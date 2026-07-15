// ============================================================
// NodeFlow — Cancelar por NOMBRE coge la cita PRÓXIMA, no la más antigua.
// Auditoría 2026-07-16: el Map se hidrata en orden ascendente con hasta 90
// días de histórico, y la búsqueda cogía el primer match → cancelaba la cita
// más VIEJA (incluso pasada), dejando viva la de mañana (no-show + hueco no
// liberado). Ahora: solo futuras, la más próxima.
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scheduler } = require('../src/scheduling/scheduler');

const BIZ = 'org-cancel-test';
const NAME = 'Cliente Cancelacion';

function put(id, date, time) {
  scheduler.appointments.set(id, {
    id, businessId: BIZ, patientName: NAME, phone: '+34600999888',
    service: 'X', date, time, duration: 30, status: 'confirmed',
  });
}
const iso = (deltaDays) => { const d = new Date(); d.setDate(d.getDate() + deltaDays); return d.toLocaleDateString('sv-SE'); };

describe('cancelAppointment por nombre — cita próxima, no la más antigua', () => {
  beforeEach(() => {
    for (const [k, a] of scheduler.appointments) if (a.businessId === BIZ) scheduler.appointments.delete(k);
  });

  test('con una cita PASADA (confirmed) y una de mañana → cancela la de MAÑANA', () => {
    put('CN-PAST', iso(-20), '10:00');   // pasada, sigue 'confirmed'
    put('CN-FUT',  iso(1),  '09:00');    // mañana
    const r = scheduler.cancelAppointment(null, NAME, BIZ);
    assert.strictEqual(r.success, true);
    assert.strictEqual(scheduler.appointments.get('CN-FUT').status, 'cancelled');
    assert.strictEqual(scheduler.appointments.get('CN-PAST').status, 'confirmed', 'la pasada NO se toca');
  });

  test('con dos futuras → cancela la MÁS PRÓXIMA', () => {
    put('CN-A', iso(5), '10:00');
    put('CN-B', iso(2), '10:00');   // más próxima
    scheduler.cancelAppointment(null, NAME, BIZ);
    assert.strictEqual(scheduler.appointments.get('CN-B').status, 'cancelled');
    assert.strictEqual(scheduler.appointments.get('CN-A').status, 'confirmed');
  });

  test('solo citas pasadas → no cancela nada (no hay próxima)', () => {
    put('CN-OLD', iso(-3), '10:00');
    const r = scheduler.cancelAppointment(null, NAME, BIZ);
    assert.strictEqual(r.success, false);
    assert.strictEqual(scheduler.appointments.get('CN-OLD').status, 'confirmed');
  });

  test('scope de negocio: no cancela la cita de otra org con el mismo nombre', () => {
    scheduler.appointments.set('CN-OTHER', { id: 'CN-OTHER', businessId: 'org-otra', patientName: NAME, phone: '+34600999888', service: 'X', date: iso(1), time: '09:00', duration: 30, status: 'confirmed' });
    put('CN-MINE', iso(3), '09:00');
    scheduler.cancelAppointment(null, NAME, BIZ);
    assert.strictEqual(scheduler.appointments.get('CN-OTHER').status, 'confirmed', 'la de otra org intacta');
    assert.strictEqual(scheduler.appointments.get('CN-MINE').status, 'cancelled');
    scheduler.appointments.delete('CN-OTHER');
  });
});
