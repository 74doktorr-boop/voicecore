// ============================================================
// NodeFlow — Reserva por PROFESIONAL (2026-07-17)
// Objeción nº1 de peluquería/barbería (y fisio de alto valor): "reservo a MI
// barbero, no a un hueco". Un profesional solo choca CONSIGO MISMO (dos barberos
// comparten el mismo hueco). Espejo del multi-sede. Staff en memoria (sin
// migración, cero riesgo pre-lanzamiento).
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { scheduler } = require('../src/scheduling/scheduler');
const { generatePrompt } = require('../src/assistants/prompt-generator');

const BIZ = 'staff-test-biz';
const DATE = '2099-05-10';

before(() => {
  const allDays = {};
  for (let d = 0; d < 7; d++) allDays[d] = { open: '09:00', close: '14:00' };
  scheduler.setBusinessConfig(BIZ, {
    name: 'Barbería Test', timezone: 'Europe/Madrid', slotInterval: 30,
    services: [{ id: 'corte', name: 'Corte', duration: 30, price: 15 }],
    schedule: allDays,
  });
});

function book(who, time, staff) {
  return scheduler.bookAppointment(BIZ, { patientName: who, phone: '+3460' + who.length, service: 'corte', date: DATE, time, staff });
}

describe('scheduler — reserva por profesional', () => {
  test('dos profesionales pueden tener el MISMO hueco', () => {
    assert.strictEqual(book('Cliente1', '10:00', 'Ana').success, true);
    assert.strictEqual(book('Cliente2', '10:00', 'Beto').success, true);   // Beto libre a las 10
  });
  test('el MISMO profesional no se duplica en el hueco', () => {
    const r = book('Cliente3', '10:00', 'Ana');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /ocupada|Ana|profesional/i);
  });
  test('disponibilidad de Ana: las 10:00 ya no aparecen', () => {
    const av = scheduler.getAvailableSlots(BIZ, DATE, DATE, 'corte', {}, null, 'Ana');
    const day = av.availableDays.find(d => d.date === DATE);
    assert.strictEqual(day.slots.find(s => s.time === '10:00'), undefined);
  });
  test('disponibilidad de Carla (libre): las 10:00 SÍ aparecen', () => {
    const av = scheduler.getAvailableSlots(BIZ, DATE, DATE, 'corte', {}, null, 'Carla');
    const day = av.availableDays.find(d => d.date === DATE);
    assert.ok(day.slots.find(s => s.time === '10:00'));
  });
});

describe('prompt — bloque EQUIPO', () => {
  test('con staff configurado, la IA sabe el equipo y pregunta por profesional', () => {
    const p = generatePrompt({ sector: 'peluqueria', staff: ['Ana', 'Beto'] }, 'Barbería X');
    assert.match(p, /EQUIPO/);
    assert.match(p, /Ana, Beto/);
    assert.match(p, /professional/);
  });
  test('acepta staff como objetos {name}', () => {
    const p = generatePrompt({ sector: 'peluqueria', staff: [{ name: 'Iker' }] }, 'X');
    assert.match(p, /Iker/);
  });
  test('sin staff → no aparece el bloque (comportamiento de siempre)', () => {
    const p = generatePrompt({ sector: 'dental' }, 'Clínica X');
    assert.doesNotMatch(p, /EQUIPO \(este negocio trabaja/);
  });
});
