// ============================================================
// NodeFlow — Firma Ed25519 de webhooks de Telnyx (seguridad, auditoría 20/07)
// Genera un par de claves real y comprueba que la verificación acepta una
// firma legítima y rechaza cualquier manipulación. Opt-in verificado.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyEd25519, verifyTelnyxRequest, isFreshTimestamp, telnyxSignatureStatus } = require('../src/utils/telnyx-signature');

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
    const now = Number(ts) * 1000; // el webhook acaba de llegar
    const sig = sign(privateKey, ts, body);
    const req = {
      rawBody: Buffer.from(body, 'utf8'),
      get(h) { return { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }[h]; },
    };
    assert.strictEqual(verifyTelnyxRequest(req, { publicKey: pubB64, now }), true);

    const bad = { rawBody: Buffer.from('otro'), get: req.get };
    assert.strictEqual(verifyTelnyxRequest(bad, { publicKey: pubB64, now }), false);
  });
});

// ── Anti-replay (auditoría 2026-07-29, S3) ────────────────────────────────────
// Antes se verificaba la firma pero NO la frescura: una firma capturada valía
// indefinidamente, así que el atacante podía reenviar un webhook legítimo.
describe('isFreshTimestamp (anti-replay)', () => {
  const NOW = 1_760_000_000_000;

  test('timestamp actual → fresco', () => {
    assert.strictEqual(isFreshTimestamp(String(NOW / 1000), NOW), true);
  });

  test('dentro de la ventana (±5 min) → fresco, en ambos sentidos', () => {
    assert.strictEqual(isFreshTimestamp(String(NOW / 1000 - 240), NOW), true);  // 4 min tarde
    assert.strictEqual(isFreshTimestamp(String(NOW / 1000 + 240), NOW), true);  // reloj adelantado
  });

  test('fuera de la ventana → rechaza', () => {
    assert.strictEqual(isFreshTimestamp(String(NOW / 1000 - 3600), NOW), false); // 1 h de antigüedad
    assert.strictEqual(isFreshTimestamp(String(NOW / 1000 + 3600), NOW), false);
  });

  test('basura o ausente → rechaza (no revienta)', () => {
    for (const bad of [undefined, null, '', 'abc', '0', '-1', {}, []]) {
      assert.strictEqual(isFreshTimestamp(bad, NOW), false, `debería rechazar: ${JSON.stringify(bad)}`);
    }
  });

  test('replay de un webhook antiguo con firma VÁLIDA → se rechaza igual', () => {
    const { privateKey, pubB64 } = keypair();
    const ts = String(Math.floor(NOW / 1000) - 86400); // firmado ayer
    const body = '{"event_type":"call.initiated"}';
    const sig = sign(privateKey, ts, body);
    const req = {
      rawBody: Buffer.from(body, 'utf8'),
      get(h) { return { 'telnyx-signature-ed25519': sig, 'telnyx-timestamp': ts }[h]; },
    };
    // La firma es criptográficamente correcta…
    assert.strictEqual(verifyEd25519(pubB64, sig, ts, body), true);
    // …pero la request se rechaza por antigua.
    assert.strictEqual(verifyTelnyxRequest(req, { publicKey: pubB64, now: NOW }), false);
  });
});

// El estado de la verificación no puede ser silencioso: hay que poder leerlo.
describe('telnyxSignatureStatus', () => {
  test('sin clave → NO enforced, con motivo legible', () => {
    const prev = process.env.TELNYX_PUBLIC_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;
    const s = telnyxSignatureStatus();
    assert.strictEqual(s.enforced, false);
    assert.match(s.reason, /AUSENTE/);
    if (prev !== undefined) process.env.TELNYX_PUBLIC_KEY = prev;
  });

  test('con clave → enforced', () => {
    const prev = process.env.TELNYX_PUBLIC_KEY;
    process.env.TELNYX_PUBLIC_KEY = 'AAAA';
    assert.strictEqual(telnyxSignatureStatus().enforced, true);
    if (prev === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = prev;
  });
});
