// ============================================================
// NodeFlow — Festivos, vacaciones y tiempo entre citas (A6, auditoría 2026-07-29)
//
// El horario era un patrón semanal fijo SIN ninguna capa de excepciones por
// fecha: un grep de festivo|holiday|vacacion|buffer|exception en todo
// src/scheduling devolvía UNA coincidencia, y era un comentario.
//
// El caso que lo resume: el 1 de mayo de 2026 cae en VIERNES. El patrón semanal
// dice abierto. El bot reservaba ocho citas en una clínica cerrada, y los ocho
// pacientes se presentaban a una puerta con la persiana bajada.
//
// (En 2026 son laborables Año Nuevo, Reyes, Viernes Santo, el 1 de mayo, el 12
// de octubre, la Inmaculada y Navidad: siete oportunidades de plantar clientes.)
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { nationalHolidays, easterSunday, closedOn, scheduleForDate, bufferMin } = require('../src/scheduling/business-calendar');

const SEMANAL = {
  1: { open: '09:00', close: '14:00' },
  2: { open: '09:00', close: '14:00' },
  3: { open: '09:00', close: '14:00' },
  4: { open: '09:00', close: '14:00' },
  5: { open: '09:00', close: '14:00' },   // viernes
};

describe('festivos nacionales', () => {
  test('los fijos de España', () => {
    const h = nationalHolidays(2026);
    for (const d of ['2026-01-01', '2026-01-06', '2026-05-01', '2026-08-15', '2026-10-12', '2026-11-01', '2026-12-06', '2026-12-08', '2026-12-25']) {
      assert.ok(h[d], `falta ${d}`);
    }
  });

  test('Viernes Santo se mueve cada año y sale bien', () => {
    // Domingos de Pascua conocidos.
    assert.strictEqual(easterSunday(2026).toISOString().slice(0, 10), '2026-04-05');
    assert.strictEqual(easterSunday(2027).toISOString().slice(0, 10), '2027-03-28');
    assert.strictEqual(nationalHolidays(2026)['2026-04-03'], 'Viernes Santo');
    assert.strictEqual(nationalHolidays(2027)['2027-03-26'], 'Viernes Santo');
  });

  test('solo NACIONALES: no se inventan los autonómicos', () => {
    // San Fermín (7/7, local) o el Día del País Vasco no son nacionales: para
    // esos está closedDates. Cerrar de más es tan malo como cerrar de menos.
    assert.ok(!nationalHolidays(2026)['2026-07-07']);
  });
});

describe('closedOn — EL CASO DEL FESTIVO EN DÍA LABORABLE', () => {
  const cfg = { schedule: SEMANAL, nationalHolidays: true };

  test('el 1 de mayo de 2026 cae en VIERNES y el negocio está cerrado', () => {
    assert.strictEqual(new Date('2026-05-01T12:00:00Z').getUTCDay(), 5, 'sanity: es viernes');
    assert.ok(SEMANAL[5], 'y el patrón semanal dice ABIERTO — ahí estaba el agujero');
    const r = closedOn('2026-05-01', cfg);
    assert.strictEqual(r.closed, true);
    assert.strictEqual(r.reason, 'Día del Trabajo');
  });

  test('y no se generan huecos ese día', () => {
    assert.strictEqual(scheduleForDate('2026-05-01', 5, cfg), null);
  });

  test('lo mismo con Viernes Santo, que además se mueve cada año', () => {
    assert.strictEqual(closedOn('2026-04-03', cfg).reason, 'Viernes Santo');
    assert.strictEqual(scheduleForDate('2026-04-03', 5, cfg), null);
  });

  test('un viernes normal sigue abierto (sin regresión)', () => {
    assert.strictEqual(closedOn('2026-05-08', cfg).closed, false);
    assert.deepStrictEqual(scheduleForDate('2026-05-08', 5, cfg), SEMANAL[5]);
  });

  test('SIN configurar nada, el comportamiento es exactamente el de antes', () => {
    const sinNada = { schedule: SEMANAL };
    assert.strictEqual(closedOn('2026-05-01', sinNada).closed, false);
    assert.deepStrictEqual(scheduleForDate('2026-05-01', 5, sinNada), SEMANAL[5]);
  });
});

describe('closedDates — vacaciones y cierres del negocio', () => {
  test('una fecha suelta', () => {
    const cfg = { schedule: SEMANAL, closedDates: ['2026-09-10'] };
    assert.strictEqual(closedOn('2026-09-10', cfg).closed, true);
    assert.strictEqual(closedOn('2026-09-11', cfg).closed, false);
  });

  test('un rango de vacaciones, con su motivo', () => {
    const cfg = { schedule: SEMANAL, closedDates: [{ from: '2026-08-01', to: '2026-08-15', reason: 'Vacaciones de verano' }] };
    assert.strictEqual(closedOn('2026-08-01', cfg).reason, 'Vacaciones de verano');
    assert.strictEqual(closedOn('2026-08-09', cfg).closed, true, 'los días de dentro también');
    assert.strictEqual(closedOn('2026-08-15', cfg).closed, true, 'el último día incluido');
    assert.strictEqual(closedOn('2026-07-31', cfg).closed, false);
    assert.strictEqual(closedOn('2026-08-16', cfg).closed, false);
  });

  test('entradas basura se ignoran sin romper la agenda', () => {
    const cfg = { schedule: SEMANAL, closedDates: ['mañana', null, 42, {}, { to: '2026-01-01' }] };
    assert.strictEqual(closedOn('2026-01-01', cfg).closed, false);
  });
});

describe('scheduleExceptions — jornadas especiales', () => {
  test('el 24 de diciembre se cierra a las 14:00', () => {
    const cfg = { schedule: SEMANAL, scheduleExceptions: { '2026-12-24': { open: '09:00', close: '14:00' } } };
    assert.deepStrictEqual(scheduleForDate('2026-12-24', 4, cfg), { open: '09:00', close: '14:00' });
  });

  test('null = cerrado ese día concreto', () => {
    const cfg = { schedule: SEMANAL, scheduleExceptions: { '2026-09-10': null } };
    assert.strictEqual(closedOn('2026-09-10', cfg).closed, true);
    assert.strictEqual(scheduleForDate('2026-09-10', 4, cfg), null);
  });

  test('una excepción EXPLÍCITA gana a un festivo: si el dueño dice que abre, abre', () => {
    const cfg = { schedule: SEMANAL, nationalHolidays: true, scheduleExceptions: { '2026-01-06': { open: '10:00', close: '14:00' } } };
    assert.strictEqual(closedOn('2026-01-06', cfg).closed, false);
    assert.deepStrictEqual(scheduleForDate('2026-01-06', 2, cfg), { open: '10:00', close: '14:00' });
  });

  test('y gana también a unas vacaciones (el dueño abre un día suelto)', () => {
    const cfg = { schedule: SEMANAL, closedDates: [{ from: '2026-08-01', to: '2026-08-15' }], scheduleExceptions: { '2026-08-10': { open: '10:00', close: '13:00' } } };
    assert.strictEqual(closedOn('2026-08-10', cfg).closed, false);
  });

  test('un día cerrado por el patrón semanal sigue cerrado (domingo)', () => {
    assert.strictEqual(scheduleForDate('2026-08-23', 0, { schedule: SEMANAL }), null);
  });
});

describe('bufferMin — tiempo entre citas', () => {
  test('sin configurar → 0 (comportamiento de siempre)', () => {
    assert.strictEqual(bufferMin({}), 0);
    assert.strictEqual(bufferMin({ bufferMin: 0 }), 0);
    assert.strictEqual(bufferMin({ bufferMin: 'diez' }), 0);
    assert.strictEqual(bufferMin({ bufferMin: -5 }), 0);
  });
  test('configurado → se respeta', () => {
    assert.strictEqual(bufferMin({ bufferMin: 10 }), 10);
    assert.strictEqual(bufferMin({ bufferMin: 15.4 }), 15);
  });
  test('un dedazo no deja la agenda sin huecos', () => {
    assert.strictEqual(bufferMin({ bufferMin: 9999 }), 120);
  });
});
