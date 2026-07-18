// ============================================================
// NodeFlow — Etiquetado de FUNDADOR en el alta (2026-07-18)
// El programa fundadores promete "49€ para siempre" a los primeros 20. Para
// poder identificarlos cuando suba el precio público, el alta con ?fundador=1
// marca registros.source con prefijo 'founder:' (columna que existe → cero
// riesgo de esquema; queryable con source LIKE 'founder:%').
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { markFounderSource } = require('../src/api/routes-registro');

describe('markFounderSource', () => {
  test('fundador preserva la atribución original tras el prefijo', () => {
    assert.strictEqual(markFounderSource(true, 'dental/donostia'), 'founder:dental/donostia');
  });
  test('fundador sin source → founder:directo', () => {
    assert.strictEqual(markFounderSource(true, null), 'founder:directo');
    assert.strictEqual(markFounderSource(true, ''), 'founder:directo');
  });
  test('no fundador → source intacto (incluido null)', () => {
    assert.strictEqual(markFounderSource(false, 'dental'), 'dental');
    assert.strictEqual(markFounderSource(false, null), null);
  });
  test('respeta el tope de 60 caracteres del campo', () => {
    const long = 'x'.repeat(80);
    const out = markFounderSource(true, long);
    assert.strictEqual(out.length, 60);
    assert.ok(out.startsWith('founder:xxxx'));
  });
  test('queryable: todo alta de fundador empieza por founder:', () => {
    ['a', 'ref/b', null].forEach(s => assert.ok(markFounderSource(true, s).startsWith('founder:')));
  });
});
