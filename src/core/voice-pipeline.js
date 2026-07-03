// ============================================
// VoiceCore v2.0 — Voice Pipeline
// Main orchestrator: STT → LLM → TTS
// Now with multi-provider routing
// ============================================

const { Logger } = require('../utils/logger');
const { STTRouter } = require('../stt/router');
const { LLMRouter } = require('../llm/router');
const { stripTextualToolCalls } = require('../llm/textual-tool-filter');
const sttDebug = require('../utils/stt-debug');
const defaultCallStore = require('../db/call-store');
const { TTSRouter } = require('../tts/router');
const { ToolExecutor } = require('../tools/executor');
const { CallSession } = require('./call-session');
const { mulawToPcm, pcm8kToPcm16k } = require('../utils/audio');
const { sendAudioToVonage } = require('../telephony/vonage-handler');
const { getKnowledgeBase } = require('../knowledge/base');
const { getDatabase } = require('../db/database');

const log = new Logger('PIPELINE');

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
      azureSpeechKey: config.azureSpeechKey,
      azureSpeechRegion: config.azureSpeechRegion,
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
  _armInterruptWatchdog(callId) {
    const session = this.activeCalls.get(callId);
    if (!session) return;
    clearTimeout(session._interruptWatchdog);
    session._interruptWatchdog = setTimeout(() => {
      const s = this.activeCalls.get(callId);
      if (!s || s.isProcessing || s.isSpeakingNow() || s.pendingUtterance) return;
      log.call(`[${callId}] Interrupción sin continuación — re-enganche`);
      this._speakText(callId, '¿Sí? Dígame.').catch(() => {});
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
   * Start a new call session
   */
  async startCall({ callId, assistant, callerNumber, calledNumber, direction, twilioWs, streamSid, vonageWs, provider = 'twilio', mediaEncoding = null }) {
    // Cap de concurrentes por asistente: rechaza ANTES de abrir STT (coste 0).
    // Devuelve null → el handler de telefonía cierra el WS limpiamente.
    const limit = this._concurrentLimitFor(assistant);
    const active = this._countActiveForAssistant(assistant?.id);
    if (limit > 0 && active >= limit) {
      log.warn(`[${callId}] Rechazada: asistente ${assistant?.id || '?'} en el cap de concurrentes (${active}/${limit})`);
      return null;
    }

    const session = new CallSession({ callId, assistant, callerNumber, calledNumber, direction });
    session.twilioWs  = twilioWs;
    session.vonageWs  = vonageWs;
    session.streamSid = streamSid;
    session.provider  = provider;
    session.status    = 'active';
    this.activeCalls.set(callId, session);

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
            if (priceBlock) { sys.content += '\n\n' + priceBlock; log.info(`[${callId}] Precios estructurados inyectados (org ${orgId})`); }
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
              const { data: contact } = await db.client.from('contacts')
                .select('id')
                .eq('org_id', orgId)
                .eq('phone', callerNumber)
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

    // Códec de entrada por proveedor. CRÍTICO: el STT debe recibir el códec
    // REAL — decodificar PCMA (Europa) como PCMU destroza la transcripción
    // sin enmudecerla (causa raíz del 2026-07-03, confidence 0.78 → 0.995).
    // Telnyx lo anuncia en el evento start (mediaEncoding); sin anuncio, en
    // España es alaw. Twilio siempre mulaw; Vonage L16 16kHz.
    const isVonage = provider === 'vonage';
    const sttEncoding = isVonage ? 'linear16'
      : provider === 'telnyx' ? (mediaEncoding || 'alaw')
      : (mediaEncoding || 'mulaw');

    // Create STT session via router
    const sttProvider = this.sttRouter.getProvider(assistant.sttProvider);
    const sttSession = sttProvider.createSession(callId, {
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
        // ahora se guarda y se procesa en cuanto termine el turno en curso.
        session.pendingUtterance = text;
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
      if (session.isSpeakingNow()) {
        session.handleInterruption();
        session.clearTwilioBuffer();
        this.sttRouter.resetTranscript(callId);
        // Si la interrupción no viene seguida de una frase (falso positivo,
        // arrepentimiento), el asistente se re-engancha — jamás aire muerto.
        this._armInterruptWatchdog(callId);
      }
    };

    // Send first message if configured
    if (assistant.firstMessage) {
      const madridHour = parseInt(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }), 10);
      const greeting =
        madridHour >= 6  && madridHour < 14 ? 'Buenos días'   :
        madridHour >= 14 && madridHour < 21 ? 'Buenas tardes' :
                                              'Buenas noches';
      const firstMsg = assistant.firstMessage.replace(/\{\{GREETING\}\}/g, greeting);
      await this._speakText(callId, firstMsg);
      session.addAssistantMessage(firstMsg);
    }

    // Vigilante de fin de llamada: (a) 75s sin turnos ni voz del asistente →
    // despedida y cierre; (b) duración máxima (MAX_CALL_MINUTES, 15 por
    // defecto) → cierre educado. Una línea que queda abierta se come
    // Deepgram/€ y deja filas 'active' huérfanas (caso real 2026-07-03).
    session.lastTurnAt = Date.now();
    session._lifeguard = setInterval(() => {
      if (session._closing) return;
      const idleMs = Date.now() - Math.max(session.lastTurnAt || 0, session.playbackEndsAt || 0);
      const ageMs = Date.now() - session.startTime;
      const maxMs = (Number(process.env.MAX_CALL_MINUTES) || 15) * 60000;
      if (idleMs > 75000 || ageMs > maxMs) {
        session._closing = true;
        const porSilencio = idleMs > 75000;
        log.warn(`[${callId}] Lifeguard: cierre por ${porSilencio ? 'silencio prolongado' : 'duración máxima'}`);
        const bye = porSilencio
          ? 'Parece que se ha cortado la línea. Gracias por llamar, ¡hasta pronto!'
          : 'Vamos a tener que dejarlo aquí. Gracias por llamar, ¡hasta pronto!';
        this._speakText(callId, bye)
          .then(() => session.addAssistantMessage(bye))
          .catch(() => {})
          .finally(() => setTimeout(() => {
            try { (session.twilioWs || session.vonageWs)?.close(); } catch (_) {}
          }, 6000));
      }
    }, 10000);
    if (session._lifeguard.unref) session._lifeguard.unref();

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
    const turnStart = Date.now();
    let turnMetrics = {};

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

    try {
      if (conf !== null && conf < 0.55) {
        // Nivel 4 — determinista, sin LLM: con esta fiabilidad cualquier
        // "entendimiento" es una moneda al aire. Se pide repetición y punto.
        session.metrics.clarifications = (session.metrics.clarifications || 0) + 1;
        const ask = 'Perdone, no le he entendido bien. ¿Me lo puede repetir, por favor?';
        log.warn(`[${callId}] Confianza nivel 4 (${conf.toFixed(2)}) — turno sin acción, se pide repetición`);
        await this._speakText(callId, ask);
        session.addAssistantMessage(ask);
        session.recordTurn(turnMetrics);
        return;
      }
      if (conf !== null && conf < 0.75) {
        // Nivel 3 — pregunta abierta, prohibido actuar con estos datos.
        session.metrics.clarifications = (session.metrics.clarifications || 0) + 1;
        session.messages.push({
          role: 'system',
          content: `AVISO (fiabilidad ${Math.round(conf * 100)}%): la última frase del cliente se ha reconocido MAL. NO ejecutes ninguna acción ni registres ningún dato basándote en ella. Haz una pregunta abierta y amable para que el cliente repita lo que necesita (ej.: "No estoy seguro de haberle entendido bien, ¿me lo puede repetir?").`,
        });
        log.warn(`[${callId}] Confianza nivel 3 (${conf.toFixed(2)}) — pregunta abierta`);
      } else if (conf !== null && conf < 0.92) {
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
      const modelSpec = session.assistant.model || null;
      const fallbackModel = session.assistant.fallbackModel || null;

      // Stream LLM response via router
      let fullResponse = '';
      let pendingToolCalls = [];
      let accumulatedText = '';

      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        tools,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: session.assistant.maxTokens || 500,
        fallbackModel,
      })) {
        if (session.interrupted) break;

        if (chunk.type === 'text') {
          accumulatedText += chunk.content;
          // Stream TTS in sentences for low latency
          const sentences = this._extractCompleteSentences(accumulatedText);
          if (sentences.complete.length > 0) {
            for (const sentence of sentences.complete) {
              if (session.interrupted) break;
              await this._speakText(callId, sentence);
            }
            accumulatedText = sentences.remaining;
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

      // Speak any remaining text
      if (accumulatedText.trim() && !session.interrupted) {
        await this._speakText(callId, accumulatedText.trim());
      }

      // Handle tool calls
      if (pendingToolCalls.length > 0 && !session.interrupted) {
        await this._handleToolCalls(callId, session, pendingToolCalls, turnMetrics);
      } else if (fullResponse) {
        session.addAssistantMessage(fullResponse);
      }

      // Red de seguridad ANTI-SILENCIO: si el turno terminó sin decir nada
      // (todos los proveedores LLM fallaron, respuesta vacía) el cliente
      // está esperando al teléfono — jamás dejar aire muerto.
      if (!session.interrupted && !fullResponse && pendingToolCalls.length === 0) {
        const recovery = 'Perdone, no le he escuchado bien. ¿Me lo puede repetir?';
        log.warn(`[${callId}] Turno sin respuesta del LLM — frase de recuperación`);
        session.metrics.recoveries = (session.metrics.recoveries || 0) + 1;
        await this._speakText(callId, recovery);
        session.addAssistantMessage(recovery);
      }

      turnMetrics.totalTime = Date.now() - turnStart;
      session.recordTurn(turnMetrics);

    } catch (error) {
      log.error(`[${callId}] Turn processing error`, { error: error.message });
    } finally {
      session.isProcessing = false;
      // Procesar lo que el cliente dijo mientras estábamos ocupados
      const pending = session.pendingUtterance;
      if (pending && this.activeCalls.has(callId)) {
        session.pendingUtterance = null;
        setImmediate(() => this._processTurn(callId, pending).catch(() => {}));
      }
    }
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
      const modelSpec = session.assistant.model || null;
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
        session.addAssistantMessage(postToolResponse);
      } else if (!session.interrupted) {
        // Anti-silencio post-herramientas: el tool YA se ejecutó y el
        // cliente espera la respuesta — jamás dejarle en el aire.
        const recovery = 'Perdone, se me ha cortado un momento. ¿Me lo puede repetir?';
        log.warn(`[${callId}] Turno post-tool sin respuesta del LLM — frase de recuperación`);
        session.metrics.recoveries = (session.metrics.recoveries || 0) + 1;
        await this._speakText(callId, recovery);
        session.addAssistantMessage(recovery);
      }
    }
  }

  /**
   * Convert text to speech via TTS Router and send to Twilio
   */
  async _speakText(callId, text) {
    const session = this.activeCalls.get(callId);
    if (!session || session.interrupted) return;

    // Red de seguridad: un tool call textualizado ("<function=...")
    // JAMÁS se lee en voz alta — el adaptador de Groq los filtra, pero
    // esto cubre cualquier proveedor y el turno post-herramientas.
    text = stripTextualToolCalls(text);
    if (!text) return;

    session.isSpeaking = true;
    const ttsStart = Date.now();

    try {
      // Use TTS Router with assistant's preferred provider/voice
      const mulaw = await this.ttsRouter.synthesize({
        callId,
        text,
        provider: session.assistant.ttsProvider || null,
        voice: session.assistant.voice || 'nova',
        speed: session.assistant.speed || 1.0,
        language: session.assistant.language || 'es',
        strategy: session.assistant.ttsStrategy || 'latency',
        fallback: session.assistant.ttsFallback || 'openai',
      });

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
      log.metric(`[${callId}] TTS completed in ${ttsTime}ms`);

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
    // Completa = hubo conversación real (≥1 turno procesado y >10s de llamada)
    const completed = session.turnCount >= 1 && callSeconds > 10;

    let score = 100;
    if (!completed) score -= 40;
    if (avgConfidence !== null) score -= Math.round(Math.max(0, (0.95 - avgConfidence) / 0.95) * 30);
    if (avgLatency !== null && avgLatency > 1500) score -= Math.min(15, Math.round((avgLatency - 1500) / 200));
    score -= Math.min(15, clarifications * 5 + recoveries * 5 + interruptions * 2);
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

module.exports = { VoicePipeline };
