'use strict';
// ============================================================
// NodeFlow — Cifrado simétrico de secretos en reposo (AES-256-GCM).
// Para tokens OAuth de terceros (Google Calendar, Outlook) y cualquier secreto
// que se guarde en la BD. Auditoría de seguridad 2026-07-16 + requisito de
// verificación OAuth de Google ("Data Protection"): los tokens de calendario se
// guardaban EN CLARO; con esto quedan cifrados en reposo.
//
// TOLERANTE A TEXTO PLANO (migración sin dolor): decryptSecret sobre un valor
// no cifrado (sin el formato iv:tag:data) lo devuelve tal cual, así los tokens
// antiguos en la BD siguen funcionando hasta que se re-escriban ya cifrados.
// ============================================================
const crypto = require('crypto');
const { Logger } = require('./logger');
const log = new Logger('CRYPTO');

const ALGORITHM = 'aes-256-gcm';
const _IS_PROD = process.env.NODE_ENV === 'production';

function _key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length === 44) return Buffer.from(raw, 'base64');
  if (_IS_PROD) { log.error('ENCRYPTION_KEY inválida (64-hex o 44-base64) — cifrado deshabilitado'); return null; }
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8'); // solo dev
}

// Cifra un secreto. Fail-closed en producción: nunca guarda en claro sin avisar.
function encryptSecret(text) {
  if (text == null || text === '') return text;
  const key = _key();
  if (!key) {
    if (_IS_PROD) throw new Error('ENCRYPTION_KEY no configurada — no se cifra en producción (fail-closed)');
    return text; // dev sin clave
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

// Descifra. Valor no cifrado (legacy plano) → se devuelve tal cual (migración).
function decryptSecret(stored) {
  if (stored == null || stored === '') return stored;
  const parts = String(stored).split(':');
  if (parts.length !== 3) return stored; // texto plano legacy → passthrough
  const key = _key();
  if (!key) return stored;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    log.warn(`decryptSecret: fallo de descifrado — ${e.message}`);
    return null; // parecía cifrado pero no valida → no devolver basura
  }
}

module.exports = { encryptSecret, decryptSecret };
