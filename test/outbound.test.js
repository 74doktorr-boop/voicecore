// ============================================================
// NodeFlow — Tests del motor de salientes compartido
// Registro de contexto (por qué llamamos), matching tolerante a
// formatos de número, consumo único, y validaciones de arranque.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');

const { normalizeE164 } = require('../src/telephony/outbound');

// ── normalizeE164 — Telnyx exige +E164 (error real 2026-07-03: el dueño
// tecleó "666351319" en Llámame y Telnyx rechazó la llamada) ──────────────
describe('normalizeE164 — nunca confiar en cómo teclea un humano', () => {
  const cases = [
    ['666351319', '+34666351319'],        // el caso real del botón
    ['666 35 13 19', '+34666351319'],
    ['943-12-34-56', '+34943123456'],     // fijo Gipuzkoa
    ['0034666351319', '+34666351319'],
    ['34666351319', '+34666351319'],
    ['+34666351319', '+34666351319'],
    ['+33612345678', '+33612345678'],     // internacional se respeta
    ['12345', null],                       // demasiado corto
    ['hola', null],
    ['', null],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(normalizeE164(input), expected));
  }
});

const {
  startOutboundCall,
  registerOutboundContext,
  consumeOutboundContext,
  PURPOSE_BLOCKS,
} = require('../src/telephony/outbound');

describe('registro de contexto de salientes', () => {
  test('registra y consume con formatos distintos del mismo número', async () => {
    await registerOutboundContext('+34 666 35 13 19', { businessId: 'org1', purpose: 'test_call', promptBlock: 'X' });
    const ctx = await consumeOutboundContext('34666351319');
    assert.ok(ctx);
    assert.strictEqual(ctx.businessId, 'org1');
    assert.strictEqual(ctx.purpose, 'test_call');
  });

  test('consumo es de un solo uso', async () => {
    await registerOutboundContext('+34600000001', { businessId: 'org1', purpose: 'recovery' });
    assert.ok(await consumeOutboundContext('+34600000001'));
    assert.strictEqual(await consumeOutboundContext('+34600000001'), null);
  });

  test('matching prueba ambos números del stream (from y to)', async () => {
    await registerOutboundContext('+34600000002', { businessId: 'org2', purpose: 'test_call' });
    const ctx = await consumeOutboundContext('+34843700849', '+34600000002'); // (nuestro, callee)
    assert.ok(ctx);
    assert.strictEqual(ctx.businessId, 'org2');
  });

  test('sin registro → null', async () => {
    assert.strictEqual(await consumeOutboundContext('+34999999999'), null);
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
