// ============================================================
// VoiceCore — rate-store: contador atómico compartido.
// Aquí se prueba el FALLBACK en memoria (sin REDIS_URL). El camino
// Redis es un eval Lua atómico equivalente; no hay Redis en CI.
// ============================================================
'use strict';

delete process.env.REDIS_URL; // forzar fallback en memoria

const { test, describe } = require('node:test');
const assert = require('node:assert');
const store = require('../src/utils/rate-store');

const k = (p) => `test:${p}:${Math.random().toString(36).slice(2)}`;

describe('rate-store (fallback en memoria)', () => {
  test('hit incrementa dentro de la ventana', async () => {
    const key = k('inc');
    const r1 = await store.hit(key, 10000);
    const r2 = await store.hit(key, 10000);
    assert.strictEqual(r1.count, 1);
    assert.strictEqual(r2.count, 2);
    assert.ok(r1.resetAt > Date.now());
  });

  test('peek devuelve el contador sin incrementar', async () => {
    const key = k('peek');
    await store.hit(key, 10000);
    const p1 = await store.peek(key);
    const p2 = await store.peek(key);
    assert.strictEqual(p1.count, 1);
    assert.strictEqual(p2.count, 1);
  });

  test('peek de clave inexistente → null', async () => {
    assert.strictEqual(await store.peek(k('none')), null);
  });

  test('reset borra el contador', async () => {
    const key = k('reset');
    await store.hit(key, 10000);
    await store.reset(key);
    assert.strictEqual(await store.peek(key), null);
    const r = await store.hit(key, 10000);
    assert.strictEqual(r.count, 1, 'tras reset vuelve a empezar en 1');
  });

  test('la ventana expira y el contador reinicia', async () => {
    const key = k('win');
    await store.hit(key, 25);
    await new Promise((r) => setTimeout(r, 45));
    const r = await store.hit(key, 25);
    assert.strictEqual(r.count, 1, 'reinicia tras expirar la ventana');
  });

  test('isRedisEnabled() es false sin REDIS_URL', () => {
    assert.strictEqual(store.isRedisEnabled(), false);
  });
});
