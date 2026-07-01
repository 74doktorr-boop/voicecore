'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeKpis, timeSeries, hourlyVolume, weekdayHourHeatmap, byOrg, periodDeltas } = require('../src/analytics/kpis');

const NOW = new Date('2026-07-01T12:00:00Z').getTime();
const day = (d) => new Date(NOW - d * 86400000).toISOString();

const calls = [
  { org_id: 'a', outcome: 'booked', duration_ms: 120000, started_at: day(0), turn_count: 6 },
  { org_id: 'a', outcome: 'info', duration_ms: 60000, started_at: day(1), turn_count: 4 },
  { org_id: 'a', outcome: 'booked', duration_ms: 180000, started_at: day(2), turn_count: 8 },
  { org_id: 'b', outcome: 'abandoned', duration_ms: 10000, started_at: day(20), turn_count: 2 }, // cliente b: última hace 20d
];
const appointments = [
  { organization_id: 'a', status: 'confirmed', reminder_sent: true, review_requested: true },
  { organization_id: 'a', status: 'no_show' },
  { organization_id: 'a', status: 'cancelled' },
  { organization_id: 'a', no_show_notified: true, status: 'confirmed', reminder_sent: true },
];
const orgs = [
  { id: 'a', name: 'Clínica A', plan: 'negocio', is_active: true, monthly_minutes_used: 520, registered_at: day(5) },
  { id: 'b', name: 'Peluquería B', plan: 'negocio', is_active: true, monthly_minutes_used: 50, registered_at: day(100) },
  { id: 'c', name: 'Inactivo C', plan: 'negocio', is_active: false, monthly_minutes_used: 0 },
];

describe('kpis.computeKpis', () => {
  const k = computeKpis({ calls, appointments, orgs, now: NOW, includedMinutes: 500 });
  test('conversión = reservas / llamadas', () => {
    assert.strictEqual(k.totalCalls, 4);
    assert.strictEqual(k.bookings, 2);
    assert.strictEqual(k.conversionRate, 50);
  });
  test('minutos y duración media', () => {
    assert.strictEqual(k.minutesUsed, 6.2); // (120+60+180+10)/60000... = 6.166→6.2
    assert.ok(k.avgDurationSec > 0);
  });
  test('no-shows cuentan status no_show Y no_show_notified', () => {
    assert.strictEqual(k.noShows, 2);
    assert.strictEqual(k.cancelled, 1);
    assert.strictEqual(k.noShowRate, 50);
  });
  test('MRR solo de activos; overage sobre lo incluido', () => {
    assert.strictEqual(k.activeOrgs, 2);
    assert.strictEqual(k.mrr, 98);              // 2 activos × 49
    assert.strictEqual(k.overageMinutes, 20);   // a: 520-500
    assert.strictEqual(k.overageRevenue, 2);    // 20 × 0,10
  });
  test('altas del mes', () => { assert.strictEqual(k.newOrgs, 1); }); // a hace 5d
  test('ARPU = MRR / activos', () => { assert.strictEqual(k.arpu, 49); }); // 98/2
  test('churn: orgs inactivas', () => {
    assert.strictEqual(k.churnedOrgs, 1);          // c inactivo
    assert.strictEqual(k.churnRate, 33);           // 1/3
  });
  test('automatizaciones: recordatorios y reseñas', () => {
    assert.strictEqual(k.remindersSent, 2);
    assert.strictEqual(k.reviewsRequested, 1);
    assert.strictEqual(k.confirmedAppts, 2);
  });
  test('media de turnos por llamada', () => { assert.strictEqual(k.avgTurns, 5); }); // (6+4+8+2)/4
  test('captación fuera de horario está calculada', () => {
    assert.ok(typeof k.afterHoursCalls === 'number');
    assert.ok(typeof k.afterHoursRate === 'number');
  });
});

describe('kpis.timeSeries / hourlyVolume', () => {
  test('serie de 14 días con llamadas y reservas por día', () => {
    const s = timeSeries(calls, 14, NOW);
    assert.strictEqual(s.length, 14);
    assert.strictEqual(s[13].date, '2026-07-01');     // hoy al final
    assert.strictEqual(s[13].calls, 1);
    assert.strictEqual(s[13].bookings, 1);
  });
  test('volumen por hora tiene 24 cubos', () => {
    const h = hourlyVolume(calls);
    assert.strictEqual(h.length, 24);
    assert.strictEqual(h.reduce((a, b) => a + b, 0), 4);
  });
  test('heatmap semanal es 7×24 y suma el total de llamadas', () => {
    const g = weekdayHourHeatmap(calls);
    assert.strictEqual(g.length, 7);
    assert.strictEqual(g[0].length, 24);
    const total = g.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
    assert.strictEqual(total, 4);
  });
});

describe('kpis.periodDeltas', () => {
  test('cuentas → % de variación; tasas → puntos', () => {
    const d = periodDeltas(
      { totalCalls: 120, bookings: 60, minutesUsed: 200, conversionRate: 50, afterHoursRate: 30 },
      { totalCalls: 100, bookings: 40, minutesUsed: 100, conversionRate: 40, afterHoursRate: 25 },
    );
    assert.strictEqual(d.totalCalls, 20);        // +20%
    assert.strictEqual(d.bookings, 50);          // +50%
    assert.strictEqual(d.minutesUsed, 100);      // ×2
    assert.strictEqual(d.conversionRate, 10);    // +10 puntos
    assert.strictEqual(d.afterHoursRate, 5);     // +5 puntos
  });
  test('periodo previo a cero → +100% si hay actividad ahora', () => {
    assert.strictEqual(periodDeltas({ totalCalls: 5 }, { totalCalls: 0 }).totalCalls, 100);
    assert.strictEqual(periodDeltas({ totalCalls: 0 }, { totalCalls: 0 }).totalCalls, 0);
  });
});

describe('kpis.byOrg (salud)', () => {
  const rows = byOrg({ calls, orgs, now: NOW, includedMinutes: 500 });
  test('cliente con llamadas recientes = activo', () => {
    const a = rows.find(r => r.id === 'a');
    assert.strictEqual(a.health, 'activo');
    assert.strictEqual(a.calls, 3);
    assert.ok(a.alerts.includes('en_overage'));
  });
  test('cliente activo sin uso reciente = en_riesgo + alerta', () => {
    const b = rows.find(r => r.id === 'b');
    assert.strictEqual(b.health, 'en_riesgo');
    assert.ok(b.alerts.includes('sin_uso_14d'));
  });
  test('cliente inactivo', () => {
    const c = rows.find(r => r.id === 'c');
    assert.strictEqual(c.health, 'inactivo');
    assert.ok(c.alerts.includes('inactivo'));
  });
});
