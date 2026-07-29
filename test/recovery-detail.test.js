// ============================================================
// NodeFlow — El extracto detrás del "~X€ recuperados" (F8, auditoría 2026-07-29)
//
// El detalle YA se calculaba y se descartaba en el res.json: el dueño veía
// "~105€" y no tenía ningún camino, en ninguna pantalla, para preguntar
// "¿cuáles?". Una cifra que no se puede auditar es un eslogan, no una prueba —
// y este número existe precisamente para convencer a quien duda.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildRecoveryDetail } = require('../src/lifecycle/call-recovery');

const CALLS = {
  recoveries: [
    { id: 'call-1', type: 'after_hours', confidence: 'strong', value: 45, at: '2026-07-14T21:47:00Z' },
    { id: 'call-2', type: 'concurrent',  confidence: 'strong', value: 60, at: '2026-07-20T11:02:00Z' },
    { id: 'call-3', type: 'in_hours_single', confidence: 'weak', value: 45, at: '2026-07-21T10:00:00Z' },
  ],
};
const FOLLOWUPS = {
  bookings: [
    { phone: '+34600111222', service: 'Limpieza', date: '2026-07-18', price: 55, lagDays: 3 },
    { phone: '+34600333444', service: null,       date: '2026-07-10', price: 0,  lagDays: 12 },
  ],
};

describe('buildRecoveryDetail', () => {
  test('solo detalla la atribución FUERTE: el extracto tiene que cuadrar con el total', () => {
    const d = buildRecoveryDetail(CALLS, { bookings: [] }, 0);
    assert.strictEqual(d.length, 2);
    assert.ok(!d.some(x => x.callId === 'call-3'), 'la "weak" no suma en la cabecera, así que no puede salir en el extracto');
  });

  test('cada llamada lleva su callId: sin eso no se puede comprobar nada', () => {
    const d = buildRecoveryDetail(CALLS, { bookings: [] }, 0);
    assert.deepStrictEqual(d.map(x => x.callId).sort(), ['call-1', 'call-2']);
  });

  test('explica POR QUÉ cuenta cada línea, no solo cuánto', () => {
    const d = buildRecoveryDetail(CALLS, { bookings: [] }, 0);
    const after = d.find(x => x.callId === 'call-1');
    const conc  = d.find(x => x.callId === 'call-2');
    assert.match(after.why, /fuera de tu horario/);
    assert.match(conc.why, /otra llamada en curso/);
  });

  test('las citas del motor usan el precio REAL y lo dicen', () => {
    const d = buildRecoveryDetail({ recoveries: [] }, FOLLOWUPS, 35);
    const real = d.find(x => x.phone === '+34600111222');
    assert.strictEqual(real.value, 55);
    assert.strictEqual(real.pricedFrom, 'real');
  });

  test('sin precio real cae al ticket, marcándolo como estimación', () => {
    const d = buildRecoveryDetail({ recoveries: [] }, FOLLOWUPS, 35);
    const est = d.find(x => x.phone === '+34600333444');
    assert.strictEqual(est.value, 35);
    assert.strictEqual(est.pricedFrom, 'ticket_medio');
  });

  test('sin precio real y SIN ticket → 0 y "sin_precio" (no se inventa)', () => {
    const d = buildRecoveryDetail({ recoveries: [] }, FOLLOWUPS, null);
    const est = d.find(x => x.phone === '+34600333444');
    assert.strictEqual(est.value, 0);
    assert.strictEqual(est.pricedFrom, 'sin_precio');
  });

  test('lo más reciente primero (es como se lee un extracto)', () => {
    const d = buildRecoveryDetail(CALLS, FOLLOWUPS, 35);
    const fechas = d.map(x => String(x.at).slice(0, 10));
    assert.deepStrictEqual(fechas, [...fechas].sort().reverse());
  });

  test('entradas vacías o basura → array vacío, sin romper el dashboard', () => {
    for (const [a, b] of [[null, null], [{}, {}], [undefined, undefined], [{ recoveries: null }, { bookings: 'x' }]]) {
      assert.deepStrictEqual(buildRecoveryDetail(a, b, 35), []);
    }
  });
});
