// ============================================
// VoiceCore — Google Cloud TTS Module
// Premium voices: Studio, WaveNet, Journey
// ============================================

const { Logger } = require('../utils/logger');
const { resampleToMulaw8k } = require('../utils/audio');

const log = new Logger('TTS:GOOGLE');

class GoogleTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://texttospeech.googleapis.com/v1';
  }

  /**
   * Voice presets for Spanish
   */
  static VOICES = {
    // Studio voices (highest quality)
    'studio-female-es': { name: 'es-ES-Studio-C', ssmlGender: 'FEMALE' },
    'studio-male-es': { name: 'es-ES-Studio-F', ssmlGender: 'MALE' },
    // Journey voices (conversational)
    'journey-female-es': { name: 'es-ES-Journey-F', ssmlGender: 'FEMALE' },
    'journey-male-es': { name: 'es-ES-Journey-D', ssmlGender: 'MALE' },
    // WaveNet voices
    'wavenet-female-es': { name: 'es-ES-Wavenet-C', ssmlGender: 'FEMALE' },
    'wavenet-male-es': { name: 'es-ES-Wavenet-B', ssmlGender: 'MALE' },
    // Neural2 voices (good balance)
    'neural-female-es': { name: 'es-ES-Neural2-A', ssmlGender: 'FEMALE' },
    'neural-male-es': { name: 'es-ES-Neural2-B', ssmlGender: 'MALE' },
    // Latam variants
    'studio-female-mx': { name: 'es-US-Studio-B', ssmlGender: 'FEMALE' },
    'neural-male-mx': { name: 'es-US-Neural2-B', ssmlGender: 'MALE' },
  };

  /**
   * Synthesize text to speech
   * @param {object} params
   * @returns {Buffer} mulaw 8kHz audio for Twilio
   */
  async synthesize({ callId, text, voice = 'studio-female-es', speed = 1.0, pitch = 0 }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      return Buffer.alloc(0);
    }

    const voiceConfig = GoogleTTS.VOICES[voice] || { name: voice, ssmlGender: 'FEMALE' };
    const languageCode = voiceConfig.name.split('-').slice(0, 2).join('-');

    log.tts(`[${callId}] Google TTS: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}" [${voiceConfig.name}]`);

    try {
      const response = await fetch(`${this.baseUrl}/text:synthesize?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode,
            name: voiceConfig.name,
            ssmlGender: voiceConfig.ssmlGender,
          },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 24000,
            speakingRate: speed,
            pitch,
            effectsProfileId: ['telephony-class-application'],
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google TTS error: ${response.status} — ${errorText}`);
      }

      const result = await response.json();
      const pcm24k = Buffer.from(result.audioContent, 'base64');

      // Convert to mulaw 8kHz for Twilio
      const mulaw = resampleToMulaw8k(pcm24k, 24000);

      const totalTime = Date.now() - startTime;
      const durationMs = (mulaw.length / 8000) * 1000;
      log.metric(`[${callId}] Google TTS completed in ${totalTime}ms, audio: ${Math.round(durationMs)}ms`);

      return mulaw;
    } catch (error) {
      log.error(`[${callId}] Google TTS error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Synthesize SSML for advanced control
   */
  async synthesizeSSML({ callId, ssml, voice = 'studio-female-es', speed = 1.0 }) {
    const startTime = Date.now();

    const voiceConfig = GoogleTTS.VOICES[voice] || { name: voice, ssmlGender: 'FEMALE' };
    const languageCode = voiceConfig.name.split('-').slice(0, 2).join('-');

    try {
      const response = await fetch(`${this.baseUrl}/text:synthesize?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { ssml },
          voice: {
            languageCode,
            name: voiceConfig.name,
            ssmlGender: voiceConfig.ssmlGender,
          },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: 24000,
            speakingRate: speed,
            effectsProfileId: ['telephony-class-application'],
          },
        }),
      });

      if (!response.ok) throw new Error(`Google SSML TTS error: ${response.status}`);

      const result = await response.json();
      const pcm24k = Buffer.from(result.audioContent, 'base64');
      const mulaw = resampleToMulaw8k(pcm24k, 24000);

      log.metric(`[${callId}] Google SSML TTS completed in ${Date.now() - startTime}ms`);
      return mulaw;
    } catch (error) {
      log.error(`[${callId}] Google SSML TTS error`, { error: error.message });
      throw error;
    }
  }

  /**
   * List available voices for a language
   */
  async listVoices(languageCode = 'es') {
    try {
      const response = await fetch(
        `${this.baseUrl}/voices?key=${this.apiKey}&languageCode=${languageCode}`
      );
      if (!response.ok) throw new Error(`List voices error: ${response.status}`);
      const result = await response.json();
      return result.voices || [];
    } catch (error) {
      log.error('Failed to list Google voices', { error: error.message });
      throw error;
    }
  }
}

module.exports = { GoogleTTS };
