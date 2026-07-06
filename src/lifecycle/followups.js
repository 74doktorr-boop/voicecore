// ============================================================
// NodeFlow — Seguimientos personalizados (2026-07-06)
// ------------------------------------------------------------
// Decisión Unai: NADA de recalls masivos automáticos (a destiempo,
// gente que ya no va → quejas). En su lugar, seguimiento PERSONAL,
// cliente a cliente, HUMANO en el bucle, por el WhatsApp del propio
// negocio.
//
// El sistema SUGIERE candidatos (quien llamó y no reservó) y redacta
// un mensaje personalizado con su contexto; el dueño lo revisa, edita
// y envía. Dos vías operativas (en el portal): enlace wa.me (envía él
// desde su WhatsApp, sin límite de plantilla) y API de su número.
//
// getCandidates() + draftMessage() (pura). markDone() marca hecho para
// que no reaparezca. Fail-open sin BD.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('FOLLOWUPS');

function _firstName(name) {
  const n = String(name || '').trim().split(/\s+/)[0];
  return n && n.length > 1 ? n : '';
}

/**
 * Redacta un mensaje de seguimiento PERSONALIZADO (editable por el dueño).
 * PURA. reason viene del outcome de la llamada. bizName = nombre del negocio.
 */
function draftMessage({ name, reason, bizName } = {}) {
  const hola = _firstName(name) ? `Hola ${_firstName(name)}` : 'Hola';
  const soy = bizName ? ` Soy ${bizName}.` : '';
  switch (reason) {
    case 'callback_requested':
      return `${hola}, ¿qué tal?${soy} Nos dejaste tus datos para que te llamáramos. ¿Te viene bien que agendemos? Dime qué día te encaja y lo miramos. 🙂`;
    case 'abandoned':
      return `${hola}, ¿qué tal?${soy} Se nos cortó la llamada del otro día. Si quieres seguimos por aquí, dime en qué te puedo ayudar. 🙂`;
    case 'info':
    default:
      return `${hola}, ¿qué tal?${soy} Vi que nos consultaste hace poco. Si te encaja, te busco un hueco cuando quieras — ¿te ayudo? 🙂`;
  }
}

/**
 * Candidatos a seguimiento: llamadas recientes que NO acabaron en cita y que
 * aún no se han seguido. Resuelve el nombre del contacto y redacta el mensaje.
 * @returns {Promise<Array>} [{ callId, phone, name, reason, when, score, draft }]
 */
async function getCandidates(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return [];
  const limit = opts.limit || 40;
  const bizName = opts.bizName || null;
  const since = new Date(Date.now() - 21 * 864e5).toISOString();

  let calls = [];
  try {
    // OJO SQL: .neq('outcome','booked') excluiría también los NULL (llamadas aún
    // sin clasificar) — el .or los mantiene como candidatos.
    const { data } = await db.client.from('nf_calls')
      .select('id, caller_number, outcome, started_at, metrics')
      .eq('org_id', orgId)
      .gte('started_at', since)
      .or('outcome.is.null,outcome.neq.booked')
      .order('started_at', { ascending: false })
      .limit(limit);
    // La bandera de "ya seguido" es NUESTRA (metrics.followup.done). followup_sent
    // pertenece al email automático post-llamada (post-call-handler/cron) y no
    // debe ocultar candidatos: un email automático no es el WhatsApp del dueño.
    calls = (data || []).filter(c =>
      c.caller_number && c.caller_number !== 'unknown' &&
      !(c.metrics && c.metrics.followup && c.metrics.followup.done));
  } catch (e) { log.warn(`getCandidates(${orgId}): ${e.message}`); return []; }
  if (!calls.length) return [];

  // Nombres de contacto (best-effort, por variantes del teléfono).
  const { phoneVariants, normalizePhone } = require('../utils/phone');
  const nameByPhone = {};
  try {
    const variants = [...new Set(calls.flatMap(c => phoneVariants(c.caller_number)))];
    if (variants.length) {
      const { data: contacts } = await db.client.from('contacts')
        .select('name, phone').eq('org_id', orgId).in('phone', variants);
      for (const ct of (contacts || [])) { const k = normalizePhone(ct.phone); if (k) nameByPhone[k] = ct.name; }
    }
  } catch (_) { /* sin nombres, se usa saludo genérico */ }

  return calls.map(c => {
    const name = nameByPhone[normalizePhone(c.caller_number)] || null;
    const reason = c.outcome || 'info';
    return {
      callId: c.id,
      phone: c.caller_number,
      name,
      reason,
      when: c.started_at,
      score: (c.metrics && c.metrics.audit && typeof c.metrics.audit.score === 'number') ? c.metrics.audit.score : null,
      draft: draftMessage({ name, reason, bizName }),
    };
  });
}

/**
 * Marca una llamada como ya seguida (enviado o descartado) → no reaparece.
 * Escribe en metrics.followup (bandera propia); NO toca followup_sent, que es
 * del email automático post-llamada. Merge lectura+escritura: el riesgo de
 * pisar metrics es mínimo (el audit escribe justo tras la llamada; esto, días
 * después).
 */
async function markDone(callId, orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !callId) return { ok: false };
  try {
    const { data: row } = await db.client.from('nf_calls')
      .select('metrics').eq('id', callId).eq('org_id', orgId).maybeSingle();
    if (!row) return { ok: false, error: 'not_found' };
    const metrics = Object.assign({}, row.metrics || {}, {
      followup: { done: true, at: new Date().toISOString(), channel: opts.channel || null },
    });
    const { error } = await db.client.from('nf_calls')
      .update({ metrics })
      .eq('id', callId).eq('org_id', orgId);
    return { ok: !error, error: error && error.message };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { draftMessage, getCandidates, markDone };
