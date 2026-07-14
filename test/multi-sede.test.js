// ============================================================
// NodeFlow — Multi-sede light (Osakin: 3 centros, 1 número).
// Reglas que fijan estos tests:
//  1. GATE: sin locations configuradas, TODO se comporta como siempre
//     (cero riesgo para las orgs mono-sede en la semana del lanzamiento).
//  2. Con centros: la disponibilidad y el anti-solape son POR CENTRO
//     (Tolosa llena no bloquea Villabona); las citas legado sin centro
//     bloquean siempre (prudencia).
//  3. Candados deterministas en los tools: sin centro → se pregunta,
//     no se adivina (mismo patrón que confirmed_with_customer).
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { scheduler } = require('../src/scheduling/scheduler');

const BIZ = 'test-multisede-biz';

function freshBiz() {
  // Limpia citas del negocio de prueba entre tests
  for (const [id, apt] of scheduler.appointments) {
    if (apt.businessId === BIZ) scheduler.appointments.delete(id);
  }
  scheduler.businessConfigs.set(BIZ, {
    name: 'Centro Test',
    services: [{ id: 'fisio', name: 'Fisioterapia', duration: 45, price: 45 }],
    schedule: { 1: { open: '09:00', close: '14:00' }, 2: { open: '09:00', close: '14:00' }, 3: { open: '09:00', close: '14:00' }, 4: { open: '09:00', close: '14:00' }, 5: { open: '09:00', close: '14:00' } },
    slotInterval: 15,
  });
}

// Próximo día laborable (lunes-viernes) en el futuro
function nextWeekday() {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().split('T')[0];
}

describe('multi-sede: scheduler', () => {
  beforeEach(freshBiz);

  test('misma hora en DOS centros distintos → ambas se reservan (no chocan)', () => {
    const date = nextWeekday();
    const r1 = scheduler.bookAppointment(BIZ, { patientName: 'Ana', service: 'Fisioterapia', date, time: '10:00', location: 'Tolosa' });
    assert.equal(r1.success, true, r1.error);
    const r2 = scheduler.bookAppointment(BIZ, { patientName: 'Jon', service: 'Fisioterapia', date, time: '10:00', location: 'Villabona' });
    assert.equal(r2.success, true, 'otro centro a la misma hora debe caber: ' + r2.error);
    assert.equal(r2.appointment.location, 'Villabona');
  });

  test('misma hora en el MISMO centro → la segunda se rechaza', () => {
    const date = nextWeekday();
    scheduler.bookAppointment(BIZ, { patientName: 'Ana', service: 'Fisioterapia', date, time: '10:00', location: 'Tolosa' });
    const r2 = scheduler.bookAppointment(BIZ, { patientName: 'Jon', service: 'Fisioterapia', date, time: '10:00', location: 'Tolosa' });
    assert.equal(r2.success, false);
    assert.match(r2.error, /Tolosa/);
  });

  test('cita LEGADO sin centro bloquea en todos los centros (prudencia)', () => {
    const date = nextWeekday();
    scheduler.bookAppointment(BIZ, { patientName: 'Legacy', service: 'Fisioterapia', date, time: '10:00' }); // sin location
    const r2 = scheduler.bookAppointment(BIZ, { patientName: 'Jon', service: 'Fisioterapia', date, time: '10:00', location: 'Villabona' });
    assert.equal(r2.success, false, 'una cita sin centro debe bloquear todos');
  });

  test('GATE: sin location, el comportamiento clásico no cambia', () => {
    const date = nextWeekday();
    const r1 = scheduler.bookAppointment(BIZ, { patientName: 'Ana', service: 'Fisioterapia', date, time: '10:00' });
    assert.equal(r1.success, true);
    assert.equal(r1.appointment.location, null);
    const r2 = scheduler.bookAppointment(BIZ, { patientName: 'Jon', service: 'Fisioterapia', date, time: '10:00' });
    assert.equal(r2.success, false); // mismo choque de siempre
  });

  test('getAvailableSlots por centro: el hueco ocupado en Tolosa sigue libre para Villabona', () => {
    const date = nextWeekday();
    scheduler.bookAppointment(BIZ, { patientName: 'Ana', service: 'Fisioterapia', date, time: '10:00', location: 'Tolosa' });
    const tolosa = scheduler.getAvailableSlots(BIZ, date, date, 'Fisioterapia', {}, 'Tolosa');
    const villabona = scheduler.getAvailableSlots(BIZ, date, date, 'Fisioterapia', {}, 'Villabona');
    const has10 = (r) => (r.availableDays[0]?.slots || []).some(s => s.time === '10:00');
    assert.equal(has10(tolosa), false, 'en Tolosa el 10:00 está pillado');
    assert.equal(has10(villabona), true, 'en Villabona el 10:00 sigue libre');
  });
});

describe('multi-sede: candados del executor', () => {
  const { ToolExecutor } = require('../src/tools/executor');

  test('los schemas de los tools exponen el parámetro location', () => {
    const tools = ToolExecutor.toOpenAITools(['check_availability', 'book_appointment']);
    const byName = Object.fromEntries(tools.map(t => [t.function.name, t.function]));
    assert.ok(byName.check_availability.parameters.properties.location, 'check_availability sin location');
    assert.ok(byName.book_appointment.parameters.properties.location, 'book_appointment sin location');
  });
});
