'use strict';
// ============================================================
// NodeFlow — Alerta de coste variable (2026-07-17)
// ------------------------------------------------------------
// Objeción nº1 de PRECIO en la crítica sectorial (128 clientes ficticios): el
// miedo a la FACTURA SORPRESA del coste variable (voz 0,15€/min + mensajes
// 0,10€/msg) sin tope, justo en los picos. Este motor calcula el gasto variable
// del mes por negocio y AVISA al dueño al 80% y 100% de un umbral configurable
// (por-org o env). Idempotente por (org, mes, nivel).
//
// NO CORTA EL SERVICIO: solo avisa. Un tope duro que corte llamadas el día del
// lanzamiento sería peor que el problema. El tope duro (enforcement) queda como
// config futura, apagado. Aquí: transparencia, no bloqueo.
// ============================================================

const { Logger } = require('../utils/logger');
const { monthStartISO, usageSummary } = require('./message-usage');
const log = new Logger('COST-ALERT');

// Precio REAL de overage de voz = el que cobra Stripe (stripe.js: 0,15€/min,
// "precio ÚNICO, decisión Unai 2026-07-04"). Antes estaba a 0,10 (copia-pega
// del precio de MENSAJES) → la alerta/tope SUBESTIMABA el gasto = justo la
// factura sorpresa que este motor debe evitar. Ahora coincide con la landing.
const VOICE_OVERAGE_EUR = Number(process.env.VOICE_OVERAGE_EUR) || 0.15;
const DEFAULT_THRESHOLD = (() => {
  const n = Number(process.env.COST_ALERT_THRESHOLD_EUR);
  return Number.isFinite(n) && n >= 0 ? n : 25;
})();

/** Umbral de aviso (€) de la org: override por-negocio o env. 0 = desactivado. PURA. */
function resolveThreshold(org) {
  const cfg = (org && org.automation_config && org.automation_config.config) || {};
  const v = cfg.costAlertThresholdEur;
  if (v === 0) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

/** Tope DURO de gasto (€) de la org. Solo por-negocio, OFF por defecto (0). PURA.
 *  Ojo: el corte NO afecta a llamadas entrantes ni a recordatorios de cita;
 *  solo pospone seguimientos/campañas no esenciales (ver isSpendingCapped). */
function resolveCap(org) {
  const cfg = (org && org.automation_config && org.automation_config.config) || {};
  const n = Number(cfg.costCapEur);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Gasto variable del mes: overage de voz (min > incluidos) + overage de mensajes. */
async function monthlyVariableSpend(org, opts = {}) {
  const db     = opts.db || require('../db/database').getDatabase();
  const usageF = opts.usageSummary || usageSummary;
  const usedMin  = Number(org.monthly_minutes_used) || 0;
  const limitMin = Number(org.monthly_minutes_limit) || 0;
  const overageMin = Math.max(0, usedMin - limitMin);
  const voiceOverageEur = Math.round(overageMin * VOICE_OVERAGE_EUR * 100) / 100;
  let messageOverageEur = 0;
  try {
    const u = await usageF(org.id, { db });
    messageOverageEur = (u && u.overageEur) || 0;
  } catch (_) { /* fail-open: sin datos de mensajes, solo cuenta voz */ }
  const totalEur = Math.round((voiceOverageEur + messageOverageEur) * 100) / 100;
  return { usedMin, limitMin, overageMin, voiceOverageEur, messageOverageEur, totalEur };
}

/** Nivel de aviso que corresponde al gasto vs umbral: 0 | 80 | 100. PURA. */
function levelFor(totalEur, threshold) {
  if (!threshold || threshold <= 0) return 0;
  const pct = totalEur / threshold;
  if (pct >= 1) return 100;
  if (pct >= 0.8) return 80;
  return 0;
}

/** ¿Ya se avisó este mes a este nivel (o superior)? PURA. */
function alreadyAlerted(org, month, level) {
  const m = (org.automation_config && org.automation_config.config && org.automation_config.config._costAlert) || {};
  return m.month === month && (m.level || 0) >= level;
}

async function _markAlerted(db, org, month, level) {
  const ac  = org.automation_config || {};
  const cfg = ac.config || {};
  await db.client.from('organizations').update({
    automation_config: { ...ac, config: { ...cfg, _costAlert: { month, level } } },
  }).eq('id', org.id);
}

/**
 * Revisa una org y avisa si cruza 80% o 100% del umbral (y no se avisó ya).
 * Nunca lanza. deps inyectables para test.
 */
async function checkAndAlertOrg(org, opts = {}) {
  const db        = opts.db || require('../db/database').getDatabase();
  const sendEmail = opts.sendEmail || require('../notifications/email').sendEmail;
  const now       = opts.now || monthStartISO();
  const month     = String(now).slice(0, 7);

  const threshold = resolveThreshold(org);
  if (!threshold || threshold <= 0) return { alerted: false, reason: 'disabled' };

  const spend = await monthlyVariableSpend(org, opts);
  const level = levelFor(spend.totalEur, threshold);
  if (!level) return { alerted: false, spend };
  if (alreadyAlerted(org, month, level)) return { alerted: false, spend, reason: 'ya avisado' };

  const owner = org.owner_email;
  const subject = level >= 100
    ? `Aviso NodeFlow: has superado tu umbral de gasto variable (${spend.totalEur}€)`
    : `Aviso NodeFlow: vas por ${spend.totalEur}€ de gasto variable este mes`;
  const text = `Hola,\n\nEste mes ${org.name || 'tu negocio'} lleva ${spend.totalEur}€ de gasto variable (fuera de tu cuota fija):\n`
    + `- Voz: ${spend.overageMin} min por encima de los ${spend.limitMin} incluidos → ${spend.voiceOverageEur}€\n`
    + `- Mensajes: ${spend.messageOverageEur}€\n\n`
    + `Tu umbral de aviso está en ${threshold}€. Es solo un aviso: el servicio sigue funcionando con normalidad. `
    + `Si quieres, puedes ajustar tu umbral desde el panel.\n\n— NodeFlow`;

  let ok = false;
  try {
    if (owner) { await sendEmail({ to: owner, subject, text }); ok = true; }
    const notify = process.env.NOTIFY_EMAIL;
    if (notify && notify !== owner) {
      await sendEmail({ to: notify, subject: `[${org.name || org.id}] ${subject}`, text });
    }
  } catch (e) { log.warn(`aviso de coste a ${org.id} falló: ${e.message}`); }

  if (ok) { try { await _markAlerted(db, org, month, level); } catch (e) { log.warn(`marca de aviso ${org.id}: ${e.message}`); } }
  return { alerted: ok, level, spend };
}

/** Recorre las orgs activas y avisa a las que crucen su umbral. Nunca lanza. */
async function checkAllOrgs(opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { checked: 0, alerted: 0 };
  let orgs = [];
  try {
    const { data } = await db.client.from('organizations')
      .select('id,name,owner_email,monthly_minutes_used,monthly_minutes_limit,automation_config')
      .eq('is_active', true);
    orgs = data || [];
  } catch (e) { log.error(`checkAllOrgs query: ${e.message}`); return { checked: 0, alerted: 0 }; }
  let alerted = 0;
  for (const org of orgs) {
    try { const r = await checkAndAlertOrg(org, { db }); if (r.alerted) alerted++; }
    catch (e) { log.warn(`checkAllOrgs ${org.id}: ${e.message}`); }
  }
  if (alerted) log.info(`Cost-alert: ${alerted} aviso(s) enviado(s)`);
  return { checked: orgs.length, alerted };
}

// ¿Está el negocio por encima de su TOPE DURO de gasto variable este mes?
// Usado para POSPONER envíos no esenciales (seguimientos/campañas), NUNCA para
// cortar llamadas ni recordatorios de cita. Cache corto (TTL 60s) para no leer
// la BD por cada recordatorio del lote. deps inyectables.
const _capCache = new Map(); // orgId -> { capped, ts }
async function isSpendingCapped(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return false;
  const now = opts.now || Date.now();
  const hit = _capCache.get(orgId);
  if (!opts.noCache && hit && now - hit.ts < 60000) return hit.capped;
  let capped = false;
  try {
    const { data: org } = await db.client.from('organizations')
      .select('id,monthly_minutes_used,monthly_minutes_limit,automation_config')
      .eq('id', orgId).maybeSingle();
    const cap = resolveCap(org || {});
    if (cap > 0) {
      const spend = await monthlyVariableSpend(org, opts);
      capped = spend.totalEur >= cap;
    }
  } catch (e) { log.warn(`isSpendingCapped(${orgId}): ${e.message}`); }
  _capCache.set(orgId, { capped, ts: now });
  return capped;
}
function _clearCapCache() { _capCache.clear(); }

let _interval = null;
function startCostAlertCron() {
  if (_interval) return;
  const run = () => checkAllOrgs().catch(e => log.error(`cost-alert cron: ${e.message}`));
  _interval = setInterval(run, 3 * 3600 * 1000); // cada 3h
  if (_interval.unref) _interval.unref();
  log.info('Cost-alert cron iniciado — cada 3h');
}
function stopCostAlertCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = {
  resolveThreshold, resolveCap, monthlyVariableSpend, levelFor, alreadyAlerted,
  checkAndAlertOrg, checkAllOrgs, isSpendingCapped, _clearCapCache,
  startCostAlertCron, stopCostAlertCron,
  DEFAULT_THRESHOLD, VOICE_OVERAGE_EUR,
};
