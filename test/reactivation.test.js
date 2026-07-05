'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { reactivationEligible } = require('../src/campaigns/enqueuers');
const { PURPOSE_BLOCKS } = require('../src/telephony/outbound');

const NOW = new Date('2026-07-05T12:00:00Z').getTime();
const daysAgo = (d) => new Intl.DateTimeFormat('sv-SE').format(new Date(NOW - d * 86400000));

describe('reactivationEligible — predicado DETERMINISTA (canal voz)', () => {
  const base = { phone: '600111222', upcomingCount: 0, lastVisitDate: daysAgo(60) };

  test('elegible: teléfono + sin próximas + última visita pasado el umbral', () => {
    assert.equal(reactivationEligible(base, 42, NOW), true);
  });
  test('NO elegible sin teléfono (la voz necesita móvil, no email)', () => {
    assert.equal(reactivationEligible({ ...base, phone: null }, 42, NOW), false);
  });
  test('NO elegible si tiene cita próxima (ya va a volver)', () => {
    assert.equal(reactivationEligible({ ...base, upcomingCount: 1 }, 42, NOW), false);
  });
  test('NO elegible sin última visita conocida', () => {
    assert.equal(reactivationEligible({ ...base, lastVisitDate: null }, 42, NOW), false);
  });
  test('NO elegible si la última visita es demasiado reciente', () => {
    assert.equal(reactivationEligible({ ...base, lastVisitDate: daysAgo(10) }, 42, NOW), false);
  });
  test('justo en el umbral SÍ es elegible', () => {
    assert.equal(reactivationEligible({ ...base, lastVisitDate: daysAgo(42) }, 42, NOW), true);
  });
  test('no revienta con cliente nulo/vacío', () => {
    assert.equal(reactivationEligible(null, 42, NOW), false);
    assert.equal(reactivationEligible({}, 42, NOW), false);
  });
});

describe('PURPOSE_BLOCKS.reactivation — bloque de propósito', () => {
  test('menciona negocio, cliente y última visita', () => {
    const b = PURPOSE_BLOCKS.reactivation('Peluquería Ana', 'María', '2026-05-01');
    assert.match(b, /Peluquería Ana/);
    assert.match(b, /María/);
    assert.match(b, /2026-05-01/);
  });
  test('es una INVITACIÓN sin presión (Biblia: honestidad, no insistir)', () => {
    const b = PURPOSE_BLOCKS.reactivation('X', 'Y', '2026-01-01').toLowerCase();
    assert.match(b, /no insistas/);
    assert.match(b, /reactivaci/);
  });
  test('degrada bien sin nombre de cliente ni fecha', () => {
    const b = PURPOSE_BLOCKS.reactivation('Bar Pepe', null, null);
    assert.match(b, /Bar Pepe/);
    assert.match(b, /un cliente/);
    assert.doesNotMatch(b, /null/); // nunca colar "null" en el prompt
  });
});
