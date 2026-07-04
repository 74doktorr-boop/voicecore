// ============================================================
// NodeFlow — Normalizador de dicción para TTS (2026-07-04)
// Charter: la pronunciación correcta NO puede depender de que el
// LLM escriba "euros" o "una hora". Este paso determinista corrige
// el texto ANTES de sintetizar: símbolo € → "euros", horas mal
// concordadas ("1 hora"/"un horas" → "una hora"), etc. Reportado
// por Unai: "no sabe pronunciar euros" + "dice un horas".
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { toSpeakable } = require('../src/tts/speakable');

describe('toSpeakable — euros', () => {
  test('símbolo € tras el número → "euros"', () => {
    assert.strictEqual(toSpeakable('Cuesta 180€.'), 'Cuesta 180 euros.');
    assert.strictEqual(toSpeakable('Son 15 € en total'), 'Son 15 euros en total');
    assert.strictEqual(toSpeakable('El corte 15€ y el tinte 45€'), 'El corte 15 euros y el tinte 45 euros');
  });
  test('decimales con coma o punto', () => {
    assert.strictEqual(toSpeakable('12,50€'), '12,50 euros');
    assert.strictEqual(toSpeakable('9.99€'), '9.99 euros');
  });
  test('€/mes → "euros al mes"', () => {
    assert.strictEqual(toSpeakable('El plan son 49€/mes'), 'El plan son 49 euros al mes');
    assert.strictEqual(toSpeakable('10€ al mes'), '10 euros al mes');
  });
  test('€ antes del número y € suelto', () => {
    assert.strictEqual(toSpeakable('cuesta €20'), 'cuesta 20 euros');
    assert.strictEqual(toSpeakable('en euros: €'), 'en euros: euros');
  });
});

describe('toSpeakable — horas', () => {
  test('"1 hora" → "una hora"', () => {
    assert.strictEqual(toSpeakable('dura 1 hora'), 'dura una hora');
    assert.strictEqual(toSpeakable('1 hora y media'), 'una hora y media');
  });
  test('mala concordancia "1 horas" / "un horas" → "una hora"', () => {
    assert.strictEqual(toSpeakable('dura 1 horas'), 'dura una hora');
    assert.strictEqual(toSpeakable('es un horas'), 'es una hora');
  });
  test('plurales reales no se tocan', () => {
    assert.strictEqual(toSpeakable('dura 2 horas'), 'dura 2 horas');
    assert.strictEqual(toSpeakable('media hora'), 'media hora');
  });
});

describe('toSpeakable — robustez', () => {
  test('texto normal pasa igual', () => {
    assert.strictEqual(toSpeakable('Hola, ¿en qué puedo ayudarle?'), 'Hola, ¿en qué puedo ayudarle?');
  });
  test('null / vacío no lanzan', () => {
    assert.strictEqual(toSpeakable(''), '');
    assert.strictEqual(toSpeakable(null), null);
    assert.strictEqual(toSpeakable(undefined), undefined);
  });
});
