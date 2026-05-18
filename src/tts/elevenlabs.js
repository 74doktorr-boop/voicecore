// ============================================
// VoiceCore — ElevenLabs TTS Module (Premium)
// High-quality text-to-speech via ElevenLabs API
// ============================================

const { Logger } = require('../utils/logger');
const { resampleToMulaw8k } = require('../utils/audio');

const log = new Logger('TTS:11LABS');

class ElevenLabsTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  /**
   * Convert text to speech using ElevenLabs
   * @param {object} params
   * @param {string} params.callId - Call identifier
   * @param {string} params.text - Text to speak
   * @param {string} params.voiceId - ElevenLabs voice ID
   * @param {string} params.modelId - Model ID
   * @returns {Buffer} mulaw 8kHz audio
   */
  async synthesize({ callId, text, voiceId = '21m00Tcm4TlvDq8ikWAM', modelId = 'eleven_multilingual_v2', stability = 0.5, similarityBoost = 0.75 }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      return Buffer.alloc(0);
    }

    log.tts(`[${callId}] Synthesizing with ElevenLabs: "${text.substring(0, 60)}..."`);

    try {
      const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
          },
          output_format: 'pcm_24000',
        }),
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const pcm24k = Buffer.from(arrayBuffer);

      // Convert to mulaw 8kHz for Twilio
      const mulaw = resampleToMulaw8k(pcm24k, 24000);

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] ElevenLabs TTS completed in ${totalTime}ms`);

      return mulaw;
    } catch (error) {
      log.error(`[${callId}] ElevenLabs error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Stream TTS with ElevenLabs streaming endpoint
   */
  async streamSynthesize({ callId, text, voiceId = '21m00Tcm4TlvDq8ikWAM', modelId = 'eleven_multilingual_v2', onChunk }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) return;

    log.tts(`[${callId}] Streaming with ElevenLabs`);

    try {
      const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          output_format: 'pcm_24000',
        }),
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs stream error: ${response.status}`);
      }

      const reader = response.body.getReader();
      let pcmBuffer = Buffer.alloc(0);
      let firstChunkTime = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          log.metric(`[${callId}] ElevenLabs TTFB: ${firstChunkTime - startTime}ms`);
        }

        // Accumulate PCM data
        pcmBuffer = Buffer.concat([pcmBuffer, Buffer.from(value)]);

        // Process in chunks (1 second = 48000 bytes at 24kHz 16-bit)
        while (pcmBuffer.length >= 48000) {
          const chunk = pcmBuffer.slice(0, 48000);
          pcmBuffer = pcmBuffer.slice(48000);
          const mulaw = resampleToMulaw8k(chunk, 24000);
          if (onChunk) await onChunk(mulaw);
        }
      }

      // Process remaining audio
      if (pcmBuffer.length > 0) {
        const mulaw = resampleToMulaw8k(pcmBuffer, 24000);
        if (onChunk) await onChunk(mulaw);
      }

      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] ElevenLabs stream completed in ${totalTime}ms`);
    } catch (error) {
      log.error(`[${callId}] ElevenLabs stream error`, { error: error.message });
      throw error;
    }
  }
}

module.exports = { ElevenLabsTTS };
