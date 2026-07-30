// ============================================================
// NodeFlow — El alta a medias que nadie veía (2026-07-30)
//
// 3 de las 4 orgs de producción no tenían `schedule` ni `mode`. Se dieron de
// alta, se les asignó número, y el alta nunca se terminó.
//
// Lo grave no es que falte, sino lo que pasa cuando falta: el prompt pone
// "HORARIO: Consultar horario" y prohíbe inventar nada, así que la IA NO dice
// las horas... pero `toSchedulerConfig` cae a DEFAULT_SCHEDULE y SÍ reserva
// citas dentro de un horario inventado. Cliente con cita confirmada para una
// hora en que el negocio está cerrado.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { orgReadiness, resumirFaltas } = require('../src/monitoring/org-readiness');

// La config REAL de hierros a freixa (la única org completa de producción).
const COMPLETA = {
  name: 'hierros a freixa',
  assistant_config: {
    mode: 'citas',
    firstMessage: 'Hola, ha llamado a Hierros A Freixa.',
    schedule: { mon: { open: '09:30', close: '14:00' } },
    services: [{ name: 'Corte', price: 40 }],
  },
};

// La config REAL de la org que llevaba semanas a medias.
const A_MEDIAS = {
  name: 'Centro Osakin',
  assistant_config: { sector: 'fisioterapia', bufferMin: 10, nationalHolidays: true, firstMessage: 'Hola, ha llamado a Centro Osakin.' },
};

describe('orgReadiness', () => {
  test('una org completa está lista', () => {
    const r = orgReadiness(COMPLETA);
    assert.strictEqual(r.gravedad, 'ok');
    assert.deepStrictEqual(r.faltan, []);
  });

  test('EL CASO REAL: sin horario ni servicios → crítico', () => {
    const r = orgReadiness(A_MEDIAS);
    assert.strictEqual(r.gravedad, 'critico');
    assert.strictEqual(r.negocio, 'Centro Osakin');
    const campos = r.faltan.map(f => f.campo);
    assert.ok(campos.includes('schedule'));
    assert.ok(campos.includes('services'));
    assert.ok(campos.includes('mode'));
    assert.ok(!campos.includes('firstMessage'), 'el saludo sí lo tenía');
  });

  test('la consecuencia del horario explica el daño concreto, no dice "falta un campo"', () => {
    const f = orgReadiness(A_MEDIAS).faltan.find(x => x.campo === 'schedule');
    assert.match(f.consecuencia, /INVENTADO/);
    assert.match(f.consecuencia, /cerrado/);
  });

  test('faltar solo el saludo es aviso, no crítico', () => {
    const org = { ...COMPLETA, assistant_config: { ...COMPLETA.assistant_config, firstMessage: '' } };
    assert.strictEqual(orgReadiness(org).gravedad, 'aviso');
  });

  test('los servicios valen desde el portal (serviceList) o desde el asistente', () => {
    const soloPortal = {
      name: 'X',
      assistant_config: { mode: 'citas', firstMessage: 'Hola', schedule: { mon: {} } },
      automation_config: { config: { serviceList: [{ name: 'Fisioterapia' }] } },
    };
    assert.strictEqual(orgReadiness(soloPortal).gravedad, 'ok');
  });

  test('vacíos de todas las formas cuentan como vacío', () => {
    const org = { name: 'X', assistant_config: { mode: '', firstMessage: null, schedule: {}, services: [] } };
    assert.strictEqual(orgReadiness(org).faltan.length, 4);
  });

  test('entrada vacía no revienta', () => {
    assert.doesNotThrow(() => orgReadiness());
    assert.strictEqual(orgReadiness({}).gravedad, 'critico');
    assert.strictEqual(orgReadiness({}).negocio, '(sin nombre)');
  });
});

describe('resumirFaltas', () => {
  test('una línea legible', () => {
    assert.strictEqual(resumirFaltas(orgReadiness(A_MEDIAS)),
      'sin horario configurado · sin servicios · sin modo (citas / recados)');
  });

  test('sin faltas, cadena vacía', () => {
    assert.strictEqual(resumirFaltas(orgReadiness(COMPLETA)), '');
    assert.strictEqual(resumirFaltas(null), '');
  });
});
