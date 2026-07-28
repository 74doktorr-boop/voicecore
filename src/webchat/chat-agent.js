'use strict';
// ============================================================
// NodeFlow — Chat WEB: el recepcionista en un widget de la web del negocio
// ------------------------------------------------------------
// El TERCER canal del mismo cerebro (voz + WhatsApp + web). Reutiliza las
// piezas ya probadas — buildSystemPrompt (de wa-agent), LLMRouter y ToolExecutor
// — SIN tocar el camino de WhatsApp (producción). El visitante escribe en la
// web, el asistente responde y RESERVA con disponibilidad real + sync a GCal.
//
// Hilo por SESIÓN (in-memory con TTL). Nota multi-réplica: como el rate-limit,
// en memoria vale para 1 instancia; con varias réplicas hace falta Redis
// (pendiente al escalar). Para un chat corto es aceptable.
//
// Kill-switch: WEB_CHAT_OFF=1. Deps inyectables (llm, execute) para tests.
// ============================================================

const { buildSystemPrompt, isEnabled: waEnabled } = require('../whatsapp/wa-agent');
const { Logger } = require('../utils/logger');
const log = new Logger('WEBCHAT');

const MAX_HISTORY   = 12;               // turnos previos que se recuerdan
const SESSION_TTL   = 30 * 60 * 1000;   // 30 min sin actividad → se olvida
const MAX_SESSIONS  = 5000;             // techo de memoria (evicta las más viejas)
const _sessions = new Map();            // `${org}:${sid}` → { messages:[{role,content}], last }

function isEnabled() { return process.env.WEB_CHAT_OFF !== '1' && waEnabled(); }

// Poda perezosa: caducadas + techo de sesiones.
function _gc(now) {
  for (const [k, s] of _sessions) if (now - s.last > SESSION_TTL) _sessions.delete(k);
  if (_sessions.size > MAX_SESSIONS) {
    const oldest = [..._sessions.entries()].sort((a, b) => a[1].last - b[1].last).slice(0, _sessions.size - MAX_SESSIONS);
    for (const [k] of oldest) _sessions.delete(k);
  }
}

function _thread(orgId, sessionId, now) {
  const key = `${orgId}:${sessionId}`;
  let s = _sessions.get(key);
  if (!s) { s = { messages: [], last: now }; _sessions.set(key, s); }
  s.last = now;
  return s;
}

let _llmSingleton = null, _execSingleton = null;
function _router() {
  if (!_llmSingleton) {
    const { LLMRouter } = require('../llm/router');
    _llmSingleton = new LLMRouter({
      openaiApiKey: process.env.OPENAI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _llmSingleton;
}
// Drena el stream del LLM a { text, toolCalls } (mismo contrato que wa-agent;
// el web no necesita streaming). streamCompletion emite chunks type text|tool_call|done.
async function _defaultLlm(messages, tools, callId) {
  const { stripTextualToolCalls } = require('../llm/textual-tool-filter');
  let text = '', toolCalls = [];
  try {
    for await (const chunk of _router().streamCompletion({ callId, messages, tools, temperature: 0.5, maxTokens: 350 })) {
      if (chunk.type === 'text' && chunk.content) text += chunk.content;
      if (chunk.type === 'tool_call') toolCalls.push(chunk.toolCall);
      if (chunk.type === 'done' && chunk.toolCalls && chunk.toolCalls.length) toolCalls = chunk.toolCalls;
      if (chunk.type === 'error') break;
    }
  } catch (_) {}
  return { text: stripTextualToolCalls(text || '').trim(), toolCalls: toolCalls || [] };
}
function _executor() {
  if (!_execSingleton) { const { ToolExecutor } = require('../tools/executor'); _execSingleton = new ToolExecutor(); }
  return _execSingleton;
}

/**
 * Genera la respuesta del asistente para un turno de chat WEB.
 * @param {{businessId, sessionId, text, config?}} p
 * @param {{llm?, execute?}} deps  inyectables para test
 * @returns {Promise<{ok, reply?, booked?, reason?}>}
 */
async function generateChatReply({ businessId, sessionId, text, config, history }, deps = {}) {
  if (!isEnabled()) return { ok: false, reason: 'disabled' };
  if (!businessId || !sessionId || !text || !text.trim()) return { ok: false, reason: 'bad_request' };
  const now = Date.now();
  _gc(now);

  const llm     = deps.llm     || _defaultLlm;
  const execute = deps.execute || ((name, args, ctx) => _executor().execute(name, args, businessId, ctx));
  const cfg     = config || deps.config || {};

  const todayMadrid = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const systemPrompt = buildSystemPrompt({ bizName: cfg.name, language: cfg.language, serviceList: cfg.serviceList, clientName: null, todayMadrid, address: cfg.address });

  const userText = String(text).trim().slice(0, 1000);
  // STATELESS (multi-réplica safe): si el widget manda el historial, se usa ese
  // — sin estado en el server, funciona con cualquier nº de réplicas. Se sanea
  // (solo user/assistant, texto acotado, últimos N; nunca system/tool del cliente).
  // Sin history → hilo in-memory (compat con widgets viejos / single-réplica).
  let thread = null, prior;
  if (Array.isArray(history)) {
    prior = history
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && (m.content || m.text))
      .slice(-MAX_HISTORY * 2)
      .map(m => ({ role: m.role, content: String(m.content || m.text).slice(0, 1000) }));
    prior.push({ role: 'user', content: userText });
  } else {
    thread = _thread(businessId, sessionId, now);
    thread.messages.push({ role: 'user', content: userText });
    if (thread.messages.length > MAX_HISTORY * 2) thread.messages = thread.messages.slice(-MAX_HISTORY * 2);
    prior = thread.messages;
  }

  const messages = [{ role: 'system', content: systemPrompt }, ...prior];
  const { ToolExecutor } = require('../tools/executor');
  const tools = ToolExecutor.toOpenAITools(['check_availability', 'book_appointment', 'lookup_appointments', 'cancel_appointment', 'register_lead']);
  const callId = `web-${businessId}|${sessionId}`;
  const session = { callerNumber: null, businessId, orgId: businessId, availabilityChecked: false, serviceList: cfg.serviceList, bookedAppointments: [] };

  try {
    let turn = await llm(messages, tools, callId);
    let booked = null;
    for (let round = 0; round < 3 && turn.toolCalls && turn.toolCalls.length; round++) {
      messages.push({ role: 'assistant', content: turn.text || null, tool_calls: turn.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) });
      for (const tc of turn.toolCalls) {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch (_) {}
        const result = await execute(tc.function.name, args, { callId, session });
        if (tc.function.name === 'book_appointment' && result && result.success) booked = result.appointment || true;
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      turn = await llm(messages, tools, callId);
    }
    const reply = (turn.text || '').trim();
    if (!reply) return { ok: false, reason: 'no_reply' };
    if (thread) thread.messages.push({ role: 'assistant', content: reply }); // solo modo in-memory
    log.info(`webchat ${sessionId} (org ${businessId}) — ${booked ? 'RESERVÓ' : 'respondió'}`);
    return { ok: true, reply, booked: !!booked };
  } catch (e) {
    log.warn(`generateChatReply ${businessId}/${sessionId}: ${e.message}`);
    return { ok: false, reason: 'error' };
  }
}

// Solo para tests: limpiar sesiones.
function _reset() { _sessions.clear(); }

module.exports = { generateChatReply, isEnabled, _reset };
