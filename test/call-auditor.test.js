// ============================================================
// NodeFlow — Tests del auditor IA y la alerta al fundador
// "El cliente nunca reporta un bug: la plataforma lo detecta
// primero." El auditor puntúa cada llamada; shouldAlert decide
// de forma DETERMINISTA cuándo el fundador recibe el aviso.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { auditCall, _clamp } = require('../src/lifecycle/call-auditor');
const { shouldAlert } = require('../src/notifications/founder-alert');

function fakeOpenAI(payload) {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) } },
  };
}

const CALL = {
  id: 'call-audit-1',
  outcome: 'booked',
  transcript: [
    { role: 'assistant', content: 'Hola, peluquería.' },
    { role: 'user', content: 'Quiero cita el martes.' },
    { role: 'assistant', content: 'Martes a las diez, ¿le va bien?' },
    { role: 'user', content: 'Sí.' },
  ],
};

describe('auditCall', () => {
  test('parsea y clampa el veredicto del LLM', async () => {
    const audit = await auditCall(CALL, {
      openai: fakeOpenAI({
        greeting_ok: true, understood_customer: true, unnecessary_questions: '2',
        hallucinated: false, confirmed_before_booking: true, verbosity: 'concisa',
        customer_satisfied: true, score: 87.6,
        problems: ['p1', 'p2', 'p3', 'p4'], improvements: ['m1'],
      }),
    });
    assert.strictEqual(audit.score, 88);
    assert.strictEqual(audit.unnecessary_questions, 2);
    assert.strictEqual(audit.problems.length, 3, 'máx 3 problemas');
    assert.strictEqual(audit.confirmed_before_booking, true);
  });

  test('score fuera de rango se acota; campos raros no revientan', () => {
    const a = _clamp({ score: 250, verbosity: 'x', problems: 'no-array', unnecessary_questions: -5 });
    assert.strictEqual(a.score, 100);
    assert.strictEqual(a.verbosity, 'adecuada');
    assert.deepStrictEqual(a.problems, []);
    assert.strictEqual(a.unnecessary_questions, 0);
  });

  test('transcript vacío o LLM roto → null sin lanzar', async () => {
    assert.strictEqual(await auditCall({ transcript: [] }, { openai: fakeOpenAI({}) }), null);
    const broken = { chat: { completions: { create: async () => { throw new Error('boom'); } } } };
    assert.strictEqual(await auditCall(CALL, { openai: broken }), null);
  });
});

describe('shouldAlert — cuándo se despierta al fundador', () => {
  const okAudit = { score: 90, hallucinated: false, customer_satisfied: true };

  test('llamada buena → sin alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { quality: { score: 92 } } }, okAudit), false);
  });

  test('alucinación → alerta aunque el score sea alto', () => {
    assert.strictEqual(shouldAlert({ metrics: {} }, { ...okAudit, hallucinated: true }), true);
  });

  test('cliente insatisfecho o score bajo (auditor o determinista) → alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: {} }, { ...okAudit, customer_satisfied: false }), true);
    assert.strictEqual(shouldAlert({ metrics: {} }, { ...okAudit, score: 45 }), true);
    assert.strictEqual(shouldAlert({ metrics: { quality: { score: 40 } } }, null), true);
  });

  test('sin auditoría y score determinista bueno → sin alerta', () => {
    assert.strictEqual(shouldAlert({ metrics: { quality: { score: 88 } } }, null), false);
  });
});
