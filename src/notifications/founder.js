// ============================================================
// NodeFlow — Aviso al FUNDADOR (Unai), no al dueño del negocio
// ------------------------------------------------------------
// Un único punto para "que a Unai le llegue X": doble canal
// best-effort — WhatsApp (CallMeBot, para el vistazo rápido) +
// email (NOTIFY_EMAIL, con el detalle). Nunca lanza; si un canal
// no está configurado, se omite y sigue.
//
// Uso: notifyFounder({ subject, text, html? })
//   · text  → cuerpo del WhatsApp y del email (y del HTML si no se pasa html)
//   · html  → opcional, para un email con formato
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('FOUNDER-NOTIFY');

function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function notifyFounder({ subject, text, html } = {}) {
  const body = text || subject || '';
  const out = { whatsapp: false, email: false };

  // 1) WhatsApp al fundador (CallMeBot). Fail-open dentro de sendWhatsApp.
  try {
    const { sendWhatsApp } = require('./whatsapp');
    const wa = await sendWhatsApp(body);
    out.whatsapp = !!(wa && wa.ok);
  } catch (e) { log.warn(`WhatsApp al fundador falló: ${e.message}`); }

  // 2) Email al fundador (NOTIFY_EMAIL).
  try {
    const to = process.env.NOTIFY_EMAIL;
    if (to) {
      const { sendEmail } = require('./email');
      await sendEmail({
        to,
        subject: subject || 'Aviso NodeFlow',
        text: body,
        html: html || `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;white-space:pre-wrap;font-size:14px;color:#1a1a2e">${_esc(body)}</div>`,
      });
      out.email = true;
    }
  } catch (e) { log.warn(`Email al fundador falló: ${e.message}`); }

  return out;
}

module.exports = { notifyFounder };
