// ============================================================
// NodeFlow — Ventana de cortesía del motor proactivo (Tema C, 2026-07)
// Bug: el cron de seguimientos no tenía ventana horaria → despachaba a
// cualquier hora, incluida la madrugada (WhatsApp a las 3 AM = queja +
// reporte de spam a Meta). _isQuietHours bloquea fuera de 9:00–21:00 Madrid.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { _isQuietHours } = require('../src/lifecycle/scheduler');

// Julio → Madrid = UTC+2 (CEST). Construimos la hora UTC equivalente.
const madrid = (hh, mm) => new Date(Date.UTC(2026, 6, 10, hh - 2, mm || 0, 0));

describe('_isQuietHours (Europe/Madrid)', () => {
  test('madrugada (3:00) → silencio', () => {
    assert.strictEqual(_isQuietHours(madrid(3, 0)), true);
  });
  test('mediodía (12:00) → se puede enviar', () => {
    assert.strictEqual(_isQuietHours(madrid(12, 0)), false);
  });
  test('noche (22:00) → silencio', () => {
    assert.strictEqual(_isQuietHours(madrid(22, 0)), true);
  });
  test('borde: 9:00 abre (inclusivo)', () => {
    assert.strictEqual(_isQuietHours(madrid(9, 0)), false);
  });
  test('borde: 8:59 aún silencio', () => {
    assert.strictEqual(_isQuietHours(madrid(8, 59)), true);
  });
  test('borde: 20:59 aún se puede', () => {
    assert.strictEqual(_isQuietHours(madrid(20, 59)), false);
  });
  test('borde: 21:00 cierra (silencio)', () => {
    assert.strictEqual(_isQuietHours(madrid(21, 0)), true);
  });
  test('ante fecha inválida no bloquea (fail-open)', () => {
    assert.strictEqual(_isQuietHours(new Date('nope')), false);
  });
});
