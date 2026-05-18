// ============================================
// VoiceCore — Cartesia Sonic TTS (Ultra-Low Latency)
// 40-90ms TTFA via State Space Models
// ============================================

const { Logger } = require('../utils/logger');
const { resampleToMulaw8k } = require('../utils/audio');

const log = new Logger('TTS:CARTESIA');

class CartesiaTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.cartesia.ai';
    this.defaultModelId = 'sonic-2';
  }

  /**
   * Synthesize text to speech with Cartesia Sonic
   * @param {object} params
   * @param {string} params.callId - Call identifier
   * @param {string} params.text - Text to speak
   * @param {string} params.voice - Cartesia voice ID
   * @param {number} params.speed - Speed multiplier
   * @returns {Buffer} mulaw 8kHz audio for Twilio
   */
  async synthesize({ callId, text, voice = 'a0e99841-438c-4a64-b679-ae501e7d6091', speed = 1.0, language = 'es' }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      return Buffer.alloc(0);
    }

    log.tts(`[${callId}] Cartesia synthesizing: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    try {
      const response = await fetch(`${this.baseUrl}/tts/bytes`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: this.defaultModelId,
          transcript: text,
          voice: {
            mode: 'id',
            id: voice,
          },
          language,
          output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 24000,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cartesia API error: ${response.status} — ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const pcm24k = Buffer.from(arrayBuffer);

      // Convert to mulaw 8kHz for Twilio
      const mulaw = resampleToMulaw8k(pcm24k, 24000);

      const totalTime = Date.now() - startTime;
      const durationMs = (mulaw.length / 8000) * 1000;
      log.metric(`[${callId}] Cartesia TTS completed in ${totalTime}ms, audio: ${Math.round(durationMs)}ms`);

      return mulaw;
    } catch (error) {
      log.error(`[${callId}] Cartesia error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Stream TTS with Cartesia SSE streaming endpoint
   * Ultra-low latency: first audio chunk in 40-90ms
   */
  async streamSynthesize({ callId, text, voice = 'a0e99841-438c-4a64-b679-ae501e7d6091', language = 'es', onChunk }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) return;

    log.tts(`[${callId}] Cartesia streaming synthesis`);

    try {
      const response = await fetch(`${this.baseUrl}/tts/sse`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: this.defaultModelId,
          transcript: text,
          voice: { mode: 'id', id: voice },
          language,
          output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 24000,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Cartesia stream error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstChunkTime = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            if (event.data) {
              const pcmChunk = Buffer.from(event.data, 'base64');

              if (!firstChunkTime) {
                firstChunkTime = Date.now();
                log.metric(`[${callId}] Cartesia TTFB: ${firstChunkTime - startTime}ms`);
              }

              const mulaw = resampleToMulaw8k(pcmChunk, 24000);
              if (onChunk) await onChunk(mulaw);
            }
          } catch (e) {
            // Skip malformed events
          }
        }
      }

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] Cartesia stream completed in ${totalTime}ms`);
    } catch (error) {
      log.error(`[${callId}] Cartesia stream error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Clone a voice from audio sample
   * @param {Buffer} audioBuffer - Audio sample (3-15 seconds)
   * @param {string} name - Name for the cloned voice
   * @returns {object} Voice ID and metadata
   */
  async cloneVoice({ audioBuffer, name, description = '' }) {
    log.info(`Cloning voice: ${name}`);

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      formData.append('clip', new Blob([audioBuffer], { type: 'audio/wav' }), 'sample.wav');

      const response = await fetch(`${this.baseUrl}/voices/clone/clip`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2024-06-10',
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Clone error: ${response.status}`);
      }

      const result = await response.json();
      log.info(`Voice cloned: ${result.id} — ${name}`);
      return result;
    } catch (error) {
      log.error(`Voice clone failed`, { error: error.message });
      throw error;
    }
  }

  /**
   * List available Cartesia voices
   */
  async listVoices() {
    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': '2024-06-10',
        },
      });
      if (!response.ok) throw new Error(`List voices error: ${response.status}`);
      return await response.json();
    } catch (error) {
      log.error('Failed to list Cartesia voices', { error: error.message });
      throw error;
    }
  }
}

module.exports = { CartesiaTTS };
