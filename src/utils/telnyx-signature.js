'use strict';
// ============================================================
// NodeFlow — Verificación de firma de webhooks de Telnyx (Ed25519)
//
// Telnyx firma cada webhook con Ed25519 sobre `${timestamp}|${cuerpo_crudo}` y
// manda la firma en la cabecera `telnyx-signature-ed25519` + `telnyx-timestamp`.
// La clave pública (base64, 32 bytes crudos) se saca del portal de Telnyx.
//
// OPT-IN y FAIL-OPEN: sin TELNYX_PUBLIC_KEY en el entorno NO se verifica (se
// comporta como hasta ahora → no rompe el deploy actual ni la entrada de
// llamadas). Al poner la clave, se exige firma válida. Así se activa cuando se
// valide con una llamada real, sin riesgo.
// ============================================================

const crypto = require('crypto');

// Prefijo SPKI DER de una clave pública Ed25519 (para envolver los 32 bytes crudos
// que da Telnyx y que crypto.createPublicKey pueda cargarla).
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verifica una firma Ed25519 de Telnyx (pura, testeable).
 * @param {string} pubB64  clave pública base64 (32 bytes crudos)
 * @param {string} sigB64  firma base64 de la cabecera telnyx-signature-ed25519
 * @param {string} timestamp cabecera telnyx-timestamp
 * @param {string} rawBody cuerpo crudo de la request (tal cual llegó)
 * @returns {boolean}
 */
function verifyEd25519(pubB64, sigB64, timestamp, rawBody) {
  if (!pubB64 || !sigB64 || !timestamp) return false;
  try {
    const der = Buffer.concat([SPKI_PREFIX, Buffer.from(pubB64, 'base64')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const signed = Buffer.from(`${timestamp}|${rawBody != null ? rawBody : ''}`, 'utf8');
    return crypto.verify(null, signed, key, Buffer.from(sigB64, 'base64'));
  } catch (_) {
    return false;
  }
}

/**
 * Verifica una request de Telnyx (Express). OPT-IN: sin publicKey → true.
 * @param {object} req  request de Express (usa req.get y req.rawBody)
 * @param {object} [opts] { publicKey } para tests
 * @returns {boolean} true = aceptar; false = rechazar (403)
 */
function verifyTelnyxRequest(req, { publicKey = process.env.TELNYX_PUBLIC_KEY } = {}) {
  if (!publicKey) return true; // opt-in: sin clave configurada, no se verifica
  const get = (h) => (typeof req.get === 'function' ? req.get(h) : (req.headers || {})[h]);
  const sig = get('telnyx-signature-ed25519');
  const ts  = get('telnyx-timestamp');
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  return verifyEd25519(publicKey, sig, ts, raw);
}

module.exports = { verifyEd25519, verifyTelnyxRequest, SPKI_PREFIX };
