// ============================================
// VoiceCore — AssemblyAI STT Module
// Real-time speech-to-text via WebSocket
// ============================================

const WebSocket = require('ws');
const { Logger } = require('../utils/logger');

const log = new Logger('STT:ASSEMBLY');

class AssemblyAISTT {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.connections = new Map();
  }

  /**
   * Create a new streaming STT session
   */
  createSession(callId, options = {}) {
    const session = {
      connection: null,
      callId,
      isOpen: false,
      finalTranscript: '',
      currentTranscript: '',
      speechStarted: false,
      lastSpeechTime: 0,
      onTranscript: null,
      onSpeechStart: null,
      onSpeechEnd: null,
      onUtteranceEnd: null,
      startTime: Date.now(),
      keepAliveInterval: null,
      silenceTimer: null,
      utteranceEndMs: options.utteranceEndMs || 1000,
    };

    const sampleRate = options.encoding === 'mulaw' ? 8000 : (options.sample_rate || 16000);
    const encoding = options.encoding === 'mulaw' ? 'pcm_mulaw' : 'pcm_s16le';

    log.stt(`[${callId}] Creating AssemblyAI session`, { sampleRate, encoding });

    const ws = new WebSocket(
      `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${sampleRate}&encoding=${encoding}`,
      { headers: { Authorization: this.apiKey } }
    );

    ws.on('open', () => {
      session.isOpen = true;
      log.stt(`[${callId}] AssemblyAI connected`);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.message_type === 'PartialTranscript') {
          const text = msg.text || '';
          if (text) {
            session.currentTranscript = text;

            // Detect speech start
            if (!session.speechStarted && text.length > 0) {
              session.speechStarted = true;
              session.lastSpeechTime = Date.now();
              if (session.onSpeechStart) session.onSpeechStart(text);
            }

            if (session.onTranscript) {
              session.onTranscript({ text, isFinal: false, fullTranscript: session.finalTranscript });
            }
          }
        }

        if (msg.message_type === 'FinalTranscript') {
          const text = msg.text || '';
          if (text) {
            session.finalTranscript += (session.finalTranscript ? ' ' : '') + text;
            log.stt(`[${callId}] Final: "${text}"`);

            if (session.onTranscript) {
              session.onTranscript({ text, isFinal: true, fullTranscript: session.finalTranscript });
            }

            // Reset silence timer for utterance end detection
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

        if (msg.message_type === 'SessionTerminated') {
          log.stt(`[${callId}] Session terminated by server`);
        }
      } catch (e) {
        log.error(`[${callId}] Parse error`, { error: e.message });
      }
    });

    ws.on('error', (err) => {
      log.error(`[${callId}] AssemblyAI error`, { error: err.message });
    });

    ws.on('close', () => {
      session.isOpen = false;
      log.stt(`[${callId}] AssemblyAI disconnected`);
      this.connections.delete(callId);
    });

    session.connection = ws;

    // Keep alive
    session.keepAliveInterval = setInterval(() => {
      if (session.isOpen) {
        try { ws.send(JSON.stringify({ type: 'keepalive' })); } catch (e) {}
      }
    }, 8000);

    this.connections.set(callId, session);
    return session;
  }

  sendAudio(callId, audioData) {
    const session = this.connections.get(callId);
    if (session?.isOpen) {
      try {
        session.connection.send(audioData);
      } catch (e) {
        log.error(`[${callId}] Send error`, { error: e.message });
      }
    }
  }

  closeSession(callId) {
    const session = this.connections.get(callId);
    if (session) {
      if (session.keepAliveInterval) clearInterval(session.keepAliveInterval);
      if (session.silenceTimer) clearTimeout(session.silenceTimer);
      if (session.isOpen) {
        try { session.connection.send(JSON.stringify({ terminate_session: true })); } catch (e) {}
        try { session.connection.close(); } catch (e) {}
      }
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
    return { callId, isOpen: session.isOpen, uptime: Date.now() - session.startTime, speechStarted: session.speechStarted };
  }
}

module.exports = { AssemblyAISTT };
