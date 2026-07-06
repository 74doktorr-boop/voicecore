// ============================================================
// NodeFlow — Salud por CLIENTE (2026-07-06)
// ------------------------------------------------------------
// A escala, el peligro no es que caiga el servicio (eso lo ve /health),
// sino que el asistente de UN negocio concreto se rompa en silencio:
// el desvío se desactiva, las llamadas entran sin turnos, la calidad
// se hunde… y te enteras por un email cabreado, cuando ya se van.
//
// Este módulo mira nf_calls por org y marca a los que necesitan
// atención ANTES de que el cliente se queje:
//   · roto      → llamadas que conectan pero no funcionan (status 'lost'
//                 o turn_count 0), o calidad hundida (score bajo).
//   · en silencio → venía recibiendo llamadas y de golpe 0 (desvío caído).
//
// Función PURA computeClientHealth() → testeable sin BD ni LLM.
// runClientHealthCheck() lo corre y avisa al fundador. Nunca lanza.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CLIENT-HEALTH');

// Umbrales (conservadores para no alertar por ruido; se recalibran con datos).
const MIN_CALLS_QUALITY = 3;   // no juzgues calidad con <3 llamadas
const BROKEN_CRIT = 0.5;       // ≥50% de llamadas rotas → crítico
const BROKEN_WARN = 0.25;
const SCORE_CRIT  = 45;
const SCORE_WARN  = 60;
const HALLUC_WARN = 40;        // % de alucinación
const SILENCE_MIN_PRIOR = 3;   // tenía ≥3 llamadas en la ventana previa…
const RECENT_MS = 2 * 24 * 3600 * 1000; // …y 0 en las últimas 48h → silencio

function _isBroken(r) {
  // Conectó pero no funcionó: fin anormal o sin un solo turno de conversación.
  return r.status === 'lost' || Number(r.turn_count) === 0;
}

/**
 * Salud por org a partir de filas de nf_calls. PURA.
 * @param {Array} rows  filas { org_id, status, outcome, turn_count, metrics, started_at, duration_ms }
 * @param {number} nowMs  instante de referencia (para detectar silencio)
 * @returns {{ byOrg: Object, issues: Array }}
 */
function computeClientHealth(rows, nowMs) {
  const now = nowMs || 0;
  const byOrg = {};

  for (const r of rows || []) {
    const id = r.org_id || 'desconocido';
    const o = byOrg[id] || (byOrg[id] = {
      orgId: id, calls: 0, broken: 0, recent: 0, prior: 0,
      booked: 0, leads: 0, abandoned: 0,
      scored: 0, scoreSum: 0, hallucinated: 0, minutes: 0,
    });
    o.calls++;
    if (_isBroken(r)) o.broken++;
    const t = new Date(r.started_at).getTime();
    if (now && t >= now - RECENT_MS) o.recent++; else if (now) o.prior++;
    o.minutes += (Number(r.duration_ms) || 0) / 60000;

    const oc = r.outcome;
    if (oc === 'booked') o.booked++;
    else if (oc === 'callback_requested') o.leads++;
    else if (oc === 'abandoned') o.abandoned++;

    const a = r.metrics && r.metrics.audit;
    if (a && typeof a.score === 'number') {
      o.scored++; o.scoreSum += a.score;
      if (a.hallucinated === true) o.hallucinated++;
    }
  }

  const issues = [];
  for (const o of Object.values(byOrg)) {
    o.minutes = Math.round(o.minutes);
    o.brokenRate = o.calls ? o.broken / o.calls : 0;
    o.avgScore = o.scored ? Math.round(o.scoreSum / o.scored) : null;
    o.hallucinationRate = o.scored ? Math.round((o.hallucinated / o.scored) * 100) : null;

    // Silencio: recibía llamadas y de golpe 0 en las últimas 48h.
    const silent = now && o.prior >= SILENCE_MIN_PRIOR && o.recent === 0;

    let verdict = 'ok';
    const reasons = [];
    if (o.brokenRate >= BROKEN_CRIT && o.calls >= 2) { verdict = 'critical'; reasons.push(`${Math.round(o.brokenRate * 100)}% de llamadas rotas`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.avgScore < SCORE_CRIT) { verdict = 'critical'; reasons.push(`calidad muy baja (score ${o.avgScore})`); }
    else if (o.brokenRate >= BROKEN_WARN && o.calls >= 2) { verdict = 'warning'; reasons.push(`${Math.round(o.brokenRate * 100)}% de llamadas rotas`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.avgScore < SCORE_WARN) { verdict = 'warning'; reasons.push(`calidad floja (score ${o.avgScore})`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.hallucinationRate >= HALLUC_WARN) { verdict = 'warning'; reasons.push(`alucina el ${o.hallucinationRate}% de las veces`); }

    if (silent) { // el silencio es lo más urgente: el negocio no recibe NADA
      verdict = 'critical';
      reasons.unshift('dejó de recibir llamadas (¿desvío caído?)');
    }

    o.verdict = verdict;
    o.reasons = reasons;
    o.silent = !!silent;
    if (verdict !== 'ok') issues.push(o);
  }

  // Más urgente primero: críticos, luego por tasa de rotura.
  issues.sort((a, b) => (a.verdict === b.verdict ? b.brokenRate - a.brokenRate : a.verdict === 'critical' ? -1 : 1));
  return { byOrg, issues };
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Corre el chequeo sobre los últimos 7 días y avisa al fundador si hay
 * negocios en rojo/ámbar. Nunca lanza. deps inyectables → testeable.
 */
async function runClientHealthCheck(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const sendEmail = deps.sendEmail || require('../notifications/email').sendEmail;
  const founderEmail = deps.founderEmail || process.env.NOTIFY_EMAIL;
  const nameOf = deps.nameOf || (async (ids) => {
    const map = {};
    try {
      const { data } = await db.client.from('organizations').select('id, name').in('id', ids);
      for (const o of (data || [])) map[o.id] = o.name;
    } catch (_) {}
    return map;
  });
  const summary = { checked: 0, issues: 0, critical: 0, emailSent: false };
  if (!db.enabled) return summary;

  let rows = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db.client
      .from('nf_calls')
      .select('org_id, status, outcome, turn_count, metrics, started_at, duration_ms')
      .gte('started_at', since);
    if (error) throw new Error(error.message);
    rows = data || [];
  } catch (e) {
    log.warn(`salud de clientes: lectura de nf_calls falló: ${e.message}`);
    return summary;
  }

  const { byOrg, issues } = computeClientHealth(rows, Date.now());
  summary.checked = Object.keys(byOrg).length;
  summary.issues = issues.length;
  summary.critical = issues.filter(i => i.verdict === 'critical').length;

  if (!issues.length) { log.info(`Salud de clientes: ${summary.checked} negocios, todos OK`); return summary; }

  const names = await nameOf(issues.map(i => i.orgId));
  log.warn(`Salud de clientes: ${summary.critical} crítico(s), ${summary.issues - summary.critical} aviso(s) de ${summary.checked}`);

  // Detalle para el dashboard admin (GET) — quién y por qué.
  summary.details = issues.map(i => ({
    orgId: i.orgId, name: names[i.orgId] || i.orgId, verdict: i.verdict,
    reasons: i.reasons, silent: i.silent,
    calls: i.calls, booked: i.booked, leads: i.leads, avgScore: i.avgScore,
    brokenRate: Math.round(i.brokenRate * 100),
  }));

  if (founderEmail && !deps.dryRun) {
    const rowsHtml = issues.map(i => {
      const color = i.verdict === 'critical' ? '#e74c3c' : '#e67e22';
      const dot = i.verdict === 'critical' ? '🔴' : '🟠';
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${dot} <b>${_esc(names[i.orgId] || i.orgId)}</b></td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:${color}">${_esc(i.reasons.join(' · '))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#888;font-size:13px">${i.calls} llam · ${i.booked} citas · score ${i.avgScore ?? '—'}</td>
      </tr>`;
    }).join('');
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
        <h2 style="margin:0 0 4px">🚑 Salud de clientes — ${summary.issues} negocio(s) necesitan atención</h2>
        <p style="color:#888;margin:0 0 16px">${summary.critical} crítico(s) · revisado(s) ${summary.checked} negocio(s) con actividad esta semana.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
            <th style="padding:6px 10px">Negocio</th><th style="padding:6px 10px">Problema</th><th style="padding:6px 10px">Semana</th>
          </tr>
          ${rowsHtml}
        </table>
        <p style="color:#888;font-size:12px;margin-top:16px">Un negocio "en silencio" casi siempre es el desvío caído: llámale antes de que se vaya. NodeFlow.</p>
      </div>`;
    const text = `Salud de clientes: ${summary.issues} necesitan atención (${summary.critical} críticos). ` +
      issues.map(i => `${names[i.orgId] || i.orgId}: ${i.reasons.join('; ')}`).join(' | ');
    try {
      await sendEmail({ to: founderEmail, subject: `🚑 ${summary.issues} cliente(s) necesitan atención${summary.critical ? ` (${summary.critical} críticos)` : ''}`, html, text });
      summary.emailSent = true;
    } catch (e) { log.warn(`aviso de salud de clientes falló: ${e.message}`); }
  }

  return summary;
}

// ── Cron: cada día 09:30 Madrid (tras el ciclo de mejora) ────────────────────
let _interval = null, _lastRun = null;
function startClientHealthCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (`${parts.hour}:${parts.minute}` === '09:30' && _lastRun !== today) {
      _lastRun = today;
      runClientHealthCheck().catch(e => log.error(`client-health cron: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Client-health cron iniciado — cada día 09:30 Madrid');
}
function stopClientHealthCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { computeClientHealth, runClientHealthCheck, startClientHealthCron, stopClientHealthCron };
