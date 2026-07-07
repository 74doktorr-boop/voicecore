// ============================================================
// NodeFlow — Riesgo de plantón (2026-07-07, oportunidad 5)
// Regla determinista: el riesgo sale del historial de faltas.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeNoShowRisk, RISK } = require('../src/lifecycle/no-show-risk');

const NOW = new Date('2026-07-07T12:00:00Z');

describe('computeNoShowRisk', () => {
  test('sin historial → riesgo NONE, nota clara', () => {
    const r = computeNoShowRisk([], NOW);
    assert.strictEqual(r.level, RISK.NONE);
    assert.strictEqual(r.noShows, 0);
    assert.match(r.note, /historial/i);
  });

  test('citas futuras/pendientes no cuentan', () => {
    const r = computeNoShowRisk([
      { status: 'pending', date: '2026-08-01' },
      { status: 'confirmed', date: '2026-08-05' },
    ], NOW);
    assert.strictEqual(r.decided, 0);
    assert.strictEqual(r.level, RISK.NONE);
  });

  test('todas completadas → NONE, sin faltas', () => {
    const r = computeNoShowRisk([
      { status: 'completed', date: '2026-05-01' },
      { status: 'completed', date: '2026-06-01' },
    ], NOW);
    assert.strictEqual(r.level, RISK.NONE);
    assert.match(r.note, /sin faltas/i);
  });

  test('una falta antigua entre muchas idas → LOW', () => {
    const r = computeNoShowRisk([
      { status: 'no_show', date: '2025-01-10' },   // hace >1 año
      { status: 'completed', date: '2026-03-01' },
      { status: 'completed', date: '2026-05-01' },
      { status: 'completed', date: '2026-06-01' },
    ], NOW);
    assert.strictEqual(r.level, RISK.LOW);
    assert.strictEqual(r.noShows, 1);
    assert.strictEqual(r.recentNoShow, false);
  });

  test('dos o más faltas → HIGH', () => {
    const r = computeNoShowRisk([
      { status: 'no_show', date: '2026-02-10' },
      { status: 'no_show', date: '2026-04-10' },
      { status: 'completed', date: '2026-05-01' },
    ], NOW);
    assert.strictEqual(r.level, RISK.HIGH);
    assert.strictEqual(r.noShows, 2);
    assert.match(r.note, /confirmar/i);
  });

  test('una falta RECIENTE con tasa alta → HIGH', () => {
    const r = computeNoShowRisk([
      { status: 'no_show', date: '2026-06-20' },   // dentro de 90 días
      { status: 'completed', date: '2026-05-01' },
    ], NOW);
    assert.strictEqual(r.recentNoShow, true);
    assert.strictEqual(r.rate, 50);
    assert.strictEqual(r.level, RISK.HIGH);
  });

  test('una falta reciente pero con muchas idas (tasa baja) → LOW', () => {
    const r = computeNoShowRisk([
      { status: 'no_show', date: '2026-06-20' },
      ...Array.from({ length: 9 }, (_, i) => ({ status: 'completed', date: `2026-0${(i % 5) + 1}-15` })),
    ], NOW);
    assert.strictEqual(r.noShows, 1);
    assert.strictEqual(r.rate, 10);          // 1/10
    assert.strictEqual(r.level, RISK.LOW);   // reciente pero rate<34
  });

  test('fechas basura no rompen el cálculo de recencia', () => {
    const r = computeNoShowRisk([
      { status: 'no_show', date: 'no-fecha' },
      { status: 'no_show', date: null },
    ], NOW);
    assert.strictEqual(r.noShows, 2);
    assert.strictEqual(r.level, RISK.HIGH);   // ≥2 faltas
    assert.strictEqual(r.recentNoShow, false); // ninguna fecha válida
  });
});
