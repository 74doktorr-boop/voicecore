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
// 360dialog usa base URL diferente cuando el negocio tiene WABA propio
const DIALOG360_API_BASE = 'waba.360dialog.io';

function isConfigured() {
  return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);
}

/**
 * Send a WhatsApp template message to a client.
 * Templates must be pre-approved by Meta (category: UTILITY).
 *
 * @param {string} phone         - International format without +: "34612345678"
 * @param {string} templateName  - Approved template name
 * @param {string} languageCode  - "es" | "eu" | "gl"
 * @param {Array}  components    - Template variable components
 * @param {object} [credentials] - Optional: { phoneNumberId, accessToken, apiBase }
 *   Si se pasa, usa las credenciales del negocio (multi-tenant).
 *   Si no, usa las env vars globales (NodeFlow propio).
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
function sendTemplate(phone, templateName, languageCode, components = [], credentials = null) {
  return new Promise((resolve) => {
    // Determinar credenciales: negocio propio > env vars globales
    const phoneNumberId = credentials?.phoneNumberId || process.env.WA_PHONE_NUMBER_ID;
    const accessToken   = credentials?.accessToken   || process.env.WA_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      log.warn('WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not set — WA skipped');
      return resolve({ ok: false, reason: 'not_configured' });
    }

    // 360dialog: auth via D360-API-KEY header; Meta: Bearer token
    const is360dialog = !!(credentials?.apiBase?.includes('360dialog'));
    const hostname    = is360dialog ? DIALOG360_API_BASE : META_API_BASE;

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
      hostname,
      path:    is360dialog
        ? `/v1/messages`                                      // 360dialog path
        : `/${META_API_VERSION}/${phoneNumberId}/messages`,  // Meta Cloud API path
      method:  'POST',
      headers: {
        ...(is360dialog
          ? { 'D360-API-KEY': accessToken }                  // 360dialog auth
          : { 'Authorization': `Bearer ${accessToken}` }),   // Meta auth
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
 *
 * @param {string} phone
 * @param {string} text
 * @param {object} [credentials] - Optional: { phoneNumberId, accessToken, apiBase }
 */
function sendText(phone, text, credentials = null) {
  return new Promise((resolve) => {
    const phoneNumberId = credentials?.phoneNumberId || process.env.WA_PHONE_NUMBER_ID;
    const accessToken   = credentials?.accessToken   || process.env.WA_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const is360dialog = !!(credentials?.apiBase?.includes('360dialog'));
    const hostname    = is360dialog ? DIALOG360_API_BASE : META_API_BASE;

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
      hostname,
      path:    is360dialog
        ? `/v1/messages`
        : `/${META_API_VERSION}/${phoneNumberId}/messages`,
      method:  'POST',
      headers: {
        ...(is360dialog
          ? { 'D360-API-KEY': accessToken }
          : { 'Authorization': `Bearer ${accessToken}` }),
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
