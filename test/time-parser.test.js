// ============================================================
// NodeFlow — Tests del parser de horas en español hablado
// El bug real: "a la una" se rechazaba como "Hora inválida" y el
// negocio perdía la reserva. Cada caso de aquí es una frase que un
// cliente puede decir por teléfono.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseSpanishTime } = require('../src/scheduling/time-parser');

describe('parseSpanishTime — formatos directos', () => {
  const cases = [
    ['13:00', '13:00'],
    ['9:30', '09:30'],
    ['13.15', '13:15'],
    ['13h30', '13:30'],
    ['13h', '13:00'],
    ['13', '13:00'],
    ['12', '12:00'],
    ['09:05', '09:05'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseSpanishTime(input), expected));
  }
});

describe('parseSpanishTime — contexto laboral (1-7 = tarde)', () => {
  const cases = [
    ['1', '13:00'],
    ['a la una', '13:00'],
    ['la una', '13:00'],
    ['a las dos', '14:00'],
    ['a las siete', '19:00'],
    ['a las ocho', '08:00'],   // 8-12 se quedan en mañana
    ['a las diez', '10:00'],
    ['a las doce', '12:00'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseSpanishTime(input), expected));
  }
});

describe('parseSpanishTime — minutos hablados', () => {
  const cases = [
    ['a la una y media', '13:30'],
    ['una y cuarto', '13:15'],
    ['la una menos cuarto', '12:45'],
    ['a las dos menos veinte', '13:40'],
    ['doce y veinte', '12:20'],
    ['a las diez y cinco', '10:05'],
    ['cinco menos diez', '16:50'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseSpanishTime(input), expected));
  }
});

describe('parseSpanishTime — meridiano explícito', () => {
  const cases = [
    ['8 de la tarde', '20:00'],
    ['ocho de la manana', '08:00'],
    ['diez de la noche', '22:00'],
    ['1 pm', '13:00'],
    ['11 am', '11:00'],
    ['siete de la mañana', '07:00'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseSpanishTime(input), expected));
  }
});

describe('parseSpanishTime — especiales y no interpretables', () => {
  test('"mediodía" → 12:00', () => assert.strictEqual(parseSpanishTime('mediodía'), '12:00'));
  test('"después de comer" → 15:00', () => assert.strictEqual(parseSpanishTime('después de comer'), '15:00'));
  test('"por la mañana" → null (rango: la IA debe concretar)', () => assert.strictEqual(parseSpanishTime('por la mañana'), null));
  test('vacío → null', () => assert.strictEqual(parseSpanishTime(''), null));
  test('null → null', () => assert.strictEqual(parseSpanishTime(null), null));
  test('"cuando pueda" → null', () => assert.strictEqual(parseSpanishTime('cuando pueda'), null));
  test('"25" → null (hora imposible)', () => assert.strictEqual(parseSpanishTime('25'), null));
});

// ── Robustez 2026-07-05: minutos hablados que antes se perdían (→ hora en punto,
//    reserva a la hora equivocada). Compuestos comprobados antes que su prefijo. ──
describe('parseSpanishTime — minutos hablados completos', () => {
  const cases = [
    ['las diez y treinta', '10:30'],          // "y treinta" = y media
    ['a las once y quince', '11:15'],          // "y quince" = y cuarto
    ['las diez y treinta y cinco', '10:35'],   // compuesto (no cortar en "treinta")
    ['las diez y cuarenta', '10:40'],
    ['las diez y cuarenta y cinco', '10:45'],  // compuesto (no cortar en "cuarenta")
    ['las diez y cincuenta', '10:50'],
    ['las diez y cincuenta y cinco', '10:55'], // compuesto
    ['las dos menos veinticinco', '13:35'],    // 2 tarde − 25 = 13:35
    // No se rompe lo que ya funcionaba:
    ['las diez y media', '10:30'],
    ['las diez y cuarto', '10:15'],
    ['las dos menos cuarto', '13:45'],
    ['las diez y veinticinco', '10:25'],
    ['las diez y veinte', '10:20'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => assert.strictEqual(parseSpanishTime(input), expected));
  }
});
