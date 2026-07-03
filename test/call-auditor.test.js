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

describe('auditor con contexto del negocio (llamada real 2026-07-04)', () => {
  // Caso real: el auditor marcó "prometió que el equipo llamará" como
  // alucinación — pero ES el guion diseñado tras register_lead (el dueño
  // recibe el aviso de verdad). Y no pudo detectar el fallo real (cliente
  // pidió información, el asistente no dio el precio configurado) porque
  // nunca vio el catálogo. El auditor debe auditar con las mismas cartas.
  function capturingOpenAI(payload, box) {
    return { chat: { completions: { create: async (args) => { box.args = args; return { choices: [{ message: { content: JSON.stringify(payload) } }] }; } } } };
  }

  const CALL_INFO = {
    id: 'call-audit-2',
    outcome: 'info',
    assistantMode: 'contacto',
    serviceList: [{ name: 'Recepcionista IA', price: '49€/mes', duration: '', notes: 'todo incluido' }],
    transcript: [
      { role: 'assistant', content: 'Bienvenido a NodeFlow, ¿qué necesita?' },
      { role: 'user', content: 'Quiero información de los servicios.' },
      { role: 'assistant', content: 'Registro su interés y el equipo le llamará.' },
    ],
  };

  test('el prompt de auditoría recibe modo y catálogo configurado', async () => {
    const box = {};
    await auditCall(CALL_INFO, { openai: capturingOpenAI({ score: 70 }, box) });
    const userMsg = box.args.messages.find(m => m.role === 'user').content;
    assert.match(userMsg, /modo contacto/i);
    assert.match(userMsg, /Recepcionista IA: 49€\/mes/);
    const sysMsg = box.args.messages.find(m => m.role === 'system').content;
    assert.match(sysMsg, /equipo le llamará.*NO es alucinación|NO es alucinación.*equipo le llamará/is);
  });

  test('info_gap se clampa: string útil o null', () => {
    assert.strictEqual(_clamp({ score: 50, info_gap: '  precio del plan  ' }).info_gap, 'precio del plan');
    assert.strictEqual(_clamp({ score: 50, info_gap: '' }).info_gap, null);
    assert.strictEqual(_clamp({ score: 50 }).info_gap, null);
    assert.strictEqual(_clamp({ score: 50, info_gap: 42 }).info_gap, null);
  });

  test('sin contexto de negocio, la auditoría sigue funcionando (legacy)', async () => {
    const box = {};
    const audit = await auditCall(CALL, { openai: capturingOpenAI({ score: 90 }, box) });
    assert.strictEqual(audit.score, 90);
    assert.doesNotMatch(box.args.messages.find(m => m.role === 'user').content, /CATÁLOGO/);
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
