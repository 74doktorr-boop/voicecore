// ============================================
// VoiceCore — Call Session
// Manages state for a single active phone call
// ============================================

const { v4: uuidv4 } = require('uuid');
const { Logger } = require('../utils/logger');

const log = new Logger('SESSION');

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
    this.startTime = Date.now();
    this.endTime = null;
    this.metrics = { turns: [], totalSttTime: 0, totalLlmTime: 0, totalTtsTime: 0, totalToolTime: 0, llmTokens: 0, toolCalls: 0, interruptions: 0 };
    this.transcript = [];
    // ── Post-call context (populated by ToolExecutor during call) ────────────
    this.outcome         = 'abandoned';  // 'booked' | 'info' | 'abandoned'
    this.bookedAppointment = null;       // set by book_appointment tool
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
    this.metrics.interruptions++;
    this.pendingMarks.clear();
    log.call(`[${this.id}] ⚡ Interrupted`);
  }

  sendAudioToTwilio(mulawBuffer) {
    if (!this.twilioWs || !this.streamSid) return;
    try {
      const chunkSize = 160;
      for (let i = 0; i < mulawBuffer.length; i += chunkSize) {
        const chunk = mulawBuffer.slice(i, Math.min(i + chunkSize, mulawBuffer.length));
        this.twilioWs.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
      }
      const markName = `voice_${++this.markCounter}`;
      this.pendingMarks.add(markName);
      this.twilioWs.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name: markName } }));
      return markName;
    } catch (error) {
      log.error(`[${this.id}] Error sending audio`, { error: error.message });
    }
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
      clientEmail: this.clientEmail,
      businessId: this.businessId,
    };
  }
}

module.exports = { CallSession };
