// ============================================================
// NodeFlow — Tope de duración por llamada (2026-07-18)
// La demo pública Llámame se autocorta a 6 min (basta y acota el gasto del
// endpoint público). effectiveMaxMs decide: tope de sesión > global > 15 min.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { effectiveMaxMs } = require('../src/core/voice-pipeline');

describe('effectiveMaxMs', () => {
  test('tope de sesión (demo 6 min) manda sobre el global', () => {
    assert.strictEqual(effectiveMaxMs(6, 15), 6 * 60000);
    assert.strictEqual(effectiveMaxMs(6, undefined), 6 * 60000);
  });
  test('sin tope de sesión → usa el global MAX_CALL_MINUTES', () => {
    assert.strictEqual(effectiveMaxMs(null, 20), 20 * 60000);
    assert.strictEqual(effectiveMaxMs(0, '10'), 10 * 60000);
  });
  test('sin ninguno → 15 min por defecto', () => {
    assert.strictEqual(effectiveMaxMs(null, null), 15 * 60000);
    assert.strictEqual(effectiveMaxMs(undefined, undefined), 15 * 60000);
  });
  test('valores basura no rompen el tope por defecto', () => {
    assert.strictEqual(effectiveMaxMs('abc', 'xyz'), 15 * 60000);
    assert.strictEqual(effectiveMaxMs(-5, -1), 15 * 60000);
  });
});
