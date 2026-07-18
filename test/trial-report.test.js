// ============================================================
// NodeFlow — Informe de resultados auditado (2026-07-18)
// El nº1 de "lo que me haría pagar" (crítica ronda 3): informe HONESTO y
// verificable de lo que citó el bot. Tests de la atribución (no inflar) y CSV.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildTrialReport, trialReportCsv, money } = require('../src/reports/trial-report');

const CALLS = [
  { outcome: 'booked', duration_ms: 120000, started_at: '2026-07-10T10:00:00Z' },
  { outcome: 'booked', duration_ms: 90000, started_at: '2026-07-11T11:00:00Z' },
  { outcome: 'info', duration_ms: 60000, started_at: '2026-07-12T12:00:00Z' },
];
const APTS = [
  { patient_name: 'Ana', service: 'Corte', date: '2026-07-12', price: 20, status: 'confirmed' },
  { patient_name: 'Beto', service: 'Tinte', date: '2026-07-10', price: 0, status: 'confirmed' },   // usa ticket medio
  { patient_name: 'Cira', service: 'Corte', date: '2026-07-11', price: 15, status: 'cancelled' },   // excluida
];

describe('buildTrialReport — atribución honesta', () => {
  const r = buildTrialReport({ calls: CALLS, appointments: APTS, avgTicket: 30, fromDate: '2026-07-01', toDate: '2026-07-18' });

  test('recuenta llamadas atendidas y las que cerraron cita', () => {
    assert.strictEqual(r.handledCalls, 3);
    assert.strictEqual(r.botBookedCalls, 2);   // solo outcome='booked'
  });
  test('itemiza citas no canceladas, ordenadas por fecha', () => {
    assert.strictEqual(r.apptCount, 2);
    assert.deepStrictEqual(r.appointments.map(a => a.name), ['Beto', 'Ana']);   // 10 antes que 12
  });
  test('valor por cita: precio real o ticket medio, marcado', () => {
    const beto = r.appointments.find(a => a.name === 'Beto');
    assert.strictEqual(beto.value, 30);            // sin precio → ticket medio 30
    assert.strictEqual(beto.pricedFrom, 'ticket_medio');
    const ana = r.appointments.find(a => a.name === 'Ana');
    assert.strictEqual(ana.value, 20);
    assert.strictEqual(ana.pricedFrom, 'real');
  });
  test('rescuedValue = botBookedCalls × ticket (honesto, NO el total)', () => {
    assert.strictEqual(r.rescuedValue, 60);        // 2 × 30, no la suma de citas (50)
    assert.strictEqual(r.bookedValue, 50);         // suma real de las citas listadas
  });
  test('sin ticket medio → rescuedValue 0 y nota que lo pide', () => {
    const r0 = buildTrialReport({ calls: CALLS, appointments: APTS, avgTicket: 0, fromDate: 'a', toDate: 'b' });
    assert.strictEqual(r0.rescuedValue, 0);
    assert.ok(/ticket medio/i.test(r0.note));
  });
});

describe('trialReportCsv', () => {
  test('cabecera BOM + resumen + filas verificables', () => {
    const r = buildTrialReport({ calls: CALLS, appointments: APTS, avgTicket: 30, fromDate: '2026-07-01', toDate: '2026-07-18' });
    const csv = trialReportCsv(r);
    assert.ok(csv.startsWith('﻿INFORME'));
    assert.ok(csv.includes('Llamadas que terminaron en cita,2'));
    assert.ok(csv.includes('Fecha,Cliente,Servicio'));
    assert.ok(csv.includes('2026-07-12,Ana,Corte,20,real'));
    assert.ok(csv.includes('2026-07-10,Beto,Tinte,30,ticket medio'));
  });
});

describe('money', () => {
  test('redondea a 2 decimales sin ruido', () => {
    assert.strictEqual(money(0.1 + 0.2), 0.3);
  });
});
