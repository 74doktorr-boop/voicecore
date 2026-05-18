// ============================================
// VoiceCore — OpenAI TTS Module
// Text-to-speech via OpenAI API with streaming
// ============================================

const OpenAI = require('openai');
const { Logger } = require('../utils/logger');
const { resampleToMulaw8k } = require('../utils/audio');

const log = new Logger('TTS');

class OpenAITTS {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Convert text to speech and return mulaw audio for Twilio
   * @param {object} params
   * @param {string} params.callId - Call identifier
   * @param {string} params.text - Text to speak
   * @param {string} params.voice - Voice name
   * @param {number} params.speed - Speed multiplier
   * @returns {Buffer} mulaw 8kHz audio
   */
  async synthesize({ callId, text, voice = 'nova', speed = 1.0, model = 'gpt-4o-mini-tts' }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      return Buffer.alloc(0);
    }

    log.tts(`[${callId}] Synthesizing: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    try {
      const response = await this.client.audio.speech.create({
        model,
        voice,
        input: text,
        speed,
        response_format: 'pcm', // Raw PCM 16-bit 24kHz
      });

      // Get the raw audio buffer
      const arrayBuffer = await response.arrayBuffer();
      const pcm24k = Buffer.from(arrayBuffer);

      // Convert to mulaw 8kHz for Twilio
      const mulaw = resampleToMulaw8k(pcm24k, 24000);

      const totalTime = Date.now() - startTime;
      const durationMs = (mulaw.length / 8000) * 1000; // 8000 samples/sec
      log.metric(`[${callId}] TTS completed in ${totalTime}ms, audio: ${Math.round(durationMs)}ms`);

      return mulaw;
    } catch (error) {
      log.error(`[${callId}] TTS error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Stream TTS - synthesize and stream audio in chunks
   * For lower latency, we split text into sentences and process them
   * @param {object} params
   * @param {string} params.callId - Call identifier
   * @param {string} params.text - Full text to speak
   * @param {string} params.voice - Voice name
   * @param {Function} params.onChunk - Callback for each audio chunk
   */
  async streamSynthesize({ callId, text, voice = 'nova', speed = 1.0, model = 'gpt-4o-mini-tts', onChunk }) {
    const startTime = Date.now();
    
    if (!text || text.trim().length === 0) return;

    // Split text into sentences for streaming
    const sentences = this.splitIntoSentences(text);
    log.tts(`[${callId}] Streaming ${sentences.length} sentence(s)`);

    let firstChunkTime = null;

    for (const sentence of sentences) {
      if (!sentence.trim()) continue;

      try {
        const response = await this.client.audio.speech.create({
          model,
          voice,
          input: sentence,
          speed,
          response_format: 'pcm',
        });

        const arrayBuffer = await response.arrayBuffer();
        const pcm24k = Buffer.from(arrayBuffer);
        const mulaw = resampleToMulaw8k(pcm24k, 24000);

        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          log.metric(`[${callId}] TTS TTFB: ${firstChunkTime - startTime}ms`);
        }

        // Send in smaller chunks for smoother playback
        const chunkSize = 8000; // ~1 second of audio at 8kHz
        for (let i = 0; i < mulaw.length; i += chunkSize) {
          const chunk = mulaw.slice(i, Math.min(i + chunkSize, mulaw.length));
          if (onChunk) {
            await onChunk(chunk);
          }
        }
      } catch (error) {
        log.error(`[${callId}] TTS stream error for sentence`, { error: error.message });
      }
    }

    const totalTime = Date.now() - startTime;
    log.metric(`[${callId}] TTS stream completed in ${totalTime}ms`);
  }

  /**
   * Split text into sentences for streaming TTS
   */
  splitIntoSentences(text) {
    // Split on sentence boundaries while keeping the delimiters
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    return sentences.map(s => s.trim()).filter(s => s.length > 0);
  }
}

module.exports = { OpenAITTS };
