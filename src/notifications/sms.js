// ============================================================
// NodeFlow — SMS to Clients (Twilio)
// Fallback when WhatsApp is not available.
// Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// Note: SMS is independent of voice calls — works even if Vonage handles voice.
// ============================================================

const { Logger } = require('../utils/logger');

const log = new Logger('SMS');

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN  &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

/**
 * Send an SMS to a client via Twilio.
 * @param {string} phone - Client phone, any format (will normalize to E.164)
 * @param {string} text  - Message body (max 160 chars for single SMS)
 * @returns {Promise<{ok: boolean, sid?: string, error?: string}>}
 */
async function sendSMS(phone, text) {
  if (!isConfigured()) {
    log.warn('Twilio SMS not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER) — SMS skipped');
    return { ok: false, reason: 'not_configured' };
  }

  // Normalize to E.164: ensure starts with +34 for Spain if no country code
  let normalized = String(phone).replace(/[\s\-().]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = '+34' + normalized.replace(/^34/, '');
  }

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const message = await client.messages.create({
      body: text,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   normalized,
    });

    log.info(`SMS sent to ${normalized} (sid: ${message.sid})`);
    return { ok: true, sid: message.sid };
  } catch (err) {
    log.warn(`SMS failed to ${normalized}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSMS, isConfigured };
