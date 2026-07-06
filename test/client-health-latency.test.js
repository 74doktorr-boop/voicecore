// ============================================================
// NodeFlow — Vigilancia de latencia por turno (2026-07-06)
// La latencia se capturaba (metrics.turns[].totalTime) pero nadie la
// miraba: en prod hay medias de 1.7-2.2s/turno con objetivo <0.7s.
// Ahora salud la vigila y prescribe según el componente dominante.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeClientHealth, prescribe } = require('../src/monitoring/client-health');

const NOW = Date.parse('2026-07-06T12:00:00Z');
function call(over = {}) {
  return {
    org_id: 'org1', status: 'completed', outcome: 'booked', turn_count: 5,
    started_at: '2026-07-05T10:00:00Z', duration_ms: 60000, metrics: {},
    ...over,
  };
}
function slowMetrics(perTurnMs, n, comp = {}) {
  return {
    turns: Array.from({ length: n }, (_, i) => ({ turn: i + 1, totalTime: perTurnMs })),
    totalLlmTime: comp.llm || 0, totalTtsTime: comp.tts || 0,
    totalSttTime: comp.stt || 0, totalToolTime: comp.tool || 0,
  };
}

describe('latencia por turno', () => {
  test('media alta con muestra suficiente → warning "va lento"', () => {
    const rows = [
      call({ metrics: slowMetrics(2200, 3, { llm: 4500, tts: 1500 }) }),
      call({ metrics: slowMetrics(1800, 3, { llm: 3600, tts: 1200 }) }),
    ];
    const { issues, byOrg } = computeClientHealth(rows, NOW);
    assert.strictEqual(byOrg.org1.avgTurnMs, 2000);
    assert.ok(issues.length === 1);
    assert.match(issues[0].reasons.join(' '), /va lento \(2\.0s por turno\)/);
  });

  test('pocos turnos → no juzga (sin falsos positivos)', () => {
    const rows = [call({ metrics: slowMetrics(3000, 2) })];
    const { issues } = computeClientHealth(rows, NOW);
    assert.strictEqual(issues.length, 0);
  });

  test('latencia buena → sin issue', () => {
    const rows = [call({ metrics: slowMetrics(600, 6) })];
    const { issues } = computeClientHealth(rows, NOW);
    assert.strictEqual(issues.length, 0);
  });

  test('prescribe señala el componente dominante (LLM) con su arreglo', () => {
    const actions = prescribe({
      latTurns: 6, avgTurnMs: 2000,
      llmSum: 8000, ttsSum: 2000, sttSum: 1000, toolSum: 500,
      causes: {}, infoGaps: {}, problems: {},
    });
    const a = actions.find(x => x.icon === '🐢');
    assert.ok(a);
    assert.match(a.action, /2\.0s de media/);
    assert.match(a.action, /70% se va en LLM/);
    assert.match(a.detail, /prompt|modelo/i);
  });

  test('prescribe señala herramientas cuando dominan', () => {
    const actions = prescribe({
      latTurns: 6, avgTurnMs: 1800,
      llmSum: 1000, ttsSum: 500, sttSum: 200, toolSum: 9000,
      causes: {}, infoGaps: {}, problems: {},
    });
    const a = actions.find(x => x.icon === '🐢');
    assert.match(a.action, /herramientas/);
    assert.match(a.detail, /integraci/i);
  });
});
