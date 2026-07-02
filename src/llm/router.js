// ============================================
// VoiceCore — Smart LLM Router
// Auto-selects best LLM provider with fallback
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('LLM:ROUTER');

class LLMRouter {
  constructor(config = {}) {
    this.providers = new Map();
    this.metrics = new Map();
    this._initProviders(config);
  }

  _initProviders(config) {
    if (config.groqApiKey) {
      const { GroqLLM } = require('./groq');
      this.providers.set('groq', {
        instance: new GroqLLM(config.groqApiKey),
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        avgTTFT: 80, costPer1kTokens: 0.05,
      });
      log.info('LLM provider: Groq (ultra-fast)');
    }

    if (config.openaiApiKey) {
      const { OpenAILLM } = require('./openai');
      this.providers.set('openai', {
        instance: new OpenAILLM(config.openaiApiKey),
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
        avgTTFT: 300, costPer1kTokens: 0.15,
      });
      log.info('LLM provider: OpenAI');
    }

    if (config.anthropicApiKey) {
      const { AnthropicLLM } = require('./anthropic');
      this.providers.set('anthropic', {
        instance: new AnthropicLLM(config.anthropicApiKey),
        models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
        avgTTFT: 400, costPer1kTokens: 3.0,
      });
      log.info('LLM provider: Anthropic Claude');
    }

    log.info(`LLM Router: ${this.providers.size} provider(s) ready`);
  }

  /**
   * Route to the correct provider based on model name
   * Model format: "provider/model" or just "model"
   */
  getProvider(modelSpec) {
    if (!modelSpec) return this._getDefaultProvider();

    // Check "provider/model" format
    if (modelSpec.includes('/')) {
      const [providerName, model] = modelSpec.split('/', 2);
      const provider = this.providers.get(providerName);
      if (provider) return { provider: provider.instance, model, providerName };
    }

    // Search by model name
    for (const [name, info] of this.providers) {
      if (info.models.some(m => modelSpec.includes(m) || m.includes(modelSpec))) {
        return { provider: info.instance, model: modelSpec, providerName: name };
      }
    }

    // Known model prefixes
    if (modelSpec.startsWith('llama') || modelSpec.startsWith('mixtral')) {
      const groq = this.providers.get('groq');
      if (groq) return { provider: groq.instance, model: modelSpec, providerName: 'groq' };
    }
    if (modelSpec.startsWith('claude')) {
      const anthropic = this.providers.get('anthropic');
      if (anthropic) return { provider: anthropic.instance, model: modelSpec, providerName: 'anthropic' };
    }
    if (modelSpec.startsWith('gpt')) {
      const openai = this.providers.get('openai');
      if (openai) return { provider: openai.instance, model: modelSpec, providerName: 'openai' };
    }

    return this._getDefaultProvider();
  }

  _getDefaultProvider() {
    // Priority: groq (fastest) > openai (reliable) > anthropic (smart)
    for (const name of ['groq', 'openai', 'anthropic']) {
      const p = this.providers.get(name);
      if (p) return { provider: p.instance, model: p.models[0], providerName: name };
    }
    throw new Error('No LLM providers configured');
  }

  /**
   * Stream completion with automatic routing and fallback
   */
  async *streamCompletion({ callId, messages, model, tools, temperature, maxTokens, fallbackModel }) {
    const { provider, model: resolvedModel, providerName } = this.getProvider(model);

    try {
      log.llm(`[${callId}] Routing to ${providerName}/${resolvedModel}`);
      // Los proveedores emiten chunks {type:'error'} en vez de lanzar — sin
      // esto, un fallo del primario = LLAMADA EN SILENCIO (el fallback de
      // abajo jamás se disparaba). Si el error llega ANTES de emitir texto,
      // lo convertimos en throw para que actúe el fallback; si ya se habló
      // parte de la respuesta, se deja pasar (no reiniciar = no duplicar).
      let yieldedText = false;
      for await (const chunk of provider.streamCompletion({ callId, messages, model: resolvedModel, tools, temperature, maxTokens })) {
        if (chunk.type === 'error' && !yieldedText) {
          throw new Error(chunk.message || chunk.content || `${providerName} error chunk`);
        }
        if (chunk.type === 'text' && chunk.content) yieldedText = true;
        yield chunk;
      }
      return;
    } catch (error) {
      log.warn(`[${callId}] ${providerName} failed (${error.message}), trying fallback...`);

      if (fallbackModel) {
        const fb = this.getProvider(fallbackModel);
        yield* fb.provider.streamCompletion({ callId, messages, model: fb.model, tools, temperature, maxTokens });
      } else {
        // Auto-fallback to next available provider
        for (const [name, info] of this.providers) {
          if (name === providerName) continue;
          try {
            log.info(`[${callId}] Fallback to ${name}`);
            yield* info.instance.streamCompletion({ callId, messages, model: info.models[0], tools, temperature, maxTokens });
            return;
          } catch (e) { continue; }
        }
        yield { type: 'error', message: 'All LLM providers failed' };
      }
    }
  }

  getMetrics() {
    const result = {};
    for (const [name, info] of this.providers) {
      result[name] = { models: info.models, avgTTFT: info.avgTTFT, costPer1kTokens: info.costPer1kTokens };
    }
    return result;
  }
}

module.exports = { LLMRouter };
