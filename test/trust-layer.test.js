// ============================================================
// NodeFlow — Tests de la capa de confianza
// Bug real (llamada b05147a2, 2026-07-03): con audio degradado
// (confidence 0.63-0.78) la IA reservó APT-1002 para un día y hora
// que el cliente JAMÁS oyó ni aceptó (el transcript no menciona
// ninguna fecha). Principio adoptado: "nunca sacrificar fiabilidad
// por inteligencia" — confirmar antes que actuar sobre datos dudosos.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ToolExecutor } = require('../src/tools/executor');
const { VoicePipeline } = require('../src/core/voice-pipeline');

describe('candados deterministas de book_appointment', () => {
  const exec = new ToolExecutor();
  const args = { patient_name: 'Ana', service: 'corte', date: '2099-01-04', time: '10:00' };

  test('sin check_availability en la llamada → RESERVA BLOQUEADA', async () => {
    const r = await exec.execute('book_appointment', { ...args, confirmed_with_customer: true }, 'biz-t', { session: {} });
    assert.strictEqual(r.success, false);
    assert.match(r.error, /check_availability/);
  });

  test('sin confirmación explícita del cliente → RESERVA BLOQUEADA', async () => {
    const r = await exec.execute('book_appointment', args, 'biz-t', { session: { availabilityChecked: true } });
    assert.strictEqual(r.success, false);
    assert.match(r.error, /confirmed_with_customer/);
  });

  test('con ambos candados abiertos, la reserva sigue su curso normal', async () => {
    const r = await exec.execute(
      'book_appointment',
      { ...args, confirmed_with_customer: true },
      'demo-clinic',
      { session: { availabilityChecked: true } }
    );
    // Pasa los candados: el resultado ya es del motor de reservas
    // (éxito o validación de negocio), nunca el bloqueo de confianza.
    assert.ok(!r.error || !/RESERVA BLOQUEADA/.test(r.error), `no debe bloquear: ${r.error}`);
  });

  test('check_availability abre el candado en la sesión', async () => {
    const session = {};
    await exec.execute('check_availability', { from_date: '2099-01-04', to_date: '2099-01-05' }, 'demo-clinic', { session });
    assert.strictEqual(session.availabilityChecked, true);
  });

  test('sin sesión (demo/pruebas internas) los candados no aplican', async () => {
    const r = await exec.execute('book_appointment', args, 'demo-clinic', {});
    assert.ok(!r.error || !/RESERVA BLOQUEADA/.test(r.error));
  });
});

describe('escalera de confianza del STT (4 niveles)', () => {
  function makePipeline() {
    const llmCalls = [];
    const sttRouter = {
      getProvider: () => ({ createSession: () => ({}) }),
      closeSession: () => {},
      sendAudio: () => {},
      resetTranscript: () => {},
    };
    const llmRouter = {
      streamCompletion: async function* (opts) {
        llmCalls.push(opts);
        yield { type: 'done', content: 'vale', metrics: {} };
      },
    };
    const ttsRouter = { synthesize: async () => Buffer.alloc(0) };
    const p = new VoicePipeline({ sttRouter, llmRouter, ttsRouter, callStore: { saveCallStart: async () => {}, saveCallEnd: async () => {} } });
    p._llmCalls = llmCalls;
    return p;
  }

  async function turnWithConfidence(confidence) {
    const p = makePipeline();
    const s = await p.startCall({
      callId: 'conf-1',
      assistant: { id: 'biz-c', name: 'Biz', language: 'es' },
      callerNumber: 'x', calledNumber: 'y', direction: 'inbound',
    });
    await p._processTurn('conf-1', 'quiero un cortador de vuelo', { confidence });
    return { s, p };
  }

  test('nivel 1 (>0.92): acción directa, sin avisos', async () => {
    const { s, p } = await turnWithConfidence(0.95);
    assert.ok(!s.messages.some(m => m.role === 'system' && /fiabilidad/.test(m.content)));
    assert.strictEqual(p._llmCalls.length, 1, 'el LLM procesa el turno');
    assert.strictEqual(s.metrics.turns[0].sttConfidence, 0.95);
    assert.strictEqual(s.metrics.clarifications || 0, 0);
  });

  test('nivel 2 (0.75-0.92): repetición parcial antes de usar datos', async () => {
    const { s } = await turnWithConfidence(0.85);
    const note = s.messages.find(m => m.role === 'system' && /es correcto/.test(m.content));
    assert.ok(note, 'aviso de repetición parcial');
    assert.strictEqual(s.metrics.clarifications, 1);
  });

  test('nivel 3 (0.55-0.75): pregunta abierta, prohibido actuar', async () => {
    const { s } = await turnWithConfidence(0.63);
    const note = s.messages.find(m => m.role === 'system' && /NO ejecutes ninguna acción/.test(m.content));
    assert.ok(note, 'aviso de pregunta abierta');
    assert.strictEqual(s.metrics.clarifications, 1);
  });

  test('nivel 4 (<0.55): NI UNA ACCIÓN — el LLM no procesa el turno', async () => {
    const { s, p } = await turnWithConfidence(0.4);
    assert.strictEqual(p._llmCalls.length, 0, 'el LLM jamás ve este turno');
    const last = s.transcript[s.transcript.length - 1];
    assert.strictEqual(last.role, 'assistant');
    assert.match(last.content, /repetir/);
    assert.strictEqual(s.metrics.clarifications, 1);
    assert.strictEqual(s.metrics.turns[0].sttConfidence, 0.4);
  });

  test('sin confidence (proveedor sin dato) no rompe ni anota', async () => {
    const p = makePipeline();
    await p.startCall({ callId: 'conf-2', assistant: { id: 'biz-c2', name: 'B', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('conf-2', 'hola buenas', {});
    const s = p.activeCalls.get('conf-2');
    assert.strictEqual(s.metrics.turns[0].sttConfidence, undefined);
    assert.strictEqual(p._llmCalls.length, 1);
  });
});

describe('Conversation Success Score v1', () => {
  function makePipeline() {
    const sttRouter = {
      getProvider: () => ({ createSession: () => ({}) }),
      closeSession: () => {},
      sendAudio: () => {},
      resetTranscript: () => {},
    };
    const llmRouter = { streamCompletion: async function* () { yield { type: 'done', content: 'vale', metrics: {} }; } };
    const ttsRouter = { synthesize: async () => Buffer.alloc(0) };
    return new VoicePipeline({ sttRouter, llmRouter, ttsRouter, callStore: { saveCallStart: async () => {}, saveCallEnd: async () => {} } });
  }

  test('cada llamada termina con metrics.quality completo y acotado', async () => {
    const p = makePipeline();
    await p.startCall({ callId: 'q-1', assistant: { id: 'biz-q', name: 'B', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('q-1', 'quiero cita para el corte', { confidence: 0.97 });
    const callData = p.endCall('q-1');
    const q = callData.metrics.quality;
    assert.ok(q, 'quality debe existir');
    assert.ok(q.score >= 0 && q.score <= 100);
    assert.strictEqual(typeof q.completed, 'boolean');
    assert.strictEqual(q.avgConfidence, 0.97);
    assert.strictEqual(q.clarifications, 0);
    assert.strictEqual(q.booked, false);
  });

  test('la fricción baja el score: turnos dudosos puntúan peor que limpios', async () => {
    const run = async (confs) => {
      const p = makePipeline();
      const id = 'q-' + confs.join('-');
      await p.startCall({ callId: id, assistant: { id: 'biz-q2', name: 'B', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
      for (const c of confs) await p._processTurn(id, 'frase del cliente', { confidence: c });
      return p.endCall(id).metrics.quality.score;
    };
    const limpia = await run([0.97, 0.96]);
    const sucia  = await run([0.6, 0.5, 0.62]);
    assert.ok(limpia > sucia, `limpia (${limpia}) debe puntuar más que sucia (${sucia})`);
  });
});
