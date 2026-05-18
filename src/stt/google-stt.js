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
      language: options.language || 'es-ES',
      sampleRate: options.encoding === 'mulaw' ? 8000 : 16000,
      encoding: options.encoding === 'mulaw' ? 'MULAW' : 'LINEAR16',
    };

    log.stt(`[${callId}] Creating Google STT session`, { language: session.language });

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

      if (!response.ok) return;

      const result = await response.json();
      const results = result.results || [];

      for (const r of results) {
        const alt = r.alternatives?.[0];
        if (!alt?.transcript) continue;

        const text = alt.transcript;
        const isFinal = r.isFinal !== false;

        if (isFinal) {
          session.finalTranscript += (session.finalTranscript ? ' ' : '') + text;
          log.stt(`[${session.callId}] Final: "${text}"`);

          if (!session.speechStarted) {
            session.speechStarted = true;
            if (session.onSpeechStart) session.onSpeechStart(text);
          }

          if (session.onTranscript) {
            session.onTranscript({ text, isFinal: true, fullTranscript: session.finalTranscript });
          }

          // Utterance end detection via silence timer
          if (session.silenceTimer) clearTimeout(session.silenceTimer);
          session.silenceTimer = setTimeout(() => {
            if (session.finalTranscript && session.onUtteranceEnd) {
              const fullText = session.finalTranscript;
              session.finalTranscript = '';
              session.currentTranscript = '';
              session.speechStarted = false;
              session.onUtteranceEnd(fullText);
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
