// ============================================================
// NodeFlow — WhatsApp to Clients (Meta Cloud API)
// Different from whatsapp.js (Callmebot) which only alerts owner.
// Env vars: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN
// Setup: Meta Business Manager → WhatsApp Product → Phone Number
// ============================================================

const https  = require('https');
const { Logger } = require('../utils/logger');

const log = new Logger('CLIENT-WA');

const META_API_VERSION = 'v19.0';
const META_API_BASE    = 'graph.facebook.com';

function isConfigured() {
  return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);
}

/**
 * Send a WhatsApp template message to a client.
 * Templates must be pre-approved by Meta (category: UTILITY).
 *
 * @param {string} phone  - International format without +: "34612345678"
 * @param {string} templateName - Approved template name
 * @param {string} languageCode - "es" | "eu" | "gl"
 * @param {Array}  components   - Template variable components
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
function sendTemplate(phone, templateName, languageCode, components = []) {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      log.warn('WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not set — WA skipped');
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const accessToken   = process.env.WA_ACCESS_TOKEN;

    // Normalize phone: strip spaces, dashes, +
    let normalizedPhone = String(phone).replace(/[\s\-+() ]/g, '');
    if (normalizedPhone.startsWith('00')) normalizedPhone = normalizedPhone.slice(2);
    if (normalizedPhone.length === 9) normalizedPhone = '34' + normalizedPhone;

    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to:                normalizedPhone,
      type:              'template',
      template: {
        name:     templateName,
        language: { code: languageCode || 'es' },
        components,
      },
    });

    const options = {
      hostname: META_API_BASE,
      path:     `/${META_API_VERSION}/${phoneNumberId}/messages`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200 && json.messages?.[0]?.id) {
            log.info(`WA sent to ${normalizedPhone} (template: ${templateName})`);
            resolve({ ok: true, messageId: json.messages[0].id });
          } else {
            const errMsg = json.error?.message || `HTTP ${res.statusCode}`;
            log.warn(`WA failed to ${normalizedPhone}: ${errMsg}`);
            resolve({ ok: false, error: errMsg });
          }
        } catch (e) {
          log.warn(`WA parse error: ${e.message}`);
          resolve({ ok: false, error: e.message });
        }
      });
    });

    req.on('error', (e) => {
      log.warn(`WA request error: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send a free-text WhatsApp message.
 * Only works within 24h of the last client-initiated message.
 * For lifecycle reminders (business-initiated) use sendTemplate instead.
 */
function sendText(phone, text) {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      return resolve({ ok: false, reason: 'not_configured' });
    }

    let normalizedPhone = String(phone).replace(/[\s\-+() ]/g, '');
    if (normalizedPhone.startsWith('00')) normalizedPhone = normalizedPhone.slice(2);
    if (normalizedPhone.length === 9) normalizedPhone = '34' + normalizedPhone;
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to:   normalizedPhone,
      type: 'text',
      text: { body: text },
    });

    const options = {
      hostname: META_API_BASE,
      path:     `/${META_API_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      method:   'POST',
      headers:  {
        'Authorization':  `Bearer ${process.env.WA_ACCESS_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200 && json.messages?.[0]?.id) {
            log.info(`WA text sent to ${normalizedPhone}`);
            resolve({ ok: true, messageId: json.messages[0].id });
          } else {
            const errMsg = json.error?.message || `HTTP ${res.statusCode}`;
            log.warn(`WA text failed to ${normalizedPhone}: ${errMsg}`);
            resolve({ ok: false, error: errMsg });
          }
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.on('error', (e) => {
      log.warn(`WA text request error: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTemplate, sendText, isConfigured };
