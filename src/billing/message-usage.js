// ============================================================
// NodeFlow — Paquete de mensajes de automatización (2026-07-07)
// ------------------------------------------------------------
// Modelo aprobado por Unai: 200 mensajes/mes incluidos en el plan y
// excedente a 0,10€/mensaje — mismo modelo mental que los minutos de
// voz. "Mensaje de automatización" = TODO envío del ledger unificado
// (scheduled_reminders con status 'sent'): seguimientos del motor,
// promociones 📣, confirmaciones y recordatorios de cita.
//
// Transparencia primero: el portal enseña el contador SIEMPRE; nadie
// descubre un cargo en la factura. El cobro real va por Stripe Billing
// Meters (como los minutos) y está GATEADO por STRIPE_MSG_METER_EVENT:
// sin el meter creado en Stripe, se cuenta y se enseña pero no se cobra.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('MSG-USAGE');

const INCLUDED = Math.max(0, Number(process.env.MESSAGES_INCLUDED_PER_MONTH) || 200);
const OVERAGE_EUR = Number(process.env.MESSAGE_OVERAGE_EUR) || 0.10;

/**
 * Inicio del MES CIVIL de Madrid en UTC, exacto también en los cambios
 * de hora (el DST cambia el último domingo de mar/oct, no el día 1):
 * se prueba cada offset y vale el que Madrid formatea como 01 a las 00h.
 */
function monthStartISO(now = new Date()) {
  const ym = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(now).slice(0, 7);
  for (const off of ['+02:00', '+01:00']) {
    const d = new Date(`${ym}-01T00:00:00${off}`);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', day: '2-digit', hour: '2-digit', hour12: false })
        .formatToParts(d).map(p => [p.type, p.value]));
    if (parts.day === '01' && parts.hour === '00') return d.toISOString();
  }
  return new Date(`${ym}-01T00:00:00+01:00`).toISOString(); // inalcanzable en la práctica
}

/** Uso del mes en curso para una org. { used, included, overage, overageEur } */
async function usageSummary(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const out = { used: 0, included: INCLUDED, overage: 0, overageEur: 0, ratePerMessage: OVERAGE_EUR };
  if (!db.enabled || !orgId) return out;
  try {
    const { count } = await db.client.from('scheduled_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('status', 'sent')
      .gte('sent_at', opts.since || monthStartISO(opts.now));
    out.used = count || 0;
  } catch (e) { log.warn(`usageSummary(${orgId}): ${e.message}`); }
  out.overage = Math.max(0, out.used - out.included);
  out.overageEur = Math.round(out.overage * OVERAGE_EUR * 100) / 100;
  return out;
}

/**
 * Reporta a Stripe el DELTA de excedente no reportado aún este mes.
 * Marcador en org_reminder_config.config._msgOverage = { month, reported }
 * (clave reservada _* → sobrevive al guardado de reglas; cero migraciones).
 * Nunca lanza. Devuelve { reported } (mensajes nuevos reportados).
 */
async function reportOverageForOrg(org, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const billing = opts.billing || require('./stripe').getBilling();
  const eventName = process.env.STRIPE_MSG_METER_EVENT;
  if (!eventName || !db.enabled || !org?.stripe_customer_id) return { reported: 0 };
  try {
    const now = opts.now || new Date();
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(now).slice(0, 7);
    const usage = await usageSummary(org.id, { db, now });
    if (usage.overage <= 0) return { reported: 0 };

    const { data: cfgRow } = await db.client.from('org_reminder_config')
      .select('config').eq('org_id', org.id).maybeSingle();
    const cfg = (cfgRow && cfgRow.config) || {};
    const hadMarker = !!(cfg._msgOverage && cfg._msgOverage.month === month);
    const marker = hadMarker ? cfg._msgOverage : { month, reported: 0 };
    const delta = usage.overage - (marker.reported || 0);
    if (delta <= 0) return { reported: 0 };

    // RECLAMO ATÓMICO antes de tocar Stripe (auditoría 2026-07-07): el
    // update solo casa si el marcador sigue valiendo lo que leímos. Dos
    // instancias simultáneas → una reclama, la otra no casa filas y NO
    // reporta. Mejor no cobrar hoy (se reintenta mañana) que cobrar doble.
    const claimedCfg = { ...cfg, _msgOverage: { month, reported: (marker.reported || 0) + delta } };
    let claimed = false;
    if (cfgRow) {
      let q = db.client.from('org_reminder_config')
        .update({ config: claimedCfg, updated_at: new Date().toISOString() })
        .eq('org_id', org.id);
      q = hadMarker
        ? q.filter('config->_msgOverage->>reported', 'eq', String(marker.reported || 0))
        : q.or(`config->_msgOverage.is.null,config->_msgOverage->>month.neq.${month}`);
      const { data: rows, error } = await q.select('org_id');
      claimed = !error && Array.isArray(rows) && rows.length > 0;
    } else {
      // Sin fila: insert — el conflicto de PK significa que otra instancia llegó antes.
      const { error } = await db.client.from('org_reminder_config')
        .insert({ org_id: org.id, config: claimedCfg, updated_at: new Date().toISOString() });
      claimed = !error;
    }
    if (!claimed) {
      log.info(`Excedente de mensajes (${org.id}): reclamado por otra instancia — skip`);
      return { reported: 0 };
    }

    try {
      await billing.reportUsage({ stripeCustomerId: org.stripe_customer_id, minutes: delta, eventName });
    } catch (e) {
      // Stripe falló DESPUÉS de reclamar: devolver el marcador (condicionado
      // a nuestro propio valor) para que el delta se reintente mañana.
      await db.client.from('org_reminder_config')
        .update({ config: { ...claimedCfg, _msgOverage: marker }, updated_at: new Date().toISOString() })
        .eq('org_id', org.id)
        .filter('config->_msgOverage->>reported', 'eq', String((marker.reported || 0) + delta))
        .select('org_id')
        .then(undefined, () => {});
      throw e;
    }
    log.info(`Excedente de mensajes reportado (${org.id}): +${delta} (total mes ${claimedCfg._msgOverage.reported})`);
    return { reported: delta };
  } catch (e) {
    log.warn(`reportOverageForOrg(${org && org.id}): ${e.message}`);
    return { reported: 0 };
  }
}

/** Recorre las orgs activas con Stripe y reporta excedentes pendientes. */
async function reportAllMessageOverages(opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const summary = { orgs: 0, reported: 0 };
  if (!db.enabled) return summary;
  if (!process.env.STRIPE_MSG_METER_EVENT) { log.info('Excedente de mensajes: sin STRIPE_MSG_METER_EVENT — solo contador (no se cobra)'); return summary; }
  try {
    const { data: orgs } = await db.client.from('organizations')
      .select('id, stripe_customer_id').eq('is_active', true).not('stripe_customer_id', 'is', null);
    for (const org of (orgs || [])) {
      summary.orgs++;
      const r = await reportOverageForOrg(org, opts);
      summary.reported += r.reported;
    }
  } catch (e) { log.warn(`reportAllMessageOverages: ${e.message}`); }
  return summary;
}

// ── Cron: cada día 02:40 Madrid, solo el líder ───────────────
let _interval = null, _lastRun = null;
function startMessageOverageCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!require('../utils/leader').isLeader()) return;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (`${parts.hour}:${parts.minute}` === '02:40' && _lastRun !== today) {
      _lastRun = today;
      reportAllMessageOverages().catch(e => log.error(`message-overage cron: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Message-overage cron iniciado — cada día 02:40 Madrid');
}
function stopMessageOverageCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { usageSummary, reportOverageForOrg, reportAllMessageOverages, startMessageOverageCron, stopMessageOverageCron, monthStartISO, INCLUDED, OVERAGE_EUR };
