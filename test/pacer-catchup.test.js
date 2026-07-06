// ============================================================
// VoiceCore — Pacer por reloj con autocompensación (2026-07-07)
// El pacer antiguo (1 frame por tick de 20ms) acumulaba huecos con el
// jitter del event loop → "se entrecorta". El nuevo calcula cuántos
// frames DEBERÍAN estar enviados y manda los que falten de golpe.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { pacerFramesDue } = require('../src/core/call-session');

describe('pacerFramesDue (pura)', () => {
  test('arranque: manda el colchón entero de golpe (600ms = 30 frames)', () => {
    assert.strictEqual(pacerFramesDue(0, 0, 999, 600), 30);
  });

  test('colchón por defecto ≥900ms (absorbe stalls de GC/CPU compartida)', () => {
    assert.ok(pacerFramesDue(0, 0, 999) >= 45);
  });

  test('en régimen: tiempo real + colchón, ni un frame más', () => {
    // a los 1000ms con colchón 600 → objetivo 80 frames; ya enviados 80 → 0
    assert.strictEqual(pacerFramesDue(1000, 80, 999, 600), 0);
    // a los 1050ms → objetivo 83 → faltan 3
    assert.strictEqual(pacerFramesDue(1050, 80, 999, 600), 3);
  });

  test('AUTOCOMPENSACIÓN: un bombeo que llega 200ms tarde envía el atraso completo', () => {
    // debería haber bombeado a los 1000ms (80 frames) pero llega a los 1200
    const due = pacerFramesDue(1200, 80, 999, 600);
    assert.strictEqual(due, 10);   // 200ms de atraso = 10 frames extra, de golpe
  });

  test('nunca más frames que la cola', () => {
    assert.strictEqual(pacerFramesDue(0, 0, 5, 600), 5);
  });

  test('tope de ráfaga: jamás megaráfagas aunque el atraso sea enorme', () => {
    assert.strictEqual(pacerFramesDue(60000, 0, 99999, 600), 100);
  });

  test('nunca negativo (enviados por delante del objetivo)', () => {
    assert.strictEqual(pacerFramesDue(100, 50, 999, 600), 0);
  });
});
