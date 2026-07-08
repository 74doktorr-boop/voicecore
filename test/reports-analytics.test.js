// ============================================================
// NodeFlow — Tests de la analítica de Informes (puras)
// Bucketing, delta %, embudo, distribuciones, insights, money story.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const A = require('../src/reports/analytics');

// Fecha fija de referencia (mediodía Madrid) para determinismo
const NOW = new Date('2026-07-08T10:00:00Z').getTime();

describe('buildBuckets', () => {
  test('semana → 7 cubos diarios', () => {
    const { granularity, buckets } = A.buildBuckets('week', NOW);
    assert.strictEqual(granularity, 'day');
    assert.strictEqual(buckets.length, 7);
    // último cubo es hoy
    assert.strictEqual(buckets[6].key, A.madridDayKey(NOW));
  });
  test('mes → 30 cubos diarios', () => {
    const { buckets } = A.buildBuckets('month', NOW);
    assert.strictEqual(buckets.length, 30);
  });
  test('año → cubos semanales (52)', () => {
    const { granularity, buckets } = A.buildBuckets('year', NOW);
    assert.strictEqual(granularity, 'week');
    assert.strictEqual(buckets.length, 53); // ceil(365/7)
  });
  test('rango desconocido cae a mes por defecto vía buildReport', () => {
    const r = A.buildReport({ range: 'nope', calls: [], now: NOW });
    assert.strictEqual(r.range, 'month');
  });
});

describe('bucketize', () => {
  test('reparte eventos en el cubo correcto y suma 1 por defecto', () => {
    const { granularity, buckets } = A.buildBuckets('week', NOW);
    const todayISO = new Date(NOW).toISOString();
    const yesterdayISO = new Date(NOW - 864e5).toISOString();
    const series = A.bucketize(buckets, granularity,
      [{ t: todayISO }, { t: todayISO }, { t: yesterdayISO }], x => x.t);
    assert.strictEqual(series[6], 2); // hoy
    assert.strictEqual(series[5], 1); // ayer
  });
  test('ignora eventos fuera del rango', () => {
    const { granularity, buckets } = A.buildBuckets('week', NOW);
    const old = new Date(NOW - 60 * 864e5).toISOString();
    const series = A.bucketize(buckets, granularity, [{ t: old }], x => x.t);
    assert.strictEqual(series.reduce((a, b) => a + b, 0), 0);
  });
  test('incOf permite sumar valores arbitrarios', () => {
    const { granularity, buckets } = A.buildBuckets('week', NOW);
    const todayISO = new Date(NOW).toISOString();
    const series = A.bucketize(buckets, granularity, [{ t: todayISO, v: 5 }], x => x.t, x => x.v);
    assert.strictEqual(series[6], 5);
  });
});

describe('computeDelta', () => {
  test('subida positiva', () => {
    const d = A.computeDelta(12, 10);
    assert.strictEqual(d.pct, 20);
    assert.strictEqual(d.dir, 'up');
  });
  test('bajada negativa', () => {
    const d = A.computeDelta(8, 10);
    assert.strictEqual(d.pct, -20);
    assert.strictEqual(d.dir, 'down');
  });
  test('sin base previa → pct null, dir up', () => {
    const d = A.computeDelta(5, 0);
    assert.strictEqual(d.pct, null);
    assert.strictEqual(d.dir, 'up');
  });
  test('0 vs 0 → flat', () => {
    const d = A.computeDelta(0, 0);
    assert.strictEqual(d.pct, 0);
    assert.strictEqual(d.dir, 'flat');
  });
});

describe('computeFunnel', () => {
  const calls = [
    { status: 'ended', outcome: 'booked' },
    { status: 'ended', outcome: 'booked' },
    { status: 'ended', outcome: 'info' },
    { status: 'ended', outcome: 'abandoned' },
    { status: 'failed', outcome: null },
  ];
  const appts = [
    { status: 'confirmed', date: '2026-07-01' }, // pasada → completada
    { status: 'confirmed', date: '2026-07-20' }, // futura
    { status: 'cancelled', date: '2026-07-01' }, // no cuenta
  ];
  test('cuenta cada paso y % sobre total', () => {
    const f = A.computeFunnel(calls, appts, NOW);
    const by = Object.fromEntries(f.steps.map(s => [s.key, s.value]));
    assert.strictEqual(by.calls, 5);
    assert.strictEqual(by.answered, 3); // no abandoned, no failed
    assert.strictEqual(by.booked, 2);
    assert.strictEqual(by.completed, 1); // solo la confirmada y pasada
    assert.strictEqual(f.convRate, 40); // 2/5
  });
  test('dropPct entre pasos consecutivos', () => {
    const f = A.computeFunnel(calls, appts, NOW);
    const booked = f.steps.find(s => s.key === 'booked');
    // de atendidas(3) a citas(2) = 33% caída
    assert.strictEqual(booked.dropPct, 33);
  });
  test('sin llamadas → todo 0, convRate 0', () => {
    const f = A.computeFunnel([], [], NOW);
    assert.strictEqual(f.convRate, 0);
    assert.strictEqual(f.steps[0].value, 0);
  });
});

describe('weekdayDistribution / hourDistribution', () => {
  test('weekday ordena Lun..Dom y suma en Madrid', () => {
    // 2026-07-06 es lunes
    const calls = [{ startTime: '2026-07-06T09:00:00Z' }, { startTime: '2026-07-06T11:00:00Z' }];
    const w = A.weekdayDistribution(calls);
    assert.strictEqual(w[0].label, 'Lun');
    assert.strictEqual(w[0].value, 2);
    assert.strictEqual(w.length, 7);
  });
  test('hour reparte 0..23', () => {
    const calls = [{ startTime: '2026-07-06T09:30:00Z' }]; // 11:30 Madrid (verano +2)
    const h = A.hourDistribution(calls);
    assert.strictEqual(h.length, 24);
    const total = h.reduce((a, b) => a + b.value, 0);
    assert.strictEqual(total, 1);
  });
});

describe('topServices', () => {
  test('cuenta y ordena, ignora canceladas y vacías', () => {
    const appts = [
      { service: 'Corte', status: 'confirmed' },
      { service: 'Corte', status: 'confirmed' },
      { service: 'Tinte', status: 'confirmed' },
      { service: 'Corte', status: 'cancelled' }, // no cuenta
      { service: '', status: 'confirmed' },        // vacío no cuenta
    ];
    const top = A.topServices(appts);
    assert.strictEqual(top[0].name, 'Corte');
    assert.strictEqual(top[0].count, 2);
    assert.strictEqual(top[1].name, 'Tinte');
  });
});

describe('insights (reglas deterministas)', () => {
  test('weekday: día que concentra ≥30% se destaca', () => {
    const dist = [
      { label: 'Lun', value: 1, dow: 1 }, { label: 'Mar', value: 1, dow: 2 },
      { label: 'Mié', value: 1, dow: 3 }, { label: 'Jue', value: 1, dow: 4 },
      { label: 'Vie', value: 10, dow: 5 }, { label: 'Sáb', value: 1, dow: 6 },
      { label: 'Dom', value: 1, dow: 0 },
    ];
    const s = A.insightWeekday(dist, 16);
    assert.match(s, /viernes/);
    assert.match(s, /reforzar/);
  });
  test('weekday: pocos datos → null', () => {
    assert.strictEqual(A.insightWeekday([{ value: 1, dow: 1 }], 3), null);
  });
  test('funnel: mayor fuga atendida→cita da mensaje de cierre', () => {
    const funnel = {
      convRate: 20,
      steps: [
        { key: 'calls', label: 'Llamadas', value: 10, dropPct: 0 },
        { key: 'answered', label: 'Atendidas', value: 9, dropPct: 10 },
        { key: 'booked', label: 'Citas', value: 2, dropPct: 78 },
        { key: 'completed', label: 'Completadas', value: 2, dropPct: 0 },
      ],
    };
    const s = A.insightFunnel(funnel);
    assert.match(s, /cierre/);
  });
  test('trend: crecimiento ≥15% se anuncia', () => {
    const s = A.insightTrend([5, 5, 5, 5], 10);
    assert.match(s, /crecen/);
  });
  test('money: usa atribución si hay valor', () => {
    const s = A.insightMoney({ totals: { count: 3, value: 210 } }, 100);
    assert.match(s, /3 citas/);
    assert.match(s, /210/);
  });
  test('services: estrella ≥40%', () => {
    const s = A.insightServices([{ name: 'Corte', count: 5 }], 10);
    assert.match(s, /estrella/);
  });
});

describe('buildMoneyStory', () => {
  test('reparte atribución auto/personal + voz', () => {
    const attr = { totals: { count: 4, value: 400, auto: 3, personal: 1 } };
    const m = A.buildMoneyStory(attr, 200, 50);
    const keys = m.segments.map(s => s.key);
    assert.ok(keys.includes('voz'));
    assert.ok(keys.includes('seguimientos'));
    assert.ok(keys.includes('fichas'));
    assert.strictEqual(m.recovered, 400);
    assert.strictEqual(m.hasAttribution, true);
  });
  test('sin atribución → solo voz', () => {
    const m = A.buildMoneyStory(null, 150, 50);
    assert.strictEqual(m.segments.length, 1);
    assert.strictEqual(m.segments[0].key, 'voz');
    assert.strictEqual(m.hasAttribution, false);
  });
});

describe('buildReport (integración pura)', () => {
  const calls = [
    { startTime: '2026-07-08T08:00:00Z', status: 'ended', outcome: 'booked' },
    { startTime: '2026-07-08T09:00:00Z', status: 'ended', outcome: 'info' },
    { startTime: '2026-07-07T09:00:00Z', status: 'ended', outcome: 'booked' },
    { startTime: '2026-07-06T09:00:00Z', status: 'ended', outcome: 'abandoned' },
    { startTime: '2026-07-05T09:00:00Z', status: 'ended', outcome: 'booked' },
    { startTime: '2026-07-04T09:00:00Z', status: 'ended', outcome: 'info' },
  ];
  const prevCalls = [{ status: 'ended', outcome: 'booked' }, { status: 'ended', outcome: 'info' }];
  const appts = [{ service: 'Corte', status: 'confirmed', date: '2026-07-01' }];

  test('devuelve payload completo y coherente', () => {
    const r = A.buildReport({
      range: 'week', calls, prevCalls, appointments: appts,
      avgTicket: 50, now: NOW,
      attribution: { totals: { count: 2, value: 100, auto: 2, personal: 0 } },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.range, 'week');
    assert.strictEqual(r.hasData, true);
    assert.strictEqual(r.kpis.totalCalls.value, 6);
    assert.strictEqual(r.kpis.bookings.value, 3);
    assert.strictEqual(r.kpis.revenueEst.value, 150); // 3 * 50
    assert.strictEqual(r.trend.calls.length, 7);
    assert.strictEqual(r.trend.calls.reduce((a, b) => a + b, 0), 6);
    // delta bookings 3 vs 1 previo = +200%
    assert.strictEqual(r.kpis.bookings.delta.pct, 200);
    assert.strictEqual(r.funnel.convRate, 50); // 3/6
    assert.ok(r.money.segments.length >= 1);
  });

  test('empty state honesto sin datos', () => {
    const r = A.buildReport({ range: 'month', calls: [], appointments: [], now: NOW });
    assert.strictEqual(r.hasData, false);
    assert.strictEqual(r.kpis.totalCalls.value, 0);
  });

  test('lowData marcado cuando <5 llamadas', () => {
    const r = A.buildReport({ range: 'month', calls: calls.slice(0, 3), appointments: [], now: NOW });
    assert.strictEqual(r.lowData, true);
  });
});
