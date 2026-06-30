'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { bookAppointment } = require('../src/integrations/booking-service');
const { MockDriver } = require('../src/integrations/drivers/mock-driver');

const recipe = {
  id: 'test-site', name: 'Test',
  steps: [
    { action: 'goto', url: '{{org.bookingUrl}}' },
    { action: 'fill', selector: '#nombre', value: '{{patient.name}}' },
    { action: 'expectText', anyOf: ['cita confirmada'] },
  ],
};
const org = { id: 'osakin', name: 'Osakin', bookingUrl: 'https://x/osakin' };
const appt = { service: 'Fisioterapia', date: '2026-07-02', time: '17:30' };
const patient = { name: 'Maite', phone: '600111222' };

describe('booking-service', () => {
  test('éxito: reserva y notifica "booked"', async () => {
    const events = [];
    const r = await bookAppointment({
      recipe, org, appt, patient,
      driverFactory: async () => new MockDriver({ present: ['#nombre'], pageText: 'su cita confirmada' }),
      notify: async (e) => events.push(e),
    });
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'booked');
    assert.strictEqual(events[0].patient.name, 'Maite');
  });

  test('fallo: fallback humano notifica "manual_needed" y NO pierde la cita', async () => {
    const events = [];
    const r = await bookAppointment({
      recipe, org, appt, patient,
      driverFactory: async () => new MockDriver({ present: ['#nombre'], pageText: 'error interno del sistema' }),
      notify: async (e) => events.push(e),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.fallback, 'human');
    assert.strictEqual(events[0].type, 'manual_needed');
    assert.strictEqual(events[0].appt.service, 'Fisioterapia'); // datos íntegros para meterla a mano
  });

  test('si ni arranca el navegador → fallback humano (no revienta)', async () => {
    const events = [];
    const r = await bookAppointment({
      recipe, org, appt, patient,
      driverFactory: async () => { throw new Error('chromium no disponible'); },
      notify: async (e) => events.push(e),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.fallback, 'human');
    assert.strictEqual(events[0].reason, 'sin_navegador');
  });

  test('un notify que peta no tumba la reserva', async () => {
    const r = await bookAppointment({
      recipe, org, appt, patient,
      driverFactory: async () => new MockDriver({ present: ['#nombre'], pageText: 'cita confirmada' }),
      notify: async () => { throw new Error('whatsapp caído'); },
    });
    assert.strictEqual(r.ok, true); // la reserva sí salió; el notify es best-effort
  });
});
