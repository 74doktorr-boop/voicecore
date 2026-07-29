// ============================================
// VoiceCore — Google Cloud STT Module
// Speech-to-Text v2 via streaming recognition
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('STT:GOOGLE');

class GoogleSTT {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.connections = new Map();
  }

  /**
   * Create a new STT session using Google Cloud Speech REST streaming
   * Uses short-lived recognize requests (simpler than gRPC)
   */
  createSession(callId, options = {}) {
    // V5: el códec y el idioma se derivan de verdad. Antes era
    // `encoding === 'mulaw' ? 'MULAW' : 'LINEAR16'` y `language || 'es-ES'`:
    // con Telnyx España (A-law) se configuraba LINEAR16 sobre bytes A-law —
    // ruido, no "peor calidad"— y se enviaba 'es+gl' como si fuera BCP-47.
    const { googleAudioConfig, toBCP47 } = require('./audio-format');
    const audio = googleAudioConfig(options.encoding, options.sample_rate);
    const session = {
      callId,
      isOpen: true,
      finalTranscript: '',
      currentTranscript: '',
      speechStarted: false,
      lastSpeechTime: 0,
      onTranscript: null,
      onSpeechStart: null,
      onSpeechEnd: null,
      onUtteranceEnd: null,
      startTime: Date.now(),
      audioBuffer: Buffer.alloc(0),
      processInterval: null,
      silenceTimer: null,
      utteranceEndMs: options.utteranceEndMs || 1000,
      language: toBCP47(options.language),
      sampleRate: audio.sampleRateHertz,
      encoding: audio.encoding,
      // Fallos seguidos de la API. Sin esto `isOpen` era true desde el
      // constructor y JAMÁS cambiaba: el vigilante del router daba a Google por
      // sano aunque devolviera 403 en cada petición.
      consecutiveErrors: 0,
    };

    log.stt(`[${callId}] Creating Google STT session`, { language: session.language, encoding: session.encoding, sampleRate: session.sampleRate });

    // Process audio buffer periodically (every 2 seconds)
    session.processInterval = setInterval(() => {
      if (session.audioBuffer.length > 0) {
        this._processAudioChunk(session);
      }
    }, 2000);

    this.connections.set(callId, session);
    return session;
  }

  /**
   * Process accumulated audio via Google recognize API
   */
  async _processAudioChunk(session) {
    const audioData = session.audioBuffer;
    session.audioBuffer = Buffer.alloc(0);

    if (audioData.length < 1600) return; // Skip tiny chunks

    try {
      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              encoding: session.encoding,
              sampleRateHertz: session.sampleRate,
              languageCode: session.language,
              enableAutomaticPunctuation: true,
              model: 'latest_long',
            },
            audio: {
              content: audioData.toString('base64'),
            },
          }),
        }
      );

      // ANTES: `if (!response.ok) return;` — se tragaba el error entero. Google
      // podía estar devolviendo 400 por códec mal declarado o 403 por la key, en
      // TODAS las peticiones, y no quedaba ni una línea de log. Es exactamente
      // por eso que el respaldo parecía funcionar.
      if (!response.ok) {
        const cuerpo = await response.text().catch(() => '');
        session.consecutiveErrors++;
        log.error(`[${session.callId}] Google STT ${response.status}: ${cuerpo.slice(0, 200)}`);
        if (session.consecutiveErrors >= 3 && session.isOpen) {
          // Marcarlo como cerrado es lo que permite al router darlo por caído y
          // reconectar/hacer failover en vez de seguir enviándole audio al vacío.
          session.isOpen = false;
          log.error(`[${session.callId}] Google STT fuera de servicio tras 3 errores seguidos — se marca la sesión como cerrada`);
          try {
            require('../monitoring/error-tracker').capture(
              new Error(`Google STT devuelve ${response.status} de forma sostenida`),
              'stt_google_down',
              { callId: session.callId, respuesta: cuerpo.slice(0, 200) },
            );
          } catch (_) {}
        }
        return;
      }
      session.consecutiveErrors = 0;

      const result = await response.json();
      const results = result.results || [];

      for (const r of results) {
        const alt = r.alternatives?.[0];
        if (!alt?.transcript) continue;

        const text = alt.transcript;
        const isFinal = r.isFinal !== false;

        if (isFinal) {
          session.finalTranscript += (session.finalTranscript ? ' ' : '') + text;
          // D4: la confianza se propaga. Sin ella, la escalera de confianza del
          // pipeline se salta ENTERA (todas sus comprobaciones son
          // `conf !== null && …`) — es decir, la protección contra transcripción
          // mala se desactivaba justo cuando la transcripción era peor, porque
          // solo Deepgram la enviaba.
          if (typeof alt.confidence === 'number') {
            session.finalConfidences = session.finalConfidences || [];
            session.finalConfidences.push(alt.confidence);
          }
          // Igual que Deepgram (F7): la transcripción íntegra no va a los logs.
          const mostrado = process.env.LOG_TRANSCRIPTS === '1' ? `"${text}"` : `${text.length} car.`;
          log.stt(`[${session.callId}] Final: ${mostrado}`);

          if (!session.speechStarted) {
            session.speechStarted = true;
            if (session.onSpeechStart) session.onSpeechStart(text, { confidence: typeof alt.confidence === 'number' ? alt.confidence : null });
          }

          if (session.onTranscript) {
            session.onTranscript({ text, isFinal: true, fullTranscript: session.finalTranscript });
          }

          // Utterance end detection via silence timer
          if (session.silenceTimer) clearTimeout(session.silenceTimer);
          session.silenceTimer = setTimeout(() => {
            if (session.finalTranscript && session.onUtteranceEnd) {
              const fullText = session.finalTranscript;
              const cs = session.finalConfidences || [];
              const confianza = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
              session.finalTranscript = '';
              session.currentTranscript = '';
              session.finalConfidences = [];
              session.speechStarted = false;
              // Con meta, igual que Deepgram: la escalera de confianza sigue
              // protegiendo aunque estemos en el proveedor de respaldo.
              session.onUtteranceEnd(fullText, { confidence: confianza });
            }
          }, session.utteranceEndMs);
        }
      }
    } catch (error) {
      log.error(`[${session.callId}] Google STT error`, { error: error.message });
    }
  }

  sendAudio(callId, audioData) {
    const session = this.connections.get(callId);
    if (session?.isOpen) {
      session.audioBuffer = Buffer.concat([session.audioBuffer, audioData]);
    }
  }

  closeSession(callId) {
    const session = this.connections.get(callId);
    if (session) {
      if (session.processInterval) clearInterval(session.processInterval);
      if (session.silenceTimer) clearTimeout(session.silenceTimer);
      session.isOpen = false;
      this.connections.delete(callId);
      log.stt(`[${callId}] Session destroyed`);
    }
  }

  resetTranscript(callId) {
    const session = this.connections.get(callId);
    if (session) {
      session.finalTranscript = '';
      session.currentTranscript = '';
    }
  }

  getMetrics(callId) {
    const session = this.connections.get(callId);
    if (!session) return null;
    return { callId, isOpen: session.isOpen, uptime: Date.now() - session.startTime };
  }
}

module.exports = { GoogleSTT };
