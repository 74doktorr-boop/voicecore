// ============================================
// NodeFlow — WhatsApp alerts via Callmebot
// ============================================
// Setup (one-time, por el receptor):
//   1. Añadir +34 644 52 70 22 en WhatsApp
//   2. Enviar el mensaje: "I allow callmebot to send me messages"
//   3. Recibirás tu API key por WhatsApp
//   4. Añadir en EasyPanel: CALLMEBOT_PHONE + CALLMEBOT_API_KEY
// ============================================

const https = require('https');
const { Logger } = require('../utils/logger');

const log = new Logger('WHATSAPP');

/**
 * Sends a WhatsApp message via Callmebot API.
 * Fire-and-forget friendly — returns a promise but won't throw.
 */
function sendWhatsApp(text) {
  return new Promise((resolve) => {
    const phone  = process.env.CALLMEBOT_PHONE;
    const apiKey = process.env.CALLMEBOT_API_KEY;

    if (!phone || !apiKey) {
      log.warn('CALLMEBOT_PHONE o CALLMEBOT_API_KEY no configurados — WA omitido');
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const encoded = encodeURIComponent(text);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 200) {
          log.info('WhatsApp enviado OK');
          resolve({ ok: true });
        } else {
          log.warn(`Callmebot respondió ${res.statusCode}: ${body.slice(0, 100)}`);
          resolve({ ok: false, status: res.statusCode });
        }
      });
    }).on('error', (e) => {
      log.warn(`Error enviando WhatsApp: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });
  });
}

/**
 * Formatted alert for a new lead.
 * Keeps it short — WhatsApp messages are for quick glance.
 */
function notifyLeadWhatsApp(registro) {
  const { negocio, ciudad, telefono, plan, coupon_code, discount_percent, source } = registro;

  const planLabel = plan === 'pro' ? '🚀 Pro (€99/mes)' : '💼 Negocio (€49/mes)';
  const cupon = coupon_code ? `\n🎟️ Cupón: ${coupon_code} (-${discount_percent}%)` : '';
  const src   = source     ? `\n📍 Fuente: ${source}` : '';

  const msg =
    `🔔 *NUEVO LEAD — NodeFlow*\n` +
    `━━━━━━━━━━━━━━\n` +
    `🏢 ${negocio}\n` +
    `📍 ${ciudad}\n` +
    `📞 ${telefono}\n` +
    `💳 ${planLabel}` +
    cupon +
    src +
    `\n━━━━━━━━━━━━━━\n` +
    `👉 Llamar: https://wa.me/34${telefono.replace(/\D/g, '')}`;

  return sendWhatsApp(msg);
}

module.exports = { sendWhatsApp, notifyLeadWhatsApp };
