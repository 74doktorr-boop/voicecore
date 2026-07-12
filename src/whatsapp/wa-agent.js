'use strict';
// ============================================================
// NodeFlow — Agente de WhatsApp: RESERVA por texto
//
// Cuando un cliente escribe por WhatsApp ("dame cita pasado mañana a las 12"),
// el asistente entiende la petición, consulta disponibilidad REAL, reserva la
// cita (misma maquinaria que la voz: check_availability + book_appointment +
// sync a Google Calendar) y confirma — todo por WhatsApp, sin humano en medio.
//
// Reutiliza el ToolExecutor con una "sesión" de texto mínima. Mantiene el hilo
// de la conversación en memoria (por org+teléfono, con TTL). Si el asistente no
// produce respuesta útil, el llamante cae a notifyOwnerFreeText (humano).
//
// Kill-switch: WA_AI_BOOKING_OFF=1 lo apaga (vuelve al comportamiento anterior).
// Deps inyectables (llm, execute, sendText, notifyOwner, loadConfig) para tests.
// ============================================================

const { Logger } = require('../utils/logger');
const { stripTextualToolCalls } = require('../llm/textual-tool-filter');

const log = new Logger('WA-AGENT');

// Conversaciones vivas: `${businessId}|${phone}` → { messages, session, updatedAt }
const _convos = new Map();
const CONVO_TTL_MS = 2 * 60 * 60 * 1000; // 2h — una reserva por WhatsApp es corta
const MAX_HISTORY  = 14;                  // pares user/assistant que retenemos

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
function _executor() {
  if (!_execSingleton) { const { ToolExecutor } = require('../tools/executor'); _execSingleton = new ToolExecutor(); }
  return _execSingleton;
}

function _gc(now) { for (const [k, v] of _convos) if (now - v.updatedAt > CONVO_TTL_MS) _convos.delete(k); }
function _resetConvos() { _convos.clear(); }   // para tests

function isEnabled() { return process.env.WA_AI_BOOKING_OFF !== '1'; }

// ── Prompt del sistema (recepcionista por WhatsApp) ──────────────────────────
function buildSystemPrompt({ bizName, language, serviceList, clientName, todayMadrid }) {
  const langName = language === 'eu' ? 'euskera' : language === 'gl' ? 'galego' : 'español';
  const svc = (serviceList && serviceList.length)
    ? 'Servicios y precios:\n' + serviceList.map(s =>
        `- ${s.name || s.service || 'servicio'}${s.price ? ` (${s.price})` : ''}${s.duration ? `, ${s.duration} min` : ''}`).join('\n')
    : '';
  return [
    `Eres la recepcionista de ${bizName} y atiendes a los clientes por WhatsApp. Hoy es ${todayMadrid} (Europe/Madrid).`,
    clientName ? `El cliente que te escribe se llama ${clientName} — resérvale a su nombre y no se lo preguntes.` : '',
    svc,
    'Tu trabajo por WhatsApp:',
    '- Si quiere RESERVAR/CAMBIAR una cita o pregunta por un hueco: llama a check_availability para ver los huecos REALES, dile las opciones y, cuando te dé un día y una hora concretos y esté de acuerdo, reserva con book_appointment (confirmed_with_customer=true). Confirma SIEMPRE en tu respuesta el día y la hora exactos.',
    '- Nunca inventes horarios: usa check_availability antes de reservar. Si no hay hueco a esa hora, ofrece alternativas cercanas.',
    '- Si pregunta por precios, servicios o dirección, respóndele con lo que sabes.',
    '- Si es una queja o algo que no puedes resolver, dile con amabilidad que el equipo le contactará.',
    `Sé BREVE, cálido y natural (es WhatsApp, no un email). Responde SIEMPRE en ${langName}.`,
  ].filter(Boolean).join('\n');
}

// Drena el stream del LLM a { text, toolCalls } (WhatsApp no necesita streaming).
async function _defaultLlm(messages, tools, callId) {
  let text = '', toolCalls = [];
  try {
    for await (const chunk of _router().streamCompletion({ callId, messages, tools, temperature: 0.5, maxTokens: 350 })) {
      if (chunk.type === 'text' && chunk.content) text += chunk.content;
      if (chunk.type === 'tool_call') toolCalls.push(chunk.toolCall);
      if (chunk.type === 'done' && chunk.toolCalls && chunk.toolCalls.length) toolCalls = chunk.toolCalls;
      if (chunk.type === 'error') break;
    }
  } catch (e) { log.warn(`llm: ${e.message}`); }
  return { text: stripTextualToolCalls(text || '').trim(), toolCalls: toolCalls || [] };
}

async function _loadConfig(businessId) {
  const out = { name: 'el negocio', language: 'es', serviceList: [] };
  try {
    const { scheduler } = require('../scheduling/scheduler');
    const c = scheduler.getBusinessConfig(businessId);
    if (c) { out.name = c.name || out.name; out.language = c.language || out.language; if (Array.isArray(c.serviceList)) out.serviceList = c.serviceList; }
  } catch (_) {}
  try {
    const { getOrgAssistant } = require('../assistants/org-assistant');
    const a = await getOrgAssistant(businessId);
    if (a) { if (a.language) out.language = a.language; if (!out.serviceList.length && Array.isArray(a.serviceList)) out.serviceList = a.serviceList; }
  } catch (_) {}
  return out;
}

async function _clientName(businessId, phone) {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase(); if (!db.enabled) return null;
    const { phoneVariants } = require('../utils/phone');
    const { data } = await db.client.from('contacts').select('name')
      .eq('org_id', businessId).in('phone', phoneVariants(phone)).limit(1).maybeSingle();
    return (data && data.name) || null;
  } catch (_) { return null; }
}

/**
 * Procesa un mensaje de texto de WhatsApp con el agente de reserva.
 * @returns {Promise<{handled:boolean, booked?:boolean, reply?:string}>}
 *   handled=false → el llamante debe caer a notifyOwnerFreeText (humano).
 */
async function handleWaBooking({ from, businessId, text }, deps = {}) {
  if (!isEnabled() || !businessId || !text || !text.trim()) return { handled: false };
  const phone = String(from).startsWith('+') ? String(from) : '+' + String(from);
  const now = Date.now(); _gc(now);

  const llm         = deps.llm         || _defaultLlm;
  const execute     = deps.execute     || ((name, args, ctx) => _executor().execute(name, args, businessId, ctx));
  const sendText    = deps.sendText    || require('../notifications/client-whatsapp').sendText;
  const getCreds    = deps.getWaCredentials || require('./accounts').getWaCredentials;
  const notifyOwner = deps.notifyOwner || ((msg) => { try { require('../tools/executor')._notifyOwner(msg, businessId); } catch (_) {} });

  const key = `${businessId}|${phone}`;
  let convo = _convos.get(key);
  if (!convo) {
    const cfg = deps.config || await _loadConfig(businessId);
    const clientName = deps.clientName !== undefined ? deps.clientName : await _clientName(businessId, phone);
    const todayMadrid = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    const session = { callerNumber: phone, businessId, orgId: businessId, availabilityChecked: false, serviceList: cfg.serviceList, bookedAppointments: [] };
    convo = {
      messages: [{ role: 'system', content: buildSystemPrompt({ bizName: cfg.name, language: cfg.language, serviceList: cfg.serviceList, clientName, todayMadrid }) }],
      session, updatedAt: now,
    };
    _convos.set(key, convo);
  }
  convo.updatedAt = now;
  convo.messages.push({ role: 'user', content: text.trim() });

  const { ToolExecutor } = require('../tools/executor');
  const tools = ToolExecutor.toOpenAITools(['check_availability', 'book_appointment']);
  const callId = `wa-${key}`;

  let turn = await llm(convo.messages, tools, callId);
  let booked = null;

  for (let round = 0; round < 2 && turn.toolCalls && turn.toolCalls.length; round++) {
    convo.messages.push({
      role: 'assistant', content: turn.text || null,
      tool_calls: turn.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })),
    });
    for (const tc of turn.toolCalls) {
      let args = {};
      try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch (_) {}
      const result = await execute(tc.function.name, args, { callId, session: convo.session });
      if (tc.function.name === 'book_appointment' && result && result.success) booked = result.appointment || true;
      convo.messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    turn = await llm(convo.messages, tools, callId);
  }

  const reply = (turn.text || '').trim();
  if (reply) convo.messages.push({ role: 'assistant', content: reply });
  // Recorte de historial (conserva el system).
  if (convo.messages.length > MAX_HISTORY + 1) convo.messages = [convo.messages[0], ...convo.messages.slice(-MAX_HISTORY)];

  if (!reply && !booked) { _convos.set(key, convo); return { handled: false }; } // sin respuesta útil → humano

  // Enviar la respuesta por WhatsApp (texto libre dentro de la ventana de 24h).
  if (reply) {
    const credentials = await getCreds(businessId).catch(() => null);
    await sendText(phone, reply, credentials).catch(e => log.warn(`wa send (${phone}): ${e.message}`));
  }

  // Reserva hecha → avisar al dueño (como en las llamadas).
  if (booked && typeof booked === 'object') {
    notifyOwner(
      `📅 *Reserva por WhatsApp — NodeFlow*\n━━━━━━━━━━━━\n` +
      `👤 ${booked.patientName || ''}\n🗓️ ${booked.service || ''}\n📆 ${booked.date || ''} · ${booked.time || ''}h\n` +
      `📞 ${booked.phone || phone}\n━━━━━━━━━━━━\nReservada por el asistente desde WhatsApp.`
    );
  }

  log.info(`WA-agent ${phone} (org ${businessId}) — ${booked ? 'RESERVÓ' : 'respondió'}`);
  return { handled: true, booked: !!booked, reply };
}

module.exports = { handleWaBooking, buildSystemPrompt, isEnabled, _resetConvos };
