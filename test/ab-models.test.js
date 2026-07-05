'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { compareModelArms, armKey } = require('../src/analytics/ab-models');

// Helper: fabricar una llamada con N turnos de un proveedor + scores.
function call({ provider, outcome, audit, quality, latency, turns = 3 }) {
  const t = [];
  for (let i = 0; i < turns; i++) t.push(provider ? { turn: i + 1, llmProvider: provider } : { turn: i + 1 });
  const metrics = { turns: t };
  if (audit != null) metrics.audit = { score: audit };
  if (quality != null) metrics.quality = { score: quality, avgLatency: latency };
  return { outcome, metrics };
}

describe('armKey — deriva el brazo del proveedor dominante', () => {
  test('proveedor mayoritario de los turnos', () => {
    assert.equal(armKey({ metrics: { turns: [{ llmProvider: 'groq' }, { llmProvider: 'groq' }, { llmProvider: 'openai' }] } }), 'groq');
  });
  test('sin turnos ni provider → null (no atribuible)', () => {
    assert.equal(armKey({ metrics: { turns: [] } }), null);
    assert.equal(armKey({ metrics: {} }), null);
    assert.equal(armKey({}), null);
  });
});

describe('compareModelArms — veredicto y métricas por brazo', () => {
  test('dos brazos ambos ≥ umbral → verdict "ready"', () => {
    const calls = [];
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'groq', outcome: i < 6 ? 'booked' : 'info', audit: 80, quality: 90, latency: 1500 }));
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'openai', outcome: i < 4 ? 'booked' : 'info', audit: 70, quality: 95, latency: 1800 }));
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.verdict, 'ready');
    assert.equal(r.totalCalls, 40);
    assert.equal(r.attributed, 40);
    assert.equal(r.arms.length, 2);
    const groq = r.arms.find(a => a.provider === 'groq');
    assert.equal(groq.n, 20);
    assert.equal(groq.booked, 6);
    assert.equal(groq.bookingRate, 30);      // 6/20
    assert.equal(groq.avgAudit, 80);
    assert.equal(groq.avgLatencyMs, 1500);
    assert.equal(groq.ready, true);
    assert.equal(groq.label, 'Llama (Groq)');
    const oa = r.arms.find(a => a.provider === 'openai');
    assert.equal(oa.label, 'gpt-4o-mini (OpenAI)');
  });

  test('un brazo por debajo del umbral → "insufficient"', () => {
    const calls = [];
    for (let i = 0; i < 25; i++) calls.push(call({ provider: 'openai', outcome: 'info', audit: 70 }));
    for (let i = 0; i < 5; i++)  calls.push(call({ provider: 'groq', outcome: 'info', audit: 80 }));
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.verdict, 'insufficient');
    assert.match(r.reason, /20/);
    assert.equal(r.arms.find(a => a.provider === 'groq').ready, false);
    assert.equal(r.arms.find(a => a.provider === 'openai').ready, true);
  });

  test('un solo brazo con datos → "insufficient" (no hay A/B)', () => {
    const calls = [];
    for (let i = 0; i < 50; i++) calls.push(call({ provider: 'openai', outcome: 'info', audit: 70 }));
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.verdict, 'insufficient');
    assert.match(r.reason, /brazo/);
    assert.equal(r.arms.length, 1);
  });

  test('llamadas no atribuibles cuentan en total pero no en un brazo', () => {
    const calls = [
      call({ provider: 'groq', outcome: 'info', audit: 80 }),
      call({ provider: null, outcome: 'abandoned', turns: 0 }),   // sin provider
      { outcome: 'abandoned' },                                    // sin metrics
    ];
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.totalCalls, 3);
    assert.equal(r.attributed, 1);
    assert.equal(r.arms.length, 1);
  });

  test('sin llamadas → insufficient, sin reventar', () => {
    const r = compareModelArms([], { threshold: 20 });
    assert.equal(r.verdict, 'insufficient');
    assert.equal(r.totalCalls, 0);
    assert.deepEqual(r.arms, []);
  });

  test('con datos suficientes DECLARA GANADOR por reservas', () => {
    const calls = [];
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'groq',   outcome: i < 6 ? 'booked' : 'info', audit: 80 })); // 30%
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'openai', outcome: i < 3 ? 'booked' : 'info', audit: 90 })); // 15%
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.verdict, 'ready');
    assert.equal(r.winner.provider, 'groq');
    assert.equal(r.winner.metric, 'reservas');
    assert.equal(r.winner.margin, 15);   // 30% - 15%
    assert.equal(r.winner.tie, false);
  });

  test('empate en reservas → gana por calidad (audit)', () => {
    const calls = [];
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'groq',   outcome: i < 5 ? 'booked' : 'info', audit: 85 }));
    for (let i = 0; i < 20; i++) calls.push(call({ provider: 'openai', outcome: i < 5 ? 'booked' : 'info', audit: 70 }));
    const r = compareModelArms(calls, { threshold: 20 });
    assert.equal(r.winner.provider, 'groq');
    assert.match(r.winner.metric, /audit/);
  });

  test('sin datos suficientes → winner null', () => {
    assert.equal(compareModelArms([], { threshold: 20 }).winner, null);
  });
});
