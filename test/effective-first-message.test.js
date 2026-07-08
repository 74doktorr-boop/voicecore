// ============================================================
// NodeFlow — Saludo efectivo: UNA sola verdad (bug real 2026-07-08)
// ------------------------------------------------------------
// La pantalla Configuración guardaba el "Mensaje de bienvenida" en
// automation_config.config.welcomeMessage — un campo que NADA leía
// (ni el runtime de llamadas ni la pantalla Asistente, que usan
// assistant_config.firstMessage). El dueño guardaba su saludo nuevo
// y las llamadas seguían con el viejo. effectiveFirstMessage es la
// migración suave: honra el legado hasta que cualquier guardado
// converja los dos almacenes en firstMessage.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { effectiveFirstMessage } = require('../src/assistants/org-assistant');

describe('effectiveFirstMessage — convergencia del saludo', () => {
  test('legado pendiente (guardado desde Configuración) gana: es lo último que el dueño guardó', () => {
    const asis = { firstMessage: 'Muy buenas, bienvenido al asistente de voz de NodeFlow' };
    const auto = { config: { welcomeMessage: 'Hola, ha llamado a Fisioterapia Unai. Soy su asistente, ¿en qué puedo ayudarle?' } };
    assert.strictEqual(
      effectiveFirstMessage(asis, auto),
      'Hola, ha llamado a Fisioterapia Unai. Soy su asistente, ¿en qué puedo ayudarle?'
    );
  });

  test('sin legado: manda el canónico assistant_config.firstMessage', () => {
    const asis = { firstMessage: 'Buenas, clínica Etxeberria, dígame' };
    assert.strictEqual(effectiveFirstMessage(asis, { config: {} }), 'Buenas, clínica Etxeberria, dígame');
    assert.strictEqual(effectiveFirstMessage(asis, null), 'Buenas, clínica Etxeberria, dígame');
    assert.strictEqual(effectiveFirstMessage(asis, undefined), 'Buenas, clínica Etxeberria, dígame');
  });

  test('legado vacío o solo espacios NO tapa al canónico', () => {
    const asis = { firstMessage: 'Saludo canónico' };
    assert.strictEqual(effectiveFirstMessage(asis, { config: { welcomeMessage: '' } }), 'Saludo canónico');
    assert.strictEqual(effectiveFirstMessage(asis, { config: { welcomeMessage: '   ' } }), 'Saludo canónico');
  });

  test('legado no-string (basura vieja) NO tapa al canónico', () => {
    const asis = { firstMessage: 'Saludo canónico' };
    assert.strictEqual(effectiveFirstMessage(asis, { config: { welcomeMessage: 42 } }), 'Saludo canónico');
    assert.strictEqual(effectiveFirstMessage(asis, { config: { welcomeMessage: null } }), 'Saludo canónico');
  });

  test('sin nada: cadena vacía (el runtime cae a defaultFirstMessage con el nombre VIVO de la org)', () => {
    assert.strictEqual(effectiveFirstMessage({}, {}), '');
    assert.strictEqual(effectiveFirstMessage(null, null), '');
    assert.strictEqual(effectiveFirstMessage(undefined, undefined), '');
  });

  test('el legado se recorta (trim) — venía de un textarea', () => {
    assert.strictEqual(
      effectiveFirstMessage({}, { config: { welcomeMessage: '  Hola, dígame  ' } }),
      'Hola, dígame'
    );
  });
});
