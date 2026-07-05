// ============================================================
// NodeFlow — Tests del parser determinista de FECHAS habladas.
// Referencia fija: 2026-07-05 (DOMINGO) para que sean deterministas.
// El bug: la hora se normalizaba pero la fecha la calculaba el LLM →
// "el martes" podía reservar el día equivocado, y colaban fechas
// imposibles (2026-02-30).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseSpanishDate } = require('../src/scheduling/date-parser');

const REF = '2026-07-05'; // domingo
const p = (input) => parseSpanishDate(input, REF);

describe('parseSpanishDate — ISO passthrough + validación', () => {
  test('ISO válido pasa tal cual', () => assert.strictEqual(p('2026-07-08'), '2026-07-08'));
  test('ISO imposible → null (30 de febrero)', () => assert.strictEqual(p('2026-02-30'), null));
  test('ISO mes imposible → null', () => assert.strictEqual(p('2026-13-01'), null));
});

describe('parseSpanishDate — relativos', () => {
  const cases = [
    ['hoy', '2026-07-05'],
    ['mañana', '2026-07-06'],
    ['pasado mañana', '2026-07-07'],
    ['quiero para mañana', '2026-07-06'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(p(input), expected));
  }
});

describe('parseSpanishDate — días de la semana (ref: domingo 2026-07-05)', () => {
  const cases = [
    ['el lunes', '2026-07-06'],
    ['el martes', '2026-07-07'],
    ['miércoles', '2026-07-08'],
    ['el sábado', '2026-07-11'],
    ['el domingo', '2026-07-12'],       // hoy es domingo → el que viene
    ['el próximo lunes', '2026-07-06'], // "próximo" = la próxima ocurrencia
    ['el lunes que viene', '2026-07-06'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(p(input), expected));
  }
});

describe('parseSpanishDate — día del mes', () => {
  const cases = [
    ['el 15', '2026-07-15'],            // aún no pasó este mes
    ['el día 8', '2026-07-08'],
    ['el 3', '2026-08-03'],             // ya pasó (hoy es 5) → mes que viene
    ['el 15 de agosto', '2026-08-15'],
    ['el 1 de enero', '2027-01-01'],    // enero ya pasó → año que viene
    ['30 de febrero', null],            // día imposible en ese mes
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(p(input), expected));
  }
});

describe('parseSpanishDate — no interpretable / bordes', () => {
  test('"cuando pueda" → null', () => assert.strictEqual(p('cuando pueda'), null));
  test('fecha numérica ambigua "08/07/2026" → null (no adivinar DD/MM vs MM/DD)', () =>
    assert.strictEqual(p('08/07/2026'), null));
  test('vacío → null', () => assert.strictEqual(p(''), null));
  test('null → null', () => assert.strictEqual(p(null), null));
  test('sin referencia, un relativo no se resuelve → null', () =>
    assert.strictEqual(parseSpanishDate('mañana', null), null));
  test('sin referencia, ISO válido SÍ pasa', () =>
    assert.strictEqual(parseSpanishDate('2026-07-08', null), '2026-07-08'));
});
