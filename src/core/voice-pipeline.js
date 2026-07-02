// ============================================
// VoiceCore v2.0 — Voice Pipeline
// Main orchestrator: STT → LLM → TTS
// Now with multi-provider routing
// ============================================

const { Logger } = require('../utils/logger');
const { STTRouter } = require('../stt/router');
const { LLMRouter } = require('../llm/router');
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
  async startCall({ callId, assistant, callerNumber, calledNumber, direction, twilioWs, streamSid, vonageWs, provider = 'twilio' }) {
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

    // Vonage sends L16 PCM 16kHz; Twilio sends mulaw 8kHz
    const isVonage = provider === 'vonage';

    // Create STT session via router
    const sttProvider = this.sttRouter.getProvider(assistant.sttProvider);
    const sttSession = sttProvider.createSession(callId, {
      language: assistant.language || 'es',
      model: assistant.sttModel || 'nova-3',
      utteranceEndMs: assistant.utteranceEndMs || 1000, // mínimo de Deepgram — 800 lo desactivaba (llamada muda)
      endpointing: assistant.endpointing || 300,
      encoding: isVonage ? 'linear16' : 'mulaw',
      sample_rate: isVonage ? 16000 : 8000,
      sttProvider: assistant.sttProvider,
    });

    // Fin de turno del cliente → procesar con el LLM.
    // Dos disparadores (Deepgram): speech_final (endpointing ~300ms, el
    // RÁPIDO) y UtteranceEnd (1000ms, respaldo). deepgram.js limpia el
    // transcript al disparar speech_final, así que no hay dobles.
    const onTurnText = async (text) => {
      if (!text?.trim() || text.trim().length < 2) return;
      if (session.isProcessing) {
        // El cliente habló mientras procesábamos el turno anterior (típico tras
        // una interrupción). Antes se DESCARTABA y la llamada quedaba muda;
        // ahora se guarda y se procesa en cuanto termine el turno en curso.
        session.pendingUtterance = text;
        return;
      }
      await this._processTurn(callId, text);
    };
    sttSession.onUtteranceEnd = onTurnText;
    sttSession.onSpeechEnd    = onTurnText;

    // On speech start → barge-in SOLO si de verdad hay audio sonando ahora
    // (reloj de reproducción). Antes se usaba el flag isSpeaking, que quedaba
    // atascado en true con Telnyx (no devuelve marks) → cualquier ruido
    // "interrumpía" y borraba la transcripción del cliente → mutismo.
    sttSession.onSpeechStart = () => {
      if (session.isSpeakingNow()) {
        session.handleInterruption();
        session.clearTwilioBuffer();
        this.sttRouter.resetTranscript(callId);
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

    // Fire webhook
    this._fireWebhook('call.started', session.toJSON());
    log.call(`[${callId}] Call started — ${callerNumber} → ${calledNumber}`);
    return session;
  }

  /**
   * Handle incoming audio from Twilio (base64-encoded mulaw)
   */
  handleAudio(callId, audioPayload) {
    const audioBuffer = Buffer.from(audioPayload, 'base64');
    this.sttRouter.sendAudio(callId, audioBuffer);
  }

  /**
   * Handle incoming raw PCM audio from Vonage (L16 binary buffer)
   */
  handleAudioPCM(callId, pcmBuffer, sampleRate) {
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
  async _processTurn(callId, userText) {
    const session = this.activeCalls.get(callId);
    if (!session) return;

    session.isProcessing = true;
    session.interrupted = false;
    const turnStart = Date.now();
    let turnMetrics = {};

    // Add user message
    session.addUserMessage(userText);

    try {
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
      const modelSpec = session.assistant.model || 'gpt-4o-mini';
      let postToolResponse = '';

      for await (const chunk of this.llmRouter.streamCompletion({
        callId,
        messages: session.messages,
        model: modelSpec,
        temperature: session.assistant.temperature || 0.7,
        maxTokens: session.assistant.maxTokens || 500,
      })) {
        if (session.interrupted) break;
        if (chunk.type === 'text') postToolResponse += chunk.content;
        if (chunk.type === 'done') postToolResponse = chunk.content;
      }

      if (postToolResponse && !session.interrupted) {
        await this._speakText(callId, postToolResponse);
        session.addAssistantMessage(postToolResponse);
      }
    }
  }

  /**
   * Convert text to speech via TTS Router and send to Twilio
   */
  async _speakText(callId, text) {
    const session = this.activeCalls.get(callId);
    if (!session || session.interrupted) return;

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

    this.sttRouter.closeSession(callId);
    const callData = session.end();
    this.activeCalls.delete(callId);
    this.callHistory.unshift(callData);
    if (this.callHistory.length > this.maxHistory) this.callHistory.pop();
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
