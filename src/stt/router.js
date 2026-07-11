// ============================================
// VoiceCore — Smart STT Router
// Routes audio to the best STT provider
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('STT:ROUTER');

class STTRouter {
  constructor(config = {}) {
    this.providers = new Map();
    // Salud por proveedor (circuit breaker): name -> { failures, openUntil }.
    // Cuando un proveedor no abre la conexión varias veces seguidas, se "abre"
    // el breaker y las llamadas NUEVAS lo saltan en frío durante un cooldown
    // (sin comerse el timeout de detección en cada llamada).
    this._health = new Map();
    this._openWatch = new Map();     // callId -> timer del watchdog de apertura
    this._failoverCount = 0;         // observabilidad (charter: evidencia)
    // Cuánto esperamos a que la conexión ABRA antes de dar el proveedor por
    // caído y saltar al siguiente. Corto para no dejar la llamada sorda, pero
    // holgado para una apertura de WebSocket normal (~100-300ms).
    this.openTimeoutMs     = Number(config.sttOpenTimeoutMs     ?? process.env.STT_OPEN_TIMEOUT_MS)     || 2500;
    this.breakerThreshold  = Number(config.sttBreakerThreshold  ?? process.env.STT_BREAKER_THRESHOLD)  || 2;
    this.breakerCooldownMs = Number(config.sttBreakerCooldownMs ?? process.env.STT_BREAKER_COOLDOWN_MS) || 30000;
    this._initProviders(config);
  }

  // ── Salud / circuit breaker (puro, `now` inyectable para tests) ──
  _isHealthy(name, now = Date.now()) {
    const h = this._health.get(name);
    return !(h && h.openUntil && now < h.openUntil);
  }
  _recordFailure(name, now = Date.now()) {
    const h = this._health.get(name) || { failures: 0, openUntil: 0 };
    h.failures = (h.failures || 0) + 1;
    if (h.failures >= this.breakerThreshold) {
      h.openUntil = now + this.breakerCooldownMs;
      h.failures = 0;
      log.warn(`STT breaker ABIERTO para '${name}' — ${Math.round(this.breakerCooldownMs / 1000)}s sin usarlo`);
    }
    this._health.set(name, h);
  }
  _recordSuccess(name) { this._health.set(name, { failures: 0, openUntil: 0 }); }

  // Orden en que probar proveedores: el preferido primero (si existe), el resto
  // por prioridad. La salud no cambia el ORDEN, solo a quién se elige de primero.
  _candidateOrder(preferName) {
    const byPriority = [...this.providers.entries()]
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name]) => name);
    if (preferName && this.providers.has(preferName)) {
      return [preferName, ...byPriority.filter(n => n !== preferName)];
    }
    return byPriority;
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
   * Create a session on the best HEALTHY provider, con failover automático:
   * si el elegido no ABRE la conexión en openTimeoutMs, se cierra, se salta al
   * siguiente proveedor sano y se recablean los callbacks del pipeline. Así una
   * caída de Deepgram no deja la llamada sorda si hay AssemblyAI/Google.
   */
  createSession(callId, options = {}) {
    const order = this._candidateOrder(options.sttProvider || null);
    if (!order.length) throw new Error('No STT providers available');
    const now = Date.now();
    // Primer intento: el primer proveedor SANO del orden; si ninguno está sano
    // (todos con el breaker abierto), el primero igualmente (mejor un intento
    // que silencio garantizado).
    const primary = order.find(n => this._isHealthy(n, now)) || order[0];
    const session = this.providers.get(primary).instance.createSession(callId, options);
    session._sttProviderName = primary;
    this._armOpenWatchdog(callId, session, primary, order, options);
    return session;
  }

  // Vigila que la sesión ABRA. Si a tiempo no abrió, marca fallo (puede abrir el
  // breaker), cierra la sesión muerta y crea otra en el siguiente proveedor sano,
  // copiando los callbacks que el pipeline puso en la sesión anterior. Encadena:
  // el nuevo también se vigila. Si no queda alternativa, lo deja registrado.
  _armOpenWatchdog(callId, session, name, order, options) {
    const prev = this._openWatch.get(callId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this._openWatch.delete(callId);
      if (session.isOpen) { this._recordSuccess(name); return; }  // abrió bien
      log.warn(`[${callId}] STT '${name}' no abrió en ${this.openTimeoutMs}ms — failover`);
      this._recordFailure(name, Date.now());
      try { this.providers.get(name).instance.closeSession(callId); } catch (_) {}
      const remaining = order.filter(n => n !== name);
      const now = Date.now();
      const next = remaining.find(n => this._isHealthy(n, now)) || remaining[0];
      if (!next) { log.error(`[${callId}] STT sin alternativa tras fallo de '${name}' — llamada sin STT`); return; }
      log.warn(`[${callId}] STT failover '${name}' → '${next}'`);
      this._failoverCount++;
      const ns = this.providers.get(next).instance.createSession(callId, options);
      ns._sttProviderName = next;
      for (const cb of ['onTranscript', 'onSpeechStart', 'onSpeechEnd', 'onUtteranceEnd']) {
        if (session[cb]) ns[cb] = session[cb];
      }
      this._armOpenWatchdog(callId, ns, next, remaining, options);
    }, this.openTimeoutMs);
    if (t.unref) t.unref();
    this._openWatch.set(callId, t);
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
    // Cancela el watchdog de apertura: si la llamada terminó (colgó) antes de
    // openTimeoutMs, NO debe marcarse como fallo del proveedor ni hacer failover.
    const w = this._openWatch.get(callId);
    if (w) { clearTimeout(w); this._openWatch.delete(callId); }
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
    const result = { _failovers: this._failoverCount };
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
