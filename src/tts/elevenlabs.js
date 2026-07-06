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
  async synthesize({ callId, text, voiceId = (process.env.ELEVENLABS_VOICE_ID || 'dNjJKg63Fr5AXwIdkATa'), modelId, stability = 0.65, similarityBoost = 0.75, language = 'es', format = 'mulaw' }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) {
      return Buffer.alloc(0);
    }

    // eleven_flash_v2_5: baja latencia + coste ~mitad de Turbo, recomendado para teléfono.
    const resolvedModel = modelId ?? 'eleven_flash_v2_5';

    // language_code SOLO lo aceptan los modelos v2_5 (flash/turbo). En
    // eleven_multilingual_v2 (calidad máxima, lo usa la DEMO) la API devuelve
    // 400 si se envía → auto-detecta idioma. Lo omitimos según el modelo.
    const supportsLangCode = /_v2_5$/.test(resolvedModel);
    // Map BCP-47 to ElevenLabs language codes
    const LANG_MAP = { es: 'es', eu: 'es', gl: 'es', en: 'en', fr: 'fr', de: 'de', pt: 'pt', it: 'it' };
    const langCode = LANG_MAP[language] ?? 'es';

    // mp3 = navegador (demo). Telefonía: ulaw_8000 NATIVO — ElevenLabs entrega
    // el formato exacto del teléfono (6x menos bytes que PCM 24k, sin
    // transcodificar en Node → menos latencia y cero pérdida por resampleo).
    // Fallback a pcm_24000+resample si el modelo/cuenta no soporta ulaw.
    const isMp3  = format === 'mp3';
    let outFmt = isMp3 ? 'mp3_44100_128' : 'ulaw_8000';

    log.tts(`[${callId}] Synthesizing with ElevenLabs (${resolvedModel}, lang=${langCode}, ${outFmt}): "${text.substring(0, 60)}..."`);

    try {
      const doFetch = (fmt) => fetch(`${this.baseUrl}/text-to-speech/${voiceId}?output_format=${fmt}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id:      resolvedModel,
          ...(supportsLangCode ? { language_code: langCode } : {}),
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style:             0.0,
            use_speaker_boost: true,
          },
          output_format: fmt,
        }),
      });

      let response = await doFetch(outFmt);
      if (!response.ok && outFmt === 'ulaw_8000') {
        log.warn(`[${callId}] ElevenLabs rechazó ulaw_8000 (${response.status}) — reintento con pcm_24000`);
        outFmt = 'pcm_24000';
        response = await doFetch(outFmt);
      }

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
      }

      const buf = Buffer.from(await response.arrayBuffer());
      const totalTime = Date.now() - startTime;
      log.metric(`[${callId}] ElevenLabs TTS completed in ${totalTime}ms (${outFmt})`);

      if (isMp3) return buf;
      return outFmt === 'ulaw_8000' ? buf : resampleToMulaw8k(buf, 24000);
    } catch (error) {
      log.error(`[${callId}] ElevenLabs error`, { error: error.message });
      throw error;
    }
  }

  /**
   * Stream TTS with ElevenLabs streaming endpoint
   */
  async streamSynthesize({ callId, text, voiceId = (process.env.ELEVENLABS_VOICE_ID || 'dNjJKg63Fr5AXwIdkATa'), modelId, onChunk, language = 'es' }) {
    const startTime = Date.now();

    if (!text || text.trim().length === 0) return;

    const resolvedModel = modelId ?? 'eleven_flash_v2_5';
    const supportsLangCode = /_v2_5$/.test(resolvedModel);
    const LANG_MAP = { es: 'es', eu: 'es', gl: 'es', en: 'en', fr: 'fr', de: 'de', pt: 'pt', it: 'it' };
    const langCode = LANG_MAP[language] ?? 'es';

    log.tts(`[${callId}] Streaming with ElevenLabs (${resolvedModel}, lang=${langCode})`);

    try {
      const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}/stream?output_format=pcm_24000`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id:      resolvedModel,
          ...(supportsLangCode ? { language_code: langCode } : {}),
          voice_settings: {
            stability:         0.65,
            similarity_boost:  0.75,
            style:             0.0,
            use_speaker_boost: true,
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

  /**
   * Clona una voz (Instant Voice Cloning) desde una muestra de audio del dueño.
   * POST /v1/voices/add (multipart) → devuelve el voice_id nuevo. Best-effort:
   * nunca lanza; devuelve { ok, voiceId } o { ok:false, error }.
   * @param {object} p
   * @param {string} p.name        Nombre de la voz (p.ej. el del negocio)
   * @param {Buffer} p.audioBuffer Muestra de audio (unos minutos)
   * @param {string} [p.mimeType]  'audio/webm', 'audio/mpeg', 'audio/wav'…
   * @param {object} [deps]        { fetchImpl } para tests
   */
  async cloneVoice({ name, audioBuffer, mimeType = 'audio/webm', description = '' }, deps = {}) {
    const f = deps.fetchImpl || fetch;
    if (!audioBuffer || !audioBuffer.length) return { ok: false, error: 'Audio vacío' };
    try {
      const form = new FormData();
      form.append('name', String(name || 'Voz personalizada').slice(0, 80));
      if (description) form.append('description', String(description).slice(0, 300));
      form.append('remove_background_noise', 'true');
      const ext = /mpeg|mp3/.test(mimeType) ? 'mp3' : /wav/.test(mimeType) ? 'wav' : /ogg/.test(mimeType) ? 'ogg' : 'webm';
      form.append('files', new Blob([audioBuffer], { type: mimeType }), `muestra.${ext}`);

      const res = await f(`${this.baseUrl}/voices/add`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey }, // NO Content-Type: lo pone FormData con su boundary
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body && (body.detail?.message || body.detail || body.message)) || `HTTP ${res.status}`;
        log.error(`Clonado de voz falló: ${JSON.stringify(detail).slice(0, 200)}`);
        return { ok: false, error: typeof detail === 'string' ? detail : `HTTP ${res.status}` };
      }
      const voiceId = body.voice_id || body.voiceId;
      if (!voiceId) return { ok: false, error: 'ElevenLabs no devolvió voice_id' };
      log.info(`Voz clonada: ${voiceId} (${name})`);
      return { ok: true, voiceId };
    } catch (e) {
      log.error(`Clonado de voz error: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  /** Borra una voz clonada de la cuenta (DELETE /v1/voices/{id}). Best-effort. */
  async deleteVoice(voiceId, deps = {}) {
    const f = deps.fetchImpl || fetch;
    if (!voiceId) return { ok: false };
    try {
      const res = await f(`${this.baseUrl}/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE', headers: { 'xi-api-key': this.apiKey },
      });
      return { ok: res.ok };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}

module.exports = { ElevenLabsTTS };
