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
const LAT_WARN_MS = 1500;      // latencia media por turno (charter apunta a <700)
const LAT_MIN_TURNS = 5;       // no juzgues latencia con menos turnos
const SILENCE_MIN_PRIOR = 3;   // tenía ≥3 llamadas en la ventana previa…
const RECENT_MS = 2 * 24 * 3600 * 1000; // …y 0 en las últimas 48h → silencio

function _isBroken(r) {
  // Conectó pero no funcionó: fin anormal o sin un solo turno de conversación.
  return r.status === 'lost' || Number(r.turn_count) === 0;
}

// Causa de una llamada rota (determinista, a partir de señales de la llamada):
//   instant        → 0 turnos y <8s: colgó nada más descolgar (latencia del
//                    saludo, enrutado erróneo, o rechazo al oír "asistente").
//   no_conversation→ 0 turnos pero duró: hubo línea y NADIE se entendió
//                    (audio/STT caído, silencio).
//   cut_mid        → hubo conversación y terminó de forma anormal (lost).
function _brokenCause(r) {
  if (Number(r.turn_count) === 0) {
    return (Number(r.duration_ms) || 0) < 8000 ? 'instant' : 'no_conversation';
  }
  return 'cut_mid';
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
      causes: { instant: 0, no_conversation: 0, cut_mid: 0 },
      infoGaps: {}, problems: {},
      latSum: 0, latTurns: 0, llmSum: 0, ttsSum: 0, sttSum: 0, toolSum: 0,
    });
    o.calls++;
    if (_isBroken(r)) { o.broken++; o.causes[_brokenCause(r)]++; }

    // Latencia por turno (metrics.turns[].totalTime) + desglose por componente.
    const m = r.metrics || {};
    for (const t of (Array.isArray(m.turns) ? m.turns : [])) {
      if (Number.isFinite(t.totalTime)) { o.latSum += t.totalTime; o.latTurns++; }
    }
    o.llmSum  += Number(m.totalLlmTime)  || 0;
    o.ttsSum  += Number(m.totalTtsTime)  || 0;
    o.sttSum  += Number(m.totalSttTime)  || 0;
    o.toolSum += Number(m.totalToolTime) || 0;
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
      // Qué información faltó y qué problemas vio el auditor (agregados).
      if (a.info_gap && typeof a.info_gap === 'string') {
        const g = a.info_gap.trim().toLowerCase().slice(0, 80);
        if (g) o.infoGaps[g] = (o.infoGaps[g] || 0) + 1;
      }
      for (const p of (Array.isArray(a.problems) ? a.problems : [])) {
        const k = String(p || '').trim().toLowerCase().slice(0, 90);
        if (k) o.problems[k] = (o.problems[k] || 0) + 1;
      }
    }
  }

  const issues = [];
  for (const o of Object.values(byOrg)) {
    o.minutes = Math.round(o.minutes);
    o.brokenRate = o.calls ? o.broken / o.calls : 0;
    o.avgScore = o.scored ? Math.round(o.scoreSum / o.scored) : null;
    o.hallucinationRate = o.scored ? Math.round((o.hallucinated / o.scored) * 100) : null;
    o.avgTurnMs = o.latTurns ? Math.round(o.latSum / o.latTurns) : null;

    // Silencio: recibía llamadas y de golpe 0 en las últimas 48h.
    const silent = now && o.prior >= SILENCE_MIN_PRIOR && o.recent === 0;

    let verdict = 'ok';
    const reasons = [];
    if (o.brokenRate >= BROKEN_CRIT && o.calls >= 2) { verdict = 'critical'; reasons.push(`${Math.round(o.brokenRate * 100)}% de llamadas rotas`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.avgScore < SCORE_CRIT) { verdict = 'critical'; reasons.push(`calidad muy baja (score ${o.avgScore})`); }
    else if (o.brokenRate >= BROKEN_WARN && o.calls >= 2) { verdict = 'warning'; reasons.push(`${Math.round(o.brokenRate * 100)}% de llamadas rotas`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.avgScore < SCORE_WARN) { verdict = 'warning'; reasons.push(`calidad floja (score ${o.avgScore})`); }
    else if (o.scored >= MIN_CALLS_QUALITY && o.hallucinationRate >= HALLUC_WARN) { verdict = 'warning'; reasons.push(`alucina el ${o.hallucinationRate}% de las veces`); }
    else if (o.latTurns >= LAT_MIN_TURNS && o.avgTurnMs >= LAT_WARN_MS) { verdict = 'warning'; reasons.push(`va lento (${(o.avgTurnMs / 1000).toFixed(1)}s por turno)`); }

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

function _top(counter, n) {
  return Object.entries(counter || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * PRESCRIPCIÓN: de "tu bot lo hace mal" a "haz esto". PURA.
 * Traduce las señales de un issue a acciones concretas, ordenadas por
 * impacto. ctx.pendingRules = nº de reglas candidatas sin revisar (admin).
 * @returns {Array<{icon, action, detail}>}
 */
function prescribe(o, ctx = {}) {
  const out = [];
  const c = o.causes || {};

  if (o.silent) {
    out.push({ icon: '📞', action: 'Llama al negocio HOY y verifica el desvío',
      detail: 'Un negocio en silencio casi siempre es el desvío desactivado (lo quitan "un momento" y se olvidan). Llama a su número real: si no salta el asistente, guíale para reactivarlo (Admin → Telefonía para comprobar el número).' });
  }
  if (c.instant > 0) {
    out.push({ icon: '⚡', action: `${c.instant} cuelgue(s) nada más descolgar — haz una llamada de prueba`,
      detail: 'O el saludo tarda en salir (latencia) o el número está mal enrutado. Llama tú al número del negocio: si tarda >2s en oírse el saludo, es latencia; si suena raro, enrutado (Admin → Telefonía → Diagnóstico).' });
  }
  if (c.no_conversation > 0) {
    out.push({ icon: '🎙️', action: `${c.no_conversation} llamada(s) con línea pero sin conversación — revisa audio/STT`,
      detail: 'Hubo llamada pero nadie se entendió: suele ser Deepgram/TTS caído o silencio del llamante. Comprueba Admin → Sistema (diagnostics) y escucha la grabación de una de esas llamadas.' });
  }
  if (c.cut_mid > 0) {
    out.push({ icon: '✂️', action: `${c.cut_mid} llamada(s) cortadas a mitad — mira esas llamadas en el Admin`,
      detail: 'Conversación iniciada que murió de forma anormal: timeout, error del proveedor o cliente desesperado. El transcript dice cuál de los tres.' });
  }

  if ((o.latTurns || 0) >= 5 && (o.avgTurnMs || 0) >= 1500) {
    // ¿Quién es el lento? El desglose por componente lo dice.
    const parts = { LLM: o.llmSum || 0, TTS: o.ttsSum || 0, STT: o.sttSum || 0, herramientas: o.toolSum || 0 };
    const total = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
    const [worst, worstMs] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
    const pct = Math.round((worstMs / total) * 100);
    const fix = {
      LLM: 'recorta el prompt (base de conocimiento al grano) o valora un modelo más rápido para este negocio',
      TTS: 'revisa la voz elegida: las premium tienen más latencia; comprueba también la salud de ElevenLabs/Cartesia en diagnostics',
      STT: 'revisa Deepgram en diagnostics — la transcripción está tardando de más',
      herramientas: 'una integración va lenta (agenda/calendario): mira qué tool tarda en los transcripts',
    }[worst];
    out.push({ icon: '🐢', action: `Va lento: ${(o.avgTurnMs / 1000).toFixed(1)}s de media por turno — el ${pct}% se va en ${worst}`,
      detail: `Cada segundo de silencio cuesta colgados (el objetivo interno es <0,7s). Dominante: ${worst}. Acción: ${fix}.` });
  }

  const gaps = _top(o.infoGaps, 3);
  if (gaps.length) {
    out.push({ icon: '📚', action: 'El asistente no supo responder: ' + gaps.map(([g, n]) => `"${g}"${n > 1 ? ` (×${n})` : ''}`).join(', '),
      detail: 'Añade justo esos datos a su Base de conocimiento (portal → Conocimiento) o a su lista de servicios con precios. Es la mejora con más impacto inmediato en el score.' });
  }
  if ((o.hallucinationRate || 0) >= 40) {
    out.push({ icon: '🧯', action: `Alucina en el ${o.hallucinationRate}% de llamadas auditadas — recorta su margen de inventar`,
      detail: 'Cuanto más completa su Base de conocimiento y su serviceList, menos inventa. Revisa también qué promete: si ofrece cosas que no puede hacer, falta una regla que lo prohíba.' });
  }
  if ((o.avgScore != null && o.avgScore < 60) && (ctx.pendingRules || 0) > 0) {
    out.push({ icon: '🧠', action: `Tienes ${ctx.pendingRules} regla(s) candidatas del auditor SIN revisar — apruébalas`,
      detail: 'El bucle de mejora ya diagnosticó estas llamadas y propuso reglas concretas. Están esperándote en Admin → 🧠 Mejora: revisar, probar (replay) y aprobar.' });
  }

  const probs = _top(o.problems, 2);
  if (probs.length && out.length < 4) {
    out.push({ icon: '🔍', action: 'Lo que más repite el auditor: ' + probs.map(([p, n]) => `"${p}"${n > 1 ? ` (×${n})` : ''}`).join(' · '),
      detail: 'Son patrones, no casos sueltos: si uno de estos se arregla con una regla del sector, propónla desde Admin → 🧠 Mejora.' });
  }

  return out.slice(0, 5);
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

  // Reglas candidatas pendientes de revisar (para la prescripción). Fail-open:
  // si la tabla aún no existe, simplemente no se menciona.
  let pendingRules = 0;
  try {
    const { count } = await db.client.from('nf_learned_rules')
      .select('id', { count: 'exact', head: true }).eq('status', 'candidate');
    pendingRules = count || 0;
  } catch (_) { /* tabla no aplicada aún */ }

  // Detalle para el dashboard admin (GET) — quién, por qué y QUÉ HACER.
  summary.details = issues.map(i => ({
    orgId: i.orgId, name: names[i.orgId] || i.orgId, verdict: i.verdict,
    reasons: i.reasons, silent: i.silent,
    calls: i.calls, booked: i.booked, leads: i.leads, avgScore: i.avgScore,
    brokenRate: Math.round(i.brokenRate * 100),
    causes: i.causes,
    avgTurnMs: i.avgTurnMs,
    actions: prescribe(i, { pendingRules }),
  }));

  if (founderEmail && !deps.dryRun) {
    const blocksHtml = summary.details.map(d => {
      const color = d.verdict === 'critical' ? '#e74c3c' : '#e67e22';
      const dot = d.verdict === 'critical' ? '🔴' : '🟠';
      const actionsHtml = d.actions.length
        ? `<div style="margin-top:10px">${d.actions.map(a => `
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <div style="font-size:15px">${a.icon}</div>
              <div>
                <div style="font-weight:700;font-size:13px;color:#1a1a2e">${_esc(a.action)}</div>
                <div style="font-size:12px;color:#666;line-height:1.5;margin-top:1px">${_esc(a.detail)}</div>
              </div>
            </div>`).join('')}</div>`
        : '';
      return `
        <div style="border:1px solid #eee;border-left:3px solid ${color};border-radius:10px;padding:14px 16px;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <div style="font-weight:800;font-size:15px">${dot} ${_esc(d.name)}</div>
            <div style="color:#888;font-size:12px">${d.calls} llam · ${d.booked} citas · score ${d.avgScore ?? '—'}</div>
          </div>
          <div style="color:${color};font-size:13px;margin-top:3px">${_esc(d.reasons.join(' · '))}</div>
          ${actionsHtml}
        </div>`;
    }).join('');
    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e">
        <h2 style="margin:0 0 4px">🚑 Salud de clientes — ${summary.issues} negocio(s) necesitan atención</h2>
        <p style="color:#888;margin:0 0 16px">${summary.critical} crítico(s) · revisado(s) ${summary.checked} negocio(s) con actividad esta semana. Cada uno lleva su plan de acción.</p>
        ${blocksHtml}
        <p style="color:#888;font-size:12px;margin-top:16px">Diagnóstico automático de NodeFlow: causas de las llamadas rotas + qué información faltó, con la acción concreta para cada una.</p>
      </div>`;
    const text = `Salud de clientes: ${summary.issues} necesitan atención (${summary.critical} críticos). ` +
      summary.details.map(d => `${d.name}: ${d.reasons.join('; ')} → ${d.actions.map(a => a.action).join(' | ')}`).join(' || ');
    try {
      await sendEmail({ to: founderEmail, subject: `🚑 ${summary.issues} cliente(s) necesitan atención${summary.critical ? ` (${summary.critical} críticos)` : ''}`, html, text });
      summary.emailSent = true;
    } catch (e) { log.warn(`aviso de salud de clientes falló: ${e.message}`); }
  }

  // Silencio = urgencia que no puede esperar al fundador: avisar al DUEÑO
  // directamente con las instrucciones de reactivación (rate-limit 72h).
  summary.ownerAlerts = 0;
  if (!deps.dryRun) {
    for (const i of issues.filter(x => x.silent)) {
      const r = await notifySilentOwner(i.orgId, deps);
      if (r.sent) summary.ownerAlerts++;
    }
  }

  return summary;
}

// ── Aviso DIRECTO al dueño cuando su desvío cae ──────────────────────────────
// A 100 clientes no se puede llamar a cada uno: si un negocio queda en
// silencio (recibía llamadas y de golpe 0), el sistema avisa al DUEÑO con
// las instrucciones exactas para reactivar el desvío. Máx 1 aviso / 72h
// (marcador en org_reminder_config.config._lastSilenceAlert, sin migración).
const SILENCE_ALERT_COOLDOWN_MS = 72 * 3600 * 1000;

async function notifySilentOwner(orgId, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const sendEmail = deps.sendEmail || require('../notifications/email').sendEmail;
  const now = deps.now || Date.now();
  if (!db.enabled) return { sent: false, reason: 'no_db' };
  try {
    // Rate limit: no insistir cada día si ya se le avisó.
    const { data: cfgRow } = await db.client.from('org_reminder_config')
      .select('config').eq('org_id', orgId).maybeSingle();
    const cfg = (cfgRow && cfgRow.config) || {};
    const last = cfg._lastSilenceAlert ? new Date(cfg._lastSilenceAlert).getTime() : 0;
    if (last && now - last < SILENCE_ALERT_COOLDOWN_MS) return { sent: false, reason: 'cooldown' };

    // Dueño + número NodeFlow asignado (para el código de desvío exacto).
    const { data: org } = await db.client.from('organizations')
      .select('name, owner_email, automation_config').eq('id', orgId).maybeSingle();
    if (!org) return { sent: false, reason: 'no_org' };
    const c = (org.automation_config && org.automation_config.config) || {};
    const to = c.notifyEmail || org.owner_email;
    if (!to) return { sent: false, reason: 'no_email' };
    const bizName = c.name || org.name || 'tu negocio';

    let nfNumber = null;
    try {
      const { data: pool } = await db.client.from('nf_phone_pool')
        .select('phone_number').eq('org_id', orgId).eq('status', 'assigned').maybeSingle();
      nfNumber = pool && pool.phone_number;
    } catch (_) {}

    const codes = nfNumber
      ? `<div style="background:#f6f8f6;border:1px solid #e3e8e3;border-radius:10px;padding:14px 16px;margin:14px 0">
           <div style="font-weight:700;font-size:13px;margin-bottom:6px">Reactivar el desvío desde tu móvil del negocio:</div>
           <div style="font-family:monospace;font-size:15px">**21*${_esc(nfNumber)}#</div>
           <div style="color:#888;font-size:12px;margin-top:6px">(desvía todas las llamadas; para desviar solo cuando no contestas: <span style="font-family:monospace">**61*${_esc(nfNumber)}#</span>)</div>
         </div>`
      : '';

    await sendEmail({
      to,
      subject: `⚠️ ${bizName}: tu asistente no recibe llamadas desde hace 2 días`,
      text: `Tu asistente de NodeFlow no recibe llamadas desde hace 2 días. Lo más probable es que el desvío de tu teléfono se haya desactivado.${nfNumber ? ` Para reactivarlo marca **21*${nfNumber}# desde el móvil del negocio.` : ''} Si lo desactivaste a propósito, ignora este aviso. ¿Dudas? Responde a este email.`,
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
          <h2 style="margin:0 0 8px">⚠️ Tu asistente no recibe llamadas</h2>
          <p style="font-size:14px;line-height:1.6;color:#444">Hola — somos NodeFlow. El asistente de <strong>${_esc(bizName)}</strong> venía atendiendo llamadas y lleva <strong>2 días sin recibir ninguna</strong>. Lo más habitual: el desvío del teléfono se desactivó sin querer (pasa al reiniciar el móvil o cambiar de operador).</p>
          ${codes}
          <p style="font-size:13px;color:#666;line-height:1.6">Haz una llamada de prueba a tu número después de marcar el código: debería contestar tu asistente. Si lo desactivaste a propósito, ignora este aviso. Y si algo no cuadra, responde a este email y lo miramos.</p>
          <p style="color:#999;font-size:12px;margin-top:18px">NodeFlow — tu recepcionista 24/7</p>
        </div>`,
    });

    // Marca el aviso (merge para no pisar reglas/otras reservadas).
    cfg._lastSilenceAlert = new Date(now).toISOString();
    await db.client.from('org_reminder_config')
      .upsert({ org_id: orgId, config: cfg, updated_at: new Date(now).toISOString() }, { onConflict: 'org_id' });
    log.info(`Aviso de silencio enviado al dueño de ${orgId} (${to})`);
    return { sent: true };
  } catch (e) {
    log.warn(`notifySilentOwner(${orgId}): ${e.message}`);
    return { sent: false, reason: e.message };
  }
}

// ── Cron: cada día 09:30 Madrid (tras el ciclo de mejora) ────────────────────
let _interval = null, _lastRun = null;
function startClientHealthCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!require('../utils/leader').isLeader()) return; // multi-réplica: solo el líder
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

module.exports = { computeClientHealth, prescribe, notifySilentOwner, runClientHealthCheck, startClientHealthCron, stopClientHealthCron };
