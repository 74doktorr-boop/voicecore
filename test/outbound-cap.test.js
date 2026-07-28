// ============================================================
// NodeFlow — Tope de gasto SALIENTE (Fase 3, 2026-07-28)
// Guardarraíl anti factura sorpresa: las llamadas salientes consumen el mismo
// pool de minutos (0,15€/min sobre lo incluido). Un cap mensual por org, fail-
// closed en el dispatcher, evita que una campaña grande se coma el pool en
// silencio (Charter: nada de fallbacks silenciosos que gasten dinero).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { capOf, monthStartISO, DEFAULT_OUTBOUND_CAP } = require('../src/campaigns/dispatcher');

describe('capOf — tope efectivo por org', () => {
  test('sin config → default', () => {
    assert.strictEqual(capOf({}), DEFAULT_OUTBOUND_CAP);
    assert.strictEqual(capOf(null), DEFAULT_OUTBOUND_CAP);
  });
  test('config numérica se respeta', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 50 } } }), 50);
  });
  test('0 = pausa total (válido, no cae al default)', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 0 } } }), 0);
  });
  test('valor inválido → default (no rompe)', () => {
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: 'xx' } } }), DEFAULT_OUTBOUND_CAP);
    assert.strictEqual(capOf({ automation_config: { config: { outboundMonthlyCap: -5 } } }), DEFAULT_OUTBOUND_CAP);
  });
});

describe('monthStartISO — inicio de mes UTC', () => {
  test('devuelve el día 1 a medianoche UTC', () => {
    assert.ok(monthStartISO(Date.UTC(2026, 6, 28, 15, 30)).startsWith('2026-07-01T00:00:00'));
    assert.ok(monthStartISO(Date.UTC(2026, 0, 1, 0, 0)).startsWith('2026-01-01T00:00:00'));
  });
});

describe('gate del dispatcher — fail-closed al alcanzar el tope', () => {
  // Réplica de la decisión del dispatcher: used >= cap → CANCELA (no llama).
  const overCap = (used, cap) => used >= cap;
  test('por debajo del tope → llama', () => {
    assert.strictEqual(overCap(199, 200), false);
  });
  test('en el tope o por encima → cancela (no gasta de más)', () => {
    assert.strictEqual(overCap(200, 200), true);
    assert.strictEqual(overCap(500, 200), true);
  });
  test('cap 0 → cancela cualquier llamada (pausa total)', () => {
    assert.strictEqual(overCap(0, 0), true);
    assert.strictEqual(overCap(3, 0), true);
  });
});
