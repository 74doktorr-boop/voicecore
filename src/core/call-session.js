// ============================================
// VoiceCore — Call Session
// Manages state for a single active phone call
// ============================================

const { v4: uuidv4 } = require('uuid');
const { Logger } = require('../utils/logger');

const log = new Logger('SESSION');

// ── Pacer por reloj ─────────────────────────────────────────
// Frames de 20ms de mulaw 8kHz. LEAD_MS = colchón que mantenemos en el
// buffer del proveedor: suficiente para absorber jitter del event loop,
// corto para que el barge-in (que además envía 'clear') siga inmediato.
const PACE_FRAME_MS = 20;
const PACE_LEAD_MS = 600;
const PACE_MAX_BURST = 100; // tope por bombeo (2s) — nunca megaráfagas

/**
 * Cuántos frames tocan enviar AHORA para ir tiempo-real + colchón por
 * delante. PURA → testeable: un bombeo tardío devuelve más frames (se
 * autocompensa), nunca acumula retraso.
 */
function pacerFramesDue(elapsedMs, framesSent, queueLen, leadMs = PACE_LEAD_MS, frameMs = PACE_FRAME_MS) {
  const target = Math.ceil((elapsedMs + leadMs) / frameMs);
  return Math.max(0, Math.min(target - framesSent, queueLen, PACE_MAX_BURST));
}

const COST_RATES = {
  twilio: 0.018,
  deepgram: 0.0077,
  openai_llm: 0.005,
  openai_tts: 0.02,
  elevenlabs_tts: 0.10,
  cartesia_tts: 0.015,
  google_tts: 0.016,
  local_tts: 0,        // XTTS v2 on own hardware — electricity only
};

class CallSession {
  constructor({ callId, assistant, callerNumber, calledNumber, direction = 'inbound' }) {
    this.id = callId || uuidv4();
    this.assistant = assistant;
    this.callerNumber = callerNumber;
    this.calledNumber = calledNumber;
    this.direction = direction;
    this.status = 'initializing';
    this.provider = 'twilio'; // 'twilio' | 'vonage' | 'browser'
    this.streamSid = null;
    this.twilioWs = null;
    this.vonageWs = null;
    this.messages = [];
    this.turnCount = 0;
    this.isProcessing = false;
    this.isSpeaking = false;
    this.interrupted = false;
    this.markCounter = 0;
    this.pendingMarks = new Set();
    // Pacer de salida: cola de frames de 20ms + reloj de reproducción.
    // Telnyx (RTP bidireccional) reproduce según llega — sin ritmo real los
    // frames se pierden (palabras cortadas). El reloj sustituye a los marks
    // (Telnyx no los devuelve → isSpeaking quedaba atascado en true).
    this.outQueue = [];
    this._pacer = null;
    this.playbackEndsAt = 0;
    this.startTime = Date.now();
    this.endTime = null;
    this.metrics = { turns: [], totalSttTime: 0, totalLlmTime: 0, totalTtsTime: 0, totalToolTime: 0, llmTokens: 0, toolCalls: 0, interruptions: 0 };
    this.transcript = [];
    // ── Post-call context (populated by ToolExecutor during call) ────────────
    this.outcome         = 'abandoned';  // 'booked' | 'info' | 'abandoned'
    this.bookedAppointment = null;       // última reserva (compat)
    // TODAS las reservas de la llamada. Bug real (Pablo, 2026-07-03):
    // reservó 2 citas en una llamada y solo se notificó la última —
    // el campo singular machacaba la primera.
    this.bookedAppointments = [];
    this.clientEmail     = null;         // set by book_appointment tool if email given
    this.businessId      = assistant?.id || null;
    if (assistant) this._initConversation();
  }

  _initConversation() {
    const systemMsg = this.assistant.systemPrompt || this.assistant.system_prompt || 'You are a helpful assistant.';
    const lang      = this.assistant.language || 'es';
    // Use locale matching the business language so day/month names are correct
    const locale    = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES';
    // BUG-47 FIX: Pin timezone to Europe/Madrid — server may run in UTC and the date/time
    // shown to the AI must reflect what the Spanish business owner sees on their clock.
    const now       = new Date();
    const dateStr   = now.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Madrid' });
    const timeStr   = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const label     = lang === 'eu' ? 'Uneko data eta ordua' : lang === 'gl' ? 'Data e hora actual' : 'Fecha y hora actual';
    this.messages.push({ role: 'system', content: `${systemMsg}\n\n[${label}: ${dateStr}, ${timeStr}]` });
  }

  addUserMessage(text) {
    if (!text?.trim()) return;
    this.messages.push({ role: 'user', content: text });
    this.transcript.push({ role: 'user', content: text, timestamp: Date.now() });
    log.call(`[${this.id}] 👤 User: "${text}"`);
  }

  addAssistantMessage(text) {
    if (!text?.trim()) return;
    this.messages.push({ role: 'assistant', content: text });
    this.transcript.push({ role: 'assistant', content: text, timestamp: Date.now() });
    log.call(`[${this.id}] 🤖 Assistant: "${text.substring(0, 80)}..."`);
  }

  addToolMessage(toolCallId, result) {
    this.messages.push({ role: 'tool', tool_call_id: toolCallId, content: typeof result === 'string' ? result : JSON.stringify(result) });
  }

  addAssistantToolCallMessage(content, toolCalls) {
    const msg = { role: 'assistant' };
    if (content) msg.content = content;
    if (toolCalls?.length > 0) {
      msg.tool_calls = toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }));
    }
    this.messages.push(msg);
  }

  recordTurn(m) {
    this.turnCount++;
    this.metrics.turns.push({ turn: this.turnCount, ...m, timestamp: Date.now() });
    if (m.sttTime) this.metrics.totalSttTime += m.sttTime;
    if (m.llmTime) this.metrics.totalLlmTime += m.llmTime;
    if (m.ttsTime) this.metrics.totalTtsTime += m.ttsTime;
    if (m.toolTime) this.metrics.totalToolTime += m.toolTime;
    if (m.llmTokens) this.metrics.llmTokens += m.llmTokens;
    if (m.toolCalls) this.metrics.toolCalls += m.toolCalls;
  }

  handleInterruption() {
    this.interrupted = true;
    this.isSpeaking = false;
    this.stopSpeaking();
    this.metrics.interruptions++;
    this.pendingMarks.clear();
    log.call(`[${this.id}] ⚡ Interrupted`);
  }

  // ¿Hay audio sonando AHORA en el teléfono? Basado en el reloj de
  // reproducción, no en acks del proveedor (Telnyx no devuelve marks).
  // Única fuente fiable para decidir si un barge-in es legítimo.
  isSpeakingNow() {
    return this.outQueue.length > 0 || Date.now() < this.playbackEndsAt;
  }

  // Vacía la cola y para el pacer (interrupción o fin de llamada).
  stopSpeaking() {
    this.outQueue.length = 0;
    if (this._pacer) { clearInterval(this._pacer); this._pacer = null; }
    this.playbackEndsAt = 0;
  }

  sendAudioToTwilio(mulawBuffer) {
    if (!this.twilioWs || !this.streamSid) return;
    const FRAME = 160; // 20ms de mulaw 8kHz
    for (let i = 0; i < mulawBuffer.length; i += FRAME) {
      this.outQueue.push(mulawBuffer.slice(i, Math.min(i + FRAME, mulawBuffer.length)));
    }
    const frames = Math.ceil(mulawBuffer.length / FRAME);
    this.playbackEndsAt = Math.max(this.playbackEndsAt, Date.now()) + frames * 20;
    this._startPacer();
  }

  _startPacer() {
    if (this._pacer) return;
    // Pacer por RELOJ con colchón (no por tick): el diseño anterior enviaba
    // 1 frame de 20ms por tick de setInterval(20ms) — el jitter del event
    // loop (5-15ms por tick en un contenedor con carga) producía huecos
    // audibles ("se entrecorta"). Ahora cada bombeo calcula cuántos frames
    // DEBERÍAN estar ya enviados (tiempo real + colchón) y envía los que
    // falten de golpe: un tick tardío se autocompensa, jamás acumula hueco.
    // El proveedor bufferiza sin problema y el barge-in sigue limpio porque
    // clearTwilioBuffer() envía 'clear' (vacía su buffer al interrumpir).
    this._paceT0 = Date.now();
    this._framesSent = 0;
    const pump = () => {
      try {
        let due = pacerFramesDue(Date.now() - this._paceT0, this._framesSent, this.outQueue.length);
        while (due-- > 0) {
          const chunk = this.outQueue.shift();
          this.twilioWs.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
          this._framesSent++;
        }
        if (!this.outQueue.length) {
          clearInterval(this._pacer); this._pacer = null;
          const markName = `voice_${++this.markCounter}`;
          this.pendingMarks.add(markName);
          this.twilioWs.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: markName } }));
          // Cuando el último frame termine de sonar, dejamos de "hablar".
          const remaining = Math.max(0, this.playbackEndsAt - Date.now());
          setTimeout(() => { if (!this.isSpeakingNow()) this.isSpeaking = false; }, remaining + 40);
        }
      } catch (error) {
        clearInterval(this._pacer); this._pacer = null;
        log.error(`[${this.id}] Error sending audio`, { error: error.message });
      }
    };
    this._pacer = setInterval(pump, 50);
    pump();
  }

  clearTwilioBuffer() {
    if (!this.twilioWs || !this.streamSid) return;
    try {
      this.twilioWs.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
      this.pendingMarks.clear();
    } catch (e) {}
  }

  handleMark(markName) {
    this.pendingMarks.delete(markName);
    if (this.pendingMarks.size === 0) this.isSpeaking = false;
  }

  getCost() {
    const mins = this.getDuration() / 60000;
    const ttsProvider = this.assistant?.ttsProvider;
    const ttsRate = {
      elevenlabs: COST_RATES.elevenlabs_tts,
      cartesia:   COST_RATES.cartesia_tts,
      google:     COST_RATES.google_tts,
      local:      COST_RATES.local_tts,
    }[ttsProvider] ?? COST_RATES.openai_tts;

    const twilio  = mins * COST_RATES.twilio;
    const stt     = mins * COST_RATES.deepgram;
    const llm     = mins * COST_RATES.openai_llm;
    const tts     = mins * ttsRate;
    const total   = twilio + stt + llm + tts;

    return {
      twilio,
      deepgram: stt,
      llm,
      tts,
      ttsProvider: ttsProvider || 'openai',
      total,
      durationMinutes: Math.round(mins * 100) / 100,
    };
  }

  getDuration() { return (this.endTime || Date.now()) - this.startTime; }

  _deriveOutcome() {
    if (this.bookedAppointment) return 'booked';
    if (this.turnCount >= 3)   return 'info';
    return 'abandoned';
  }

  end() {
    this.stopSpeaking(); // limpia el pacer — sin esto el intervalo quedaría vivo
    this.status  = 'ended';
    this.endTime = Date.now();
    this.outcome = this._deriveOutcome();
    const cost   = this.getCost();
    log.call(`[${this.id}] Call ended — ${Math.round(this.getDuration()/1000)}s, ${this.turnCount} turns, $${cost.total.toFixed(4)}, outcome:${this.outcome}`);
    return this.toJSON();
  }

  toJSON() {
    const d = this.getDuration(); const s = Math.floor(d/1000); const m = Math.floor(s/60);
    return {
      id: this.id, assistantId: this.assistant?.id, assistantName: this.assistant?.name,
      callerNumber: this.callerNumber, calledNumber: this.calledNumber, direction: this.direction,
      status: this.status, startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      duration: d, durationFormatted: `${m}:${(s%60).toString().padStart(2,'0')}`,
      turnCount: this.turnCount, transcript: this.transcript, metrics: this.metrics, cost: this.getCost(),
      // Post-call context
      outcome: this.outcome,
      bookedAppointment: this.bookedAppointment,
      bookedAppointments: this.bookedAppointments,
      clientEmail: this.clientEmail,
      businessId: this.businessId,
      campaignRef: this.campaignRef || null, // job de Campaign Core que originó la saliente
      // Contexto para el auditor: sin esto auditaba a ciegas (no sabía el
      // modo ni el catálogo y puntuaba mal el guion correcto — 2026-07-04)
      assistantMode: this.assistant?.mode || null,
      sector: this.assistant?.sector || null,
      serviceList: this.serviceList || null,
    };
  }
}

module.exports = { CallSession, pacerFramesDue };
