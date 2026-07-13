'use strict';
// ============================================================
// NodeFlow — Canal SMS (Telnyx Messaging API)
// ------------------------------------------------------------
// Respaldo de avisos para clientes CON teléfono pero SIN WhatsApp ni
// email — el hueco típico del cliente mayor. Reutiliza la misma cuenta
// Telnyx que ya usamos para voz; sólo cambia el endpoint (/v2/messages).
//
// (Antes: Twilio. Migrado a Telnyx — Twilio quedó descartado y evitamos
// arrastrar su SDK. Se conservan los nombres de export `sendSMS` /
// `isConfigured` para no tocar quien ya los usa: lifecycle/scheduler y
// el estado del portal.)
//
// APAGADO POR DEFECTO. Se enciende SOLO cuando el servidor tiene:
//   SMS_ENABLED=true
//   TELNYX_API_KEY=...            (ya existe para voz)
//   SMS_FROM=NodeFlow             (sender ID alfanumérico) o un +34… propio
//   SMS_MESSAGING_PROFILE_ID=...  (obligatorio si SMS_FROM es alfanumérico)
//
// Mientras no esté configurado, isConfigured() = false y sendSMS() es un
// no-op inmediato: NADA del camino crítico del lanzamiento se ve afectado.
//
// Todo FAIL-OPEN: un fallo de SMS jamás rompe el flujo que lo invoca.
// ============================================================

const { Logger } = require('../utils/logger');
const { normalizeE164 } = require('../telephony/outbound');

const log = new Logger('SMS');

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

// Un sender alfanumérico ("NodeFlow") EXIGE messaging_profile_id en Telnyx;
// un remitente numérico (+34…) puede ir solo. Detectamos el caso.
function _isAlphanumericSender(from) {
  return !!from && /[a-zA-Z]/.test(String(from));
}

/**
 * ¿Está el canal SMS activo en este servidor? OFF salvo opt-in explícito.
 * @returns {boolean}
 */
function isConfigured() {
  if (process.env.SMS_ENABLED !== 'true') return false;
  const apiKey = process.env.TELNYX_API_KEY;
  const from   = process.env.SMS_FROM;
  if (!apiKey || !from) return false;
  // Sender alfanumérico sin messaging profile → Telnyx lo rechaza: no activar.
  if (_isAlphanumericSender(from) && !process.env.SMS_MESSAGING_PROFILE_ID) return false;
  return true;
}

/**
 * Envía un SMS por Telnyx. Fail-open: nunca lanza, devuelve {ok:false} ante
 * cualquier problema. No-op inmediato si el canal no está activo.
 * @param {string} phone teléfono destino, cualquier formato (se normaliza a E.164)
 * @param {string} text  cuerpo del mensaje (texto plano)
 * @param {object} [deps] inyección para test: { fetch }
 * @returns {Promise<{ok:boolean, sid?:string, error?:string}>}
 */
async function sendSMS(phone, text, deps = {}) {
  if (!isConfigured()) {
    return { ok: false, error: 'not_configured' };
  }

  const safeTo = normalizeE164(phone);
  if (!safeTo) return { ok: false, error: 'destino no válido' };
  if (!text || !String(text).trim()) return { ok: false, error: 'texto vacío' };

  const apiKey    = process.env.TELNYX_API_KEY;
  const from      = process.env.SMS_FROM;
  const profileId = process.env.SMS_MESSAGING_PROFILE_ID || null;
  const _fetch    = deps.fetch || fetch;

  const body = { from, to: safeTo, text: String(text).slice(0, 1530) };
  if (profileId) body.messaging_profile_id = profileId;

  try {
    const resp = await _fetch(TELNYX_MESSAGES_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const detail = data.errors ? data.errors.map(e => e.detail || e.title).join('; ') : `HTTP ${resp.status}`;
      log.warn(`SMS a ${safeTo} rechazado: ${detail}`);
      return { ok: false, error: detail };
    }
    const sid = (data.data && data.data.id) || null;
    log.info(`SMS enviado → ${safeTo}${sid ? ' (' + sid + ')' : ''}`);
    return { ok: true, sid };
  } catch (e) {
    log.warn(`SMS a ${safeTo} falló: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Alias de nombres más nuevos por claridad; misma implementación.
const isSmsEnabled = isConfigured;
const sendSms      = sendSMS;

module.exports = { sendSMS, isConfigured, sendSms, isSmsEnabled, _isAlphanumericSender };
