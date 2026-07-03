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
  const detScore = callData?.metrics?.quality?.score;
  return Boolean(
    (audit && (audit.score < 60 || audit.hallucinated === true || audit.customer_satisfied === false)) ||
    (typeof detScore === 'number' && detScore < 60)
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
    <b>Confianza STT media:</b> ${q.avgConfidence ?? '—'}</p>
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
