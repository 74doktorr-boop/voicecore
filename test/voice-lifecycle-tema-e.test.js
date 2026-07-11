// ============================================================
// NodeFlow — Ciclo de vida de la llamada (Tema E, 2026-07)
// Tres fallos que se notan en CADA llamada real:
//   E1  la despedida automática cuelga aunque el cliente vuelva a hablar
//   E2  la 1ª frase se pierde cuando llegan dos mientras procesamos
//   E4  el lifeguard se arma después del saludo (hueco sin vigilante)
// Se prueban las piezas extraídas en aislamiento (sin montar routers).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  VoicePipeline,
  mergePendingUtterance,
  lowerConfidenceMeta,
} = require('../src/core/voice-pipeline');

describe('E2 — mergePendingUtterance (no perder la 1ª frase)', () => {
  test('acumula en orden en vez de sobrescribir', () => {
    assert.strictEqual(mergePendingUtterance('quiero una cita', 'para mañana'),
      'quiero una cita para mañana');
  });
  test('sin frase previa → la nueva tal cual', () => {
    assert.strictEqual(mergePendingUtterance(null, 'hola'), 'hola');
    assert.strictEqual(mergePendingUtterance('', 'hola'), 'hola');
  });
  test('frase nueva vacía → conserva la previa', () => {
    assert.strictEqual(mergePendingUtterance('hola', '   '), 'hola');
    assert.strictEqual(mergePendingUtterance('hola', null), 'hola');
  });
  test('recorta espacios sobrantes', () => {
    assert.strictEqual(mergePendingUtterance('  a ', ' b  '), 'a b');
  });
  test('cap de longitud: conserva lo más reciente (la cola)', () => {
    const long = 'x'.repeat(2100);
    const merged = mergePendingUtterance(long, 'FINAL');
    assert.ok(merged.length <= 2000, `capado a ${merged.length}`);
    assert.ok(merged.endsWith('FINAL'), 'mantiene la frase más reciente');
  });
});

describe('E2 — lowerConfidenceMeta (la escalera de confianza sigue protegiendo)', () => {
  test('se queda con la confianza MÁS BAJA de las dos frases', () => {
    const r = lowerConfidenceMeta({ confidence: 0.9 }, { confidence: 0.6 });
    assert.strictEqual(r.confidence, 0.6);
  });
  test('maneja nulos por ambos lados', () => {
    assert.deepStrictEqual(lowerConfidenceMeta(null, { confidence: 0.7 }), { confidence: 0.7 });
    assert.deepStrictEqual(lowerConfidenceMeta({ confidence: 0.7 }, null), { confidence: 0.7 });
    assert.strictEqual(lowerConfidenceMeta(null, null), null);
  });
  test('meta sin confidence numérica no rompe', () => {
    const r = lowerConfidenceMeta({ foo: 1 }, { confidence: 0.5 });
    assert.strictEqual(r.confidence, 0.5);
  });
});

describe('E1 — _cancelPendingHangup (no colgar en la cara del cliente)', () => {
  test('cancela el timer de despedida y lo pone a null', () => {
    let fired = false;
    const session = { _farewellTimer: setTimeout(() => { fired = true; }, 20) };
    const cancelled = VoicePipeline.prototype._cancelPendingHangup(session);
    assert.strictEqual(cancelled, true, 'informa de que había un colgado pendiente');
    assert.strictEqual(session._farewellTimer, null, 'deja el timer a null');
    // esperar más que el timeout original: nunca debe dispararse
    return new Promise((res) => setTimeout(() => { assert.strictEqual(fired, false); res(); }, 40));
  });
  test('es seguro cuando no hay ningún colgado pendiente', () => {
    assert.strictEqual(VoicePipeline.prototype._cancelPendingHangup({}), false);
    assert.strictEqual(VoicePipeline.prototype._cancelPendingHangup(null), false);
  });
});
