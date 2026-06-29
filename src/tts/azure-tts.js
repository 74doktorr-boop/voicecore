// ============================================
// VoiceCore — Azure Neural TTS Module
// Voces neurales de Microsoft. Muy buen castellano (Elvira/Álvaro),
// precio bajísimo (~$15/1M chars) → margen máximo en el plan de 49€.
// Devuelve mulaw 8 kHz DIRECTO (formato de telefonía), sin resamplear.
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('TTS:AZURE');

class AzureTTS {
  /**
   * @param {string} subscriptionKey - Azure Speech key
   * @param {string} region          - p.ej. 'westeurope', 'francecentral'
   */
  constructor(subscriptionKey, region = 'westeurope') {
    this.key = subscriptionKey;
    this.region = region;
    this.endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }

  /**
   * Presets de voz → voz neural de Azure. 'es-ES' = castellano de España.
   */
  static VOICES = {
    // Castellano (España)
    'elvira':   'es-ES-ElviraNeural',     // femenina, cálida (por defecto)
    'alvaro':   'es-ES-AlvaroNeural',     // masculina
    'ximena':   'es-ES-XimenaNeural',     // femenina
    'arabella': 'es-ES-ArabellaMultilingualNeural',
    'female-es': 'es-ES-ElviraNeural',
    'male-es':   'es-ES-AlvaroNeural',
    // Galego
    'sabela':   'gl-ES-SabelaNeural',     // femenina
    'roi':      'gl-ES-RoiNeural',        // masculina
    'female-gl': 'gl-ES-SabelaNeural',
    // Euskera
    'ainhoa':   'eu-ES-AinhoaNeural',     // femenina
    'ander':    'eu-ES-AnderNeural',      // masculina
    'female-eu': 'eu-ES-AinhoaNeural',
  };

  /** Voz por defecto según idioma BCP-47 corto. */
  static defaultVoiceFor(language = 'es') {
    if (language === 'gl') return 'gl-ES-SabelaNeural';
    if (language === 'eu') return 'eu-ES-AinhoaNeural';
    return 'es-ES-ElviraNeural';
  }

  static _escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /**
   * @param {object} params
   * @param {string} params.text
   * @param {string} [params.voice]    - preset (ver VOICES) o nombre de voz Azure
   * @param {number} [params.speed]    - 1.0 = normal
   * @param {string} [params.language] - 'es' | 'gl' | 'eu'
   * @param {string} [params.format]   - 'mulaw' (telefonía, por defecto) | 'mp3' (navegador)
   * @returns {Promise<Buffer>} audio en el formato pedido
   */
  async synthesize({ callId, text, voice, speed = 1.0, language = 'es', format = 'mulaw' }) {
    if (!text || !text.trim()) return Buffer.alloc(0);
    if (!this.key) throw new Error('Azure Speech key no configurada');

    // Resolver nombre de voz: preset → voz Azure; si no, usar tal cual; si nada,
    // la voz por defecto del idioma.
    const voiceName = (voice && AzureTTS.VOICES[voice])
      || (voice && /Neural$/i.test(voice) ? voice : null)
      || AzureTTS.defaultVoiceFor(language);

    // Idioma del <speak> derivado del prefijo de la voz (es-ES, gl-ES, eu-ES).
    const xmlLang = voiceName.split('-').slice(0, 2).join('-') || 'es-ES';
    const ratePct = `${Math.round((speed - 1) * 100)}%`;

    const ssml =
      `<speak version='1.0' xml:lang='${xmlLang}'>` +
      `<voice name='${voiceName}'><prosody rate='${ratePct}'>` +
      `${AzureTTS._escapeXml(text)}` +
      `</prosody></voice></speak>`;

    log.tts(`[${callId}] Azure TTS: "${text.substring(0, 60)}${text.length > 60 ? '…' : ''}" [${voiceName}]`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.key,
          'Content-Type': 'application/ssml+xml',
          // mulaw 8 kHz = telefonía (Twilio/Vonage); mp3 = reproducible en navegador (demo).
          'X-Microsoft-OutputFormat': format === 'mp3'
            ? 'audio-24khz-96kbitrate-mono-mp3'
            : 'raw-8khz-8bit-mono-mulaw',
          'User-Agent': 'NodeFlow',
        },
        body: ssml,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Azure TTS ${res.status}: ${detail.slice(0, 160)}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { AzureTTS };
