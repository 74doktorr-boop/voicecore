// ============================================================
// NodeFlow — Agregador de mejora continua (opción A — el fundador
// aprueba; GO de Unai 2026-07-04)
//
// El auditor ya deja en cada llamada (nf_calls.metrics.audit) sus
// problemas, mejoras sugeridas y el info_gap (dato que el cliente
// pidió y el asistente no supo dar). Este módulo cierra el bucle:
//
//   CARRIL DATOS (por negocio, 100% autónomo): los info_gap de la
//   semana se agrupan y cada dueño recibe UN aviso accionable:
//   "tu asistente no supo responder «precio del plan» (2 veces) —
//   añádelo en Configuración → Servicios y precios".
//
//   CARRIL GLOBAL (aprende de uno, aplica a todos — con gate): los
//   problems/improvements de TODAS las orgs se normalizan y agrupan;
//   un patrón repetido (≥2 llamadas) sale como REGLA CANDIDATA en el
//   informe semanal al fundador. Él aprueba (opción A) y la regla se
//   implementa como cambio de prompt versionado con tests + replay.
//   JAMÁS auto-mutación del prompt en producción: el propio auditor
//   tuvo un falso positivo el 2026-07-04 — un juez falible sin gate
//   degradaría todos los asistentes a la vez.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('IMPROVE');

const RULE_MIN_COUNT = 2; // un patrón es candidato cuando se repite

/** Clave de clúster: minúsculas, sin acentos ni puntuación. */
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function _cluster(texts) {
  const map = new Map();
  for (const t of texts) {
    const key = _norm(t);
    if (!key) continue;
    const hit = map.get(key);
    if (hit) hit.count++;
    else map.set(key, { text: String(t).trim(), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * Función PURA: filas de nf_calls (org_id, metrics.audit) → hallazgos
 * agregados. Testeable sin BD ni LLM.
 */
function aggregateFindings(rows) {
  const out = {
    calls: 0, audited: 0, avgAuditScore: null, hallucinationRate: null,
    byOrg: {}, topProblems: [], candidateRules: [],
  };
  const allProblems = [];
  const allImprovements = [];
  let scoreSum = 0, hallucinated = 0;

  for (const r of rows || []) {
    out.calls++;
    const orgId = r.org_id || 'desconocido';
    if (!out.byOrg[orgId]) out.byOrg[orgId] = { calls: 0, audited: 0, infoGaps: [], _gaps: [] };
    const org = out.byOrg[orgId];
    org.calls++;

    const audit = r.metrics && r.metrics.audit;
    if (!audit || typeof audit.score !== 'number') continue;
    out.audited++;
    org.audited++;
    scoreSum += audit.score;
    if (audit.hallucinated === true) hallucinated++;
    if (audit.info_gap) org._gaps.push(audit.info_gap);
    for (const p of audit.problems || []) allProblems.push(p);
    for (const i of audit.improvements || []) allImprovements.push(i);
  }

  for (const org of Object.values(out.byOrg)) {
    org.infoGaps = _cluster(org._gaps).map(c => ({ gap: c.text, count: c.count }));
    delete org._gaps;
  }

  if (out.audited > 0) {
    out.avgAuditScore = Math.round(scoreSum / out.audited);
    out.hallucinationRate = Math.round((hallucinated / out.audited) * 100);
  }
  out.topProblems = _cluster(allProblems).slice(0, 10);
  out.candidateRules = _cluster(allImprovements)
    .filter(c => c.count >= RULE_MIN_COUNT)
    .map(c => ({ rule: c.text, count: c.count }));

  return out;
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Ciclo completo (semanal por cron, o bajo demanda desde el admin):
 * lee la última semana de nf_calls, agrega, avisa a cada dueño de sus
 * huecos de datos y envía el informe con reglas candidatas al fundador.
 * Nunca lanza. Devuelve un resumen para logs/admin.
 */
async function runImprovementCycle(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const notifyOwner = deps.notifyOwner || ((msg, bizId) => {
    try { require('../tools/executor')._notifyOwner(msg, bizId); } catch (_) {}
  });
  const sendEmail = deps.sendEmail || require('../notifications/email').sendEmail;
  const founderEmail = deps.founderEmail || process.env.NOTIFY_EMAIL;
  const summary = { calls: 0, audited: 0, orgsNotified: 0, candidateRules: 0, emailSent: false };

  if (!db.enabled) return summary;

  let rows = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db.client
      .from('nf_calls')
      .select('org_id, started_at, metrics')
      .gte('started_at', since)
      .not('metrics', 'is', null);
    if (error) throw new Error(error.message);
    rows = data || [];
  } catch (e) {
    log.warn(`ciclo de mejora: lectura de nf_calls falló: ${e.message}`);
    return summary;
  }

  const agg = aggregateFindings(rows);
  summary.calls = agg.calls;
  summary.audited = agg.audited;
  summary.candidateRules = agg.candidateRules.length;
  if (agg.audited === 0) return summary;

  // ── Carril datos: un aviso accionable por negocio con huecos ──
  for (const [orgId, org] of Object.entries(agg.byOrg)) {
    if (!org.infoGaps.length) continue;
    const lines = org.infoGaps.slice(0, 5)
      .map(g => `• «${g.gap}»${g.count > 1 ? ` (${g.count} veces)` : ''}`).join('\n');
    try {
      notifyOwner(
        `🧠 *Tu asistente necesita un dato*\n` +
        `━━━━━━━━━━━━\n` +
        `Esta semana no supo responder:\n${lines}\n\n` +
        `Añádelo en tu portal → Configuración → Servicios y precios (o en tu Base de conocimiento) y lo dirá con exactitud en la próxima llamada.\n` +
        `━━━━━━━━━━━━\nNodeFlow IA`,
        orgId
      );
      summary.orgsNotified++;
    } catch (e) {
      log.warn(`aviso de huecos a ${orgId} falló: ${e.message}`);
    }
  }

  // ── Carril global: informe con reglas candidatas → aprobación (opción A) ──
  if (founderEmail) {
    const rules = agg.candidateRules.length
      ? agg.candidateRules.map(r => `<li><b>${_esc(r.rule)}</b> — vista en ${r.count} llamadas</li>`).join('')
      : '<li>Ninguna esta semana — sin patrones repetidos.</li>';
    const problems = agg.topProblems.slice(0, 5)
      .map(p => `<li>${_esc(p.text)} (${p.count})</li>`).join('') || '<li>—</li>';
    const gapsByOrg = Object.entries(agg.byOrg)
      .filter(([, o]) => o.infoGaps.length)
      .map(([id, o]) => `<li><b>${_esc(id)}</b>: ${o.infoGaps.map(g => `«${_esc(g.gap)}» ×${g.count}`).join(', ')}</li>`)
      .join('') || '<li>Ningún hueco de datos — los asistentes supieron responder todo.</li>';

    const html = `
      <h2>🧠 Informe de mejora continua — última semana</h2>
      <p><b>Llamadas:</b> ${agg.calls} · <b>Auditadas:</b> ${agg.audited} ·
      <b>Score medio:</b> ${agg.avgAuditScore}/100 · <b>Alucinación:</b> ${agg.hallucinationRate}%</p>
      <h3>Reglas candidatas (globales — aplicarían a TODOS los negocios)</h3>
      <ul>${rules}</ul>
      <p><b>Responde a este email con las reglas que apruebas</b> y se implementan como cambio de prompt versionado, con tests y replay de llamadas reales antes de desplegar (opción A acordada el 2026-07-04).</p>
      <h3>Problemas más repetidos</h3><ul>${problems}</ul>
      <h3>Huecos de datos por negocio (sus dueños ya han recibido el aviso)</h3><ul>${gapsByOrg}</ul>
      <p style="color:#888">Generado automáticamente por el agregador de mejora de NodeFlow.</p>`;

    try {
      await sendEmail({
        to: founderEmail,
        subject: `🧠 Mejora continua: ${agg.candidateRules.length} regla(s) candidata(s) · score medio ${agg.avgAuditScore}/100`,
        html,
      });
      summary.emailSent = true;
    } catch (e) {
      log.warn(`informe de mejora al fundador falló: ${e.message}`);
    }
  }

  log.info(`Ciclo de mejora: ${agg.calls} llamadas, ${agg.audited} auditadas, ${summary.orgsNotified} dueños avisados, ${agg.candidateRules.length} reglas candidatas`);
  return summary;
}

module.exports = { aggregateFindings, runImprovementCycle };
