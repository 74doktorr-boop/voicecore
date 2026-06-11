// ============================================================
// NodeFlow — Error Tracker
// Captura errores no manejados a nivel de proceso y de Express,
// los registra y alerta por email (rate-limited para no inundar).
//
// Filosofía:
//   - unhandledRejection → log + alerta, NO se cae (recuperable)
//   - uncaughtException   → log + alerta + salida limpia (el contenedor
//     reinicia; continuar tras un uncaughtException deja el proceso en
//     estado indefinido y es peligroso)
//   - errores de Express  → log con contexto de la petición + 500 limpio
//
// Las alertas se agrupan: máx 1 email por tipo de error cada 15 min,
// con un contador de cuántas veces ocurrió en la ventana.
// ============================================================

'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('ERROR-TRACKER');

const ALERT_WINDOW_MS = 15 * 60 * 1000; // 1 alerta por firma cada 15 min
// firma del error → { lastAlertAt, countSinceAlert }
const _alertState = new Map();

// Poda de firmas viejas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _alertState) {
    if (now - v.lastAlertAt > ALERT_WINDOW_MS * 4) _alertState.delete(k);
  }
}, 30 * 60 * 1000).unref();

/** Firma estable de un error para agrupar repeticiones. */
function signature(err, context = '') {
  const msg = (err && err.message) || String(err);
  // Primera línea del stack (dónde ocurrió) para distinguir orígenes
  const where = (err && err.stack ? err.stack.split('\n')[1] || '' : '').trim();
  return `${context}|${msg}|${where}`.slice(0, 200);
}

/**
 * Registra y (si procede) alerta de un error.
 * @param {Error} err
 * @param {string} kind  — 'unhandledRejection' | 'uncaughtException' | 'express' | string
 * @param {object} [meta] — contexto extra (ruta, método, etc.)
 */
async function capture(err, kind = 'error', meta = {}) {
  const sig = signature(err, kind);
  log.error(`[${kind}] ${err?.message || err}`, { stack: err?.stack, ...meta });

  const now = Date.now();
  let state = _alertState.get(sig);

  if (state && now - state.lastAlertAt < ALERT_WINDOW_MS) {
    // Dentro de la ventana → sólo contar, no enviar otro email
    state.countSinceAlert++;
    return;
  }

  const repeated = state ? state.countSinceAlert : 0;
  _alertState.set(sig, { lastAlertAt: now, countSinceAlert: 0 });

  // Enviar alerta (no bloqueante, tolerante a fallos)
  try {
    const { sendEmail } = require('../notifications/email');
    const notifyEmail = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
    const when = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
    const metaRows = Object.entries(meta)
      .map(([k, v]) => `<tr><td style="color:#999;padding:2px 8px 2px 0;">${esc(k)}</td><td>${esc(String(v))}</td></tr>`)
      .join('');

    await sendEmail({
      to: notifyEmail,
      subject: `⚠️ NodeFlow error [${kind}] — ${(err?.message || String(err)).slice(0, 60)}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;padding:24px;background:#16101a;border-radius:12px;color:#eee;">
          <h2 style="color:#fdcb6e;margin:0 0 8px;">⚠️ Error capturado — ${esc(kind)}</h2>
          <p style="color:#aaa;font-size:13px;margin:0 0 16px;">${esc(when)} (Madrid)${repeated > 0 ? ` · se repitió ${repeated} vez(es) en la ventana anterior` : ''}</p>
          <div style="background:#0c0810;border-radius:8px;padding:14px;font-family:monospace;font-size:12px;color:#ff9b9b;white-space:pre-wrap;word-break:break-word;">${esc(err?.message || String(err))}</div>
          ${metaRows ? `<table style="margin-top:12px;font-size:12px;">${metaRows}</table>` : ''}
          ${err?.stack ? `<details style="margin-top:12px;"><summary style="cursor:pointer;color:#888;font-size:12px;">Stack trace</summary><pre style="font-size:11px;color:#888;white-space:pre-wrap;word-break:break-word;">${esc(err.stack)}</pre></details>` : ''}
          <p style="color:#666;font-size:11px;margin-top:16px;">Las repeticiones de este mismo error se agrupan: máx 1 email cada 15 min.</p>
        </div>`,
      text: `Error [${kind}] en NodeFlow: ${err?.message || err}\n${when}\n\n${err?.stack || ''}`,
    });
  } catch (e) {
    log.warn(`No se pudo enviar alerta de error: ${e.message}`);
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Instala los handlers a nivel de proceso. Llamar una vez en server.js. */
function installProcessHandlers({ onFatal } = {}) {
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    capture(err, 'unhandledRejection').catch(() => {});
    // No se cae — una promesa rechazada no debe tumbar todas las llamadas activas
  });

  process.on('uncaughtException', (err) => {
    capture(err, 'uncaughtException').catch(() => {});
    log.error('uncaughtException — cerrando ordenadamente para que el contenedor reinicie');
    // Dar 1.5s para que la alerta salga, luego salir (el orquestador reinicia)
    setTimeout(() => {
      try { if (typeof onFatal === 'function') onFatal(); } catch (_) {}
      process.exit(1);
    }, 1500);
  });

  log.info('Process error handlers instalados (unhandledRejection + uncaughtException)');
}

/** Middleware de Express para errores en rutas. Montar al final, después de las rutas. */
function expressErrorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    capture(err, 'express', {
      method: req.method,
      path:   req.originalUrl || req.url,
      ip:     req.ip,
    }).catch(() => {});
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: 'Error interno del servidor' });
  };
}

module.exports = { capture, installProcessHandlers, expressErrorHandler };
