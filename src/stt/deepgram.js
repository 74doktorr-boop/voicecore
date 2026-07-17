// ============================================
// VoiceCore — Deepgram STT Module
// Real-time speech-to-text via WebSocket streaming
// ============================================

const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { Logger } = require('../utils/logger');

const log = new Logger('STT');

// Idioma de RECONOCIMIENTO para Deepgram. Deepgram NO reconoce gallego ('gl'),
// pero el gallego lo capta perfectamente el modelo español (lenguas muy
// próximas y toda Galicia es bilingüe). El euskera ('eu') SÍ lo soporta.
// Bilingüe (es+gl / es+eu) → base español (el LLM entiende ambas del texto).
function _recognitionLang(language) {
  if (!language) return 'es';
  const l = String(language).toLowerCase();
  if (l === 'eu') return 'eu';
  if (l === 'en') return 'en';
  if (l === 'fr') return 'fr';
  // Bilingüe con inglés/francés (turismo/costa) → modelo MULTILINGÜE de Deepgram
  // (nova-3 multi reconoce es/en/fr en una sola conexión, con cambio de idioma
  // dentro de la llamada). Tarifa multilingüe.
  if (l.indexOf('+') !== -1 && (l.indexOf('en') !== -1 || l.indexOf('fr') !== -1)) return 'multi';
  // Bilingüe es+gl / es+eu → base español (lenguas muy próximas, mismo modelo).
  if (l.indexOf('gl') !== -1 || l.indexOf('+') !== -1) return 'es';
  return l;
}

// Media de confidence de los frames finales del turno (o null si no hay).
// Deepgram la emite en cada Final; hasta 2026-07-03 se TIRABA — y la
// llamada real transcrita como basura llevaba 0.63-0.78 de confidence:
// la señal para pedir confirmación estaba ahí y nadie la miraba.
function _avgConfidence(session) {
  const c = session.finalConfidences;
  if (!c || c.length === 0) return null;
  return c.reduce((a, b) => a + b, 0) / c.length;
}

class DeepgramSTT {
  constructor(apiKey) {
    this.client = createClient(apiKey);
    this.connections = new Map(); // callId -> connection
  }

  /**
   * Create a new streaming STT session for a call
   * @param {string} callId - Unique call identifier
   * @param {object} options - STT options
   * @param {Function} onTranscript - Callback for final transcripts
   * @param {Function} onUtterance - Callback for utterance end (silence detection)
   * @returns {object} Connection handle
   */
  createSession(callId, options = {}) {
    const config = {
      model: options.model || 'nova-3',
      language: _recognitionLang(options.language),
      smart_format: true,
      punctuate: true,
      interim_results: true,
      // Deepgram EXIGE >= 1000ms: por debajo, el evento UtteranceEnd se
      // desactiva en silencio → ningún turno arranca → llamada muda.
      utterance_end_ms: Math.max(1000, options.utteranceEndMs || 1000),
      vad_events: true,
      // BUG FIX: respect caller-supplied encoding/sample_rate so Vonage (linear16 @16kHz)
      // and Twilio (mulaw @8kHz) both get the correct Deepgram transcription config.
      encoding: options.encoding || 'mulaw',
      sample_rate: options.sample_rate || 8000,
      channels: 1,
      endpointing: options.endpointing || 300,
      ...options.extra
    };

    log.stt(`Creating session for call ${callId}`, { language: config.language, model: config.model });

    const connection = this.client.listen.live(config);
    
    const session = {
      connection,
      callId,
      isOpen: false,
      currentTranscript: '',
      finalTranscript: '',
      finalConfidences: [],
      speechStarted: false,
      lastSpeechTime: 0,
      onTranscript: null,
      onSpeechStart: null,
      onSpeechEnd: null,
      onUtteranceEnd: null,
      startTime: Date.now(),
    };

    // Connection opened
    connection.on(LiveTranscriptionEvents.Open, () => {
      session.isOpen = true;
      log.stt(`Session opened for call ${callId}`);
    });

    // Transcript received
    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript || '';
      const isFinal = data.is_final;
      const speechFinal = data.speech_final;

      if (transcript) {
        if (isFinal) {
          session.finalTranscript += (session.finalTranscript ? ' ' : '') + transcript;
          const conf = data.channel?.alternatives?.[0]?.confidence;
          if (typeof conf === 'number') session.finalConfidences.push(conf);
          log.stt(`[${callId}] Final: "${transcript}"${typeof conf === 'number' ? ` (conf ${conf.toFixed(2)})` : ''}`);
        } else {
          session.currentTranscript = transcript;
        }

        // Detect speech start for interruption handling. Se pasa el
        // confidence del interim: las voces de FONDO transcriben con
        // confianza baja — el pipeline lo usa para no dejar de hablar
        // por una tele o una conversación ajena (bug real 2026-07-03).
        if (!session.speechStarted) {
          session.speechStarted = true;
          session.lastSpeechTime = Date.now();
          if (session.onSpeechStart) {
            const interimConf = data.channel?.alternatives?.[0]?.confidence;
            session.onSpeechStart(transcript, { confidence: typeof interimConf === 'number' ? interimConf : null });
          }
        }

        if (session.onTranscript) {
          session.onTranscript({
            text: transcript,
            isFinal,
            speechFinal,
            fullTranscript: session.finalTranscript,
          });
        }
      }

      // speech_final indica que el hablante terminó (endpointing ~300ms) y
      // MUY A MENUDO llega en un frame VACÍO de cierre — el antiguo
      // `if (!transcript) return` de arriba se lo tragaba y el turno jamás
      // arrancaba. Consumirlo SIEMPRE, con o sin texto en este frame.
      if (speechFinal && session.onSpeechEnd) {
        const fullText = session.finalTranscript;
        const meta = { confidence: _avgConfidence(session) };
        session.speechStarted = false;
        session.finalTranscript = '';
        session.currentTranscript = '';
        session.finalConfidences = [];
        if (fullText) {
          log.stt(`[${callId}] speech_final → turno: "${fullText.slice(0, 60)}"`);
          session.onSpeechEnd(fullText, meta);
        }
      }
    });

    // Utterance end (silence detected after speech)
    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      log.stt(`[${callId}] Utterance end detected`);
      if (session.finalTranscript && session.onUtteranceEnd) {
        const fullText = session.finalTranscript;
        const meta = { confidence: _avgConfidence(session) };
        session.finalTranscript = '';
        session.currentTranscript = '';
        session.speechStarted = false;
        session.finalConfidences = [];
        session.onUtteranceEnd(fullText, meta);
      }
    });

    // Speech started event (VAD)
    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      session.speechStarted = true;
      session.lastSpeechTime = Date.now();
      if (session.onSpeechStart) {
        session.onSpeechStart('');
      }
    });

    // Error handling
    connection.on(LiveTranscriptionEvents.Error, (err) => {
      log.error(`[${callId}] Deepgram error`, { error: err.message || err });
    });

    // Connection closed
    connection.on(LiveTranscriptionEvents.Close, () => {
      session.isOpen = false;
      log.stt(`[${callId}] Session closed`);
      this.connections.delete(callId);
    });

    // Keep alive
    session.keepAliveInterval = setInterval(() => {
      if (session.isOpen) {
        try {
          connection.keepAlive();
        } catch (e) {
          // Ignore keepalive errors
        }
      }
    }, 8000);

    this.connections.set(callId, session);
    return session;
  }

  /**
   * Send audio data to the STT session
   * @param {string} callId - Call identifier
   * @param {Buffer} audioData - Raw mulaw audio data
   */
  sendAudio(callId, audioData) {
    const session = this.connections.get(callId);
    if (session?.isOpen) {
      try {
        session.connection.send(audioData);
      } catch (e) {
        log.error(`[${callId}] Error sending audio to Deepgram`, { error: e.message });
      }
    }
  }

  /**
   * Close a STT session
   * @param {string} callId - Call identifier
   */
  closeSession(callId) {
    const session = this.connections.get(callId);
    if (session) {
      if (session.keepAliveInterval) {
        clearInterval(session.keepAliveInterval);
      }
      if (session.connection) {
        try { session.connection.requestClose(); } catch (e) { /* ignore */ }
        // Soltar los listeners al instante (auditoría 2026-07-07): sin esto
        // el cierre del socket los libera "cuando toque"; con miles de llamadas
        // al día conviene romper el ciclo ya, no esperar al GC.
        try { session.connection.removeAllListeners(); } catch (e) { /* ignore */ }
      }
      this.connections.delete(callId);
      log.stt(`[${callId}] Session destroyed`);
    }
  }

  /**
   * Reset transcript accumulator (after processing)
   */
  resetTranscript(callId) {
    const session = this.connections.get(callId);
    if (session) {
      session.finalTranscript = '';
      session.currentTranscript = '';
    }
  }

  /**
   * Get session metrics
   */
  getMetrics(callId) {
    const session = this.connections.get(callId);
    if (!session) return null;
    return {
      callId,
      isOpen: session.isOpen,
      uptime: Date.now() - session.startTime,
      speechStarted: session.speechStarted,
    };
  }
}

module.exports = { DeepgramSTT, _recognitionLang };
