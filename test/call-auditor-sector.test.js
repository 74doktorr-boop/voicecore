// ============================================================
// NodeFlow — Auditor SECTOR-AWARE (2026-07-04)
// El auditor juzga con la rúbrica del sector y estampa el sector en la
// auditoría (la clave que el agregador usa para agrupar por vertical).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { auditCall } = require('../src/lifecycle/call-auditor');

// openai simulado: captura el prompt y devuelve una auditoría canónica.
function fakeOpenAI(captured) {
  return {
    chat: { completions: { create: async ({ messages }) => {
      captured.user = messages.find(m => m.role === 'user').content;
      return { choices: [{ message: { content: JSON.stringify({
        greeting_ok: true, understood_customer: true, unnecessary_questions: 0,
        hallucinated: false, confirmed_before_booking: null, verbosity: 'adecuada',
        customer_satisfied: true, score: 80, info_gap: null, problems: [], improvements: [],
      }) } }] };
    } } },
  };
}

const transcript = [
  { role: 'assistant', content: 'Hola, ¿en qué puedo ayudarle?' },
  { role: 'user', content: 'Quiero reservar mesa.' },
];

describe('auditCall sector-aware', () => {
  test('inyecta la rúbrica del sector en el prompt del auditor', async () => {
    const cap = {};
    await auditCall({ id: 'c1', transcript, sector: 'restaurante' }, { openai: fakeOpenAI(cap) });
    assert.match(cap.user, /SECTOR: Restaurante/);
    assert.match(cap.user, /comensales/i); // uno de sus metricChecks
  });

  test('estampa el sector (canónico) en la auditoría', async () => {
    const cap = {};
    const audit = await auditCall({ id: 'c2', transcript, sector: 'dentista' }, { openai: fakeOpenAI(cap) });
    assert.strictEqual(audit.sector, 'dental'); // alias → canónico
  });

  test('sector desconocido → generico, sin bloque de rúbrica de sector', async () => {
    const cap = {};
    const audit = await auditCall({ id: 'c3', transcript, sector: 'queseria' }, { openai: fakeOpenAI(cap) });
    assert.strictEqual(audit.sector, 'generico');
    assert.ok(!/SECTOR:/.test(cap.user), 'no añade rúbrica de sector para genérico');
  });

  test('sin sector → generico (no rompe)', async () => {
    const cap = {};
    const audit = await auditCall({ id: 'c4', transcript }, { openai: fakeOpenAI(cap) });
    assert.strictEqual(audit.sector, 'generico');
  });
});
