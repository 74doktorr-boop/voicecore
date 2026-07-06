// ============================================================
// NodeFlow — Prescripción de salud de clientes (2026-07-06)
// De "tu bot lo hace mal" a "haz esto": causas de llamadas rotas +
// info que faltó + acción concreta por cada señal.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeClientHealth, prescribe } = require('../src/monitoring/client-health');

const NOW = Date.parse('2026-07-06T12:00:00Z');
function call(over = {}) {
  return {
    org_id: 'org1', status: 'completed', outcome: 'info', turn_count: 5,
    started_at: '2026-07-05T10:00:00Z', duration_ms: 60000, metrics: {},
    ...over,
  };
}

describe('computeClientHealth — causas de rotura', () => {
  test('clasifica instant / no_conversation / cut_mid', () => {
    const rows = [
      call({ turn_count: 0, duration_ms: 3000 }),                 // instant
      call({ turn_count: 0, duration_ms: 30000 }),                // no_conversation
      call({ status: 'lost', turn_count: 4 }),                    // cut_mid
      call(),                                                     // sana
    ];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.deepStrictEqual(byOrg.org1.causes, { instant: 1, no_conversation: 1, cut_mid: 1 });
  });

  test('agrega info_gaps y problems del auditor', () => {
    const rows = [
      call({ metrics: { audit: { score: 55, info_gap: 'Precio de mechas', problems: ['no confirmó la cita'] } } }),
      call({ metrics: { audit: { score: 50, info_gap: 'precio de mechas', problems: ['no confirmó la cita', 'se enrolla'] } } }),
      call({ metrics: { audit: { score: 60 } } }),
    ];
    const { byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.org1.infoGaps['precio de mechas'], 2);   // case-insensitive
    assert.strictEqual(byOrg.org1.problems['no confirmó la cita'], 2);
  });
});

describe('prescribe', () => {
  test('silencio → acción de llamar y verificar el desvío, la primera', () => {
    const actions = prescribe({ silent: true, causes: {}, infoGaps: {}, problems: {} });
    assert.ok(actions.length >= 1);
    assert.match(actions[0].action, /desvío/i);
  });

  test('cuelgues instantáneos → llamada de prueba con diagnóstico de latencia', () => {
    const actions = prescribe({ causes: { instant: 3 }, infoGaps: {}, problems: {} });
    assert.match(actions[0].action, /3 cuelgue/);
    assert.match(actions[0].detail, /latencia/i);
  });

  test('info_gaps → dice EXACTAMENTE qué falta y dónde añadirlo', () => {
    const actions = prescribe({ causes: {}, infoGaps: { 'precio de mechas': 3, 'horario de sábado': 1 }, problems: {} });
    const a = actions.find(x => x.icon === '📚');
    assert.ok(a);
    assert.match(a.action, /precio de mechas.*×3/);
    assert.match(a.detail, /[Bb]ase de conocimiento/);
  });

  test('score bajo + reglas candidatas → manda a la pestaña Mejora con el número', () => {
    const actions = prescribe({ avgScore: 50, causes: {}, infoGaps: {}, problems: {} }, { pendingRules: 4 });
    const a = actions.find(x => x.icon === '🧠');
    assert.ok(a);
    assert.match(a.action, /4 regla/);
  });

  test('sin reglas pendientes no se menciona la pestaña Mejora', () => {
    const actions = prescribe({ avgScore: 50, causes: {}, infoGaps: {}, problems: {} }, { pendingRules: 0 });
    assert.ok(!actions.some(x => x.icon === '🧠'));
  });

  test('nunca más de 5 acciones (no abrumar)', () => {
    const actions = prescribe({
      silent: true, avgScore: 40, hallucinationRate: 60,
      causes: { instant: 2, no_conversation: 1, cut_mid: 3 },
      infoGaps: { a: 1 }, problems: { b: 2, c: 1 },
    }, { pendingRules: 2 });
    assert.ok(actions.length <= 5);
  });
});
