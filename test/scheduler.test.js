// ============================================================
// NodeFlow — Lifecycle scheduler concurrency tests
// Ejecutar: npm test  (node --test test/)
//
// Verifica que el despacho con concurrencia acotada procesa
// todos los elementos y nunca supera el límite en vuelo — base
// del escalado a miles de clientes sin saturar proveedores.
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { mapWithConcurrency } = require('../src/lifecycle/scheduler');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  test('procesa todos los elementos exactamente una vez', async () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const seen = [];
    await mapWithConcurrency(items, 5, async (i) => { seen.push(i); });
    assert.strictEqual(seen.length, 250);
    assert.deepStrictEqual([...seen].sort((a, b) => a - b), items);
  });

  test('nunca supera el límite de concurrencia', async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(items, 8, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(2);
      inFlight--;
    });
    assert.ok(maxInFlight <= 8, `concurrencia ${maxInFlight} > 8`);
    assert.ok(maxInFlight >= 2, 'no hubo paralelismo real');
  });

  test('lista vacía no hace nada y no lanza', async () => {
    let calls = 0;
    await mapWithConcurrency([], 5, async () => { calls++; });
    assert.strictEqual(calls, 0);
  });

  test('un fallo aislado no detiene el resto (si fn lo captura)', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const done = [];
    await mapWithConcurrency(items, 4, async (i) => {
      try { if (i === 7) throw new Error('boom'); } catch (_) {}
      done.push(i);
    });
    assert.strictEqual(done.length, 20);
  });
});
