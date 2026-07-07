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

const { normalizePhone } = require('../utils/phone');

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Destinatarios elegibles: con teléfono, sin opt-out. Segmentable (2026-07-07)
 * para pasar de megáfono a bisturí:
 *   opts.tag           — solo con esa etiqueta
 *   opts.service       — solo quien ha consumido ese servicio (historial de citas)
 *   opts.inactiveDays  — solo quien no viene desde hace ≥N días (dormidos)
 *   opts.birthdayMonth — solo quien cumple años ESTE mes (sector_data.fecha_cumpleanos)
 * Los filtros se combinan en AND. Sin ninguno → toda la cartera (como antes).
 */
async function getRecipients(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return [];
  const now = opts.now || new Date();
  let q = db.client.from('contacts')
    .select('id, name, phone, tags, sector_data')
    .eq('org_id', orgId).is('deleted_at', null)
    .not('phone', 'is', null)
    .limit(MAX_RECIPIENTS + 1);
  const { data } = await q;
  let list = (data || []).filter(c => c.phone && c.phone !== 'unknown');
  if (opts.tag) {
    const tag = String(opts.tag).toLowerCase();
    list = list.filter(c => Array.isArray(c.tags) && c.tags.some(t => String(t).toLowerCase() === tag));
  }

  // Cumpleaños este mes (mes civil de Madrid) — no depende de citas.
  if (opts.birthdayMonth) {
    const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', month: 'numeric' }).format(now));
    list = list.filter(c => {
      const raw = c.sector_data && c.sector_data.fecha_cumpleanos;
      if (!raw) return false;
      const d = new Date(String(raw).slice(0, 10) + 'T12:00:00');
      return !isNaN(d.getTime()) && (d.getMonth() + 1) === month;
    });
  }

  // Segmentos por HISTORIAL de citas (servicio consumido / inactividad).
  if ((opts.service || opts.inactiveDays) && list.length) {
    const svc = opts.service ? _norm(opts.service) : null;
    const cutoff = opts.inactiveDays ? new Date(now.getTime() - Number(opts.inactiveDays) * 86400000) : null;
    let apts = [];
    try {
      const { data: aptData } = await db.client.from('nf_appointments')
        .select('phone, service, date, status')
        .eq('organization_id', orgId).limit(20000);
      apts = aptData || [];
    } catch (_) { apts = []; }
    // Índice por teléfono normalizado.
    const byPhone = new Map();
    for (const a of apts) {
      if (a.status === 'cancelled' || !a.phone) continue;
      const k = normalizePhone(a.phone);
      if (!byPhone.has(k)) byPhone.set(k, []);
      byPhone.get(k).push(a);
    }
    list = list.filter(c => {
      const hist = byPhone.get(normalizePhone(c.phone)) || [];
      if (svc && !hist.some(a => _norm(a.service).includes(svc) || svc.includes(_norm(a.service)))) return false;
      if (cutoff) {
        // Inactivo: su cita más reciente es anterior al corte (o no tiene ninguna).
        const last = hist.reduce((m, a) => (a.date && a.date > m ? a.date : m), '');
        if (last && new Date(last + 'T12:00:00') >= cutoff) return false;
      }
      return true;
    });
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
async function sendPromo(orgId, { text, tag, bizName, service, inactiveDays, birthdayMonth } = {}, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const sendTemplate = deps.sendTemplate || require('./client-whatsapp').sendTemplate;
  const throttle = deps.throttleMs != null ? deps.throttleMs : THROTTLE_MS;
  const out = { recipients: 0, sent: 0, failed: 0, aborted: null };

  // Meta no admite saltos de línea/tabs en parámetros de plantilla
  // (auditoría 2026-07-07): colapsar whitespace o el envío muere en Meta.
  const promoText = String(text || '').replace(/\s+/g, ' ').trim();
  if (promoText.length < 10) return { ...out, aborted: 'El texto de la promo es demasiado corto' };

  const recipients = await getRecipients(orgId, { tag, service, inactiveDays, birthdayMonth, db });
  out.recipients = recipients.length;
  if (!recipients.length) return { ...out, aborted: 'No hay destinatarios elegibles' };

  const nowISO = new Date().toISOString();
  for (const c of recipients) {
    try {
      const r = await sendTemplate(c.phone, 'nodeflow_promo', 'es', [{
        type: 'body',
        parameters: [
          { type: 'text', text: String(c.name || 'cliente').replace(/\s+/g, ' ').trim().split(' ')[0] || 'cliente' },
          { type: 'text', text: String(bizName || 'el negocio').replace(/\s+/g, ' ').trim() },
          { type: 'text', text: promoText },
        ],
      }]);
      if (r && r.ok) {
        out.sent++;
        // Ledger unificado: cuenta para el paquete, sale en la ficha y en el ROI.
        // Si el insert falla, el contador y el ledger se descuadran: se loguea
        // y se cuenta (auditoría 2026-07-07) — nunca más en silencio.
        await db.client.from('scheduled_reminders').insert({
          org_id: orgId, contact_id: c.id, service_key: 'promo',
          channel: 'whatsapp', scheduled_for: nowISO, status: 'sent',
          sent_at: new Date().toISOString(), message_preview: promoText.slice(0, 120),
        }).then(({ error }) => {
          if (error) { out.ledgerMisses = (out.ledgerMisses || 0) + 1; log.error(`promo ledger (${c.id}): ${error.message}`); }
        }, (e) => { out.ledgerMisses = (out.ledgerMisses || 0) + 1; log.error(`promo ledger (${c.id}): ${e.message}`); });
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
