// ============================================================
// NodeFlow — Firma Ed25519 de webhooks de Telnyx (seguridad, auditoría 20/07)
// Genera un par de claves real y comprueba que la verificación acepta una
// firma legítima y rechaza cualquier manipulación. Opt-in verificado.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyEd25519, verifyTelnyxRequest } = require('../src/utils/telnyx-signature');

// Par de claves Ed25519 + la pública en el formato que da Telnyx (32 bytes b64).
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }); // 12 prefijo + 32 clave
  const pubB64 = spki.subarray(12).toString('base64');
  return { privateKey, pubB64 };
}
const sign = (privateKey, ts, body) =>
  crypto.sign(null, Buffer.from(`${ts}|${body}`, 'utf8'), privateKey).toString('base64');

describe('verifyEd25519 (firma Telnyx)', () => {
  test('firma legítima → acepta', () => {
    const { privateKey, pubB64 } = keypair();
    const ts = '1720000000', body = '{"event_type":"call.initiated"}';
    const sig = sign(privateKey, ts, body);
    assert.strictEqual(verifyEd25519(pubB64, sig, ts, body), true);
  });

  test('cuerpo manipulado → rechaza', () => {
    const { privateKey, pubB64 } = keypair();
    const ts = '1720000000';
    const sig = sign(privateKey, ts, 'original');
    assert.strictEqual(verifyEd25519(pubB64, sig, ts, 'ALTERADO'), false);
  });

  test('timestamp manipulado → rechaza', () => {
    const { privateKey, pubB64 } = keypair();
    const sig = sign(privateKey, '111', 'x');
    assert.strictEqual(verifyEd25519(pubB64, sig, '222', 'x'), false);
  });

  test('firma de OTRA clave → rechaza', () => {
    const a = keypair(), b = keypair();
    const ts = '1', body = 'x';
    const sig = sign(a.privateKey, ts, body);
    assert.strictEqual(verifyEd25519(b.pubB64, sig, ts, body), false);
  });

  test('faltan datos → rechaza (no revienta)', () => {
    assert.strictEqual(verifyEd25519('', 'x', '1', 'y'), false);
    assert.strictEqual(verifyEd25519('bad', 'x', '1', 'y'), false);
    assert.strictEqual(verifyEd25519('AAAA', '', '1', 'y'), false);
  });
});

describe('verifyTelnyxRequest (opt-in)', () => {
  test('sin clave configurada → acepta (comportamiento actual, no rompe)', () => {
    const req = { headers: {}, rawBody: Buffer.from('x') };
    assert.strictEqual(verifyTelnyxRequest(req, { publicKey: '' }), true);
    assert.strictEqual(verifyTelnyxRequest(req, { publicKey: undefined }), true);
  });

  test('con clave: firma válida en cabeceras → acepta; inválida → rechaza', () => {
    const { privateKey, pubB64 } = keypair();
    const ts = '1720000000', body = 'form=data&a=1';
    const sig = sign(privateKey, ts, body);
    const req = {
      rawBody: Buffer.from(body, 'utf8'),
      get(h) { return { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }[h]; },
    };
    assert.strictEqual(verifyTelnyxRequest(req, { publicKey: pubB64 }), true);

    const bad = { rawBody: Buffer.from('otro'), get: req.get };
    assert.strictEqual(verifyTelnyxRequest(bad, { publicKey: pubB64 }), false);
  });
});
