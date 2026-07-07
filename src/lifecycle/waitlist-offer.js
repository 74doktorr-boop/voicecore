// ============================================================
// NodeFlow — Hueco libre → oferta automática a la lista de espera
// (2026-07-07). Cuando una cita se cancela, el hueco es dinero que
// se va. En vez de solo avisar al dueño "tienes N en lista", se lo
// OFRECEMOS al primer candidato que encaje, por WhatsApp.
//
// Diseño seguro contra doble reserva: se ofrece a UNA persona (la más
// antigua en espera cuyo servicio case), se la marca 'contacted' y se
// avisa al dueño de a quién se ofreció. Si no lo quiere, el dueño ofrece
// al siguiente desde el portal. Nunca se auto-reserva a dos a la vez.
//
// Gateado por WA_WAITLIST_AUTOOFFER=1 (necesita la plantilla
// nodeflow_hueco_libre aprobada en Meta). Sin la env, no-op.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('WAITLIST-OFFER');

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * ¿Encaja el candidato de la lista con el servicio del hueco liberado?
 * Sin servicio en ninguno de los dos → encaja (no filtramos de más).
 */
function serviceMatches(waitService, slotService) {
  const w = _norm(waitService), s = _norm(slotService);
  if (!w || !s) return true;
  return w.includes(s) || s.includes(w) || w.split(/\s+/).some(t => t.length > 3 && s.includes(t));
}

/**
 * Ofrece un hueco liberado al primer candidato en espera que encaje.
 * @param {{businessId, date, time, service, humanDate, bizName}} slot
 * @param {object} deps  { db, sendTemplate, notifyOwner, credentials, now }
 * @returns {Promise<{offered:boolean, to?:string, reason?:string}>}
 */
async function offerFreedSlot(slot, deps = {}) {
  if (process.env.WA_WAITLIST_AUTOOFFER !== '1') return { offered: false, reason: 'disabled' };
  const { businessId, date, time, service } = slot || {};
  if (!businessId || !date || !time) return { offered: false, reason: 'missing_slot' };

  const db = deps.db || require('../db/database').getDatabase();
  if (!db.enabled) return { offered: false, reason: 'no_db' };
  const sendTemplate = deps.sendTemplate || require('../notifications/client-whatsapp').sendTemplate;

  // Candidatos en espera, más antiguos primero.
  let candidates = [];
  try {
    const { data } = await db.client.from('nf_waitlist')
      .select('id, name, phone, service, status')
      .eq('organization_id', businessId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(50);
    candidates = data || [];
  } catch (e) {
    log.warn(`offerFreedSlot lookup (${businessId}): ${e.message}`);
    return { offered: false, reason: 'lookup_failed' };
  }

  const match = candidates.find(c => c.phone && serviceMatches(c.service, service));
  if (!match) return { offered: false, reason: 'no_match' };

  // RECLAMO atómico: pasar a 'contacted' solo si sigue 'waiting'. Dos
  // cancelaciones simultáneas no ofrecen el mismo hueco a la misma persona.
  let claimed = false;
  try {
    const { data: upd } = await db.client.from('nf_waitlist')
      .update({ status: 'contacted' })
      .eq('id', match.id).eq('status', 'waiting')
      .select('id');
    claimed = Array.isArray(upd) && upd.length > 0;
  } catch (e) {
    log.warn(`offerFreedSlot claim (${match.id}): ${e.message}`);
  }
  if (!claimed) return { offered: false, reason: 'claim_lost' };

  const firstName = String(match.name || 'cliente').replace(/\s+/g, ' ').trim().split(' ')[0] || 'cliente';
  const bizName = String(slot.bizName || 'el negocio').replace(/\s+/g, ' ').trim();
  const when = slot.humanDate || date;
  const svc = String(service || 'tu cita').replace(/\s+/g, ' ').trim();

  const params = [firstName, bizName, when, String(time), svc].map(text => ({ type: 'text', text }));
  let sent = false;
  try {
    const r = await sendTemplate(match.phone, 'nodeflow_hueco_libre', 'es',
      [{ type: 'body', parameters: params }], deps.credentials || null);
    sent = !!(r && r.ok);
  } catch (e) {
    log.warn(`offerFreedSlot send (${match.phone}): ${e.message}`);
  }

  if (!sent) {
    // No se pudo enviar: devolver a 'waiting' para no perder al candidato.
    await db.client.from('nf_waitlist').update({ status: 'waiting' })
      .eq('id', match.id).eq('status', 'contacted').then(undefined, () => {});
    return { offered: false, reason: 'send_failed' };
  }

  // Registrar el envío en el ledger unificado (cuenta para el paquete + ficha).
  try {
    await db.client.from('scheduled_reminders').insert({
      org_id: businessId, contact_id: null, service_key: 'hueco_libre',
      channel: 'whatsapp', scheduled_for: (deps.now || new Date()).toISOString(),
      status: 'sent', sent_at: (deps.now || new Date()).toISOString(),
      message_preview: `Hueco ${when} ${time} → ${match.phone}`,
    }).then(undefined, () => {});
  } catch (_) {}

  if (deps.notifyOwner) {
    await deps.notifyOwner(
      `📤 *Hueco ofrecido automáticamente*\n${firstName} (${match.phone}) estaba en lista de espera y le hemos ofrecido el hueco de ${when} a las ${time}. Te avisamos cuando responda.`
    ).catch(() => {});
  }

  log.info(`Hueco ${date} ${time} ofrecido a ${match.phone} (org ${businessId})`);
  return { offered: true, to: match.phone, waitlistId: match.id };
}

module.exports = { offerFreedSlot, serviceMatches };
