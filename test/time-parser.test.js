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
