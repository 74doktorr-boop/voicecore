// ============================================================
// NodeFlow — De dónde sale cada euro que se le enseña al cliente (F9, 2026-07-29)
//
// La primera pantalla del portal mostraba dos cifras inventadas: un ticket medio
// de 35€ hardcodeado en CINCO sitios y "horas ahorradas" = llamadas × 4 min.
// Un taller de 300€ de ticket veía su valor dividido por 9; una peluquería de
// 15€ lo veía multiplicado por 2,3 — y ese es el caso que quema, porque el dueño
// hace la cuenta, no le cuadra, y deja de creerse TAMBIÉN las cifras honestas.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { resolveAvgTicket, estimateBookingValue, timeSavedFromCalls } = require('../src/analytics/value-model');

describe('resolveAvgTicket', () => {
  test('lo que el dueño declaró manda siempre', () => {
    const t = resolveAvgTicket({ configured: 300, prices: [40, 45, 50] });
    assert.deepStrictEqual(t, { value: 300, source: 'configured', n: 0 });
  });

  test('sin configurar → MEDIANA de los precios reales de sus citas', () => {
    const t = resolveAvgTicket({ prices: [40, 45, 50] });
    assert.strictEqual(t.value, 45);
    assert.strictEqual(t.source, 'observed');
    assert.strictEqual(t.n, 3);
  });

  test('mediana y no media: un implante de 1.200€ no puede inflar el ticket típico', () => {
    const t = resolveAvgTicket({ prices: [40, 40, 40, 40, 1200] });
    assert.strictEqual(t.value, 40, 'la media daría 272€ y sería mentira');
  });

  test('SIN DATOS → null, nunca 35', () => {
    for (const input of [{}, { prices: [] }, { prices: [0, -5, null, 'x'] }, { configured: 0 }]) {
      const t = resolveAvgTicket(input);
      assert.strictEqual(t.value, null, `debería ser null: ${JSON.stringify(input)}`);
      assert.strictEqual(t.source, null);
    }
  });

  test('un configurado inválido no cuela como declarado', () => {
    assert.strictEqual(resolveAvgTicket({ configured: 'mucho', prices: [50] }).source, 'observed');
    assert.strictEqual(resolveAvgTicket({ configured: -10, prices: [50] }).source, 'observed');
  });
});

describe('estimateBookingValue', () => {
  test('con ticket → euros y de dónde salen', () => {
    const v = estimateBookingValue(4, { value: 45, source: 'observed' });
    assert.deepStrictEqual(v, { value: 180, source: 'observed', bookings: 4 });
  });

  test('SIN ticket → null, no 0', () => {
    const v = estimateBookingValue(4, { value: null, source: null });
    assert.strictEqual(v.value, null,
      '0€ se lee como "no has ganado nada", que es una afirmación distinta de "no sé cuánto vale una cita tuya"');
    assert.strictEqual(v.bookings, 4, 'el número de reservas sí se sabe y se conserva');
  });
});

describe('timeSavedFromCalls', () => {
  test('suma la duración REAL, no 4 minutos por llamada', () => {
    const r = timeSavedFromCalls([{ duration_ms: 20_000 }, { duration_ms: 40_000 }]);
    assert.strictEqual(r.minutes, 1, 'un minuto de verdad');
    assert.strictEqual(r.source, 'measured');
    assert.strictEqual(r.n, 2);
  });

  test('EL ABSURDO ANTERIOR: una llamada de 20s que acaba en cuelgue contaba 4 min', () => {
    const r = timeSavedFromCalls([{ duration_ms: 20_000 }]);
    assert.ok(r.minutes < 1, `medido: ${r.minutes} min (antes se contaban 4)`);
  });

  test('deriva la duración de startTime/endTime cuando no hay duration_ms', () => {
    const t0 = Date.UTC(2026, 6, 29, 10, 0, 0);
    const r = timeSavedFromCalls([{ startTime: new Date(t0), endTime: new Date(t0 + 180_000) }]);
    assert.strictEqual(r.minutes, 3);
  });

  test('las llamadas sin duración utilizable se EXCLUYEN, no se rellenan', () => {
    const r = timeSavedFromCalls([{ duration_ms: 60_000 }, {}, { startTime: 'x' }, { duration_ms: 0 }]);
    assert.strictEqual(r.minutes, 1);
    assert.strictEqual(r.n, 1);
    assert.strictEqual(r.unmeasured, 3, 'se reporta cuántas no se pudieron medir, no se inventan');
  });

  test('sin llamadas → 0 horas y source null (no hay medición que presumir)', () => {
    const r = timeSavedFromCalls([]);
    assert.strictEqual(r.hours, 0);
    assert.strictEqual(r.source, null);
  });

  test('entrada basura no revienta', () => {
    for (const bad of [null, undefined, 'x', 42]) assert.strictEqual(timeSavedFromCalls(bad).hours, 0);
  });
});
