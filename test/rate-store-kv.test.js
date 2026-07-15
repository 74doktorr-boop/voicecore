// ============================================================
// NodeFlow — rate-store put/get/del con TTL (auditoría 2026-07-16).
// Soporta la persistencia del token de admin (Redis multi-réplica o memoria):
// antes vivía en un Set en memoria → se perdía en CADA deploy (re-login) y
// con 2+ réplicas el panel daba 401 en las que no emitieron el token.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const rateStore = require('../src/utils/rate-store');

const nap = (ms) => new Promise(r => setTimeout(r, ms));

describe('rate-store KV (put/get/del)', () => {
  test('put luego get devuelve el valor', async () => {
    await rateStore.put('kvt:1', '1', 1000);
    assert.strictEqual(await rateStore.get('kvt:1'), '1');
  });

  test('get de una clave inexistente → null', async () => {
    assert.strictEqual(await rateStore.get('kvt:noexiste'), null);
  });

  test('del elimina la clave', async () => {
    await rateStore.put('kvt:2', 'x', 1000);
    await rateStore.del('kvt:2');
    assert.strictEqual(await rateStore.get('kvt:2'), null);
  });

  test('TTL: la clave caduca sola', async () => {
    await rateStore.put('kvt:3', 'x', 40);
    assert.strictEqual(await rateStore.get('kvt:3'), 'x');
    await nap(60);
    assert.strictEqual(await rateStore.get('kvt:3'), null, 'tras el TTL, ya no existe');
  });

  test('simula el flujo del token de admin: emitir → válido → borrar → inválido', async () => {
    const tok = 'admintok:deadbeef';
    await rateStore.put(tok, '1', 1000);
    assert.ok(!!(await rateStore.get(tok)), 'token recién emitido es válido');
    await rateStore.del(tok);
    assert.ok(!(await rateStore.get(tok)), 'token borrado es inválido');
  });
});
