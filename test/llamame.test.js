// ============================================================
// NodeFlow — "Llámame" público (2026-07-17)
// La IA llama al prospecto para que la pruebe (objeción nº1 del embudo: 74%
// no compra sin fiarse). GASTA DINERO → tests centrados en las protecciones:
// inerte sin org, solo España, horario, topes por teléfono/IP/global.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { setupLlamameRoutes, isAllowedSpanishDest, inCallingHours, takeDailySlot } = require('../src/api/routes-llamame');
const { normalizeE164, PURPOSE_BLOCKS } = require('../src/telephony/outbound');

describe('helpers puros', () => {
  test('isAllowedSpanishDest: móviles y fijos españoles sí', () => {
    assert.strictEqual(isAllowedSpanishDest('+34666351319'), true);
    assert.strictEqual(isAllowedSpanishDest('+34943123456'), true);
  });
  test('isAllowedSpanishDest: internacional y premium NO (anti toll-fraud)', () => {
    assert.strictEqual(isAllowedSpanishDest('+447911123456'), false);  // UK
    assert.strictEqual(isAllowedSpanishDest('+3480312345'), false);    // 803 premium (no cuadra patrón)
    assert.strictEqual(isAllowedSpanishDest('+341234567890'), false);
    assert.strictEqual(isAllowedSpanishDest(''), false);
  });
  test('inCallingHours: 9-20 sí, 8 y 21 no', () => {
    assert.strictEqual(inCallingHours(9), true);
    assert.strictEqual(inCallingHours(20), true);
    assert.strictEqual(inCallingHours(8), false);
    assert.strictEqual(inCallingHours(21), false);
    assert.strictEqual(inCallingHours(3), false);
  });
  test('takeDailySlot: respeta el máximo y resetea al cambiar de día', () => {
    const store = new Map();
    assert.strictEqual(takeDailySlot(store, 'k', 2, '2026-07-17'), true);
    assert.strictEqual(takeDailySlot(store, 'k', 2, '2026-07-17'), true);
    assert.strictEqual(takeDailySlot(store, 'k', 2, '2026-07-17'), false);  // tope
    assert.strictEqual(takeDailySlot(store, 'k', 2, '2026-07-18'), true);   // día nuevo
  });
  test('el bloque llamame_demo existe y habla al PROSPECTO', () => {
    const b = PURPOSE_BLOCKS.llamame_demo('NodeFlow', 'Ana', 'peluquería');
    assert.match(b, /DEMOSTRACIÓN A UN POSIBLE CLIENTE/);
    assert.match(b, /Ana/);
    assert.match(b, /peluquería/);
    assert.match(b, /NUNCA presiones/);
  });
});

describe('POST /api/public/llamame (ruta real, Telnyx mockeado)', () => {
  let server, base, calls;
  const outboundMock = {
    normalizeE164,
    PURPOSE_BLOCKS,
    registerOutboundContext: async () => {},
    startOutboundCall: async (args) => { calls.push(args); return { ok: true, callSid: 'CS1' }; },
  };
  function boot(deps) {
    const app = express();
    app.use(express.json());
    setupLlamameRoutes(app, { outbound: outboundMock, hour: 12, today: '2026-07-17', ...deps });
    return new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  }
  const post = (body) => fetch(base + '/api/public/llamame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  after(() => server && server.close());

  test('sin LLAMAME_ORG_ID → 503 (inerte, no gasta)', async () => {
    calls = [];
    await boot({ orgId: null });
    const r = await post({ telefono: '666351319' });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(calls.length, 0);
    server.close();
  });

  test('flujo feliz: normaliza el número, llama y responde ok', async () => {
    calls = [];
    await boot({ orgId: 'org-demo' });
    const r = await post({ telefono: '666 35 13 19', nombre: 'Ana', sector: 'peluquería' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].to, '+34666351319');
    assert.strictEqual(calls[0].businessId, 'org-demo');
  });

  test('mismo teléfono otra vez el mismo día → 429 (no gasta doble)', async () => {
    const r = await post({ telefono: '666351319' });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(calls.length, 1);   // sigue en 1
  });

  test('número extranjero → 400 (anti toll-fraud)', async () => {
    const r = await post({ telefono: '+447911123456' });
    assert.strictEqual(r.status, 400);
  });

  test('fuera de horario → 409 y no llama', async () => {
    server.close();
    calls = [];
    await boot({ orgId: 'org-demo', hour: 23 });
    const r = await post({ telefono: '677111222' });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(calls.length, 0);
  });
});
