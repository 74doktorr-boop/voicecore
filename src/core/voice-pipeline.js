// ============================================
// VoiceCore v2.0 — Voice Pipeline
// Main orchestrator: STT → LLM → TTS
// Now with multi-provider routing
// ============================================

const { Logger } = require('../utils/logger');
const { STTRouter } = require('../stt/router');
const { LLMRouter } = require('../llm/router');
const { stripTextualToolCalls } = require('../llm/textual-tool-filter');
const { toSpeakable } = require('../tts/speakable');
const { timeOfDayGreeting, farewell } = require('../assistants/i18n');
const sttDebug = require('../utils/stt-debug');
const defaultCallStore = require('../db/call-store');
const { TTSRouter } = require('../tts/router');
const { ToolExecutor } = require('../tools/executor');
const { CallSession } = require('./call-session');
const { mulawToPcm, pcm8kToPcm16k } = require('../utils/audio');
const { sendAudioToVonage } = require('../telephony/vonage-handler');
const { getKnowledgeBase } = require('../knowledge/base');
const { getDatabase } = require('../db/database');
// Estado de clúster (DORMANTE — no-op salvo CLUSTER_MODE=1 + Redis).
const clusterState = require('../utils/cluster-state');
const {
  personalizeGreeting,
  isShortCloser,
  containsNotAddressedToken,
  stripNotAddressedToken,
} = require('../assistants/greeting');

// Caché LRU de audio para frases FIJAS (saludos, "¿Sí? Dígame.", despedidas).
// mulaw 8kHz ≈ 8KB/s → 120 entradas de ~5s ≈ 5MB máximo. El saludo de cada
// negocio es idéntico en cada llamada: sintetizarlo cada vez era latencia
// y coste de TTS regalados justo en la primera impresión.
const _fixedAudioCache = new Map();
const FIXED_AUDIO_MAX = 120;

const log = new Logger('PIPELINE');

// ── Acumular lo que el cliente dice MIENTRAS procesamos el turno anterior ──
// Antes se hacía `session.pendingUtterance = text` (sobrescribía): si el
// cliente decía dos frases seguidas, la PRIMERA se perdía. Aquí se concatenan
// en orden. Cap alto para no acumular sin fin ante un atasco (conserva la cola,
// que es lo más reciente/relevante).
function mergePendingUtterance(existing, incoming, maxLen = 2000) {
  const add = String(incoming || '').trim();
  if (!add) return existing || null;
  const base = String(existing || '').trim();
  const merged = base ? `${base} ${add}` : add;
  return merged.length > maxLen ? merged.slice(merged.length - maxLen) : merged;
}

// Al fusionar dos frases pendientes, conservamos la confianza MÁS BAJA: así la
// escalera de confianza del turno reprocesado sigue siendo prudente (si una de
// las dos frases se oyó mal, el turno se trata como dudoso, no como fiable).
function lowerConfidenceMeta(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  const ca = typeof a.confidence === 'number' ? a.confidence : Infinity;
  const cb = typeof b.confidence === 'number' ? b.confidence : Infinity;
  return cb < ca ? b : a;
}

/**
 * Duración máxima de una llamada en ms: el tope propio de la sesión (p.ej. demo
 * Llámame = 6 min) manda sobre el global MAX_CALL_MINUTES; si ninguno, 15 min.
 * PURA (env inyectable en tests). El lifeguard la usa para el cierre educado.
 */
function effectiveMaxMs(sessionMaxMinutes, envMaxMinutes) {
  const perCall = Number(sessionMaxMinutes) > 0 ? Number(sessionMaxMinutes) : 0;
  const global = Number(envMaxMinutes) > 0 ? Number(envMaxMinutes) : 0;
  return (perCall || global || 15) * 60000;
}

class VoicePipeline {
  constructor(config) {
    // Use routers if provided, otherwise create from config
    this.sttRouter = config.sttRouter || new STTRouter({
      deepgramApiKey: config.deepgramApiKey,
      assemblyaiApiKey: config.assemblyaiApiKey,
      googleSttApiKey: config.googleSttApiKey,
    });

    this.llmRouter = config.llmRouter || new LLMRouter({
      openaiApiKey: config.openaiApiKey,
      groqApiKey: config.groqApiKey,
      anthropicApiKey: config.anthropicApiKey,
    });

    this.ttsRouter = config.ttsRouter || new TTSRouter({
      openaiApiKey: config.openaiApiKey,
      elevenlabsApiKey: config.elevenlabsApiKey,
      cartesiaApiKey: config.cartesiaApiKey,
      googleApiKey: config.googleApiKey,
    });

    this.toolExecutor = new ToolExecutor();
    this.activeCalls = new Map();
    this.callHistory = [];
    this.maxHistory = 500;
    this.webhookUrl = config.webhookUrl || null;
    // Persistencia de llamadas (nf_calls) — inyectable en tests.
    this.callStore = config.callStore || defaultCallStore;

    // Cap de llamadas concurrentes por asistente (= identidad de negocio).
    // Control de coste/abuso a escala. Override por-asistente con el campo
    // `concurrentCalls` en el JSON; si no, este default (env configurable).
    this.maxConcurrentPerAssistant =
      Number(config.maxConcurrentPerAssistant ?? process.env.MAX_CONCURRENT_CALLS_PER_ASSISTANT) || 10;

    // Cap GLOBAL del nodo: backstop de saturación sumando TODOS los asistentes.
    // El cap por-asistente evita el abuso de un negocio, pero no protege al
    // nodo de un pico agregado (p.ej. 100 clientes → decenas de llamadas
    // simultáneas): sin este techo, un nodo aceptaría hasta morir (STT/LLM/TTS
    // agotan CPU/hilos) y CAER-SE tira TODAS las llamadas, no solo la de más.
    // 0 = sin límite (default: no cambia el comportamiento actual). A escala,
    // poner MAX_CONCURRENT_CALLS_NODE (~40-50, según tamaño de la instancia)
    // en EasyPanel: rechazar limpio la llamada nº51 es mucho mejor que caer.
    this.maxConcurrentNode =
      Number(config.maxConcurrentNode ?? process.env.MAX_CONCURRENT_CALLS_NODE) || 0;

    // Cap GLOBAL del CLÚSTER (DORMANTE). Solo se consulta cuando
    // CLUSTER_MODE=1 (varias réplicas): suma las llamadas activas de TODAS
    // las réplicas vía Redis, para que el techo agregado no se multiplique
    // por el nº de nodos. 0 = sin límite. Sin efecto con el flag apagado.
    this.maxConcurrentCluster =
      Number(config.maxConcurrentCluster ?? process.env.MAX_CONCURRENT_CALLS_CLUSTER) || 0;
  }

  /** Llamadas activas para un asistente concreto. */
  _countActiveForAssistant(assistantId) {
    if (!assistantId) return 0;
    let n = 0;
    for (const s of this.activeCalls.values()) {
      if (s.assistant?.id === assistantId) n++;
    }
    return n;
  }

  /** Límite de concurrentes del asistente: override > default. */
  _concurrentLimitFor(assistant) {
    const override = Number(assistant?.concurrentCalls);
    if (Number.isFinite(override) && override > 0) return override;
    return this.maxConcurrentPerAssistant;
  }

  /**
   * Resuelve el org_id del negocio a partir del número llamado (NodeFlow),
   * vía la tabla indexada nf_phone_pool. Devuelve null si no hay match/BD
   * (fail-open: el RAG simplemente no se inyecta).
   */
  // Re-enganche tras interrupción sin continuación: si cortaron al asistente
  // y en 2,5s no llegó ninguna frase (ruido, arrepentimiento), retoma la
  // palabra brevemente — como haría una recepcionista humana.
  // Cancela el colgado automático por despedida mutua. Se llama tanto al
  // principio de _processTurn (frase COMPLETA) como en el barge-in
  // (onSpeechStart, señal TEMPRANA): si el cliente vuelve a hablar tras el
  // "adiós", jamás se le cuelga a media frase. Idempotente y seguro con null.
  _cancelPendingHangup(session) {
    if (!session || !session._farewellTimer) return false;
    clearTimeout(session._farewellTimer);
    session._farewellTimer = null;
    return true;
  }

  _armInterruptWatchdog(callId) {
    const session = this.activeCalls.get(callId);
    if (!session) return;
    clearTimeout(session._interruptWatchdog);
    session._interruptWatchdog = setTimeout(() => {
      const s = this.activeCalls.get(callId);
      if (!s || s.isProcessing || s.isSpeakingNow() || s.pendingUtterance) return;
      log.call(`[${callId}] Interrupción sin continuación — re-enganche`);
      this._speakText(callId, '¿Sí? Dígame.', { cache: true }).catch(() => {});
    }, 2500);
  }

  async _resolveOrgId(calledNumber) {
    if (!calledNumber || calledNumber === 'unknown') return null;
    const db = getDatabase();
    if (!db.enabled) return null;
    // Formato canónico E.164 (+34843700849): el pool guarda así y los
    // proveedores a veces envían espacios/guiones — normalizamos antes del match.
    const clean = String(calledNumber).replace(/[^\d+]/g, '');
    const { data } = await db.client
      .from('nf_phone_pool').select('org_id').eq('phone_number', clean).maybeSingle();
    return data?.org_id || null;
  }

  /**
   * Resuelve el NOMBRE del cliente que llama (por su número, aislado por
   * negocio) para el saludo personalizado. Con TIMEOUT DURO (~250ms): el
   * saludo es la primera impresión y NO puede saltarse el presupuesto de
   * latencia (<700ms al primer audio, charter). Si la BD tarda, se cae al
   * saludo genérico configurado — jamás bloquea. Devuelve '' si no hay
   * nombre usable, BD apagada o timeout. FAIL-OPEN total.
   */
  async _resolveGreetingName(orgId, callerNumber, timeoutMs = 250) {
    if (!orgId || !callerNumber || callerNumber === 'unknown') return '';
    const db = getDatabase();
    if (!db.enabled) return '';
    try {
      const { phoneVariants } = require('../utils/phone');
      const { isUsableName } = require('../lifecycle/lead-safety-net');
      const lookup = db.client.from('contacts')
        .select('name')
        .eq('org_id', orgId)
        .in('phone', phoneVariants(callerNumber))
        .limit(1)
        .maybeSingle()
        .then(({ data }) => data?.name || '');
      const guarded = Promise.race([
        lookup,
        new Promise(resolve => setTimeout(() => resolve(''), timeoutMs)),
      ]);
      const name = await guarded;
      return isUsableName(name) ? String(name).trim() : '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Start a new call session
   */
  async startCall({ callId, assistant, callerNumber, calledNumber, direction, twilioWs, streamSid, vonageWs, provider = 'twilio', mediaEncoding = null, maxMinutes = null }) {
    // Cap GLOBAL del nodo: backstop de saturación (todos los asistentes juntos).
    // Rechaza ANTES de abrir STT (coste 0) → el handler cierra el WS limpio.
    if (this.maxConcurrentNode > 0 && this.activeCalls.size >= this.maxConcurrentNode) {
      log.warn(`[${callId}] Rechazada: nodo en cap global de concurrentes (${this.activeCalls.size}/${this.maxConcurrentNode})`);
      return null;
    }

    // Cap GLOBAL del CLÚSTER (DORMANTE — solo con CLUSTER_MODE=1).
    // isClusterMode() es una comparación de string barata; si es false
    // (producción hoy) NO se ejecuta NADA de abajo y el camino queda
    // idéntico byte-a-byte al de siempre (cero await, cero latencia).
    if (clusterState.isClusterMode() && this.maxConcurrentCluster > 0) {
      const clusterActive = await clusterState.getClusterCallCount(this.activeCalls.size);
      if (clusterActive >= this.maxConcurrentCluster) {
        log.warn(`[${callId}] Rechazada: clúster en cap global (${clusterActive}/${this.maxConcurrentCluster})`);
        return null;
      }
    }

    // Cap de concurrentes por asistente: rechaza ANTES de abrir STT (coste 0).
    // Devuelve null → el handler de telefonía cierra el WS limpiamente.
    const limit = this._concurrentLimitFor(assistant);
    const active = this._countActiveForAssistant(assistant?.id);
    if (limit > 0 && active >= limit) {
      log.warn(`[${callId}] Rechazada: asistente ${assistant?.id || '?'} en el cap de concurrentes (${active}/${limit})`);
      return null;
    }

    const session = new CallSession({ callId, assistant, callerNumber, calledNumber, direction });
    // Tope de duración propio de ESTA llamada (p.ej. demo Llámame: 6 min basta y
    // acota el gasto). Si es null, el lifeguard usa MAX_CALL_MINUTES global.
    session.maxMinutes = (Number(maxMinutes) > 0) ? Number(maxMinutes) : null;
    session.twilioWs  = twilioWs;
    session.vonageWs  = vonageWs;
    session.streamSid = streamSid;
    session.provider  = provider;
    session.status    = 'active';
    this.activeCalls.set(callId, session);
    // Alta en el contador del clúster (DORMANTE — no-op si CLUSTER_MODE off).
    // Fire-and-forget: jamás bloquea ni añade latencia al alta de la llamada.
    clusterState.incrCall(callId).catch(() => {});

    // ── Experto en el negocio: inyecta precios estructurados + base de conocimiento ──
    // Una sola vez, al inicio. FAIL-OPEN: si falla o no hay datos, la llamada sigue igual.
    try {
      const orgId = await this._resolveOrgId(calledNumber);
      if (orgId) session.orgId = orgId; // disponible para los tools (get_services / get_pricing)
      const sys = orgId && session.messages.find(m => m.role === 'system');
      if (sys) {
        // 1) Servicios y precios estructurados (datos exactos → IA experta en precios)
        try {
          const db = getDatabase();
          if (db.enabled) {
            const { data: org } = await db.client
              .from('organizations').select('automation_config').eq('id', orgId).maybeSingle();
            const sl = org && org.automation_config && org.automation_config.config && org.automation_config.config.serviceList;
            if (Array.isArray(sl) && sl.length) session.serviceList = sl; // para get_services / get_pricing
            const { formatServiceList } = require('../assistants/prompt-generator');
            const priceBlock = formatServiceList(org?.automation_config?.config?.serviceList);
            // Dedupe (#8): el prompt base del asistente ya puede traer el
            // bloque (org-assistant lo genera desde la misma tabla).
            if (priceBlock && !sys.content.includes('SERVICIOS Y PRECIOS (datos EXACTOS')) { sys.content += '\n\n' + priceBlock; log.info(`[${callId}] Precios estructurados inyectados (org ${orgId})`); }
            // Dirección del negocio: si el dueño la configuró, la IA debe
            // saber decirla ("¿dónde estáis?") — antes no llegaba al prompt
            // (feedback real 2026-07-03).
            // Dedupe: el prompt base puede traer ya la dirección (generatePrompt
            // la incluye si vive en assistant_config). Solo se añade si el texto
            // exacto no está ya, para no inyectarla dos veces.
            const address = org?.automation_config?.config?.address;
            if (address && !sys.content.includes(String(address))) sys.content += `\n\nDIRECCIÓN DEL NEGOCIO: ${address}. Dásela al cliente si pregunta dónde está el negocio o cómo llegar.`;
          }
        } catch (e) { log.warn(`[${callId}] price-list inject fail-open: ${e.message}`); }
        // 2) Base de conocimiento libre (RAG)
        const ctx = await getKnowledgeBase().getSystemContext(orgId);
        if (ctx) { sys.content += ctx; log.info(`[${callId}] RAG: KB del negocio inyectada (org ${orgId})`); }
        // 3) Memoria del cliente que llama — aislada por negocio: el contacto
        // se resuelve por (org_id, phone), así el mismo teléfono en dos
        // negocios son dos historiales distintos que jamás se cruzan.
        if (callerNumber && callerNumber !== 'unknown') {
          try {
            const db = getDatabase();
            if (db.enabled) {
              const { phoneVariants } = require('../utils/phone');
              const { data: contact } = await db.client.from('contacts')
                .select('id')
                .eq('org_id', orgId)
                .in('phone', phoneVariants(callerNumber))
                .limit(1)
                .maybeSingle();
              if (contact?.id) {
                session.contactId = contact.id;
                const { buildMemoryBlock } = require('../assistants/prompt-generator');
                const memBlock = await buildMemoryBlock(contact.id, orgId);
                if (memBlock) {
                  sys.content += memBlock;
                  log.info(`[${callId}] Memoria del cliente inyectada (contact ${contact.id})`);
                }
              }
            }
          } catch (e) { log.warn(`[${callId}] memory inject fail-open: ${e.message}`); }
        }
      }
    } catch (e) {
      log.warn(`[${callId}] business-context inject fail-open: ${e.message}`);
    }

    // Reglas APRENDIDAS activas del sector (aprobadas por el fundador en el
    // admin) — el eslabón "aplicar" del bucle. Se aplican por SECTOR y no
    // dependen de resolver la org. Fail-open. [[learned-rules]]
    try {
      const rulesBlock = await require('../lifecycle/learned-rules').activeRulesBlock(assistant && assistant.sector);
      if (rulesBlock) {
        const sysMsg = session.messages.find(m => m.role === 'system');
        if (sysMsg) { sysMsg.content += rulesBlock; log.info(`[${callId}] Reglas aprendidas inyectadas (sector ${assistant?.sector || 'generico'})`); }
      }
    } catch (e) { log.warn(`[${callId}] learned-rules inject fail-open: ${e.message}`); }

    // Códec de entrada por proveedor. CRÍTICO: el STT debe recibir el códec
    // REAL — decodificar PCMA (Europa) como PCMU destroza la transcripción
    // sin enmudecerla (causa raíz del 2026-07-03, confidence 0.78 → 0.995).
    // Telnyx lo anuncia en el evento start (mediaEncoding); sin anuncio, en
    // España es alaw. Twilio siempre mulaw; Vonage L16 16kHz.
    const isVonage = provider === 'vonage';
    const sttEncoding = isVonage ? 'linear16'
      : provider === 'telnyx' ? (mediaEncoding || 'alaw')
      : (mediaEncoding || 'mulaw');

    // Create STT session via router (createSession, NO getProvider().createSession):
    // así pasa por el failover — si el proveedor no abre, salta al siguiente.
    const sttSession = this.sttRouter.createSession(callId, {
      language: assistant.language || 'es',
      model: assistant.sttModel || 'nova-3',
      utteranceEndMs: assistant.utteranceEndMs || 1000, // mínimo de Deepgram — 800 lo desactivaba (llamada muda)
      endpointing: assistant.endpointing || 300,
      encoding: sttEncoding,
      sample_rate: isVonage ? 16000 : 8000,
      sttProvider: assistant.sttProvider,
    });

    // Fin de turno del cliente → procesar con el LLM.
    // Dos disparadores (Deepgram): speech_final (endpointing ~300ms, el
    // RÁPIDO) y UtteranceEnd (1000ms, respaldo). deepgram.js limpia el
    // transcript al disparar speech_final, así que no hay dobles.
    const onTurnText = async (text, meta) => {
      if (!text?.trim() || text.trim().length < 2) return;
      if (session.isProcessing) {
        // El cliente habló mientras procesábamos el turno anterior (típico tras
        // una interrupción). Antes se DESCARTABA y la llamada quedaba muda;
        // luego se GUARDABA pero sobrescribiendo (dos frases → se perdía la
        // 1ª). Ahora se ACUMULAN en orden y se conserva la confianza más baja,
        // y se procesa todo en cuanto termine el turno en curso.
        session.pendingUtterance = mergePendingUtterance(session.pendingUtterance, text);
        session.pendingMeta = lowerConfidenceMeta(session.pendingMeta, meta);
        return;
      }
      await this._processTurn(callId, text, meta);
    };
    sttSession.onUtteranceEnd = onTurnText;
    sttSession.onSpeechEnd    = onTurnText;

    // Barge-in con TRES condiciones: (1) hay audio sonando AHORA (reloj de
    // reproducción), (2) el reconocedor tiene PALABRAS reales (≥4 chars —
    // el VAD pelado salta con ruido), y (3) el interim llega con confianza
    // alta: las voces de FONDO (tele, gente hablando cerca) transcriben con
    // confidence bajo y dejaban al asistente callado a mitad de frase sin
    // que el cliente le hubiera hablado (reportado de nuevo 2026-07-03).
    sttSession.onSpeechStart = (text, meta) => {
      if (!text || String(text).trim().length < 4) return; // ruido/energía sin palabras
      const interimConf = meta && typeof meta.confidence === 'number' ? meta.confidence : null;
      if (interimConf !== null && interimConf < 0.75) {
        log.info(`[${callId}] Interim con confianza baja (${interimConf.toFixed(2)}) — NO interrumpe (voz de fondo)`);
        return;
      }
      // El cliente vuelve a hablar tras una despedida mutua: cancelar el colgado
      // automático AQUÍ (señal temprana), no esperar a la frase completa. Antes
      // solo lo cancelaba _processTurn (utteranceEnd, ~1s más tarde) → el timer
      // colgaba a media frase. Se hace aunque el asistente ya no esté hablando
      // (tras el "adiós" la cola está vacía pero el colgado sigue armado).
      if (session._farewellTimer && this._cancelPendingHangup(session)) {
        log.info(`[${callId}] Cliente sigue hablando tras la despedida — colgado cancelado`);
      }
      if (session.isSpeakingNow()) {
        session.handleInterruption();
        session.clearTwilioBuffer();
        this.sttRouter.resetTranscript(callId);
        // Si la interrupción no viene seguida de una frase (falso positivo,
        // arrepentimiento), el asistente se re-engancha — jamás aire muerto.
        this._armInterruptWatchdog(callId);
      }
    };

    // Vigilante de fin de llamada: (a) 75s sin turnos ni voz del asistente →
    // despedida y cierre; (b) duración máxima (MAX_CALL_MINUTES, 15 por
    // defecto) → cierre educado. Una línea que queda abierta se come
    // Deepgram/€ y deja filas 'active' huérfanas (caso real 2026-07-03).
    // Se arma ANTES del saludo: si el TTS del saludo se atasca (proveedor
    // lento, red), había una ventana SIN vigilante y la llamada podía colgar
    // del proveedor sin que la limpiásemos. El check de silencio usa
    // max(lastTurnAt, playbackEndsAt), así que durante el saludo no cierra.
    session.lastTurnAt = Date.now();
    session._lifeguard = setInterval(() => {
      if (session._closing) return;
      const idleMs = Date.now() - Math.max(session.lastTurnAt || 0, session.playbackEndsAt || 0);
      const ageMs = Date.now() - session.startTime;
      const maxMs = effectiveMaxMs(session.maxMinutes, process.env.MAX_CALL_MINUTES);
      if (idleMs > 75000 || ageMs > maxMs) {
        session._closing = true;
        const porSilencio = idleMs > 75000;
        log.warn(`[${callId}] Lifeguard: cierre por ${porSilencio ? 'silencio prolongado' : 'duración máxima'}`);
        const bye = farewell(assistant && assistant.language, porSilencio ? 'silence' : 'maxlen');
        this._speakText(callId, bye, { cache: true })
          .then(() => session.addAssistantMessage(bye))
          .catch(() => {})
          .finally(() => setTimeout(() => {
            try { (session.twilioWs || session.vonageWs)?.close(); } catch (_) {}
          }, 6000));
      }
    }, 10000);
    if (session._lifeguard.unref) session._lifeguard.unref();

    // Send first message if configured
    if (assistant.firstMessage) {
      const madridHour = parseInt(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }), 10);
      const greeting = timeOfDayGreeting(assistant.language, madridHour);
      // Saludo NATURAL: reconoce al cliente por su número ANTES de hablar.
      // Solo en castellano (la transformación está en español) y si el dueño
      // no lo apagó. Timeout duro ~250ms → jamás retrasa el primer audio; si
      // no hay nombre/BD/tiempo, cae al saludo configurado. La cache de audio
      // fijo sigue funcionando: el saludo genérico es idéntico llamada a
      // llamada; el personalizado varía por nombre pero es coste puntual.
      let firstMsg = assistant.firstMessage;
      const lang = assistant.language || 'es';
      if (assistant.personalizedGreeting !== false && (lang === 'es' || lang === 'es+eu' || lang === 'es+gl')) {
        try {
          const name = await this._resolveGreetingName(session.orgId, callerNumber);
          if (name) {
            firstMsg = personalizeGreeting(assistant.firstMessage, name, assistant.name);
            log.info(`[${callId}] Saludo personalizado: cliente reconocido (${name})`);
          }
        } catch (_) { /* fail-open: saludo configurado */ }
      }
      firstMsg = firstMsg.replace(/\{\{GREETING\}\}/g, greeting);
      // El saludo personalizado varía por nombre — no cachear (evita llenar
      // la LRU de variantes); el genérico sí (misma frase siempre).
      const isPersonalized = firstMsg !== assistant.firstMessage.replace(/\{\{GREETING\}\}/g, greeting);
      await this._speakText(callId, firstMsg, { cache: !isPersonalized });
      session.addAssistantMessage(firstMsg);
      session._greeted = true; // el LLM ya no debe re-saludar (lo dice el prompt)
    }

    // Fire webhook
    this._fireWebhook('call.started', session.toJSON());
    // Persistencia (C1): alta fail-open — jamás bloquea ni tumba la llamada.
    this.callStore.saveCallStart(session).catch(() => {});
    log.call(`[${callId}] Call started — ${callerNumber} → ${calledNumber}`);
    return session;
  }

  /**
   * Handle incoming audio from Twilio (base64-encoded mulaw)
   */
  handleAudio(callId, audioPayload) {
    const audioBuffer = Buffer.from(audioPayload, 'base64');
    // Contabilidad de audio entrante: ulaw son 8000 bytes/s exactos. Si en
    // X s de llamada llegaron muchos menos segundos de audio, estamos
    // PERDIENDO frames — la diferencia entre "el cliente se oye mal" y
    // "nosotros perdemos audio". Se reporta al colgar (endCall).
    const session = this.activeCalls.get(callId);
    if (session) session.audioRxBytes = (session.audioRxBytes || 0) + audioBuffer.length;
    sttDebug.capture(callId, audioBuffer);
    this.sttRouter.sendAudio(callId, audioBuffer);
  }

  /**
   * Handle incoming raw PCM audio from Vonage (L16 binary buffer)
   */
  handleAudioPCM(callId, pcmBuffer, sampleRate) {
    const session = this.activeCalls.get(callId);
    if (session) session.audioRxBytes = (session.audioRxBytes || 0) + pcmBuffer.length;
    this.sttRouter.sendAudio(callId, pcmBuffer);
  }

  /**
   * Handle mark event from Twilio
   */
  handleMark(callId, markName) {
    const session = this.activeCalls.get(callId);
    if (session) session.handleMark(markName);
  }

  /**
   * Process a conversation turn: LLM → (Tools) → TTS
   */
  async _processTurn(callId, userText, meta = {}) {
    const session = this.activeCalls.get(callId);
    if (!session) return;

    session.isProcessing = true;
    session.interrupted = false;
    session.lastTurnAt = Date.now(); // vigilante de silencio: hay conversación viva
    clearTimeout(session._interruptWatchdog); // llegó frase real — sin re-enganche
    // El cliente siguió hablando: cancelar el colgado por despedida
    this._cancelPendingHangup(session);
    const turnStart = Date.now();
    let turnMetrics = {};
    // Reloj del turno para medir el tiempo hasta el PRIMER audio (lo que el
    // cliente percibe como "tardó en contestar") — _speakText lo captura.
    session._turnT0 = turnStart;
    session._turnFirstAudioMs = null;

    // Add user message
    session.addUserMessage(userText);

    // ── Escalera de confianza (diseño 2026-07-03): "nunca sacrificar
    // fiabilidad por inteligencia". Nivel 1 >0.92 acción directa ·
    // Nivel 2 0.75-0.92 repetición parcial ("Creo que ha dicho X, ¿es
    // correcto?") · Nivel 3 0.55-0.75 pregunta abierta · Nivel 4 <0.55
    // NI UNA SOLA ACCIÓN: el LLM ni siquiera procesa el turno.
    // Se mide todo en metrics (sttConfidence por turno, clarifications).
    const conf = typeof meta?.confidence === 'number' ? meta.confidence : null;
    if (conf !== null) turnMetrics.sttConfidence = +conf.toFixed(3);

    // Cierre corto ("nada", "no", "ya está"): NO es un fallo de STT, el
    // cliente quiere cerrar. Se trata como ALTA confianza para que la
    // escalera de abajo no lo convierta en "¿me lo puede repetir?" (queja
    // real: un "Nada" tras una oferta desataba una petición de repetición).
    // El LLM decide la despedida amable (lo dice el prompt de cierre); aquí
    // solo evitamos que la escalera de confianza lo trate como ruido.
    const shortCloser = isShortCloser(userText);
    if (shortCloser) turnMetrics.shortCloser = true;

    // Malentendidos CONSECUTIVOS (se resetea al entender bien). Sin confianza de
    // STT no hay evidencia de fallo → se resetea, para no escalar en falso.
    const misunderstoodTurn = (conf !== null && conf < 0.75 && !shortCloser);
    session._consecMisunderstand = misunderstoodTurn ? (session._consecMisunderstand || 0) + 1 : 0;
    const ESCALATE_AFTER = Math.max(2, Number(process.env.MISUNDERSTAND_ESCALATE_AFTER) || 3);

    try {
      // ── Salida de gracia: tras N malentendidos SEGUIDOS, la IA deja de pedir
      // "¿me lo puede repetir?" en bucle (el peor primer fallo para un cliente
      // nuevo): toma el recado y avisa al dueño con el número del llamante.
      // Determinista, una sola vez por llamada, mismo espíritu que la red de
      // seguridad post-llamada. No bloquea el audio: el aviso va por setImmediate
      // y el lead es fire-and-forget.
      if (misunderstoodTurn && session._consecMisunderstand >= ESCALATE_AFTER && !session._escalatedTakeMessage) {
        await this._takeMessageAndNotify(callId, session, turnMetrics, `${session._consecMisunderstand} malentendidos seguidos`);
        if (session._turnFirstAudioMs != null) turnMetrics.firstAudioMs = session._turnFirstAudioMs;
        session.recordTurn(turnMetrics);
        return;
      }

      if (conf !== null && conf < 0.55 && !shortCloser) {
        // Nivel 4 — determinista, sin LLM: con esta fiabilidad cualquier
        // "entendimiento" es una moneda al aire. Se pide repetición y punto.
        session.metrics.clarifications = (session.metrics.clarifications || 0) + 1;
        const ask = 'Perdone, no le he entendido bien. ¿Me lo puede repetir, por favor?';
        log.warn(`[${callId}] Confianza nivel 4 (${conf.toFixed(2)}) — turno sin acción, se pide repetición`);
        await this._speakText(callId, ask, { cache: true });
        session.addAssistantMessage(ask);
        if (session._turnFirstAudioMs != null) turnMetrics.firstAudioMs = session._turnFirstAudioMs;
        session.recordTurn(turnMetrics);
        return;
      }
      if (conf !== null && conf < 0.75 && !shortCloser) {
        // Nivel 3 — pregunta abierta, prohibido actuar con estos datos.
        session.metrics.clarifications = (session.metrics.clarifications || 0) + 1;
        session.messages.push({
          role: 'system',
          content: `AVISO (fiabilidad ${Math.round(conf * 100)}%): la última frase del cliente se ha reconocido MAL. NO ejecutes ninguna acción ni registres ningún dato basándote en ella. Haz una pregunta abierta y amable para que el cliente repita lo que necesita (ej.: "No estoy seguro de haberle entendido bien, ¿me lo puede repetir?").`,
        });
        log.warn(`[${callId}] Confianza nivel 3 (${conf.toFixed(2)}) — pregunta abierta`);
      } else if (conf !== null && conf < 0.92 && !shortCloser) {
        // Nivel 2 — repetición parcial antes de usar cualquier dato.
        session.metrics.clarifications = (session.metrics.clarifications || 0) + 1;
        session.messages.push({
          role: 'system',
          content: `AVISO (fiabilidad ${Math.round(conf * 100)}%): la última frase puede contener palabras mal reconocidas. Si vas a usar un dato de ella (servicio, fecha, hora, nombre) o ejecutar una acción, PRIMERO repite lo entendido en forma de pregunta ("Creo que ha dicho X, ¿es correcto?") y espera la confirmación.`,
        });
        log.info(`[${callId}] Confianza nivel 2 (${conf.toFixed(2)}) — repetición parcial`);
      }
      // Get OpenAI tools format
      const tools = ToolExecutor.toOpenAITools(session.assistant.tools);

      // Resolve LLM model — supports "provider/model" format.
      // Sin modelo explícito, el router elige el proveedor MÁS RÁPIDO disponible
      // (groq ~80ms TTFT > openai > anthropic) con auto-fallback si falla.
      // Forzar gpt-4o-mini aquí ignoraba Groq y costaba ~4s por turno al teléfono.
      // DEFAULT_LLM_MODEL (env): palanca global de proveedor por defecto. Sin él,
      // comportamiento idéntico (null → router elige groq). Puente anti-entrecortado
      // (2026-07-12): mientras Groq free-tier (12k TPM) se agota a mitad de llamada
      // y provoca 429→failover a trompicones, poner 'gpt-4o-mini' fuerza OpenAI de
      // principio a fin (sin thrash, ~300ms constante). Al abrir Groq de pago, se
      // quita el env y vuelve a groq. La config por-org (assistant.model) manda.
      const modelSpec = session.assistant.model || process.env.DEFAULT_LLM_MODEL || null;
      const fallbackModel = session.assistant.fallbackModel || null;

      // Stream LLM response via router
      let fullResponse = '';
      let pendingToolCalls = [];
      let accumulatedText = '';
      let rawResponse = '';        // acumulado crudo — para detectar [NO_DIRIGIDO]
      let notAddressed = false;    // la frase no iba dirigida a la asistente
      let spokeFirstFragment = false; // arranque temprano: la 1ª cláusula no espera al punto

      // Tope de tokens del turno CONVERSACIONAL: backstop duro contra los
      // monólogos (veredicto del fundador "habla demasiado"). ~200 tokens ≈
      // 3-4 frases habladas: sigue siendo breve pero ya no corta una respuesta
      // legítima a media frase (subido de 150→200 tras la revisión adversarial,
      // que detectó truncado ocasional sin finish_reason). OJO: solo el turno
      // principal — el turno POST-HERRAMIENTA (confirmación de reserva con
      // nombre+día+hora) conserva el límite alto. El dueño puede ajustarlo con
      // assistant_config.maxTokens.
      const convMaxTokens = session.assistant.maxTokens || 200;
      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        tools,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: convMaxTokens,
        fallbackModel,
      })) {
        if (session.interrupted) break;

        if (chunk.type === 'text') {
          rawResponse += chunk.content;
          // Criterio de relevancia: si el LLM emite [NO_DIRIGIDO], la frase del
          // cliente no iba con ella (habló con otro, tele, ruido). Se descarta
          // el turno ENTERO: ni TTS ni frase suelta. En cuanto se detecta, se
          // deja de acumular/hablar (el token va solo, no hay nada válido antes).
          if (containsNotAddressedToken(rawResponse)) {
            notAddressed = true;
            accumulatedText = '';
            continue;
          }
          accumulatedText += chunk.content;
          // Stream TTS in sentences for low latency
          const sentences = this._extractCompleteSentences(accumulatedText);
          if (sentences.complete.length > 0) {
            spokeFirstFragment = true;
            for (const sentence of sentences.complete) {
              if (session.interrupted) break;
              await this._speakText(callId, sentence);
            }
            accumulatedText = sentences.remaining;
          } else if (!spokeFirstFragment) {
            // ARRANQUE TEMPRANO: para el PRIMER audio del turno no esperamos
            // al punto — una cláusula con coma (≥24 chars) ya se puede decir.
            // Recorta ~300-600ms de la latencia percibida ("Hola de nuevo
            // Raúl," suena mientras el resto de la frase aún se genera).
            const frag = accumulatedText.match(/^(.{24,}?[,;:])\s+/s);
            if (frag) {
              spokeFirstFragment = true;
              await this._speakText(callId, frag[1]);
              accumulatedText = accumulatedText.slice(frag[0].length);
            }
          }
        }

        // BUG-09 FIX: Handle error chunks from LLM router — they were silently ignored,
        // leaving the call stalled with isProcessing=true and no response.
        if (chunk.type === 'error') {
          log.error(`[${callId}] LLM error chunk: ${chunk.message || chunk.content}`);
          break;
        }

        if (chunk.type === 'tool_call') {
          pendingToolCalls.push(chunk.toolCall);
        }

        if (chunk.type === 'done') {
          fullResponse = chunk.content;
          turnMetrics.llmTime = chunk.metrics?.totalTime;
          turnMetrics.llmTokens = chunk.metrics?.tokens;
          turnMetrics.llmProvider = chunk.metrics?.provider;
          if (chunk.toolCalls?.length > 0) pendingToolCalls = chunk.toolCalls;
        }
      }

      // Criterio de relevancia: la frase NO iba dirigida a la asistente.
      // Se descarta el turno — sin TTS, sin turno de asistente registrado —
      // y se sigue escuchando. La frase descartada se conserva en el
      // historial marcada "[aparte del cliente]" para que, si luego el
      // cliente sí pregunta, no se pierda contexto. Métrica notAddressed++.
      if (notAddressed || containsNotAddressedToken(rawResponse)) {
        session.metrics.notAddressed = (session.metrics.notAddressed || 0) + 1;
        turnMetrics.notAddressed = true;
        // Reetiqueta el último user message (el que se acaba de añadir) como aparte.
        for (let i = session.messages.length - 1; i >= 0; i--) {
          if (session.messages[i].role === 'user') {
            session.messages[i].content = `[aparte del cliente, no dirigido a ti] ${userText}`;
            break;
          }
        }
        if (session.transcript.length && session.transcript[session.transcript.length - 1].role === 'user') {
          session.transcript[session.transcript.length - 1].notAddressed = true;
        }
        log.info(`[${callId}] [NO_DIRIGIDO] — frase no dirigida a la asistente, turno descartado`);
        turnMetrics.totalTime = Date.now() - turnStart;
        session.recordTurn(turnMetrics);
        return;
      }

      // Speak any remaining text
      if (accumulatedText.trim() && !session.interrupted) {
        await this._speakText(callId, accumulatedText.trim());
      }

      // Handle tool calls
      if (pendingToolCalls.length > 0 && !session.interrupted) {
        // FRASE-PUENTE (2026-07-07): el turno con herramienta era ~3,8s de
        // SILENCIO medido (LLM decide tool → tool corre → LLM redacta). Si aún
        // no ha sonado nada este turno, un "un momento" cacheado (coste ~0 tras
        // la 1ª vez) llena el hueco: el cliente sabe que seguimos ahí.
        if (session._turnFirstAudioMs == null) {
          const lang = session.assistant.language || 'es';
          const filler = lang === 'eu' ? 'Momentu bat, mesedez…'
            : lang === 'gl' ? 'Un momento, por favor…'
            : 'Un momento, por favor…';
          await this._speakText(callId, filler, { cache: true });
        }
        await this._handleToolCalls(callId, session, pendingToolCalls, turnMetrics);
      } else if (fullResponse) {
        session._consecRecovery = 0; // respuesta real → rompe cualquier racha de recuperación
        session.addAssistantMessage(fullResponse);
      }

      // Red de seguridad ANTI-SILENCIO: si el turno terminó sin decir nada
      // (todos los proveedores LLM fallaron, respuesta vacía) el cliente
      // está esperando al teléfono — jamás dejar aire muerto.
      if (!session.interrupted && !fullResponse && pendingToolCalls.length === 0) {
        session._consecRecovery = (session._consecRecovery || 0) + 1;
        session.metrics.recoveries = (session.metrics.recoveries || 0) + 1;
        // Anti-bucle (fix 2026-07): esta rama antes quedaba FUERA del anti-bucle
        // de la escalera de STT y podía repetir "¿me lo puede repetir?" sin fin
        // (caso real: STT bien, LLM vacío en bucle). Ahora, tras N turnos sin
        // respuesta seguidos, escala a recado con la misma salida de gracia.
        if (session._consecRecovery >= ESCALATE_AFTER && !session._escalatedTakeMessage) {
          await this._takeMessageAndNotify(callId, session, turnMetrics, `${session._consecRecovery} turnos sin respuesta seguidos`);
        } else {
          const recovery = 'Perdone, no le he escuchado bien. ¿Me lo puede repetir?';
          log.warn(`[${callId}] Turno sin respuesta del LLM — recuperación (${session._consecRecovery})`);
          await this._speakText(callId, recovery);
          session.addAssistantMessage(recovery);
        }
      }

      turnMetrics.totalTime = Date.now() - turnStart;
      if (session._turnFirstAudioMs != null) turnMetrics.firstAudioMs = session._turnFirstAudioMs;
      session.recordTurn(turnMetrics);

      // Colgado determinista por despedida: si el CLIENTE se despide y la
      // respuesta también es despedida, el servidor cuelga solo — el LLM no
      // siempre invoca end_call (verificado: turno final con 0 tools tras
      // "gracias, adiós", 2026-07-03). Una frase nueva del cliente lo cancela
      // (el siguiente _processTurn limpia el timer).
      const USER_BYE = /\b(adi[oó]s|hasta luego|hasta pronto|nada m[aá]s|eso es todo|chao|agur|cu[ií]date)\b/i;
      const BOT_BYE  = /\b(adi[oó]s|hasta luego|hasta pronto|que tenga|buen d[ií]a|buenas tardes|buenas noches|agur)\b/i;
      const lastBot = session.transcript.length ? session.transcript[session.transcript.length - 1] : null;
      if (USER_BYE.test(userText) && lastBot?.role === 'assistant' && BOT_BYE.test(lastBot.content) && !session._farewellTimer) {
        const waitMs = Math.max(0, (session.playbackEndsAt || 0) - Date.now()) + 2500;
        log.info(`[${callId}] Despedida mutua — colgado automático en ${Math.round(waitMs / 1000)}s`);
        session._farewellTimer = setTimeout(() => {
          try { (session.twilioWs || session.vonageWs)?.close(); } catch (_) {}
        }, waitMs);
        if (session._farewellTimer.unref) session._farewellTimer.unref();
      }

    } catch (error) {
      log.error(`[${callId}] Turn processing error`, { error: error.message });
    } finally {
      session.isProcessing = false;
      // Procesar lo que el cliente dijo mientras estábamos ocupados, con su
      // confianza (para que la escalera de STT proteja también ese turno).
      const pending = session.pendingUtterance;
      const pendingMeta = session.pendingMeta;
      if (pending && this.activeCalls.has(callId)) {
        session.pendingUtterance = null;
        session.pendingMeta = null;
        setImmediate(() => this._processTurn(callId, pending, pendingMeta || {}).catch(() => {}));
      }
    }
  }

  /**
   * Salida de gracia UNIFICADA. Tras varios fallos seguidos —malentendidos
   * de STT o turnos sin respuesta del LLM— deja de pedir "¿me lo puede
   * repetir?" en bucle: toma el recado y avisa al dueño con el número del
   * llamante. Una sola vez por llamada (session._escalatedTakeMessage). No
   * hace recordTurn ni corta el flujo — de eso se encarga quien llama.
   */
  async _takeMessageAndNotify(callId, session, turnMetrics, reason) {
    session._escalatedTakeMessage = true;
    session.metrics.escalatedTakeMessage = true;
    if (turnMetrics) turnMetrics.escalatedTakeMessage = true;
    const msg = 'Disculpe, hoy me cuesta oírle bien y no quiero hacerle perder el tiempo. Tomo nota de su llamada y le devolverán la llamada enseguida. Gracias por su paciencia.';
    log.warn(`[${callId}] ${reason} — escala a recado + aviso al dueño`);
    await this._speakText(callId, msg, { cache: true });
    session.addAssistantMessage(msg);
    // Aviso inmediato al dueño (setImmediate dentro de _notifyOwner → no bloquea)
    try {
      require('../tools/executor')._notifyOwner(
        `📞 *Llamada difícil de atender — NodeFlow*\n` +
        `━━━━━━━━━━━━\n` +
        `No se pudo atender bien al cliente por la línea. Le dijimos que le devolveríais la llamada.\n` +
        `📞 ${session.callerNumber || 'número oculto'}\n` +
        `━━━━━━━━━━━━\nMejor llamarle pronto. NodeFlow IA`,
        session.businessId
      );
    } catch (_) {}
    // Lead determinista (fire-and-forget: nunca bloquea ni tumba la llamada)
    try {
      const db = require('../db/database').getDatabase();
      if (db.enabled && session.businessId) {
        db.client.from('leads').insert({
          org_id:     session.businessId,
          name:       '',
          phone:      session.callerNumber || '',
          need:       'Llamada con mala calidad de audio: no se pudo atender bien. Devolver la llamada.',
          notes:      'Escalado en llamada: la IA no pudo atender bien al cliente varias veces seguidas y le prometió que le devolverían la llamada.',
          urgency:    'media',
          source:     'voice_call_take_message',
          created_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      }
    } catch (_) {}
  }

  /**
   * Handle tool calls from LLM
   */
  async _handleToolCalls(callId, session, toolCalls, turnMetrics) {
    session.addAssistantToolCallMessage(null, toolCalls);
    turnMetrics.toolCalls = toolCalls.length;
    const toolStart = Date.now();

    for (const tc of toolCalls) {
      if (session.interrupted) break;

      let toolArgs = {};
      try {
        toolArgs = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function.arguments || {});
      } catch (_) {
        log.warn(`[${callId}] Failed to parse tool args for ${tc.function.name} — using {}`);
      }
      const result = await this.toolExecutor.execute(
        tc.function.name,
        toolArgs,
        session.assistant.id,
        { callId, session }          // ← context for session stamping (System A)
      );

      // Observabilidad: entrada y salida de CADA tool quedan en las métricas
      // del turno (nf_calls). Sin esto, "dijo que no había disponibilidad"
      // era indiagnosticable — no sabíamos qué vio el LLM (2026-07-03).
      turnMetrics.tools = turnMetrics.tools || [];
      turnMetrics.tools.push({
        name: tc.function.name,
        args: JSON.stringify(toolArgs).slice(0, 300),
        result: JSON.stringify(result).slice(0, 400),
      });

      session.addToolMessage(tc.id, result.success !== undefined
        ? (result.success ? JSON.stringify(result) : `Error: ${result.error}`)
        : JSON.stringify(result));
    }

    turnMetrics.toolTime = Date.now() - toolStart;

    // Get LLM response after tool results
    if (!session.interrupted) {
      // Mismo criterio que el turno principal: sin modelo forzado el
      // router elige el proveedor más rápido con auto-fallback. Forzar
      // gpt-4o-mini aquí costaba ~4s por turno y, sin OpenAI, el turno
      // moría en silencio JUSTO después de consultar la disponibilidad.
      // DEFAULT_LLM_MODEL (env): misma palanca que el turno principal (puente
      // anti-entrecortado 2026-07-12) — ambos turnos deben ir por el mismo
      // proveedor o el post-herramienta volvería a hacer thrash.
      const modelSpec = session.assistant.model || process.env.DEFAULT_LLM_MODEL || null;
      const fallbackModel = session.assistant.fallbackModel || null;
      let postToolResponse = '';
      let accumulatedText = '';

      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: session.assistant.maxTokens || 500,
        fallbackModel,
      })) {
        if (session.interrupted) break;
        if (chunk.type === 'text') {
          accumulatedText += chunk.content;
          // Frases al TTS según llegan — igual que el turno principal
          const sentences = this._extractCompleteSentences(accumulatedText);
          for (const sentence of sentences.complete) {
            if (session.interrupted) break;
            await this._speakText(callId, sentence);
          }
          if (sentences.complete.length > 0) accumulatedText = sentences.remaining;
        }
        if (chunk.type === 'error') {
          log.error(`[${callId}] LLM error chunk (post-tool): ${chunk.message || chunk.content}`);
          break;
        }
        if (chunk.type === 'done') postToolResponse = chunk.content;
      }

      if (accumulatedText.trim() && !session.interrupted) {
        await this._speakText(callId, accumulatedText.trim());
      }

      if (postToolResponse && !session.interrupted) {
        session._consecRecovery = 0; // respuesta real tras la herramienta → rompe la racha
        session.addAssistantMessage(postToolResponse);
      } else if (!session.interrupted) {
        // Anti-silencio post-herramientas: el tool YA se ejecutó y el
        // cliente espera la respuesta — jamás dejarle en el aire. Con el mismo
        // anti-bucle que el resto: tras N turnos post-tool vacíos seguidos,
        // recado en vez de repetir sin fin.
        const escalateAfter = Math.max(2, Number(process.env.MISUNDERSTAND_ESCALATE_AFTER) || 3);
        session._consecRecovery = (session._consecRecovery || 0) + 1;
        session.metrics.recoveries = (session.metrics.recoveries || 0) + 1;
        if (session._consecRecovery >= escalateAfter && !session._escalatedTakeMessage) {
          await this._takeMessageAndNotify(callId, session, turnMetrics, `${session._consecRecovery} turnos post-tool sin respuesta`);
        } else {
          const recovery = 'Perdone, se me ha cortado un momento. ¿Me lo puede repetir?';
          log.warn(`[${callId}] Turno post-tool sin respuesta del LLM — recuperación (${session._consecRecovery})`);
          await this._speakText(callId, recovery);
          session.addAssistantMessage(recovery);
        }
      }
    }
  }

  /**
   * Convert text to speech via TTS Router and send to Twilio
   */
  async _speakText(callId, text, opts = {}) {
    const session = this.activeCalls.get(callId);
    if (!session || session.interrupted) return;

    // Red de seguridad: un tool call textualizado ("<function=...")
    // JAMÁS se lee en voz alta — el adaptador de Groq los filtra, pero
    // esto cubre cualquier proveedor y el turno post-herramientas.
    text = stripTextualToolCalls(text);
    if (!text) return;
    // Defensa en profundidad: el token de relevancia [NO_DIRIGIDO] JAMÁS
    // se pronuncia, ni aunque el LLM lo incruste en una frase. La lógica
    // de descarte del turno vive en _processTurn; esto es el último cortafuegos.
    if (containsNotAddressedToken(text)) {
      text = stripNotAddressedToken(text);
      if (!text) return;
    }
    // Dicción determinista: €→euros, "1 hora"→"una hora"… antes del TTS.
    text = toSpeakable(text);

    session.isSpeaking = true;
    const ttsStart = Date.now();

    try {
      // Caché de frases FIJAS (saludo, "¿Sí? Dígame.", despedidas): el mismo
      // texto con la misma voz se sintetiza UNA vez; el resto de llamadas
      // arranca al instante — el saludo es la primera impresión y donde se
      // concentran los cuelgues por latencia.
      let mulaw = null, cacheKey = null;
      if (opts.cache) {
        cacheKey = [session.assistant.voice, session.assistant.ttsProvider, session.assistant.language, session.assistant.speed, text].join('|');
        const hit = _fixedAudioCache.get(cacheKey);
        if (hit) {
          _fixedAudioCache.delete(cacheKey); _fixedAudioCache.set(cacheKey, hit); // LRU refresh
          mulaw = hit;
        }
      }

      if (!mulaw) {
        // Use TTS Router with assistant's preferred provider/voice
        mulaw = await this.ttsRouter.synthesize({
          callId,
          text,
          provider: session.assistant.ttsProvider || null,
          voice: session.assistant.voice || 'nova',
          speed: session.assistant.speed || 1.0,
          language: session.assistant.language || 'es',
          strategy: session.assistant.ttsStrategy || 'latency',
          fallback: session.assistant.ttsFallback || 'openai',
        });
        if (cacheKey && mulaw && mulaw.length > 0) {
          _fixedAudioCache.set(cacheKey, mulaw);
          while (_fixedAudioCache.size > FIXED_AUDIO_MAX) {
            _fixedAudioCache.delete(_fixedAudioCache.keys().next().value);
          }
        }
      }

      if (mulaw.length > 0 && !session.interrupted) {
        if (session.provider === 'vonage' && session.vonageWs) {
          // Vonage expects L16 PCM 16kHz — convert mulaw 8kHz → PCM 8kHz → PCM 16kHz
          const pcm16k = pcm8kToPcm16k(mulawToPcm(mulaw));
          sendAudioToVonage(session.vonageWs, pcm16k);
          // BUG-01 FIX: Vonage has no mark/acknowledgement mechanism — reset isSpeaking now.
          // Twilio resets it via handleMark(); Vonage audio is fire-and-forget.
          session.isSpeaking = false;
        } else {
          session.sendAudioToTwilio(mulaw);
          // isSpeaking resets via handleMark() when Twilio confirms playback
        }
      } else {
        // BUG-06 FIX: isSpeaking was set to true at the top of this function.
        // If no audio was actually sent (empty, interrupted), reset it here.
        session.isSpeaking = false;
      }

      const ttsTime = Date.now() - ttsStart;
      // Instrumentación real del TTS: antes SOLO se logueaba (n=0 en métricas)
      // y el desglose de latencia atribuía todo al LLM.
      session.metrics.totalTtsTime = (session.metrics.totalTtsTime || 0) + ttsTime;
      // Tiempo hasta el PRIMER audio del turno = la latencia que percibe el
      // cliente al teléfono (la métrica que importa, no el total del turno).
      if (session._turnT0 && session._turnFirstAudioMs == null) {
        session._turnFirstAudioMs = Date.now() - session._turnT0;
      }
      log.metric(`[${callId}] TTS completed in ${ttsTime}ms${cacheKey && ttsTime < 50 ? ' (caché)' : ''}`);

    } catch (error) {
      log.error(`[${callId}] TTS error`, { error: error.message });
      // BUG-06 FIX: Reset isSpeaking on error — otherwise the session is stuck
      // thinking the assistant is speaking when TTS failed.
      session.isSpeaking = false;
    }
  }

  /**
   * Conversation Success Score v1 — determinista y documentado.
   * Entradas (todas ya medidas): completitud, confianza media del STT,
   * latencia media por turno, fricción (aclaraciones + recuperaciones +
   * interrupciones). 0-100. Los pesos son la calibración inicial; se
   * revisan con datos reales (el score y sus entradas se persisten).
   */
  _computeQuality(session, callSeconds) {
    const turns = session.metrics.turns || [];
    const confs = turns.map(t => t.sttConfidence).filter(c => typeof c === 'number');
    const avgConfidence = confs.length ? +(confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3) : null;
    const lats = turns.map(t => t.totalTime).filter(Boolean);
    const avgLatency = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
    const clarifications = session.metrics.clarifications || 0;
    const recoveries = session.metrics.recoveries || 0;
    const interruptions = session.metrics.interruptions || 0;
    // Audio entrecortado: huecos entre fragmentos (silencio a media frase) y
    // atascos del pacer. Antes NINGUNO contaba en la calidad → un cliente decía
    // "se entrecorta" y el score decía 99 (hallazgo auditoría voz 2026-07-07).
    const fragmentGaps = session.metrics.fragmentGaps || 0;
    const worstFragmentGapMs = session.metrics.worstFragmentGapMs || 0;
    const pacerStalls = session.metrics.pacerStalls || 0;
    // Completa = hubo conversación real (≥1 turno procesado y >10s de llamada)
    const completed = session.turnCount >= 1 && callSeconds > 10;

    let score = 100;
    if (!completed) score -= 40;
    if (avgConfidence !== null) score -= Math.round(Math.max(0, (0.95 - avgConfidence) / 0.95) * 30);
    if (avgLatency !== null && avgLatency > 1500) score -= Math.min(15, Math.round((avgLatency - 1500) / 200));
    score -= Math.min(15, clarifications * 5 + recoveries * 5 + interruptions * 2);
    // El entrecortado es lo que MÁS molesta al oído: cada hueco resta, y un
    // hueco largo (>400ms) es una pausa clarísima a media frase.
    score -= Math.min(25, fragmentGaps * 6 + pacerStalls * 4 + (worstFragmentGapMs > 400 ? 8 : 0));
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      completed,
      booked: session.outcome === 'booked',
      avgConfidence,
      avgLatency,
      clarifications,
      recoveries,
      interruptions,
      fragmentGaps,
      worstFragmentGapMs,
      pacerStalls,
    };
  }

  /**
   * Extract complete sentences from accumulated text
   */
  _extractCompleteSentences(text) {
    const sentenceEnders = /([.!?;])(\s+|$)/g;
    let lastIndex = 0;
    const complete = [];
    let match;

    while ((match = sentenceEnders.exec(text)) !== null) {
      complete.push(text.substring(lastIndex, match.index + match[1].length).trim());
      lastIndex = match.index + match[0].length;
    }

    return { complete, remaining: text.substring(lastIndex) };
  }

  /**
   * End a call
   */
  endCall(callId) {
    const session = this.activeCalls.get(callId);
    if (!session) return null;
    clearInterval(session._lifeguard);
    clearTimeout(session._hangupTimer);
    clearTimeout(session._farewellTimer);

    // Salud del audio entrante: segundos recibidos vs segundos de llamada.
    // <85% con llamada >10s = frames perdidos (red o CPU) — sospechar del
    // host antes que del llamante. Vonage manda L16 16kHz (32000 B/s).
    const rxRate = session.provider === 'vonage' ? 32000 : 8000;
    const rxSeconds = (session.audioRxBytes || 0) / rxRate;
    const callSeconds = session.getDuration() / 1000;
    const pct = callSeconds > 0 ? Math.round((rxSeconds / callSeconds) * 100) : 0;
    const rxLine = `[${callId}] Audio entrante: ${rxSeconds.toFixed(1)}s en ${callSeconds.toFixed(1)}s de llamada (${pct}%)`;
    if (callSeconds > 10 && pct < 85) log.warn(`${rxLine} — FRAMES PERDIDOS`);
    else log.info(rxLine);
    // También en el registro de la llamada: diagnosticable desde la API
    // sin acceso a los logs del host.
    session.metrics.audioRx = { seconds: +rxSeconds.toFixed(1), callSeconds: +callSeconds.toFixed(1), pct };
    // Conversation Success Score v1 — determinista, calculado de lo YA
    // medido. Persiste en nf_calls.metrics.quality: "hoy 97 llamadas, 95
    // con score >80" sustituye a leer logs. v2 (auditor IA) tras validar E2E.
    session.metrics.quality = this._computeQuality(session, callSeconds);
    sttDebug.finalize(callId);

    this.sttRouter.closeSession(callId);
    const callData = session.end();
    this.activeCalls.delete(callId);
    // Baja del contador del clúster (DORMANTE — no-op si CLUSTER_MODE off).
    // Fire-and-forget; si fallara, la clave caduca sola por TTL de auto-cura.
    clusterState.decrCall(callId).catch(() => {});
    this.callHistory.unshift(callData);
    if (this.callHistory.length > this.maxHistory) this.callHistory.pop();
    // Persistencia (C1): registro completo, upsert idempotente — recupera
    // incluso las llamadas cuya alta falló (BD caída al inicio).
    this.callStore.saveCallEnd(callData).catch(() => {});
    this._fireWebhook('call.ended', callData);

    // BUG-32 FIX: Wire analytics so admin dashboard callsToday reflects real calls.
    // Must run before System A (which may throw) to guarantee recording.
    try {
      const { getAnalytics } = require('../analytics/engine');
      getAnalytics().recordCall(callData);
    } catch (e) {
      log.warn('analytics recordCall failed', { err: e.message });
    }

    // System A: post-call automations (fire-and-forget — never blocks endCall)
    try {
      const { postCallHandler } = require('../automations/post-call-handler');
      postCallHandler.handle(callData).catch(e => log.warn('post-call handler error', { err: e.message }));
    } catch (e) {
      // require() failure (missing module) must not break call teardown
    }

    return callData;
  }

  /**
   * Get active calls
   */
  getActiveCalls() {
    return Array.from(this.activeCalls.values()).map(s => s.toJSON());
  }

  /**
   * Get call history
   */
  getCallHistory(limit = 50) {
    return this.callHistory.slice(0, limit);
  }

  /**
   * Get metrics summary
   */
  getMetrics() {
    const active = this.activeCalls.size;
    const total = this.callHistory.length;
    const totalCost = this.callHistory.reduce((sum, c) => sum + (c.cost?.total || 0), 0);
    const totalDuration = this.callHistory.reduce((sum, c) => sum + (c.duration || 0), 0);
    const avgTurns = total > 0 ? this.callHistory.reduce((sum, c) => sum + (c.turnCount || 0), 0) / total : 0;
    return {
      activeCalls: active,
      totalCalls: total,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalDurationMinutes: Math.round(totalDuration / 60000 * 100) / 100,
      avgTurnsPerCall: Math.round(avgTurns * 10) / 10,
      providers: {
        stt: this.sttRouter.getMetrics(),
        llm: this.llmRouter.getMetrics(),
        tts: this.ttsRouter.getMetrics(),
      },
    };
  }

  /**
   * Fire webhook event
   */
  async _fireWebhook(event, data) {
    if (!this.webhookUrl) return;
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), data }),
      });
    } catch (e) {
      log.error(`Webhook fire failed for ${event}`, { error: e.message });
    }
  }
}

module.exports = { VoicePipeline, mergePendingUtterance, lowerConfidenceMeta, effectiveMaxMs };
