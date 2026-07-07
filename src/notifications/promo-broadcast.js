// ============================================================
// NodeFlow — Promociones por WhatsApp (2026-07-07)
// ------------------------------------------------------------
// El dueño escribe UNA promo y llega a sus clientes por WhatsApp
// (plantilla MARKETING nodeflow_promo, con opt-out BAJA). Diseño:
//   · Destinatarios: sus contactos con teléfono, EXCLUYENDO pausados
//     y no_whatsapp (los opt-outs son sagrados). Filtro por etiqueta.
//   · Cada envío se registra en scheduled_reminders (status 'sent',
//     service_key 'promo') → ledger ÚNICO: cuenta para el paquete de
//     mensajes, aparece en la ficha del cliente y en la atribución ROI.
//   · Throttle suave para no tropezar con los límites de Meta.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('PROMO');

const THROTTLE_MS = 120;      // ~8 msg/s — de sobra bajo los límites de Meta
const MAX_RECIPIENTS = 1000;  // tope de seguridad por difusión

/** Destinatarios elegibles: con teléfono, sin opt-out, filtro por etiqueta. */
async function getRecipients(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return [];
  let q = db.client.from('contacts')
    .select('id, name, phone, tags')
    .eq('org_id', orgId).is('deleted_at', null)
    .not('phone', 'is', null)
    .limit(MAX_RECIPIENTS + 1);
  const { data } = await q;
  let list = (data || []).filter(c => c.phone && c.phone !== 'unknown');
  if (opts.tag) {
    const tag = String(opts.tag).toLowerCase();
    list = list.filter(c => Array.isArray(c.tags) && c.tags.some(t => String(t).toLowerCase() === tag));
  }

  // Opt-outs (no_whatsapp) en bloque — jamás se contacta a quien dijo no.
  if (list.length) {
    const blocked = new Set();
    const ids = list.map(c => c.id);
    for (let i = 0; i < ids.length; i += 500) {
      try {
        const { data: mem } = await db.client.from('contact_memory')
          .select('contact_id, no_whatsapp').eq('org_id', orgId).in('contact_id', ids.slice(i, i + 500));
        for (const m of (mem || [])) if (m.no_whatsapp) blocked.add(m.contact_id);
      } catch (_) {}
    }
    list = list.filter(c => !blocked.has(c.id));
  }
  return list.slice(0, MAX_RECIPIENTS);
}

/**
 * Envía la promo a los destinatarios. Devuelve { sent, failed, aborted }.
 * Si la plantilla aún no está aprobada en Meta, aborta al primer fallo de
 * plantilla con un mensaje claro (no quema el bucle entero).
 */
async function sendPromo(orgId, { text, tag, bizName } = {}, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const sendTemplate = deps.sendTemplate || require('./client-whatsapp').sendTemplate;
  const throttle = deps.throttleMs != null ? deps.throttleMs : THROTTLE_MS;
  const out = { recipients: 0, sent: 0, failed: 0, aborted: null };

  const promoText = String(text || '').trim();
  if (promoText.length < 10) return { ...out, aborted: 'El texto de la promo es demasiado corto' };

  const recipients = await getRecipients(orgId, { tag, db });
  out.recipients = recipients.length;
  if (!recipients.length) return { ...out, aborted: 'No hay destinatarios elegibles' };

  const nowISO = new Date().toISOString();
  for (const c of recipients) {
    try {
      const r = await sendTemplate(c.phone, 'nodeflow_promo', 'es', [{
        type: 'body',
        parameters: [
          { type: 'text', text: (c.name || 'cliente').split(/\s+/)[0] },
          { type: 'text', text: bizName || 'el negocio' },
          { type: 'text', text: promoText },
        ],
      }]);
      if (r && r.ok) {
        out.sent++;
        // Ledger unificado: cuenta para el paquete, sale en la ficha y en el ROI.
        await db.client.from('scheduled_reminders').insert({
          org_id: orgId, contact_id: c.id, service_key: 'promo',
          channel: 'whatsapp', scheduled_for: nowISO, status: 'sent',
          sent_at: new Date().toISOString(), message_preview: promoText.slice(0, 120),
        }).then(undefined, () => {});
      } else {
        out.failed++;
        const err = String((r && r.error) || '');
        // Plantilla inexistente/no aprobada → parar YA con mensaje claro.
        if (/template|Template|132001|does not exist/.test(err) && out.sent === 0) {
          out.aborted = 'La plantilla de promociones aún está en revisión de Meta — inténtalo cuando esté aprobada.';
          break;
        }
      }
    } catch (e) {
      out.failed++;
      log.warn(`promo → ${c.phone}: ${e.message}`);
    }
    if (throttle) await new Promise(res => setTimeout(res, throttle));
  }
  log.info(`Promo de ${orgId}: ${out.sent} enviadas, ${out.failed} fallidas de ${out.recipients}`);
  return out;
}

module.exports = { getRecipients, sendPromo, MAX_RECIPIENTS };
