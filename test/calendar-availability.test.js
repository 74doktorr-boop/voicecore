// Disponibilidad real contra Google Calendar (feature A).
// Cubre el conversor puro de intervalos freebusy → bloques por día, y que el
// scheduler respeta esos bloques externos al listar huecos y al reservar.

const { test } = require('node:test');
const assert   = require('node:assert');
const { busyIntervalsToByDate } = require('../src/integrations/google-calendar');
const { scheduler } = require('../src/scheduling/scheduler');

test('busyIntervalsToByDate: evento mismo día → minutos del día en Madrid', () => {
  // Verano en España = UTC+2 → 08:00Z = 10:00 Madrid
  const map = busyIntervalsToByDate([{ start: '2026-07-10T08:00:00Z', end: '2026-07-10T09:00:00Z' }]);
  assert.deepStrictEqual(map['2026-07-10'], [{ startMin: 600, endMin: 660 }]);
});

test('busyIntervalsToByDate: descarta intervalos inválidos', () => {
  assert.deepStrictEqual(busyIntervalsToByDate([{ start: 'x', end: 'y' }]), {});
  assert.deepStrictEqual(busyIntervalsToByDate([]), {});
  assert.deepStrictEqual(busyIntervalsToByDate(null), {});
});

test('busyIntervalsToByDate: evento que cruza medianoche se parte por día', () => {
  // 21:00Z = 23:00 Madrid del día 10 ; 23:00Z = 01:00 Madrid del día 11
  const map = busyIntervalsToByDate([{ start: '2026-07-10T21:00:00Z', end: '2026-07-10T23:00:00Z' }]);
  assert.deepStrictEqual(map['2026-07-10'], [{ startMin: 23 * 60, endMin: 24 * 60 }]);
  assert.deepStrictEqual(map['2026-07-11'], [{ startMin: 0, endMin: 60 }]);
});

test('_isSlotTaken respeta bloques externos de Google Calendar', () => {
  // negocio sin citas propias → decide solo el bloque externo
  const solapa = scheduler._isSlotTaken('biz-inexistente', '2099-01-05', '10:00', 30, [{ startMin: 600, endMin: 630 }]);
  assert.strictEqual(solapa, true);
  const libre  = scheduler._isSlotTaken('biz-inexistente', '2099-01-05', '10:00', 30, [{ startMin: 660, endMin: 690 }]);
  assert.strictEqual(libre, false);
  // sin extraBusy → comportamiento clásico (libre)
  assert.strictEqual(scheduler._isSlotTaken('biz-inexistente', '2099-01-05', '10:00', 30), false);
});

test('getAvailableSlots excluye el hueco ocupado en Google Calendar', () => {
  const from = '2099-03-02', to = '2099-03-02';
  const base = scheduler.getAvailableSlots('demo-clinic', from, to, null, {});
  const day  = base.availableDays && base.availableDays[0];
  if (!day || !day.slots.length) return; // demo-clinic cerrado ese día → no aplica
  const t = day.slots[0].time;
  const [h, m] = t.split(':').map(Number);
  const busyByDate = { [day.date]: [{ startMin: h * 60 + m, endMin: h * 60 + m + 15 }] };
  const withBusy = scheduler.getAvailableSlots('demo-clinic', from, to, null, busyByDate);
  const d2 = (withBusy.availableDays || []).find(x => x.date === day.date);
  const stillThere = d2 && d2.slots.some(s => s.time === t);
  assert.strictEqual(stillThere, false, `el hueco ${t} debía quedar excluido por Google Calendar`);
});

test('bookAppointment rechaza reservar sobre un evento de Google Calendar', () => {
  const r = scheduler.bookAppointment('demo-clinic', {
    patientName: 'Test GCal', phone: '600000000', service: 'revisión',
    date: '2099-03-03', time: '10:00',
  }, [{ startMin: 600, endMin: 660 }]); // 10:00-11:00 ocupado en GCal
  assert.strictEqual(r.success, false);
  assert.match(r.error, /ocupada/i);
});
