// ============================================================
// NodeFlow — Conector de integraciones (2026-07-17)
// Objeción nº1 de la crítica sectorial (5×32): "solo Google Calendar".
// Motor genérico que empuja eventos por webhook firmado (HMAC) y verifica el
// ingreso. Fail-open: un webhook caído no afecta al flujo de citas.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { sign, verifyInbound, dispatch, emit, _clearCache } = require('../src/integrations/connector');

const fakeDb = { enabled: true, client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } };

describe('sign / verifyInbound', () => {
  test('verifica una firma correcta', () => {
    const secret = 's3cr3t', ts = Date.now(), body = '{"a":1}';
    const signature = sign(`${ts}.${body}`, secret);
    assert.strictEqual(verifyInbound({ rawBody: body, signature, timestamp: ts, secret }), true);
  });
  test('rechaza firma manipulada', () => {
    const secret = 's3cr3t', ts = Date.now(), body = '{"a":1}';
    const signature = sign(`${ts}.${body}`, secret);
    assert.strictEqual(verifyInbound({ rawBody: '{"a":2}', signature, timestamp: ts, secret }), false);
  });
  test('rechaza timestamp viejo (replay)', () => {
    const secret = 's3cr3t', ts = Date.now() - 10 * 60 * 1000, body = '{}';
    const signature = sign(`${ts}.${body}`, secret);
    assert.strictEqual(verifyInbound({ rawBody: body, signature, timestamp: ts, secret }), false);
  });
  test('sin secreto → false', () => {
    assert.strictEqual(verifyInbound({ rawBody: '{}', signature: 'x', timestamp: Date.now(), secret: '' }), false);
  });
});

describe('dispatch — envío saliente', () => {
  test('sin config → no-op (skipped)', async () => {
    _clearCache();
    const r = await dispatch('org1', 'appointment.saved', { id: 'A' }, { config: null });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(r.delivered, 0);
  });

  test('config deshabilitada → no-op', async () => {
    const r = await dispatch('org1', 'appointment.saved', {}, { config: { enabled: false, outbound: [{ url: 'http://x' }] } });
    assert.strictEqual(r.skipped, true);
  });

  test('entrega a los webhooks suscritos al evento, firma incluida', async () => {
    const calls = [];
    const config = { enabled: true, outbound: [
      { url: 'https://a.test/hook', secret: 'k1', events: ['appointment.saved'] },
      { url: 'https://b.test/hook', events: ['appointment.cancelled'] }, // NO suscrito a saved
    ] };
    const fakeFetch = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 200 }; };
    const r = await dispatch('org1', 'appointment.saved', { id: 'A' }, { config, fetch: fakeFetch, ts: 1000 });
    assert.strictEqual(r.delivered, 1);
    assert.strictEqual(r.total, 1);                 // solo el suscrito
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://a.test/hook');
    // firma HMAC presente y correcta
    const sig = calls[0].o.headers['X-NodeFlow-Signature'];
    const expected = crypto.createHmac('sha256', 'k1').update(`1000.${calls[0].o.body}`).digest('hex');
    assert.strictEqual(sig, expected);
    assert.strictEqual(calls[0].o.headers['X-NodeFlow-Event'], 'appointment.saved');
  });

  test('reintenta ante 5xx y acaba entregando', async () => {
    let n = 0;
    const config = { enabled: true, outbound: [{ url: 'https://a.test', events: null }] };
    const fakeFetch = async () => { n++; return n < 2 ? { ok: false, status: 503 } : { ok: true, status: 200 }; };
    const r = await dispatch('o', 'lead.registered', {}, { config, fetch: fakeFetch, backoffMs: 0 });
    assert.strictEqual(r.delivered, 1);
    assert.ok(n >= 2);
  });

  test('NO reintenta ante 4xx (salvo 429)', async () => {
    let n = 0;
    const config = { enabled: true, outbound: [{ url: 'https://a.test' }] };
    const fakeFetch = async () => { n++; return { ok: false, status: 400 }; };
    const r = await dispatch('o', 'appointment.saved', {}, { config, fetch: fakeFetch, backoffMs: 0 });
    assert.strictEqual(r.delivered, 0);
    assert.strictEqual(n, 1);   // un solo intento
  });

  test('fail-open: si el fetch lanza, no propaga (delivered 0)', async () => {
    const config = { enabled: true, outbound: [{ url: 'https://a.test' }] };
    const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
    const r = await dispatch('o', 'appointment.saved', {}, { config, fetch: fakeFetch, backoffMs: 0 });
    assert.strictEqual(r.delivered, 0);
  });
});

describe('emit — fire-and-forget', () => {
  test('nunca lanza aunque la config falle', () => {
    assert.doesNotThrow(() => emit('org1', 'appointment.saved', {}, { db: fakeDb }));
  });
});
