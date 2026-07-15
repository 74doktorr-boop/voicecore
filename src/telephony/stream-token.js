'use strict';
// ============================================================
// NodeFlow — Token efímero para autenticar el WebSocket de media-stream.
// Auditoría de seguridad 2026-07-16: /telnyx-stream aceptaba conexiones SIN
// autenticación → cualquiera arrancaba un pipeline STT+LLM+TTS con el
// assistantId de la víctima (vaciado de APIs + inyección de audio + DoS).
//
// La URL del <Stream> la genera el webhook /voice/telnyx, que SÍ va firmado por
// Telnyx. Ese webhook incrusta un token HMAC de vida corta; el handler de
// upgrade lo valida antes de aceptar el WS. Así solo los streams nacidos de un
// webhook legítimo (verificado) pueden conectar.
// ============================================================
const crypto = require('crypto');

// Secreto compartido: JWT_SECRET/STREAM_SECRET (env → válido entre réplicas).
// Si falta, uno aleatorio por-proceso: seguro con 1 réplica (webhook y WS caen
// en el mismo proceso); multi-réplica necesita el env.
let _secret = process.env.STREAM_SECRET || process.env.JWT_SECRET || null;
let _ephemeral = false;
if (!_secret) { _secret = crypto.randomBytes(32).toString('hex'); _ephemeral = true; }

const TTL_MS = 120000; // el stream conecta segundos después del webhook

function mintStreamToken() {
  const exp = Date.now() + TTL_MS;
  const mac = crypto.createHmac('sha256', _secret).update(String(exp)).digest('base64url');
  return `${exp}.${mac}`;
}

function verifyStreamToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = token.slice(0, dot), mac = token.slice(dot + 1);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  const good = crypto.createHmac('sha256', _secret).update(exp).digest('base64url');
  try {
    const a = Buffer.from(mac), b = Buffer.from(good);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

function usesEphemeralSecret() { return _ephemeral; }

module.exports = { mintStreamToken, verifyStreamToken, usesEphemeralSecret };
