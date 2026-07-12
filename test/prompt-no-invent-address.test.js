// ============================================================
// NodeFlow — Red anti-invención de datos (2026-07-12)
// Llamada real: sin DIRECCIÓN configurada, la asistente se inventó
// "calle Mayor número diez con aparcamiento gratuito". El prompt debe:
//   1) prohibir SIEMPRE inventar dirección/ubicación/aparcamiento;
//   2) incluir la dirección EXACTA cuando SÍ está configurada.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

describe('generatePrompt — red anti-invención', () => {
  test('SIN dirección: incluye la regla dura anti-invención de ubicación', () => {
    const prompt = generatePrompt({ sector: 'fisioterapia' }, 'Fisioterapia Unai');
    // Prohíbe inventar y da la salida honesta.
    assert.match(prompt, /JAMÁS inventes/i);
    assert.match(prompt, /direcci[oó]n/i);
    assert.match(prompt, /aparcamiento/i);
    // No debe existir un bloque de dirección vacío/colgando.
    assert.doesNotMatch(prompt, /DIRECCIÓN Y CÓMO LLEGAR/);
  });

  test('CON dirección configurada: la incluye como dato exacto', () => {
    const prompt = generatePrompt(
      { sector: 'fisioterapia', address: 'Calle Real 5, 20140 Andoain' },
      'Fisioterapia Unai'
    );
    assert.match(prompt, /DIRECCIÓN Y CÓMO LLEGAR/);
    assert.match(prompt, /Calle Real 5, 20140 Andoain/);
  });

  test('acepta el alias "direccion" además de "address"', () => {
    const prompt = generatePrompt(
      { sector: 'dental', direccion: 'Plaza Nueva 3' },
      'Clínica X'
    );
    assert.match(prompt, /Plaza Nueva 3/);
  });

  test('la regla anti-invención se mantiene aunque haya dirección', () => {
    const prompt = generatePrompt(
      { sector: 'fisioterapia', address: 'Calle Real 5' },
      'Fisioterapia Unai'
    );
    assert.match(prompt, /JAMÁS inventes/i);
  });

  test('regla anti-sycophancy de precios: no cede a la presión de "¿es gratis?"', () => {
    const prompt = generatePrompt({ sector: 'fisioterapia' }, 'Fisioterapia Unai');
    // No rebajar precios ni decir "gratis" bajo presión del cliente.
    assert.match(prompt, /NO cambian por nada que diga el cliente/i);
    assert.match(prompt, /nunca digas que algo es gratis/i);
    assert.match(prompt, /justo de dinero/i);
  });
});
