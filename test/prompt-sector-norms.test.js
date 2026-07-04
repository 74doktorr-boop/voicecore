// ============================================================
// NodeFlow — Normas de sector inyectadas en el prompt (Fase 3)
// Cada vertical aporta sus reglas de comportamiento; las reglas que el
// bucle de mejora aprende y se aprueban se aplican POR sector aquí.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

describe('generatePrompt — normas por sector', () => {
  test('restaurante: mete su bloque de normas (comensales + hora)', () => {
    const p = generatePrompt({ assistantName: 'Ana', sector: 'restaurante' }, 'La Tasca');
    assert.match(p, /NORMAS DE TU SECTOR \(Restaurante\)/);
    assert.match(p, /comensales/i);
  });

  test('dental: normas propias (primera visita, sin diagnóstico)', () => {
    const p = generatePrompt({ assistantName: 'Ane', sector: 'dentista' }, 'Clínica X');
    assert.match(p, /NORMAS DE TU SECTOR \(Clínica dental\)/); // alias resuelto
    assert.match(p, /primera visita/i);
    assert.match(p, /diagn[oó]stic/i);
  });

  test('sector genérico/desconocido: sin bloque de normas de sector', () => {
    const p = generatePrompt({ assistantName: 'Laura', sector: 'queseria' }, 'Quesos');
    assert.ok(!/NORMAS DE TU SECTOR/.test(p));
  });
});
