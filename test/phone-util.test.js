// ============================================================
// NodeFlow — utilidad canónica de teléfonos (ES)
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { normalizePhone, phoneVariants } = require('../src/utils/phone');

describe('normalizePhone — nacional 9 dígitos', () => {
  const cases = [
    ['+34 843 98 76 54', '843987654'],
    ['34843987654', '843987654'],
    ['+34843987654', '843987654'],
    ['0034843987654', '843987654'],
    ['843987654', '843987654'],
    ['843 98 76 54', '843987654'],
    ['', ''],
    [null, ''],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → "${expected}"`, () => assert.strictEqual(normalizePhone(input), expected));
  }
});

describe('phoneVariants — todas las formas para un .in()', () => {
  test('incluye el original, el nacional y las formas con país', () => {
    const v = phoneVariants('+34843987654');
    assert.ok(v.includes('843987654'), 'nacional');
    assert.ok(v.includes('+34843987654'), 'original');
    assert.ok(v.includes('34843987654'), 'con 34');
    assert.ok(v.includes('0034843987654'), 'con 0034');
    assert.strictEqual(new Set(v).size, v.length, 'sin duplicados');
  });
  test('un número guardado como nacional casa con la variante E.164 y viceversa', () => {
    // el contacto guardado "843987654" está entre las variantes del E.164 entrante
    assert.ok(phoneVariants('+34843987654').includes('843987654'));
    // y el E.164 guardado está entre las variantes del nacional entrante
    assert.ok(phoneVariants('843987654').includes('+34843987654'));
  });
  test('vacío → array vacío (no revienta)', () => {
    assert.deepStrictEqual(phoneVariants(''), []);
  });
});
