// ============================================
// VoiceCore — Smart TTS Router
// Auto-selects best provider based on latency,
// cost, quality preferences. Includes fallback chains.
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('TTS:ROUTER');

class TTSRouter {
  constructor(config = {}) {
    this.providers = new Map();
    this.metrics = new Map(); // provider -> { avgLatency, errorRate, callCount }
    this.cache = new Map();   // text hash -> { audio, timestamp }
    this.cacheMaxAge = 3600000; // 1 hour
    this.cacheMaxSize = 200;

    this._initProviders(config);
  }

  _initProviders(config) {
    // Cartesia (ultra-low latency)
    if (config.cartesiaApiKey) {
      const { CartesiaTTS } = require('./cartesia');
      this.providers.set('cartesia', {
        instance: new CartesiaTTS(config.cartesiaApiKey),
        priority: 1,
        avgLatency: 80,
        costPerMinute: 0.015,
        features: ['streaming', 'cloning', 'emotions'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it'],
      });
      log.info('Provider registered: Cartesia Sonic');
    }

    // ElevenLabs (premium quality)
    if (config.elevenlabsApiKey) {
      const { ElevenLabsTTS } = require('./elevenlabs');
      this.providers.set('elevenlabs', {
        instance: new ElevenLabsTTS(config.elevenlabsApiKey),
        priority: 2,
        avgLatency: 250,
        costPerMinute: 0.10,
        features: ['streaming', 'cloning', 'multilingual', 'emotions'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
      });
      log.info('Provider registered: ElevenLabs');
    }

    // OpenAI TTS (reliable, good quality)
    if (config.openaiApiKey) {
      const { OpenAITTS } = require('./openai-tts');
      this.providers.set('openai', {
        instance: new OpenAITTS(config.openaiApiKey),
        priority: 3,
        avgLatency: 300,
        costPerMinute: 0.02,
        features: ['streaming'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
      });
      log.info('Provider registered: OpenAI TTS');
    }

    // Google Cloud TTS (studio quality)
    if (config.googleApiKey) {
      const { GoogleTTS } = require('./google-tts');
      this.providers.set('google', {
        instance: new GoogleTTS(config.googleApiKey),
        priority: 4,
        avgLatency: 200,
        costPerMinute: 0.016,
        features: ['ssml', 'studio-voices'],
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'eu'],
      });
      log.info('Provider registered: Google Cloud TTS');
    }

    log.info(`TTS Router initialized with ${this.providers.size} provider(s)`);
  }

  /**
   * Synthesize with smart provider selection
   * @param {object} params
   * @param {string} params.provider - Preferred provider (optional)
   * @param {string} params.fallback - Fallback provider (optional)
   * @param {string} params.strategy - 'latency' | 'quality' | 'cost' | 'specific'
   */
  async synthesize({ callId, text, voice, speed, provider, fallback, strategy = 'latency', language = 'es' }) {
    if (!text || text.trim().length === 0) return Buffer.alloc(0);

    // Check cache first
    const cacheKey = this._cacheKey(text, voice, provider);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      log.metric(`[${callId}] TTS cache hit`);
      return cached;
    }

    // Build provider chain
    const chain = this._buildProviderChain(provider, fallback, strategy, language);

    if (chain.length === 0) {
      log.error(`[${callId}] No TTS providers available`);
      return Buffer.alloc(0);
    }

    // Try each provider in chain
    for (const providerName of chain) {
      const providerInfo = this.providers.get(providerName);
      if (!providerInfo) continue;

      try {
        const startTime = Date.now();

        const params = { callId, text, speed: speed || 1.0 };

        // Map voice parameter based on provider
        if (providerName === 'cartesia') {
          params.voice = voice || 'a0e99841-438c-4a64-b679-ae501e7d6091';
          params.language = language;
        } else if (providerName === 'elevenlabs') {
          params.voiceId = voice || '21m00Tcm4TlvDq8ikWAM';
        } else if (providerName === 'openai') {
          params.voice = voice || 'nova';
        } else if (providerName === 'google') {
          params.voice = voice || 'studio-female-es';
        }

        const audio = await providerInfo.instance.synthesize(params);
        const latency = Date.now() - startTime;

        // Update metrics
        this._updateMetrics(providerName, latency, false);

        // Cache the result
        this._addToCache(cacheKey, audio);

        log.metric(`[${callId}] TTS via ${providerName} in ${latency}ms`);
        return audio;

      } catch (error) {
        log.warn(`[${callId}] TTS ${providerName} failed: ${error.message}, trying next...`);
        this._updateMetrics(providerName, 0, true);
      }
    }

    log.error(`[${callId}] All TTS providers failed`);
    return Buffer.alloc(0);
  }

  /**
   * Build provider chain based on strategy
   */
  _buildProviderChain(preferred, fallback, strategy, language) {
    const chain = [];

    // If specific provider requested, use it first
    if (preferred && this.providers.has(preferred)) {
      chain.push(preferred);
    }

    // Add providers by strategy
    const sorted = Array.from(this.providers.entries())
      .filter(([name]) => !chain.includes(name))
      .filter(([, info]) => info.languages.includes(language))
      .sort(([, a], [, b]) => {
        switch (strategy) {
          case 'latency':
            return (this._getAvgLatency(a) || a.avgLatency) - (this._getAvgLatency(b) || b.avgLatency);
          case 'cost':
            return a.costPerMinute - b.costPerMinute;
          case 'quality':
            return a.priority - b.priority;
          default:
            return a.priority - b.priority;
        }
      });

    for (const [name] of sorted) {
      chain.push(name);
    }

    // Add explicit fallback if specified
    if (fallback && !chain.includes(fallback) && this.providers.has(fallback)) {
      chain.push(fallback);
    }

    return chain;
  }

  /**
   * Get real average latency from metrics
   */
  _getAvgLatency(providerInfo) {
    // Uses collected metrics if available
    return null; // Falls back to static avgLatency
  }

  /**
   * Update provider metrics
   */
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

  /**
   * Get provider metrics for monitoring
   */
  getMetrics() {
    const result = {};
    for (const [name, info] of this.providers) {
      const m = this.metrics.get(name) || { totalLatency: 0, callCount: 0, errorCount: 0 };
      result[name] = {
        avgLatency: m.callCount > m.errorCount
          ? Math.round(m.totalLatency / (m.callCount - m.errorCount))
          : info.avgLatency,
        callCount: m.callCount,
        errorRate: m.callCount > 0 ? Math.round((m.errorCount / m.callCount) * 100) : 0,
        costPerMinute: info.costPerMinute,
        features: info.features,
      };
    }
    return result;
  }

  /**
   * List all available voices across providers
   */
  listAvailableVoices() {
    const voices = [];
    for (const [providerName, info] of this.providers) {
      voices.push({
        provider: providerName,
        languages: info.languages,
        features: info.features,
        costPerMinute: info.costPerMinute,
        avgLatency: info.avgLatency,
      });
    }
    return voices;
  }

  // ─── Cache methods ───
  _cacheKey(text, voice, provider) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(`${text}:${voice}:${provider}`).digest('hex');
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
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    this.cache.set(key, { audio, timestamp: Date.now() });
  }
}

module.exports = { TTSRouter };
