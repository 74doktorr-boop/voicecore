// ============================================
// VoiceCore — Smart TTS Router
// Selects the best provider per request based on strategy, language and
// real-time metrics. Includes fallback chains and result caching.
//
// Language affinity
// -----------------
// Some providers are the *only* good option for a language even if they are
// slower than alternatives. A provider can declare `languageAffinity: ['eu']`
// to signal "I'm the preferred choice for these languages". When the router
// builds a chain and no explicit provider is requested, affinity providers
// jump to the front of the queue for those languages regardless of strategy.
//
// Example: local TTS is ~600 ms but is the only provider with a native Basque
// voice. With strategy:'latency', Google (200 ms) would otherwise win, giving
// the caller a generic synthesized voice instead of the real Basque one.
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('TTS:ROUTER');

class TTSRouter {
  constructor(config = {}) {
    this.providers = new Map();
    this.metrics = new Map();
    this.cache = new Map();
    this.cacheMaxAge = 3_600_000; // 1 hour
    this.cacheMaxSize = 200;

    this._initProviders(config);
  }

  _initProviders(config) {
    // Azure Neural TTS — castellano excelente, coste bajísimo → margen máximo.
    // Devuelve mulaw 8 kHz directo. Proveedor por defecto del plan de 49€.
    if (config.azureSpeechKey) {
      const { AzureTTS } = require('./azure-tts');
      this.providers.set('azure', {
        instance: new AzureTTS(config.azureSpeechKey, config.azureSpeechRegion || 'westeurope'),
        priority: 1,
        avgLatency: 220,
        costPerMinute: 0.013,
        features: ['streaming', 'ssml', 'multilingual'],
        languages: ['es', 'gl', 'eu', 'ca'],
        languageAffinity: [],
      });
      log.info('Provider registered: Azure Neural TTS');
    }

    // Cartesia Sonic — ultra-low latency via State Space Models
    if (config.cartesiaApiKey) {
      const { CartesiaTTS } = require('./cartesia');
      this.providers.set('cartesia', {
        instance: new CartesiaTTS(config.cartesiaApiKey),
        priority: 1,
        avgLatency: 80,
        costPerMinute: 0.015,
        features: ['streaming', 'cloning', 'emotions'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it'],
        languageAffinity: [],
      });
      log.info('Provider registered: Cartesia Sonic');
    }

    // ElevenLabs — premium multilingual quality
    if (config.elevenlabsApiKey) {
      const { ElevenLabsTTS } = require('./elevenlabs');
      this.providers.set('elevenlabs', {
        instance: new ElevenLabsTTS(config.elevenlabsApiKey),
        priority: 2,
        avgLatency: 250,
        costPerMinute: 0.10,
        features: ['streaming', 'cloning', 'multilingual', 'emotions'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
        languageAffinity: [],
      });
      log.info('Provider registered: ElevenLabs');
    }

    // OpenAI TTS — reliable, good quality, widely supported
    if (config.openaiApiKey) {
      const { OpenAITTS } = require('./openai-tts');
      this.providers.set('openai', {
        instance: new OpenAITTS(config.openaiApiKey),
        priority: 3,
        avgLatency: 300,
        costPerMinute: 0.02,
        features: ['streaming'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
        languageAffinity: [],
      });
      log.info('Provider registered: OpenAI TTS');
    }

    // Google Cloud TTS — studio quality, SSML support
    if (config.googleApiKey) {
      const { GoogleTTS } = require('./google-tts');
      this.providers.set('google', {
        instance: new GoogleTTS(config.googleApiKey),
        priority: 4,
        avgLatency: 200,
        costPerMinute: 0.016,
        features: ['ssml', 'studio-voices'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'eu'],
        languageAffinity: [],
      });
      log.info('Provider registered: Google Cloud TTS');
    }

    // Local TTS — XTTS v2 on RTX 4090, native Basque voice, zero API cost.
    // Has language affinity for 'eu': even though latency is higher than Google,
    // it is the only provider with a real cloned Basque voice.
    if (config.localTtsUrl) {
      const { LocalTTS } = require('./local-tts');
      this.providers.set('local', {
        instance: new LocalTTS(config.localTtsUrl),
        priority: 0,
        avgLatency: 600,
        costPerMinute: 0,
        features: ['cloning', 'euskera'],
        languages: ['eu', 'es'],
        languageAffinity: ['eu'],  // Always preferred for Basque
      });
      log.info(`Provider registered: Local TTS (${config.localTtsUrl})`);
    }

    // Local TTS (Galician) — Proyecto Nós / F5-TTS cross-lingual on RTX 4090.
    // Has language affinity for 'gl': only provider with a native Galician voice.
    // URL configured separately via LOCAL_TTS_URL_GL env var so it can point to
    // a different model endpoint than the Basque one.
    if (config.localTtsUrlGl) {
      const { LocalTTS } = require('./local-tts');
      this.providers.set('local-gl', {
        instance: new LocalTTS(config.localTtsUrlGl),
        priority: 0,
        avgLatency: 600,
        costPerMinute: 0,
        features: ['cloning', 'galego'],
        languages: ['gl', 'es', 'pt'],
        languageAffinity: ['gl'],  // Always preferred for Galician
      });
      log.info(`Provider registered: Local TTS GL (${config.localTtsUrlGl})`);
    }

    log.info(`TTS Router initialized with ${this.providers.size} provider(s)`);
  }

  /**
   * Synthesize with smart provider selection.
   *
   * @param {object}  params
   * @param {string}  params.callId
   * @param {string}  params.text
   * @param {string}  [params.voice]     - Voice name / ID (provider-specific)
   * @param {number}  [params.speed]     - Playback speed (1.0 = normal)
   * @param {string}  [params.provider]  - Force a specific provider
   * @param {string}  [params.fallback]  - Explicit fallback provider
   * @param {string}  [params.strategy]  - 'latency' | 'quality' | 'cost' | 'specific'
   * @param {string}  [params.language]  - BCP-47 language code (default 'es')
   * @returns {Promise<Buffer>} mulaw 8 kHz audio
   */
  async synthesize({ callId, text, voice, speed, provider, fallback, strategy = 'latency', language = 'es' }) {
    if (!text?.trim()) return Buffer.alloc(0);

    // Cache check
    const cacheKey = this._cacheKey(text, voice, provider, language);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      log.metric(`[${callId}] TTS cache hit`);
      return cached;
    }

    const chain = this._buildProviderChain(provider, fallback, strategy, language);
    if (chain.length === 0) {
      log.error(`[${callId}] No TTS providers available for language '${language}'`);
      return Buffer.alloc(0);
    }

    for (const providerName of chain) {
      const info = this.providers.get(providerName);
      if (!info) continue;

      try {
        const t0 = Date.now();
        const params = this._buildParams(providerName, voice, speed, language);
        params.callId = callId;
        params.text = text;

        const audio = await info.instance.synthesize(params);
        const latency = Date.now() - t0;

        this._updateMetrics(providerName, latency, false);
        this._addToCache(cacheKey, audio);

        log.metric(`[${callId}] TTS via ${providerName} in ${latency}ms`);
        return audio;

      } catch (err) {
        log.warn(`[${callId}] TTS '${providerName}' failed: ${err.message} — trying next`);
        this._updateMetrics(providerName, 0, true);
      }
    }

    log.error(`[${callId}] All TTS providers failed`);
    return Buffer.alloc(0);
  }

  // ── Chain builder ─────────────────────────────────────────────────────────

  _buildProviderChain(preferred, fallback, strategy, language) {
    const chain = [];

    // 1. Explicit provider request is always first
    if (preferred && this.providers.has(preferred)) {
      chain.push(preferred);
    }

    // 2. Language-affinity providers jump to the front (if not already there)
    //    Only applies when no explicit provider is requested.
    if (!preferred) {
      for (const [name, info] of this.providers) {
        if (info.languageAffinity?.includes(language) && !chain.includes(name)) {
          chain.push(name);
        }
      }
    }

    // 3. Remaining compatible providers sorted by strategy
    const remaining = Array.from(this.providers.entries())
      .filter(([name]) => !chain.includes(name))
      .filter(([, info]) => info.languages.includes(language))
      .sort(([nameA, a], [nameB, b]) => {
        switch (strategy) {
          case 'latency':
            // BUG-29 FIX: _realAvgLatency must receive the provider *name* (string key),
            // not the info object — this.metrics is keyed by name.
            return (this._realAvgLatency(nameA) ?? a.avgLatency) -
                   (this._realAvgLatency(nameB) ?? b.avgLatency);
          case 'cost':
            return a.costPerMinute - b.costPerMinute;
          case 'quality':
          default:
            return a.priority - b.priority;
        }
      });

    for (const [name] of remaining) chain.push(name);

    // 4. Explicit fallback appended if not already present
    if (fallback && !chain.includes(fallback) && this.providers.has(fallback)) {
      chain.push(fallback);
    }

    return chain;
  }

  _buildParams(providerName, voice, speed, language) {
    const params = { speed: speed ?? 1.0 };

    switch (providerName) {
      case 'azure':
        params.voice = voice ?? null;  // null → AzureTTS elige la voz por defecto del idioma
        params.language = language;
        break;
      case 'cartesia':
        params.voice = voice ?? 'a0e99841-438c-4a64-b679-ae501e7d6091';
        params.language = language;
        break;
      case 'elevenlabs':
        params.voiceId   = voice ?? '21m00Tcm4TlvDq8ikWAM';
        params.language  = language;  // lock language — prevents mid-speech switching
        break;
      case 'openai':
        params.voice = voice ?? 'nova';
        break;
      case 'google':
        params.voice = voice ?? 'studio-female-es';
        break;
      case 'local':
        params.voice = voice ?? 'ane';
        params.language = language;
        break;
      case 'local-gl':
        params.voice = voice ?? 'default';  // Will be updated when GL voices are cloned
        params.language = language;
        break;
      default:
        params.voice = voice;
    }

    return params;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  _realAvgLatency(providerName) {
    const m = this.metrics.get(providerName);
    if (!m || m.callCount <= m.errorCount) return null;
    return Math.round(m.totalLatency / (m.callCount - m.errorCount));
  }

  _updateMetrics(providerName, latency, isError) {
    if (!this.metrics.has(providerName)) {
      this.metrics.set(providerName, { totalLatency: 0, callCount: 0, errorCount: 0 });
    }
    const m = this.metrics.get(providerName);
    m.callCount++;
    if (isError) {
      m.errorCount++;
    } else {
      m.totalLatency += latency;
    }
  }

  getMetrics() {
    const result = {};
    for (const [name, info] of this.providers) {
      const m = this.metrics.get(name) ?? { totalLatency: 0, callCount: 0, errorCount: 0 };
      const goodCalls = m.callCount - m.errorCount;
      result[name] = {
        avgLatency: goodCalls > 0 ? Math.round(m.totalLatency / goodCalls) : info.avgLatency,
        callCount: m.callCount,
        errorRate: m.callCount > 0 ? Math.round((m.errorCount / m.callCount) * 100) : 0,
        costPerMinute: info.costPerMinute,
        features: info.features,
        languageAffinity: info.languageAffinity ?? [],
      };
    }
    return result;
  }

  listAvailableVoices() {
    const voices = [];
    for (const [providerName, info] of this.providers) {
      voices.push({
        provider: providerName,
        languages: info.languages,
        languageAffinity: info.languageAffinity ?? [],
        features: info.features,
        costPerMinute: info.costPerMinute,
        avgLatency: info.avgLatency,
      });
    }
    return voices;
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  _cacheKey(text, voice, provider, language) {
    const crypto = require('crypto');
    return crypto
      .createHash('md5')
      .update(`${text}:${voice}:${provider}:${language}`)
      .digest('hex');
  }

  _getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheMaxAge) {
      this.cache.delete(key);
      return null;
    }
    return entry.audio;
  }

  _addToCache(key, audio) {
    if (this.cache.size >= this.cacheMaxSize) {
      // Evict oldest entry
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { audio, timestamp: Date.now() });
  }
}

module.exports = { TTSRouter };
