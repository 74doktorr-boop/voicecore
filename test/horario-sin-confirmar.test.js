// ============================================================
// NodeFlow — La cita a una hora inventada (2026-07-30)
//
// EL CAMINO NORMAL, NO UN CASO RARO: en el alta (routes-billing) se siembra
// `assistant_config` con nombre, voz y saludo — SIN horario. El horario por
// defecto se escribe solo en el scheduler EN MEMORIA, que se pierde al
// reiniciar y se rehidrata desde `assistant_config`, que no lo tiene.
//
// Resultado: todo cliente recién dado de alta cae en DEFAULT_SCHEDULE (L-J 9-14
// y 15:30-19:30, V 9-14). El prompt prohíbe inventar datos y pone "HORARIO:
// Consultar horario", así que la asistente NO DICE el horario... pero sí
// CONFIRMA una hora sacada de ese calendario inventado. El cliente cuelga con
// una cita para un momento en que el negocio puede estar cerrado.
//
// No se corta la reserva (perder al cliente es peor, y el negocio se queda sin
// el aviso): se coge la cita y se dice la verdad.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt, tieneHorarioConfigurado } = require('../src/assistants/prompt-generator');

const CON_HORARIO = {
  sector: 'fisioterapia',
  schedule: { mon: { open: '09:00', close: '20:00' }, tue: { open: '09:00', close: '20:00' } },
};
// La config REAL con la que arranca cualquier alta.
const RECIEN_DADO_DE_ALTA = {
  sector: 'fisioterapia',
  assistantName: 'Asistente de Centro Osakin',
  voice: 'nova',
  firstMessage: 'Hola, ha llamado a Centro Osakin.',
};

describe('tieneHorarioConfigurado', () => {
  test('un horario de verdad, sí', () => {
    assert.strictEqual(tieneHorarioConfigurado(CON_HORARIO.schedule), true);
  });
  test('ausente, nulo, vacío o basura, no', () => {
    for (const v of [undefined, null, {}, '', 0, 'lunes a viernes', []]) {
      assert.strictEqual(tieneHorarioConfigurado(v), false, `${JSON.stringify(v)} no es un horario`);
    }
  });
});

describe('generatePrompt — negocio sin horario confirmado', () => {
  const prompt = generatePrompt(RECIEN_DADO_DE_ALTA, 'Centro Osakin');

  test('avisa de que el horario NO está confirmado', () => {
    assert.match(prompt, /AÚN NO NOS HA CONFIRMADO SU HORARIO/);
  });

  test('los huecos de la herramienta quedan degradados a estimación', () => {
    // Es el nudo: la herramienta SIEMPRE devuelve huecos, incluso inventados.
    assert.match(prompt, /ESTIMACIÓN, no el horario real/);
    assert.match(prompt, /JAMÁS para afirmar/);
  });

  test('le prohíbe decir a qué hora abre', () => {
    assert.match(prompt, /NUNCA digas ni des a entender a qué hora abre/);
  });

  test('SIGUE reservando: perder al cliente sería peor que la hora imprecisa', () => {
    assert.match(prompt, /Puedes reservar con normalidad/);
    assert.match(prompt, /pendiente de confirmar/);
  });

  test('le da la frase hecha, no solo la regla abstracta', () => {
    // Una instrucción sin ejemplo se cumple a medias; con ejemplo, se copia.
    assert.match(prompt, /le confirmamos desde el centro/);
  });

  test('y qué responder si el cliente insiste en el horario', () => {
    assert.match(prompt, /No lo tengo aquí delante/);
  });
});

describe('generatePrompt — negocio CON horario', () => {
  const prompt = generatePrompt(CON_HORARIO, 'hierros a freixa');

  test('ni una palabra del bloque: sería ruido y sembraría duda', () => {
    assert.ok(!/AÚN NO NOS HA CONFIRMADO/.test(prompt));
    assert.ok(!/pendiente de confirmar/.test(prompt));
    assert.ok(!/ESTIMACIÓN/.test(prompt));
  });

  test('dice el horario real', () => {
    assert.match(prompt, /lunes: 09:00–20:00/);
  });
});
