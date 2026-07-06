// ============================================================
// NodeFlow — Atribución del motor de seguimientos (2026-07-06)
// ------------------------------------------------------------
// LA métrica que renueva suscripciones: "el motor te trajo N citas
// (~X€) este mes". Hasta ahora el motor enviaba avisos pero nada
// demostraba que funcionan.
//
// Regla de atribución (determinista, conservadora):
//   una cita se atribuye a un seguimiento si su teléfono coincide y se
//   CREÓ después del envío y dentro de la ventana (14 días). Cada cita
//   se atribuye UNA vez, al envío más reciente que la precede.
//
// Dos fuentes de envío:
//   · auto     → scheduled_reminders con status='sent' (motor por sector)
//   · personal → nf_calls.metrics.followup (Personalizados: wa.me / API)
//
// matchAttribution() es PURA. getAttribution() carga eventos + citas y
// delega. El valor usa el precio real de la cita o el ticket medio.
// ============================================================
'use strict';

const { normalizePhone } = require('../utils/phone');
const { Logger } = require('../utils/logger');
const log = new Logger('FOLLOWUP-ROI');

const WINDOW_DAYS = 14;

/**
 * Casa envíos con citas. PURA.
 * @param {Array<{phone, at, source}>} events   envíos de seguimiento
 * @param {Array<{phone, created_at, date, service, price, status}>} appointments
 * @returns {Array} citas atribuidas [{...apt, source, sentAt, lagDays}]
 */
function matchAttribution(events, appointments, opts = {}) {
  const windowMs = (opts.windowDays || WINDOW_DAYS) * 864e5;
  // Envíos por teléfono normalizado, ordenados por fecha.
  const byPhone = new Map();
  for (const e of events || []) {
    const key = normalizePhone(e.phone);
    if (!key || !e.at) continue;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(e);
  }
  for (const list of byPhone.values()) list.sort((a, b) => new Date(a.at) - new Date(b.at));

  const out = [];
  for (const apt of appointments || []) {
    if (!apt || apt.status === 'cancelled') continue;
    const key = normalizePhone(apt.phone);
    if (!key || !byPhone.has(key)) continue;
    const created = new Date(apt.created_at || apt.date);
    if (isNaN(created.getTime())) continue;
    // Envío más reciente ANTERIOR a la creación de la cita, dentro de ventana.
    let match = null;
    for (const e of byPhone.get(key)) {
      const sent = new Date(e.at);
      if (sent < created && created - sent <= windowMs) match = e;
      if (sent >= created) break;
    }
    if (match) {
      out.push({
        phone: apt.phone, service: apt.service || null, date: apt.date || null,
        price: parseFloat(apt.price) || 0,
        source: match.source, sentAt: match.at,
        lagDays: Math.round((created - new Date(match.at)) / 864e5),
      });
    }
  }
  return out;
}

/** Totales para pintar: citas, valor (precio real o ticket medio), por fuente. */
function summarize(attributed, { avgTicket = 0 } = {}) {
  const t = { count: attributed.length, value: 0, auto: 0, personal: 0 };
  for (const a of attributed) {
    t.value += a.price > 0 ? a.price : (parseFloat(avgTicket) || 0);
    if (a.source === 'personal') t.personal++; else t.auto++;
  }
  t.value = Math.round(t.value);
  return t;
}

/**
 * Carga envíos (auto + personales) y citas del rango y atribuye.
 * @param {string} orgId
 * @param {{ sinceDays?, until?, db?, avgTicket? }} opts
 * @returns {Promise<{ totals, bookings, sentCount }>}
 */
async function getAttribution(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const empty = { totals: { count: 0, value: 0, auto: 0, personal: 0 }, bookings: [], sentCount: 0 };
  if (!db.enabled || !orgId) return empty;

  const sinceDays = opts.sinceDays || 30;
  // Los envíos se miran desde antes del rango: un aviso de hace 10 días puede
  // haber traído una cita de esta semana.
  const eventsSince = new Date(Date.now() - (sinceDays + WINDOW_DAYS) * 864e5).toISOString();
  const aptsSince = new Date(Date.now() - sinceDays * 864e5).toISOString();

  try {
    const [remRes, callsRes, aptsRes] = await Promise.all([
      db.client.from('scheduled_reminders')
        .select('sent_at, contacts(phone)')
        .eq('org_id', orgId).eq('status', 'sent').gte('sent_at', eventsSince).limit(2000),
      db.client.from('nf_calls')
        .select('caller_number, metrics')
        .eq('org_id', orgId).gte('started_at', eventsSince).limit(2000),
      db.client.from('nf_appointments')
        .select('phone, created_at, date, service, price, status')
        .eq('organization_id', orgId).gte('created_at', aptsSince).limit(2000),
    ]);

    const events = [];
    for (const r of (remRes.data || [])) {
      const phone = r.contacts && r.contacts.phone;
      if (phone && r.sent_at) events.push({ phone, at: r.sent_at, source: 'auto' });
    }
    for (const c of (callsRes.data || [])) {
      const fu = c.metrics && c.metrics.followup;
      // Solo enviados de verdad (wa_link/api); los descartados no cuentan.
      if (fu && fu.done && fu.channel !== 'dismissed' && fu.at && c.caller_number) {
        events.push({ phone: c.caller_number, at: fu.at, source: 'personal' });
      }
    }

    const attributed = matchAttribution(events, aptsRes.data || [], opts);
    return {
      totals: summarize(attributed, { avgTicket: opts.avgTicket }),
      bookings: attributed.slice(0, 50),
      sentCount: events.length,
    };
  } catch (e) {
    log.warn(`getAttribution(${orgId}): ${e.message}`);
    return empty;
  }
}

module.exports = { matchAttribution, summarize, getAttribution, WINDOW_DAYS };
