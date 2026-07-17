// ============================================================
// NodeFlow — Guardarraíl clínico/profesional por cluster (2026-07-17)
// Crítica sectorial (128 clientes ficticios): la objeción nº1 de confianza
// en 30 sectores era que la IA improvise sobre salud/derecho/precio no cerrado.
// El prompt debe reforzarse por CLUSTER:
//   · SALUD → nunca consejo clínico ni precio de tratamiento sin valoración.
//   · COLEGIADOS → nunca asesora legal/fiscal ni arancel cerrado.
//   · Otros sectores → sin refuerzo (no molestar a una peluquería con reglas médicas).
// Ligado al bug real del "gratis" (llamada fisio, 2026-07-12).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

describe('generatePrompt — guardarraíl clínico (cluster salud)', () => {
  for (const sector of ['dental', 'fisioterapia', 'veterinaria', 'psicologia', 'podologia', 'optica', 'farmacia']) {
    test(`${sector}: incluye el guardarraíl clínico`, () => {
      const p = generatePrompt({ sector }, 'Clínica X');
      assert.match(p, /GUARDARRAÍL CLÍNICO/);
      assert.match(p, /consejo m[eé]dico/i);
      assert.match(p, /se valora en consulta/i);          // precio de tratamiento no cerrado
      assert.match(p, /URGENCIA/i);
      assert.match(p, /ofr[eé]cele cita|agenda/i);        // AYUDA y agenda, no solo rebota
    });
  }

  test('dental: NO trae el guardarraíl profesional (legal)', () => {
    const p = generatePrompt({ sector: 'dental' }, 'Clínica X');
    assert.doesNotMatch(p, /GUARDARRAÍL PROFESIONAL/);
  });
});

describe('generatePrompt — guardarraíl profesional (cluster colegiados)', () => {
  for (const sector of ['abogados', 'asesoria', 'notaria', 'arquitectura']) {
    test(`${sector}: incluye el guardarraíl profesional Y ayuda a agendar`, () => {
      const p = generatePrompt({ sector }, 'Despacho X');
      assert.match(p, /GUARDARRAÍL PROFESIONAL/);
      assert.match(p, /asesoramiento legal, fiscal/i);      // sigue vetando el consejo de fondo
      assert.match(p, /AGENDAS|agendo|cita/i);              // pero AYUDA y agenda (fix regresión r2)
      assert.doesNotMatch(p, /GUARDARRAÍL CLÍNICO/);
    });
  }

  test('legal: NO se limita a rebotar — engancha y agenda (fix de la regresión r2)', () => {
    const p = generatePrompt({ sector: 'asesoria' }, 'Gestoría X');
    assert.match(p, /AYUDAS/);
    assert.match(p, /consiga la cita|le agendo|ofr[eé]cele cita/i);
  });
});

describe('generatePrompt — NO filtrar info interna (bonos/planes) al cliente', () => {
  for (const sector of ['dental', 'abogados', 'peluqueria', 'gimnasio', 'generico']) {
    test(`${sector}: prohíbe mencionar bonos/planes/sesiones restantes`, () => {
      const p = generatePrompt({ sector }, 'Negocio X');
      assert.match(p, /INFORMACIÓN INTERNA DEL NEGOCIO/);
      assert.match(p, /nunca menciones al cliente bonos, planes/i);
    });
  }
});

describe('generatePrompt — guardarraíl CONFIGURABLE por negocio (guardrailExtra)', () => {
  test('el texto extra del dueño se añade al guardarraíl del cluster salud', () => {
    const p = generatePrompt({ sector: 'dental', guardrailExtra: 'Sí puedes confirmar que trabajamos con Adeslas.' }, 'Clínica X');
    assert.match(p, /trabajamos con Adeslas/);
  });
  test('sin guardrailExtra no aparece basura', () => {
    const p = generatePrompt({ sector: 'dental' }, 'Clínica X');
    assert.doesNotMatch(p, /undefined/);
  });
  test('guardrailExtra no afecta a sectores neutros (no tienen bloque de cluster)', () => {
    const p = generatePrompt({ sector: 'peluqueria', guardrailExtra: 'texto X' }, 'Peluquería X');
    assert.doesNotMatch(p, /texto X/);
  });
});

describe('generatePrompt — sectores neutros no reciben refuerzo de cluster', () => {
  for (const sector of ['peluqueria', 'taller', 'restaurante', 'gimnasio', 'generico']) {
    test(`${sector}: sin guardarraíl clínico ni profesional`, () => {
      const p = generatePrompt({ sector }, 'Negocio X');
      assert.doesNotMatch(p, /GUARDARRAÍL CLÍNICO/);
      assert.doesNotMatch(p, /GUARDARRAÍL PROFESIONAL/);
      // Pero el núcleo común SÍ está siempre.
      assert.match(p, /REGLAS INQUEBRANTABLES/);
    });
  }
});

describe('generatePrompt — el guardarraíl de cluster se aplica AUNQUE haya prompt personalizado', () => {
  test('customPromptOverride en dental: el guardarraíl clínico va delante', () => {
    const p = generatePrompt({ sector: 'dental', customPromptOverride: 'Sé simpática.' }, 'Clínica X');
    assert.match(p, /GUARDARRAÍL CLÍNICO/);
    assert.match(p, /Sé simpática\./);
    // El guardarraíl precede al texto libre (no se puede saltar).
    assert.ok(p.indexOf('GUARDARRAÍL CLÍNICO') < p.indexOf('Sé simpática'));
  });
});
