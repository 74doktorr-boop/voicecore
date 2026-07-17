// ============================================================
// NodeFlow — Motor de AFORO / plazas (2026-07-17)
// Objeción nº2 de la crítica sectorial (~20 sectores no son cita 1:1: gimnasio,
// yoga, pilates, spa, láser…). Un servicio con capacity>1 admite varias plazas
// en el mismo hueco hasta el aforo; el resto sigue siendo 1:1 (sin cambios).
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { scheduler } = require('../src/scheduling/scheduler');

const BIZ = 'aforo-test-biz-' + Math.floor(1);
const DATE = '2099-06-15'; // futuro, y con todos los días abiertos vale cualquiera

before(() => {
  const allDays = {};
  for (let d = 0; d < 7; d++) allDays[d] = { open: '09:00', close: '14:00' };
  scheduler.setBusinessConfig(BIZ, {
    name: 'Box CrossFit',
    timezone: 'Europe/Madrid',
    slotInterval: 60,
    services: [
      { id: 'wod', name: 'WOD', duration: 60, price: 10, capacity: 3 }, // clase de aforo 3
      { id: 'personal', name: 'Entreno personal', duration: 60, price: 40 }, // 1:1
    ],
    schedule: allDays,
  });
});

function book(service, time, who) {
  return scheduler.bookAppointment(BIZ, { patientName: who, phone: '+34600' + who.length, service, date: DATE, time });
}

describe('aforo — servicio con capacity>1 (clase)', () => {
  test('las 3 plazas del WOD de las 10:00 se llenan; la 4ª se rechaza', () => {
    assert.strictEqual(book('wod', '10:00', 'Ana').success, true);
    assert.strictEqual(book('wod', '10:00', 'Beto').success, true);
    assert.strictEqual(book('wod', '10:00', 'Cris').success, true);
    const cuarta = book('wod', '10:00', 'Dani');
    assert.strictEqual(cuarta.success, false);
    assert.match(cuarta.error, /completa/i);
  });

  test('otra clase (11:00) sigue libre — el aforo es por hueco', () => {
    assert.strictEqual(book('wod', '11:00', 'Eva').success, true);
  });

  test('disponibilidad: el hueco de las 10:00 desaparece al llenarse, el de 11:00 tiene plazas', () => {
    const av = scheduler.getAvailableSlots(BIZ, DATE, DATE, 'wod');
    const day = av.availableDays.find(d => d.date === DATE);
    const t10 = day.slots.find(s => s.time === '10:00');
    const t11 = day.slots.find(s => s.time === '11:00');
    assert.strictEqual(t10, undefined);               // completo → no se ofrece
    assert.ok(t11 && t11.spotsLeft === 2);            // 3 - 1 (Eva) = 2 plazas
  });
});

describe('1:1 — servicio sin capacity (comportamiento clásico intacto)', () => {
  test('la 2ª reserva del mismo hueco 1:1 se rechaza', () => {
    assert.strictEqual(book('personal', '12:00', 'Ana').success, true);
    const segunda = book('personal', '12:00', 'Beto');
    assert.strictEqual(segunda.success, false);
    assert.match(segunda.error, /ocupada/i);
  });

  test('disponibilidad 1:1: el hueco ocupado ya no aparece y no lleva spotsLeft', () => {
    const av = scheduler.getAvailableSlots(BIZ, DATE, DATE, 'personal');
    const day = av.availableDays.find(d => d.date === DATE);
    const t12 = day.slots.find(s => s.time === '12:00');
    assert.strictEqual(t12, undefined);
    const t13 = day.slots.find(s => s.time === '13:00');
    assert.ok(t13 && t13.spotsLeft === undefined);   // 1:1 no expone plazas
  });
});
