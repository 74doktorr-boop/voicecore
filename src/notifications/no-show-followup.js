'use strict';
// ============================================================
// NodeFlow — Seguimiento de PLANTÓN (no-show): reproponer cita por WhatsApp
//
// Cuando el negocio marca EXPLÍCITAMENTE una cita como "no vino", enviamos al
// cliente un WhatsApp en nombre del negocio ofreciéndole reprogramar. Recupera
// clientes que se habrían perdido sin que el negocio tenga que acordarse.
//
// Usa la plantilla YA APROBADA `nodeflow_aviso` ({{1}}=nombre {{2}}=negocio
// {{3}}=texto libre) → NO necesita una plantilla nueva de Meta. Respeta el
// opt-out (no_whatsapp) y es fail-open (nunca rompe el marcado de la cita).
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('NO-SHOW');

// Fecha humana en español (sin depender de otros módulos).
function _humanDate(dateStr) {
  try {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const days   = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${days[dt.getDay()]} ${d} de ${months[m - 1]}`;
  } catch (_) { return 'el día de tu cita'; }
}

/**
 * Texto libre ({{3}} de nodeflow_aviso) del mensaje de reproposición. Puro.
 */
function buildNoShowMessage(apt, opts = {}) {
  const svc    = apt && apt.service ? ` para tu ${apt.service}` : '';
  const cuando = opts.humanDate
    ? `el ${opts.humanDate}${apt && apt.time ? ` a las ${apt.time}h` : ''}`
    : 'el día de tu cita';
  return `Te esperábamos ${cuando}${svc} y al final no pudiste venir. ` +
    `¿Te reservo un nuevo hueco? Dime qué día te viene bien y te lo guardo.`;
}

// Resuelve { id, no_whatsapp } del contacto por teléfono (para opt-out + ledger).
async function _lookupContact(businessId, phone) {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();
    if (!db.enabled) return null;
    const { phoneVariants } = require('../utils/phone');
    const { data: c } = await db.client.from('contacts')
      .select('id').eq('org_id', businessId).in('phone', phoneVariants(phone)).limit(1).maybeSingle();
    if (!c || !c.id) return null;
    const { getContactMemory } = require('../lifecycle/call-memory');
    const mem = await getContactMemory(c.id, businessId);
    return { id: c.id, no_whatsapp: !!(mem && mem.no_whatsapp) };
  } catch (_) { return null; } // fail-open: no bloquear por un fallo de lookup
}

/**
 * Envía el WhatsApp de reproposición tras un plantón. Deps inyectables para tests.
 * @returns {Promise<{ok:boolean, reason?:string, messageId?:string}>}
 */
async function sendNoShowRebooking(apt, config = {}, deps = {}) {
  if (!apt || !apt.phone || !apt.businessId) return { ok: false, reason: 'no_phone' };
  const send         = deps.sendTemplate      || require('./client-whatsapp').sendTemplate;
  const isConfigured = deps.isConfigured       || require('./client-whatsapp').isConfigured;
  const getCreds     = deps.getWaCredentials   || require('../whatsapp/accounts').getWaCredentials;
  const lookup       = deps.lookupContact      || _lookupContact;

  const contact = await lookup(apt.businessId, apt.phone);
  if (contact && contact.no_whatsapp) { log.info(`no-show: ${apt.phone} opted out — no se envía`); return { ok: false, reason: 'opted_out' }; }

  const credentials = await getCreds(apt.businessId).catch(() => null);
  if (!credentials && !isConfigured()) return { ok: false, reason: 'no_wa' };

  const bizName  = config.name || 'el negocio';
  const name     = String(apt.patientName || 'cliente').split(' ')[0] || 'cliente';
  const langCode = config.language === 'eu' ? 'eu' : config.language === 'gl' ? 'gl' : 'es';
  const msg      = buildNoShowMessage(apt, { humanDate: _humanDate(apt.date) });

  let res;
  try {
    res = await send(apt.phone, 'nodeflow_aviso', langCode, [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: bizName },
        { type: 'text', text: msg },
      ] },
    ], credentials);
  } catch (e) { log.warn(`no-show WA failed (${apt.phone}): ${e.message}`); return { ok: false, reason: 'send_error' }; }

  // Ledger (billing + timeline): cuenta como mensaje del paquete. Best-effort.
  if (res && res.ok && contact && contact.id && deps.recordLedger !== false) {
    try {
      const { getDatabase } = require('../db/database');
      const db = getDatabase();
      if (db.enabled) db.client.from('scheduled_reminders').insert({
        org_id: apt.businessId, contact_id: contact.id, service_key: 'no_show_rebook',
        channel: 'whatsapp', scheduled_for: new Date().toISOString(), status: 'sent',
        sent_at: new Date().toISOString(), message_preview: msg.slice(0, 120),
      }).then(() => {}, () => {});
    } catch (_) {}
  }
  if (res && res.ok) {
    log.info(`no-show: reproposición enviada a ${apt.phone}`);
    // Transcript: registra el mensaje saliente.
    try { require('../whatsapp/wa-log').logWaMessage({ orgId: apt.businessId, phone: apt.phone, contactId: contact && contact.id, direction: 'out', body: msg, kind: 'no_show' }); } catch (_) {}
  }
  return res || { ok: false, reason: 'no_result' };
}

module.exports = { buildNoShowMessage, sendNoShowRebooking, _humanDate };
