// ============================================
// NodeFlow IA — Health Monitor
// Comprueba el estado cada 5 min y alerta si cae
// ============================================

const { Logger } = require('../utils/logger');
const { sendEmail } = require('../notifications/email');

const log = new Logger('MONITOR');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // no repetir alerta en 30 min

let lastAlertAt = 0;
let consecutiveFailures = 0;
let monitorInterval = null;
let _warmupTimer = null;

async function checkHealth(publicUrl) {
  try {
    const url = `${publicUrl}/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Status: ${data.status}`);

    // Recuperado tras fallos
    if (consecutiveFailures > 0) {
      log.info(`✅ Servicio recuperado tras ${consecutiveFailures} fallo(s)`);
      await sendAlert('recovered', { failures: consecutiveFailures, data });
      consecutiveFailures = 0;
    }

    return true;
  } catch (e) {
    consecutiveFailures++;
    log.warn(`❌ Health check fallido (${consecutiveFailures}): ${e.message}`);

    // Alerta si 2+ fallos consecutivos y no se ha alertado recientemente
    if (consecutiveFailures >= 2 && Date.now() - lastAlertAt > ALERT_COOLDOWN_MS) {
      await sendAlert('down', { error: e.message, failures: consecutiveFailures });
      lastAlertAt = Date.now();
    }

    return false;
  }
}

async function sendAlert(type, info) {
  const notifyEmail = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
  const publicUrl = process.env.PUBLIC_URL || 'https://nodeflow.es';

  if (type === 'down') {
    await sendEmail({
      to: notifyEmail,
      subject: `🚨 NodeFlow IA CAÍDO — ${new Date().toLocaleTimeString('es-ES')}`,
      html: `
        <div style="font-family:sans-serif;max-width:500px;padding:24px;background:#1a0000;border-radius:12px;color:#fff;">
          <h2 style="color:#ff6b6b;">🚨 Servidor caído</h2>
          <p>El servidor de NodeFlow IA no responde.</p>
          <table style="width:100%;margin-top:12px;font-size:14px;">
            <tr><td style="color:#999;padding:4px 0;">URL</td><td>${publicUrl}</td></tr>
            <tr><td style="color:#999;padding:4px 0;">Error</td><td style="color:#ff6b6b;">${info.error}</td></tr>
            <tr><td style="color:#999;padding:4px 0;">Fallos consecutivos</td><td>${info.failures}</td></tr>
            <tr><td style="color:#999;padding:4px 0;">Hora</td><td>${new Date().toLocaleString('es-ES')}</td></tr>
          </table>
          <a href="https://xmehd4.easypanel.host" style="display:inline-block;margin-top:16px;background:#6c5ce7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">
            Abrir EasyPanel →
          </a>
        </div>
      `,
      text: `🚨 NodeFlow IA caído. Error: ${info.error}. Fallos: ${info.failures}. Hora: ${new Date().toLocaleString('es-ES')}`,
    });
  }

  if (type === 'recovered') {
    await sendEmail({
      to: notifyEmail,
      subject: `✅ NodeFlow IA recuperado — ${new Date().toLocaleTimeString('es-ES')}`,
      html: `<div style="font-family:sans-serif;padding:24px;"><h2 style="color:#00cec9;">✅ Servicio recuperado</h2><p>NodeFlow IA vuelve a estar online tras ${info.failures} fallo(s).</p></div>`,
      text: `✅ NodeFlow IA recuperado tras ${info.failures} fallo(s).`,
    });
  }
}

function startMonitor(publicUrl) {
  if (monitorInterval) return;
  const url = publicUrl || process.env.PUBLIC_URL || 'https://nodeflow.es';

  log.info(`Monitor iniciado — check cada 5 min → ${url}/health`);

  // Primera comprobación al arrancar (con delay de 30s para que el servidor esté listo)
  _warmupTimer = setTimeout(() => checkHealth(url), 30000);

  monitorInterval = setInterval(() => checkHealth(url), CHECK_INTERVAL_MS);
}

function stopMonitor() {
  if (_warmupTimer) {
    clearTimeout(_warmupTimer);
    _warmupTimer = null;
  }
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

module.exports = { startMonitor, stopMonitor, checkHealth };
