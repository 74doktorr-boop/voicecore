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

describe('confidence del STT → modo confirmación', () => {
  function makePipeline() {
    const sttRouter = {
      getProvider: () => ({ createSession: () => ({}) }),
      closeSession: () => {},
      sendAudio: () => {},
      resetTranscript: () => {},
    };
    const llmRouter = {
      streamCompletion: async function* () {
        yield { type: 'done', content: 'vale', metrics: {} };
      },
    };
    const ttsRouter = { synthesize: async () => Buffer.alloc(0) };
    return new VoicePipeline({ sttRouter, llmRouter, ttsRouter, callStore: { saveCallStart: async () => {}, saveCallEnd: async () => {} } });
  }

  async function turnWithConfidence(confidence) {
    const p = makePipeline();
    const s = await p.startCall({
      callId: 'conf-1',
      assistant: { id: 'biz-c', name: 'Biz', language: 'es' },
      callerNumber: 'x', calledNumber: 'y', direction: 'inbound',
    });
    await p._processTurn('conf-1', 'quiero un cortador de vuelo', { confidence });
    return s;
  }

  test('confidence baja inyecta la orden de confirmar y queda en métricas', async () => {
    const s = await turnWithConfidence(0.63);
    const note = s.messages.find(m => m.role === 'system' && /baja fiabilidad/.test(m.content));
    assert.ok(note, 'debe inyectarse el aviso de baja fiabilidad');
    assert.match(note.content, /confirmación antes de actuar/);
    assert.strictEqual(s.metrics.turns[0].sttConfidence, 0.63);
  });

  test('confidence alta NO inyecta el aviso', async () => {
    const s = await turnWithConfidence(0.95);
    assert.ok(!s.messages.some(m => m.role === 'system' && /baja fiabilidad/.test(m.content)));
    assert.strictEqual(s.metrics.turns[0].sttConfidence, 0.95);
  });

  test('sin confidence (proveedor sin dato) no rompe ni anota', async () => {
    const p = makePipeline();
    await p.startCall({ callId: 'conf-2', assistant: { id: 'biz-c2', name: 'B', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('conf-2', 'hola buenas', {});
    const s = p.activeCalls.get('conf-2');
    assert.strictEqual(s.metrics.turns[0].sttConfidence, undefined);
  });
});
