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
   * Stream completion con enrutado y fallback ROBUSTO.
   *
   * Bug real (fisioterapia unai, 2026-07): el cliente decía "Sí, por favor"
   * (STT 0.999) y el asistente respondía "no te he escuchado". Dos causas:
   *   1) el router solo hacía fallback ante un chunk 'error', NO ante una
   *      respuesta VACÍA "exitosa" (Groq devolvía done sin texto ni tools).
   *   2) el fallbackModel de la org apuntaba al MISMO Groq → reintentaba el
   *      proveedor que acababa de fallar.
   * Ahora: se prueban proveedores en orden (primario → fallbackModel →
   * resto), NUNCA se repite un proveedor ya intentado, y una respuesta
   * vacía cuenta como fallo (se pasa al siguiente). Solo tras agotarlos
   * todos se emite 'error' (último recurso honesto → el pipeline recupera).
   */
  async *streamCompletion({ callId, messages, model, tools, temperature, maxTokens, fallbackModel }) {
    const opts = { messages, tools, temperature, maxTokens };
    const attempted = new Set();

    // Orden de intento: primario, luego el fallbackModel explícito, luego el resto.
    const order = [this.getProvider(model)];
    if (fallbackModel) order.push(this.getProvider(fallbackModel));
    for (const [name, info] of this.providers) {
      order.push({ provider: info.instance, model: info.models[0], providerName: name });
    }

    for (let i = 0; i < order.length; i++) {
      const resolved = order[i];
      if (!resolved || !resolved.provider || attempted.has(resolved.providerName)) continue;
      attempted.add(resolved.providerName);
      const viaFallback = attempted.size > 1;
      const ok = yield* this._tryProvider(callId, resolved, opts, viaFallback);
      if (ok) return;
      log.warn(`[${callId}] ${resolved.providerName} no produjo respuesta útil — probando siguiente`);
    }

    // Todos agotados: el pipeline lo trata como turno vacío (recupera/escala).
    yield { type: 'error', message: 'All LLM providers failed or returned empty' };
  }

  /**
   * Intenta UN proveedor. Emite sus chunks (texto/tool en streaming, para no
   * añadir latencia) y retiene el 'done' hasta saber si hubo contenido.
   * @returns {boolean} true si produjo algo con sentido (texto o tool_call);
   *   false si vacío o error SIN nada emitido → el llamante prueba el siguiente.
   *   Nunca lanza; nunca deja el 'done' vacío pasar (para no disparar la red
   *   anti-silencio del pipeline antes de intentar el fallback).
   */
  async *_tryProvider(callId, { provider, model, providerName }, opts, viaFallback) {
    let meaningful = false;
    let doneChunk = null;
    log.llm(`[${callId}] LLM → ${providerName}/${model}${viaFallback ? ' (fallback)' : ''}`);
    try {
      for await (const chunk of provider.streamCompletion({ callId, model, ...opts })) {
        if (chunk.type === 'error') {
          // Si ya emitimos texto no se puede deshacer: se deja pasar y se da por servido.
          if (meaningful) { yield chunk; return true; }
          log.warn(`[${callId}] ${providerName} error: ${chunk.message || chunk.content}`);
          return false;
        }
        if (chunk.type === 'done') { doneChunk = chunk; continue; } // decidir al cerrar
        if (chunk.type === 'text' && chunk.content) meaningful = true;
        if (chunk.type === 'tool_call') meaningful = true;
        yield chunk; // texto / tool_call / otros → en streaming
      }
    } catch (e) {
      if (meaningful) {
        if (doneChunk) { doneChunk.metrics = { ...(doneChunk.metrics || {}), provider: providerName, model, viaFallback }; yield doneChunk; }
        return true;
      }
      log.warn(`[${callId}] ${providerName} lanzó: ${e.message}`);
      return false;
    }
    const producedTool = !!(doneChunk && doneChunk.toolCalls && doneChunk.toolCalls.length > 0);
    if (meaningful || producedTool) {
      // Etiquetar QUIÉN sirvió el turno (A/B de modelos + diagnóstico).
      if (doneChunk) { doneChunk.metrics = { ...(doneChunk.metrics || {}), provider: providerName, model, viaFallback }; yield doneChunk; }
      return true;
    }
    // Vacío: NO se emite el done vacío — que el llamante pruebe otro proveedor.
    return false;
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
