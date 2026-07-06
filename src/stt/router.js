// ============================================
// VoiceCore — Smart STT Router
// Routes audio to the best STT provider
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('STT:ROUTER');

class STTRouter {
  constructor(config = {}) {
    this.providers = new Map();
    this._initProviders(config);
  }

  _initProviders(config) {
    if (config.deepgramApiKey) {
      const { DeepgramSTT } = require('./deepgram');
      this.providers.set('deepgram', {
        instance: new DeepgramSTT(config.deepgramApiKey),
        priority: 1,
        avgLatency: 100,
        costPerMinute: 0.0043,
        languages: ['es', 'gl', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'nl', 'eu'], // gl → se reconoce con el modelo 'es'
        models: ['nova-3', 'nova-2'],
        features: ['streaming', 'vad', 'utterance-end', 'interim'],
      });
      log.info('STT provider: Deepgram Nova-3');
    }

    if (config.assemblyaiApiKey) {
      const { AssemblyAISTT } = require('./assemblyai');
      this.providers.set('assemblyai', {
        instance: new AssemblyAISTT(config.assemblyaiApiKey),
        priority: 2,
        avgLatency: 150,
        costPerMinute: 0.0055,
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it'],
        models: ['universal-2'],
        features: ['streaming', 'utterance-end', 'interim'],
      });
      log.info('STT provider: AssemblyAI');
    }

    if (config.googleSttApiKey) {
      const { GoogleSTT } = require('./google-stt');
      this.providers.set('google', {
        instance: new GoogleSTT(config.googleSttApiKey),
        priority: 3,
        avgLatency: 300,
        costPerMinute: 0.006,
        languages: ['es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh', 'eu'],
        models: ['latest_long'],
        features: ['batch', 'punctuation'],
      });
      log.info('STT provider: Google Cloud');
    }

    log.info(`STT Router: ${this.providers.size} provider(s) ready`);
  }

  /**
   * Get the STT provider instance for a given config
   */
  getProvider(providerName) {
    if (providerName && this.providers.has(providerName)) {
      return this.providers.get(providerName).instance;
    }
    // Return highest priority (lowest number)
    let best = null;
    for (const [name, info] of this.providers) {
      if (!best || info.priority < best.priority) {
        best = { name, ...info };
      }
    }
    return best?.instance || null;
  }

  /**
   * Create a session on the specified or best provider
   */
  createSession(callId, options = {}) {
    const providerName = options.sttProvider || null;
    const provider = this.getProvider(providerName);
    if (!provider) throw new Error('No STT providers available');
    return provider.createSession(callId, options);
  }

  sendAudio(callId, audioData) {
    for (const [, info] of this.providers) {
      const session = info.instance.connections?.get(callId);
      if (session) {
        info.instance.sendAudio(callId, audioData);
        return;
      }
    }
  }

  closeSession(callId) {
    for (const [, info] of this.providers) {
      if (info.instance.connections?.has(callId)) {
        info.instance.closeSession(callId);
        return;
      }
    }
  }

  resetTranscript(callId) {
    for (const [, info] of this.providers) {
      if (info.instance.connections?.has(callId)) {
        info.instance.resetTranscript(callId);
        return;
      }
    }
  }

  getMetrics() {
    const result = {};
    for (const [name, info] of this.providers) {
      result[name] = {
        models: info.models,
        avgLatency: info.avgLatency,
        costPerMinute: info.costPerMinute,
        languages: info.languages,
        features: info.features,
      };
    }
    return result;
  }
}

module.exports = { STTRouter };
