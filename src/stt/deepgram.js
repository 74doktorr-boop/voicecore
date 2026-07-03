// ============================================
// VoiceCore — Deepgram STT Module
// Real-time speech-to-text via WebSocket streaming
// ============================================

const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { Logger } = require('../utils/logger');

const log = new Logger('STT');

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
      language: options.language || 'es',
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
          log.stt(`[${callId}] Final: "${transcript}"`);
        } else {
          session.currentTranscript = transcript;
        }

        // Detect speech start for interruption handling
        if (!session.speechStarted) {
          session.speechStarted = true;
          session.lastSpeechTime = Date.now();
          if (session.onSpeechStart) {
            session.onSpeechStart(transcript);
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
        session.speechStarted = false;
        session.finalTranscript = '';
        session.currentTranscript = '';
        if (fullText) {
          log.stt(`[${callId}] speech_final → turno: "${fullText.slice(0, 60)}"`);
          session.onSpeechEnd(fullText);
        }
      }
    });

    // Utterance end (silence detected after speech)
    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      log.stt(`[${callId}] Utterance end detected`);
      if (session.finalTranscript && session.onUtteranceEnd) {
        const fullText = session.finalTranscript;
        session.finalTranscript = '';
        session.currentTranscript = '';
        session.speechStarted = false;
        session.onUtteranceEnd(fullText);
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
      if (session.isOpen) {
        try {
          session.connection.requestClose();
        } catch (e) {
          // Ignore close errors
        }
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

module.exports = { DeepgramSTT };
