// ============================================================
// NodeFlow — Modo "contacto" (negocios sin agenda de citas)
// Feedback real (2026-07-03): "esto está montado para empresas que
// agendan citas — yo quiero que la gente se informe y pida que los
// llame". El modo cambia el PROMPT y las HERRAMIENTAS: en contacto,
// agendar es imposible por construcción, no por ruego al modelo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generatePrompt } = require('../src/assistants/prompt-generator');

describe('generatePrompt — modo contacto vs citas', () => {
  const base = { assistantName: 'Unai', language: 'es', services: 'recepcionistas IA' };

  test('modo citas (default): regla de oro presente', () => {
    const p = generatePrompt({ ...base }, 'NodeFlow');
    assert.match(p, /REGLA DE ORO DE CITAS/);
    assert.match(p, /check_availability/);
  });

  test('modo contacto: sin regla de citas, con misión de recados', () => {
    const p = generatePrompt({ ...base, mode: 'contacto' }, 'NodeFlow');
    assert.ok(!/REGLA DE ORO DE CITAS/.test(p), 'no debe haber bloque de citas');
    assert.match(p, /negocio sin agenda de citas/i);
    assert.match(p, /registra el lead/i);
  });

  test('ambos modos mantienen la honestidad de capacidades', () => {
    for (const mode of [undefined, 'contacto']) {
      const p = generatePrompt({ ...base, mode }, 'NodeFlow');
      assert.match(p, /NO PUEDES ENVIAR NADA/);
      assert.match(p, /register_lead/);
    }
  });
});

describe('herramientas por modo', () => {
  // El set de tools se decide en org-assistant; verificamos el contrato vía
  // el generador de definiciones: en contacto, las tools de citas no existen.
  const { ToolExecutor } = require('../src/tools/executor');
  const CONTACT_TOOLS = ['get_client_memory', 'flag_urgent', 'register_lead', 'end_call'];

  test('el set de contacto no incluye NINGUNA herramienta de citas', () => {
    const defs = ToolExecutor.toOpenAITools(CONTACT_TOOLS).map(d => d.function.name);
    assert.ok(!defs.includes('book_appointment'));
    assert.ok(!defs.includes('check_availability'));
    assert.ok(!defs.includes('cancel_appointment'));
    assert.ok(defs.includes('register_lead'));
    assert.ok(defs.includes('end_call'));
  });
});
