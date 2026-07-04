// ============================================================
// NodeFlow — Reglas del prompt APRENDIDAS del bucle de mejora
// Origen: auditoría de llamadas reales (2026-07-04). El agregador sacó
// como regla candidata (≥2 llamadas) "no prometer acciones que no puede
// realizar", y las transcripts mostraron que el propio prompt mandaba
// prometer "el equipo le llamará muy pronto" — la causa de que el auditor
// marcara esas llamadas como alucinación. Aprobado por Unai. Estos tests
// FIJAN las reglas para que no se caigan en silencio (regresión).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

const base = { assistantName: 'Unai', language: 'es', services: 'recepcionistas IA' };

describe('reglas aprendidas (2026-07-04): no prometer plazos/acciones que no controla', () => {
  for (const mode of [undefined, 'contacto']) {
    test(`modo ${mode || 'citas'}: NO ordena prometer "muy pronto"`, () => {
      const p = generatePrompt({ ...base, mode }, 'NodeFlow');
      // El prompt ya NO debe instruir a prometer un plazo concreto de llamada.
      assert.ok(!/llamará muy pronto/i.test(p),
        'el prompt no debe mandar prometer "el equipo llamará muy pronto"');
    });
    test(`modo ${mode || 'citas'}: contiene la regla explícita de no prometer plazos`, () => {
      const p = generatePrompt({ ...base, mode }, 'NodeFlow');
      assert.match(p, /NUNCA prometas/i);
      assert.match(p, /que no (puedes|controlas)|plazos? (concreto|que no)/i);
    });
  }
});

describe('reglas aprendidas: no repetir datos/preguntas ya respondidas (reforzada)', () => {
  test('prohíbe re-pedir el nombre / servicio ya dado y re-preguntar el tipo', () => {
    const p = generatePrompt({ ...base }, 'NodeFlow');
    assert.match(p, /No repitas preguntas ya respondidas/i);
    assert.match(p, /ya te dio|ya ha dicho/i);          // no re-pedir lo dado
    assert.match(p, /moderaci[oó]n|no lo repitas en cada frase/i); // usar el nombre sin abusar
  });
});
