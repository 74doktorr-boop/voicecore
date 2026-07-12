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

// El hilo se reconstruye desde nf_wa_messages (persistente); ya no hay estado en
// memoria. MAX_HISTORY = cuántos mensajes previos se cargan para dar contexto.
const MAX_HISTORY = 20;

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

function _resetConvos() { /* el hilo vive en nf_wa_messages; no-op (compat tests) */ }

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
    '- Si quiere CANCELAR o REPROGRAMAR una cita: usa lookup_appointments para ver sus citas, confirma cuál con él, y usa cancel_appointment (para reprogramar: cancela la vieja y reserva la nueva con book_appointment). Confirma el cambio.',
    '- Si pregunta por precios, servicios o dirección, respóndele con lo que sabes.',
    '- Si es una QUEJA, una duda que no sabes resolver, o pide que le llamen: usa register_lead para que el equipo le contacte, y díselo con amabilidad. Así el dueño se entera.',
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

  const llm         = deps.llm         || _defaultLlm;
  const execute     = deps.execute     || ((name, args, ctx) => _executor().execute(name, args, businessId, ctx));
  const sendText    = deps.sendText    || require('../notifications/client-whatsapp').sendText;
  const getCreds    = deps.getWaCredentials || require('./accounts').getWaCredentials;
  const notifyOwner = deps.notifyOwner || ((msg) => { try { require('../tools/executor')._notifyOwner(msg, businessId); } catch (_) {} });
  const getThread   = deps.getWaThread || require('./wa-log').getWaThread;

  const cfg = deps.config || await _loadConfig(businessId);
  const clientName = deps.clientName !== undefined ? deps.clientName : await _clientName(businessId, phone);
  const todayMadrid = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const systemPrompt = buildSystemPrompt({ bizName: cfg.name, language: cfg.language, serviceList: cfg.serviceList, clientName, todayMadrid });

  // El HILO se reconstruye desde nf_wa_messages (persistente → sobrevive a
  // reinicios/deploys, ya no vive solo en memoria). Los mensajes tool/tool_calls
  // son transitorios dentro de UN turno; entre mensajes basta el texto.
  const prior = await getThread(businessId, phone, MAX_HISTORY).catch(() => []);
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const m of (prior || [])) {
    if (!m.body) continue;
    messages.push({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body });
  }
  // El mensaje actual al final (dedupe: el webhook puede haberlo logueado ya).
  const last = messages[messages.length - 1];
  if (!(last && last.role === 'user' && last.content === text.trim())) messages.push({ role: 'user', content: text.trim() });

  const session = { callerNumber: phone, businessId, orgId: businessId, availabilityChecked: false, serviceList: cfg.serviceList, bookedAppointments: [] };
  const { ToolExecutor } = require('../tools/executor');
  const tools = ToolExecutor.toOpenAITools(['check_availability', 'book_appointment', 'lookup_appointments', 'cancel_appointment', 'register_lead']);
  const callId = `wa-${businessId}|${phone}`;

  let turn = await llm(messages, tools, callId);
  let booked = null;

  for (let round = 0; round < 3 && turn.toolCalls && turn.toolCalls.length; round++) {
    messages.push({
      role: 'assistant', content: turn.text || null,
      tool_calls: turn.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })),
    });
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
  if (!reply && !booked) return { handled: false }; // sin respuesta útil → humano

  // Enviar la respuesta por WhatsApp (texto libre dentro de la ventana de 24h).
  if (reply) {
    const credentials = await getCreds(businessId).catch(() => null);
    await sendText(phone, reply, credentials).catch(e => log.warn(`wa send (${phone}): ${e.message}`));
    // Transcript: registra la respuesta del asistente (y así el hilo persiste).
    try { require('./wa-log').logWaMessage({ orgId: businessId, phone, direction: 'out', body: reply, kind: 'ai' }); } catch (_) {}
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
