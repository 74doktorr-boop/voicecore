// ============================================================
// NodeFlow — Alerta al fundador: el producto se autodiagnostica
// "El cliente nunca debería reportar un bug: la plataforma lo
// detecta primero." Cuando una llamada sale MAL (score bajo,
// alucinación, cliente insatisfecho), NodeFlow avisa al fundador
// por email ANTES de que el negocio se queje. Fire-and-forget.
// ============================================================
'use strict';

const { sendEmail } = require('./email');
const { Logger } = require('../utils/logger');

const log = new Logger('FOUNDER-ALERT');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ¿Merece alerta? Determinista y documentado. */
function shouldAlert(callData, audit) {
  const m = callData?.metrics || {};
  const detScore = m.quality?.score;
  return Boolean(
    // 1) Veredicto del auditor IA
    (audit && (audit.score < 60 || audit.hallucinated === true || audit.customer_satisfied === false)) ||
    // 2) Score determinista de calidad
    (typeof detScore === 'number' && detScore < 60) ||
    // 3) Señales DETERMINISTAS de fallo (no dependen del auditor IA — la
    //    llamada real de fisioterapia unai las tenía todas y NO alertó,
    //    2026-07): el bot se rindió y tomó recado, repitió "no te he
    //    escuchado" varias veces, o se atascó pidiendo repetición. Estas
    //    SIEMPRE merecen que el fundador lo sepa, en cualquier sector.
    m.escalatedTakeMessage === true ||
    (typeof m.recoveries === 'number' && m.recoveries >= 2) ||
    (typeof m.clarifications === 'number' && m.clarifications >= 3)
  );
}

async function sendFounderAlert(callData, audit, config = {}) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) { log.warn('NOTIFY_EMAIL no configurado — alerta omitida'); return false; }

  const q = callData?.metrics?.quality || {};
  const problems = (audit?.problems || []).map(p => `<li>${esc(p)}</li>`).join('') || '<li>—</li>';
  const improvements = (audit?.improvements || []).map(p => `<li>${esc(p)}</li>`).join('') || '<li>—</li>';
  const transcriptHtml = (callData?.transcript || []).slice(0, 20)
    .map(t => `<div><b>${t.role === 'assistant' ? '🤖' : '👤'}</b> ${esc(t.content)}</div>`).join('');

  const subject = `⚠️ Llamada con problemas — ${esc(config.name || callData?.businessId || 'negocio')} (auditor ${audit?.score ?? '—'}/100)`;
  const html = `
    <h2>⚠️ NodeFlow ha detectado una llamada mala</h2>
    <p><b>Negocio:</b> ${esc(config.name || callData?.businessId)} · <b>Llamada:</b> ${esc(callData?.id)}<br>
    <b>Resultado:</b> ${esc(callData?.outcome)} · <b>Duración:</b> ${Math.round((callData?.duration || 0) / 1000)}s</p>
    <p><b>Score auditor IA:</b> ${audit?.score ?? '—'}/100 · <b>Score determinista:</b> ${q.score ?? '—'}/100<br>
    <b>Alucinación:</b> ${audit?.hallucinated ? 'SÍ 🔴' : 'no'} · <b>Cliente satisfecho:</b> ${audit?.customer_satisfied ? 'sí' : 'NO 🔴'} ·
    <b>Confianza STT media:</b> ${q.avgConfidence ?? '—'}<br>
    <b>Se rindió (tomó recado):</b> ${callData?.metrics?.escalatedTakeMessage ? 'SÍ 🔴' : 'no'} ·
    <b>Turnos "no te he escuchado":</b> ${callData?.metrics?.recoveries ?? 0}${(callData?.metrics?.recoveries || 0) >= 2 ? ' 🔴' : ''} ·
    <b>Peticiones de repetición:</b> ${callData?.metrics?.clarifications ?? 0}</p>
    <h3>Problemas</h3><ul>${problems}</ul>
    <h3>Mejoras sugeridas</h3><ul>${improvements}</ul>
    <h3>Transcripción</h3>${transcriptHtml}
    <p style="color:#888">Detectado automáticamente por el auditor de NodeFlow — nadie ha tenido que reportarlo.</p>`;

  try {
    await sendEmail({ to, subject, html });
    log.info(`[${callData?.id}] Alerta enviada al fundador (${to})`);
    return true;
  } catch (e) {
    log.warn(`[${callData?.id}] Alerta al fundador falló: ${e.message}`);
    return false;
  }
}

module.exports = { sendFounderAlert, shouldAlert };
