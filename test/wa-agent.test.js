// ============================================================
// NodeFlow — Agente de reserva por WhatsApp (2026-07)
// El asistente entiende el mensaje, consulta disponibilidad, RESERVA y confirma
// por WhatsApp. Se prueba la orquestación con LLM/executor/envío FALSOS.
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { handleWaBooking, buildSystemPrompt, _resetConvos } = require('../src/whatsapp/wa-agent');

// LLM falso: devuelve una secuencia de respuestas {text, toolCalls}.
function fakeLlm(seq) { let i = 0; const calls = []; const fn = async (messages) => { calls.push(messages.length); return seq[Math.min(i++, seq.length - 1)]; }; fn.calls = calls; return fn; }
const tc = (id, name, args) => ({ id, function: { name, arguments: JSON.stringify(args) } });

function harness(over = {}) {
  const sent = [], owner = [], execd = [];
  const deps = {
    config: { name: 'Fisio Unai', language: 'es', serviceList: [{ name: 'Fisioterapia', price: '50€', duration: 60 }] },
    clientName: over.clientName !== undefined ? over.clientName : 'Raúl',
    sendText: async (phone, text, creds) => { sent.push({ phone, text, creds }); return { ok: true }; },
    getWaCredentials: async () => ({ phoneNumberId: 'pn', accessToken: 'tok' }),
    notifyOwner: (msg) => owner.push(msg),
    execute: over.execute || (async (name, args, ctx) => {
      execd.push({ name, args, session: ctx.session });
      if (name === 'check_availability') { ctx.session.availabilityChecked = true; return { success: true, slots: ['12:00', '13:00'] }; }
      if (name === 'book_appointment') return { success: true, appointment: { patientName: args.patient_name, service: args.service, date: args.date, time: args.time, phone: ctx.session.callerNumber } };
      return { success: false };
    }),
    llm: over.llm,
  };
  return { sent, owner, execd, deps };
}

beforeEach(() => _resetConvos());

describe('handleWaBooking — reserva completa', () => {
  test('consulta disponibilidad, reserva y confirma por WhatsApp', async () => {
    const h = harness();
    h.deps.llm = fakeLlm([
      { text: '', toolCalls: [tc('t1', 'check_availability', { service: 'fisioterapia', from_date: '2026-07-14' })] },
      { text: '', toolCalls: [tc('t2', 'book_appointment', { patient_name: 'Raúl', service: 'fisioterapia', date: '2026-07-14', time: '12:00', confirmed_with_customer: true })] },
      { text: '¡Perfecto Raúl! Te he reservado el martes 14 a las 12:00. Te espero.', toolCalls: [] },
    ]);
    const r = await handleWaBooking({ from: '34666111222', businessId: 'org-1', text: 'dame cita el martes a las 12' }, h.deps);

    assert.strictEqual(r.handled, true);
    assert.strictEqual(r.booked, true);
    assert.strictEqual(h.execd.map(e => e.name).join(','), 'check_availability,book_appointment');
    // se envió la confirmación al cliente por WhatsApp desde el número del negocio
    assert.strictEqual(h.sent.length, 1);
    assert.match(h.sent[0].text, /reservado.*12:00/i);
    assert.deepStrictEqual(h.sent[0].creds, { phoneNumberId: 'pn', accessToken: 'tok' });
    // el teléfono del cliente se pasa solo a la reserva (session.callerNumber)
    const book = h.execd.find(e => e.name === 'book_appointment');
    assert.strictEqual(book.session.callerNumber, '+34666111222');
    // se avisó al dueño
    assert.strictEqual(h.owner.length, 1);
    assert.match(h.owner[0], /Reserva por WhatsApp/);
  });

  test('candado: check_availability abre availabilityChecked antes de reservar', async () => {
    const h = harness();
    h.deps.llm = fakeLlm([
      { text: '', toolCalls: [tc('t1', 'check_availability', {})] },
      { text: '', toolCalls: [tc('t2', 'book_appointment', { patient_name: 'Raúl', service: 'x', date: '2026-07-14', time: '12:00', confirmed_with_customer: true })] },
      { text: 'Listo.', toolCalls: [] },
    ]);
    await handleWaBooking({ from: '34600', businessId: 'org-1', text: 'reserva' }, h.deps);
    const book = h.execd.find(e => e.name === 'book_appointment');
    assert.strictEqual(book.session.availabilityChecked, true);
  });
});

describe('handleWaBooking — otros casos', () => {
  test('pregunta de info (sin herramientas) → responde, no reserva, no avisa al dueño', async () => {
    const h = harness();
    h.deps.llm = fakeLlm([{ text: 'La fisioterapia cuesta 50€ y dura 60 minutos. ¿Te reservo?', toolCalls: [] }]);
    const r = await handleWaBooking({ from: '34600', businessId: 'org-1', text: '¿cuánto cuesta?' }, h.deps);
    assert.strictEqual(r.handled, true);
    assert.strictEqual(r.booked, false);
    assert.strictEqual(h.sent.length, 1);
    assert.strictEqual(h.owner.length, 0);
  });

  test('el LLM no produce nada útil → handled:false (cae al humano)', async () => {
    const h = harness();
    h.deps.llm = fakeLlm([{ text: '', toolCalls: [] }]);
    const r = await handleWaBooking({ from: '34600', businessId: 'org-1', text: '...' }, h.deps);
    assert.strictEqual(r.handled, false);
    assert.strictEqual(h.sent.length, 0);
  });

  test('kill-switch WA_AI_BOOKING_OFF=1 → handled:false', async () => {
    const prev = process.env.WA_AI_BOOKING_OFF;
    process.env.WA_AI_BOOKING_OFF = '1';
    try {
      const h = harness();
      h.deps.llm = fakeLlm([{ text: 'hola', toolCalls: [] }]);
      const r = await handleWaBooking({ from: '34600', businessId: 'org-1', text: 'hola' }, h.deps);
      assert.strictEqual(r.handled, false);
    } finally { if (prev === undefined) delete process.env.WA_AI_BOOKING_OFF; else process.env.WA_AI_BOOKING_OFF = prev; }
  });

  test('mantiene el hilo: 2º mensaje reutiliza la conversación', async () => {
    const h = harness();
    h.deps.llm = fakeLlm([
      { text: '¿Para qué día?', toolCalls: [] },
      { text: 'Vale, miro el jueves.', toolCalls: [tc('t1', 'check_availability', { from_date: '2026-07-16' })] },
      { text: 'Tengo hueco a las 10 o a las 12.', toolCalls: [] },
    ]);
    await handleWaBooking({ from: '34600', businessId: 'org-1', text: 'quiero cita' }, h.deps);
    await handleWaBooking({ from: '34600', businessId: 'org-1', text: 'el jueves' }, h.deps);
    // el 2º turno arrancó con historial (system + user1 + assistant1 + user2 = 4)
    assert.ok(h.deps.llm.calls[h.deps.llm.calls.length - 1] >= 4, 'reutiliza el hilo');
  });
});

describe('buildSystemPrompt', () => {
  test('incluye negocio, servicios y nombre del cliente', () => {
    const p = buildSystemPrompt({ bizName: 'Fisio Unai', language: 'es', serviceList: [{ name: 'Fisio', price: '50€' }], clientName: 'Raúl', todayMadrid: 'lunes 12 de julio' });
    assert.match(p, /Fisio Unai/);
    assert.match(p, /Raúl/);
    assert.match(p, /50€/);
    assert.match(p, /check_availability/);
  });
});
