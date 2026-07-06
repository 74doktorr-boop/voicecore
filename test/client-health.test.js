// ============================================================
// NodeFlow — Salud por cliente (2026-07-06)
// A escala, el asistente de UN negocio se rompe en silencio y te
// enteras tarde. Estos tests fijan cuándo se enciende la alarma.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeClientHealth } = require('../src/monitoring/client-health');

const NOW = 1_800_000_000_000; // instante fijo (los tests no usan Date.now)
const hAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
function call(org, over = {}) {
  return { org_id: org, status: 'ended', outcome: 'info', turn_count: 6, duration_ms: 90000, started_at: hAgo(3), metrics: null, ...over };
}
function scored(org, score, over = {}) {
  return call(org, { metrics: { audit: { score, hallucinated: false } }, ...over });
}

describe('computeClientHealth', () => {
  test('negocio sano → sin issue', () => {
    const rows = [scored('a', 80), scored('a', 75), scored('a', 82), call('a', { outcome: 'booked' })];
    const { byOrg, issues } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.a.verdict, 'ok');
    assert.strictEqual(issues.length, 0);
  });

  test('llamadas rotas (status lost / 0 turnos) → crítico', () => {
    const rows = [
      call('b', { status: 'lost' }),
      call('b', { turn_count: 0 }),
      call('b'),
    ];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.b.verdict, 'critical');
    assert.ok(byOrg.b.reasons.join(' ').includes('rotas'));
  });

  test('calidad hundida (score medio < 45) → crítico', () => {
    const rows = [scored('c', 40), scored('c', 35), scored('c', 42)];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.c.verdict, 'critical');
    assert.strictEqual(byOrg.c.avgScore, 39);
  });

  test('calidad floja (score 50) → aviso, no crítico', () => {
    const rows = [scored('d', 50), scored('d', 55), scored('d', 52)];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.d.verdict, 'warning');
  });

  test('SILENCIO: recibía llamadas y 0 en 48h → crítico (desvío caído)', () => {
    const rows = [
      call('e', { started_at: hAgo(120) }), // hace 5 días
      call('e', { started_at: hAgo(100) }),
      call('e', { started_at: hAgo(80) }),
      // nada en las últimas 48h
    ];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.e.silent, true);
    assert.strictEqual(byOrg.e.verdict, 'critical');
    assert.ok(byOrg.e.reasons[0].includes('dejó de recibir'));
  });

  test('poca muestra no dispara falsos positivos de calidad', () => {
    const rows = [scored('f', 50)]; // 1 sola llamada floja
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.f.verdict, 'ok');
  });

  test('los issues salen ordenados: críticos primero', () => {
    const rows = [
      scored('warn', 55), scored('warn', 55), scored('warn', 55),
      call('crit', { status: 'lost' }), call('crit', { status: 'lost' }),
    ];
    const { issues } = computeClientHealth(rows, NOW);
    assert.strictEqual(issues[0].orgId, 'crit');
    assert.strictEqual(issues[0].verdict, 'critical');
  });
});
