// ============================================================
// NodeFlow — Tests del motor de salientes compartido
// Registro de contexto (por qué llamamos), matching tolerante a
// formatos de número, consumo único, y validaciones de arranque.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');

const {
  startOutboundCall,
  registerOutboundContext,
  consumeOutboundContext,
  PURPOSE_BLOCKS,
} = require('../src/telephony/outbound');

describe('registro de contexto de salientes', () => {
  test('registra y consume con formatos distintos del mismo número', () => {
    registerOutboundContext('+34 666 35 13 19', { businessId: 'org1', purpose: 'test_call', promptBlock: 'X' });
    const ctx = consumeOutboundContext('34666351319');
    assert.ok(ctx);
    assert.strictEqual(ctx.businessId, 'org1');
    assert.strictEqual(ctx.purpose, 'test_call');
  });

  test('consumo es de un solo uso', () => {
    registerOutboundContext('+34600000001', { businessId: 'org1', purpose: 'recovery' });
    assert.ok(consumeOutboundContext('+34600000001'));
    assert.strictEqual(consumeOutboundContext('+34600000001'), null);
  });

  test('matching prueba ambos números del stream (from y to)', () => {
    registerOutboundContext('+34600000002', { businessId: 'org2', purpose: 'test_call' });
    const ctx = consumeOutboundContext('+34843700849', '+34600000002'); // (nuestro, callee)
    assert.ok(ctx);
    assert.strictEqual(ctx.businessId, 'org2');
  });

  test('sin registro → null', () => {
    assert.strictEqual(consumeOutboundContext('+34999999999'), null);
  });
});

describe('PURPOSE_BLOCKS', () => {
  test('test_call menciona el negocio y que es una prueba', () => {
    const block = PURPOSE_BLOCKS.test_call('Peluquería HHR');
    assert.match(block, /Peluquería HHR/);
    assert.match(block, /prueba/i);
    assert.match(block, /SALIENTE/);
  });

  test('recovery pide no insistir y menciona al cliente', () => {
    const block = PURPOSE_BLOCKS.recovery('Clínica X', 'María');
    assert.match(block, /María/);
    assert.match(block, /NO insistas/);
  });
});

describe('startOutboundCall — validaciones', () => {
  const saved = { key: process.env.TELNYX_API_KEY, app: process.env.TELNYX_APP_ID };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.TELNYX_API_KEY; else process.env.TELNYX_API_KEY = saved.key;
    if (saved.app === undefined) delete process.env.TELNYX_APP_ID; else process.env.TELNYX_APP_ID = saved.app;
  });

  test('sin TELNYX_API_KEY → error accionable', async () => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_APP_ID;
    await assert.rejects(
      () => startOutboundCall({ businessId: 'o', to: '+34666351319' }),
      /TELNYX_API_KEY/
    );
  });

  test('número destino inválido → error claro', async () => {
    process.env.TELNYX_API_KEY = 'k';
    process.env.TELNYX_APP_ID = 'a';
    await assert.rejects(
      () => startOutboundCall({ businessId: 'o', to: '12' }),
      /destino no válido/
    );
  });
});
