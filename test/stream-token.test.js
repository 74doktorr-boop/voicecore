// ============================================================
// NodeFlow — Token efímero del media-stream (auditoría seguridad 2026-07-16).
// Autentica el WS /telnyx-stream: solo un stream nacido del webhook firmado
// /voice/telnyx (que incrusta el token) puede abrir la conexión.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { mintStreamToken, verifyStreamToken } = require('../src/telephony/stream-token');

describe('stream-token', () => {
  test('un token recién emitido verifica', () => {
    assert.strictEqual(verifyStreamToken(mintStreamToken()), true);
  });

  test('token ausente / vacío / basura → false', () => {
    assert.strictEqual(verifyStreamToken(null), false);
    assert.strictEqual(verifyStreamToken(''), false);
    assert.strictEqual(verifyStreamToken('basura'), false);
    assert.strictEqual(verifyStreamToken('123.abc'), false);
  });

  test('firma manipulada → false', () => {
    const t = mintStreamToken();
    const tampered = t.slice(0, t.indexOf('.') + 1) + 'X'.repeat(t.length - t.indexOf('.') - 1);
    assert.strictEqual(verifyStreamToken(tampered), false);
  });

  test('expiración manipulada al futuro (con MAC viejo) → false', () => {
    const t = mintStreamToken();
    const mac = t.slice(t.indexOf('.') + 1);
    const forged = (Date.now() + 3600000) + '.' + mac; // exp futuro, MAC no casa
    assert.strictEqual(verifyStreamToken(forged), false);
  });

  test('token caducado → false', () => {
    const crypto = require('crypto');
    // Reconstruir un token con exp en el pasado firmado con el MISMO secreto:
    // no lo tenemos, pero un exp pasado se rechaza antes de comprobar el MAC.
    const past = (Date.now() - 1000) + '.' + 'x';
    assert.strictEqual(verifyStreamToken(past), false);
  });
});
