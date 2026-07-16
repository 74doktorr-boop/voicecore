// ============================================================
// NodeFlow — Cifrado de secretos en reposo (src/utils/crypto.js).
// Tokens OAuth (Google/Outlook) cifrados AES-256-GCM. Migración sin dolor:
// descifrar un valor legacy en claro lo devuelve tal cual.
// ============================================================
'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

// Clave de prueba (64 hex = 32 bytes). Se pone ANTES de requerir el módulo.
const OLD = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const { encryptSecret, decryptSecret } = require('../src/utils/crypto');

describe('crypto util — cifrado de secretos en reposo', () => {
  test('roundtrip: cifrar y descifrar recupera el original', () => {
    const secret = 'ya29.a0AfB_byC-refresh-token-EJEMPLO';
    const enc = encryptSecret(secret);
    assert.notStrictEqual(enc, secret, 'el cifrado no es el texto plano');
    assert.match(enc, /^[^:]+:[^:]+:[^:]+$/, 'formato iv:tag:data');
    assert.strictEqual(decryptSecret(enc), secret);
  });

  test('cada cifrado usa IV distinto (no determinista)', () => {
    const s = 'mismo-token';
    assert.notStrictEqual(encryptSecret(s), encryptSecret(s));
  });

  test('MIGRACIÓN: descifrar un token legacy EN CLARO lo devuelve tal cual', () => {
    assert.strictEqual(decryptSecret('token-en-claro-sin-cifrar'), 'token-en-claro-sin-cifrar');
  });

  test('valor manipulado (parece cifrado pero no valida) → null, no basura', () => {
    const enc = encryptSecret('x');
    const parts = enc.split(':');
    const tampered = parts[0] + ':' + parts[1] + ':' + Buffer.from('otracosa').toString('base64');
    assert.strictEqual(decryptSecret(tampered), null);
  });

  test('null/vacío pasan sin romper', () => {
    assert.strictEqual(encryptSecret(null), null);
    assert.strictEqual(encryptSecret(''), '');
    assert.strictEqual(decryptSecret(null), null);
  });

  after(() => { if (OLD === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = OLD; });
});
