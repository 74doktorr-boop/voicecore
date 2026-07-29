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
    // Llamadas VIVAS según el router: callId -> { options, order, session,
    // attempts, nextAttemptAt, reconnecting, dropped, gaveUp }.
    // Existir aquí significa "esta llamada sigue en curso": es lo que permite
    // distinguir una conexión que se ha MUERTO de una llamada que ha COLGADO.
    this._live = new Map();
    this._reconnects = 0;
    this._droppedFrames = 0;
    // Reconexión en vuelo (V3). Tope de intentos y espera creciente: si Deepgram
    // está caído de verdad, no tiene sentido martillearlo 50 veces por segundo
    // (llega un frame de audio cada 20 ms).
    this.maxReconnects   = Number(config.sttMaxReconnects   ?? process.env.STT_MAX_RECONNECTS)   || 3;
    this.reconnectBackoff = [250, 1000, 2500];
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
      // F5: que se caiga el STT es lo más grave que puede pasarle a una llamada
      // —la IA se queda sorda— y hasta ahora solo dejaba un log.warn que nadie
      // leía. El error-tracker ya tenía la tubería de alertas con agrupación por
      // firma cada 15 min, y NINGÚN fallo de dominio la usaba.
      try {
        require('../monitoring/error-tracker').capture(
          new Error(`STT '${name}' fuera de servicio: ${this.breakerThreshold} fallos seguidos`),
          'stt_breaker_open',
          { proveedor: name, cooldownSegundos: Math.round(this.breakerCooldownMs / 1000), impacto: 'las llamadas pueden quedarse sin transcripción' },
        );
      } catch (_) {}
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
    // Marca la llamada como viva: a partir de aquí, quedarse sin sesión es una
    // AVERÍA que hay que reparar, no el final normal de la llamada.
    this._live.set(callId, {
      options, order, session,
      attempts: 0, nextAttemptAt: 0, reconnecting: false, dropped: 0, gaveUp: false,
    });
    this._armOpenWatchdog(callId, session, primary, order, options);
    return session;
  }

  /** Sesión activa de este callId en cualquier proveedor, o null. */
  _findSession(callId) {
    for (const [name, info] of this.providers) {
      const session = info.instance.connections?.get(callId);
      if (session) return { name, info, session };
    }
    return null;
  }

  /**
   * Reconecta el STT de una llamada VIVA cuya conexión se ha muerto (V3).
   *
   * EL BUG QUE ARREGLA (auditoría 2026-07-29): cuando Deepgram cerraba el socket
   * a mitad de llamada —cosa que pasa: timeouts de red, despliegues suyos, un
   * keepAlive perdido— su handler de Close borraba la sesión del Map y `sendAudio`
   * dejaba de encontrarla. Y no hacía nada: `return` a secas, sin log, sin
   * métrica, sin excepción. **El audio del cliente se tiraba al suelo el resto
   * de la llamada y la IA se quedaba SORDA en silencio.** El único que se
   * enteraba era el salvavidas, 75 segundos después. El negocio veía "llamada de
   * 8 minutos, 3 turnos, abandonada" y culpaba al cliente.
   *
   * No había reconexión en ningún sitio: el failover del router solo cubría la
   * APERTURA (un watchdog de un disparo que se desarma en cuanto la conexión
   * abre), así que protegía el primer segundo de la llamada y nada más.
   *
   * Idempotente y con freno: llega un frame cada 20 ms, así que esto se invoca
   * en ráfaga. Un solo intento en vuelo, espera creciente entre intentos y tope
   * duro; agotado el tope se avisa UNA vez y se deja de intentar.
   */
  _reconnect(callId, live, now = Date.now()) {
    if (live.reconnecting || live.gaveUp) return;
    if (now < live.nextAttemptAt) return;

    if (live.attempts >= this.maxReconnects) {
      live.gaveUp = true;
      log.error(`[${callId}] STT: ${live.attempts} reconexiones fallidas — la llamada se queda sin transcripción`);
      try {
        require('../monitoring/error-tracker').capture(
          new Error(`STT no se pudo reconectar tras ${live.attempts} intentos`),
          'stt_reconnect_failed',
          { callId, framesDescartados: live.dropped, impacto: 'la IA no oye al cliente durante el resto de la llamada' },
        );
      } catch (_) {}
      return;
    }

    live.reconnecting = true;
    live.attempts++;
    live.nextAttemptAt = now + (this.reconnectBackoff[live.attempts - 1] || 2500);

    // Si el proveedor de origen se ha ganado el breaker por el camino, se
    // reconecta en el siguiente sano: reconectar contra un servicio caído es
    // repetir el problema.
    const prevName = live.session?._sttProviderName;
    const candidates = live.order.filter(n => this.providers.has(n));
    const next = candidates.find(n => this._isHealthy(n, now)) || prevName || candidates[0];
    if (!next) { live.reconnecting = false; live.gaveUp = true; return; }

    log.warn(`[${callId}] STT caído en mitad de la llamada — reconectando (intento ${live.attempts}/${this.maxReconnects}, proveedor '${next}')`);
    this._reconnects++;

    try {
      const ns = this.providers.get(next).instance.createSession(callId, live.options);
      ns._sttProviderName = next;
      // Los callbacks los puso el pipeline sobre la sesión ANTERIOR: sin
      // recablearlos, la conexión nueva transcribiría al vacío.
      for (const cb of ['onTranscript', 'onSpeechStart', 'onSpeechEnd', 'onUtteranceEnd']) {
        if (live.session && live.session[cb]) ns[cb] = live.session[cb];
      }
      live.session = ns;
      this._armOpenWatchdog(callId, ns, next, live.order, live.options);
    } catch (e) {
      log.error(`[${callId}] STT: fallo al reconectar con '${next}': ${e.message}`);
      this._recordFailure(next, now);
    } finally {
      live.reconnecting = false;
    }
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
    const found = this._findSession(callId);
    if (found) { found.info.instance.sendAudio(callId, audioData); return; }

    // Sin sesión. Dos casos MUY distintos que antes se trataban igual (con un
    // `return` mudo):
    const live = this._live.get(callId);
    if (!live) return;            // la llamada ya colgó: normal, no hay nada que hacer.

    // …y la llamada SIGUE VIVA: la conexión se ha muerto. Esto es una avería.
    live.dropped++;
    this._droppedFrames++;
    this._reconnect(callId, live);
  }

  closeSession(callId) {
    // Cancela el watchdog de apertura: si la llamada terminó (colgó) antes de
    // openTimeoutMs, NO debe marcarse como fallo del proveedor ni hacer failover.
    const w = this._openWatch.get(callId);
    if (w) { clearTimeout(w); this._openWatch.delete(callId); }
    // Y deja de considerarla viva ANTES de cerrar: si no, el cierre normal
    // parecería una caída y el router intentaría reconectar una llamada que ya
    // ha colgado (audio a un proveedor por una conversación que no existe).
    const live = this._live.get(callId);
    if (live && live.dropped) {
      log.warn(`[${callId}] STT: ${live.dropped} frame(s) de audio descartados por caída de conexión durante la llamada`);
    }
    this._live.delete(callId);
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
    // `_reconnects` y `_droppedFrames` son la evidencia de V3: si crecen, hay
    // llamadas en las que la IA se estuvo quedando sorda. Antes ninguna de las
    // dos cosas dejaba rastro de ningún tipo.
    const result = {
      _failovers: this._failoverCount,
      _reconnects: this._reconnects,
      _droppedFrames: this._droppedFrames,
      _liveCalls: this._live.size,
    };
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
