// ============================================================
// NodeFlow — Transcript de WhatsApp: normalización del teléfono del hilo.
// Entrante ("34..") y saliente ("+34.. ") deben caer en el MISMO hilo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { _canon } = require('../src/whatsapp/wa-log');

describe('wa-log _canon', () => {
  test('normaliza a +<digitos> sea cual sea el formato', () => {
    assert.strictEqual(_canon('34666351319'), '+34666351319');
    assert.strictEqual(_canon('+34666351319'), '+34666351319');
    assert.strictEqual(_canon('+34 666 351 319'), '+34666351319');
    assert.strictEqual(_canon('34-666-351-319'), '+34666351319');
  });
  test('entrante y saliente del mismo número → misma clave de hilo', () => {
    assert.strictEqual(_canon('34666351319'), _canon('+34666351319'));
  });
  test('vacío/basura → cadena vacía (no rompe)', () => {
    assert.strictEqual(_canon(''), '');
    assert.strictEqual(_canon(null), '');
    assert.strictEqual(_canon('abc'), '');
  });
});
