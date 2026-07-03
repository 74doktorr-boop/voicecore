// ============================================================
// NodeFlow — Tests de persistencia de llamadas (nf_calls)
// Hallazgo C1 de la auditoría 2026-07-03: 0 llamadas persistidas
// en producción (historial en memoria, borrado en cada deploy;
// KPIs consultando una tabla vacía). Estos tests fijan el contrato:
// alta al iniciar, upsert completo al colgar, idempotencia por id,
// y fail-open SIEMPRE (la persistencia jamás tumba una llamada).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { saveCallStart, saveCallEnd } = require('../src/db/call-store');
const { VoicePipeline } = require('../src/core/voice-pipeline');

// BD falsa que captura los upserts
function fakeDb({ failWith = null } = {}) {
  const upserts = [];
  return {
    upserts,
    enabled: true,
    client: {
      from: (table) => ({
        upsert: async (row, opts) => {
          upserts.push({ table, row, opts });
          return { error: failWith ? { message: failWith } : null };
        },
      }),
    },
  };
}

const session = {
  callId: 'call-e2e-1',
  orgId: 'org-1',
  assistant: { id: 'asst-1' },
  direction: 'inbound',
  callerNumber: '+34666000111',
  calledNumber: '+34843700849',
  startTime: 1783040058944,
};

describe('saveCallStart', () => {
  test('upsert por id en nf_calls con los datos de la sesión', async () => {
    const db = fakeDb();
    assert.strictEqual(await saveCallStart(session, { db }), true);
    const u = db.upserts[0];
    assert.strictEqual(u.table, 'nf_calls');
    assert.strictEqual(u.row.id, 'call-e2e-1');
    assert.strictEqual(u.row.org_id, 'org-1');
    assert.strictEqual(u.row.status, 'active');
    assert.strictEqual(u.opts.onConflict, 'id');
  });

  test('fail-open: error de BD devuelve false, jamás lanza', async () => {
    const db = fakeDb({ failWith: 'boom' });
    assert.strictEqual(await saveCallStart(session, { db }), false);
  });

  test('BD deshabilitada o sesión sin callId → false sin tocar la BD', async () => {
    assert.strictEqual(await saveCallStart(session, { db: { enabled: false } }), false);
    const db = fakeDb();
    assert.strictEqual(await saveCallStart({}, { db }), false);
    assert.strictEqual(db.upserts.length, 0);
  });
});

describe('saveCallEnd', () => {
  const callData = {
    id: 'call-e2e-1',
    businessId: 'org-1',
    assistantId: 'asst-1',
    direction: 'inbound',
    callerNumber: '+34666000111',
    calledNumber: '+34843700849',
    outcome: 'booked',
    transcript: [{ role: 'user', content: 'quiero un corte de pelo' }],
    metrics: { audioRx: { pct: 98 }, turns: [] },
    cost: { total: 0.03 },
    bookedAppointment: { id: 'APT-1' },
    campaignRef: null,
    startTime: '2026-07-03T00:54:18.353Z',
    endTime: '2026-07-03T00:55:55.422Z',
    duration: 97069,
    turnCount: 6,
  };

  test('upsert COMPLETO al colgar: transcript, metrics, cost, outcome', async () => {
    const db = fakeDb();
    assert.strictEqual(await saveCallEnd(callData, { db }), true);
    const { row } = db.upserts[0];
    assert.strictEqual(row.status, 'ended');
    assert.strictEqual(row.outcome, 'booked');
    assert.strictEqual(row.duration_ms, 97069);
    assert.strictEqual(row.turn_count, 6);
    assert.deepStrictEqual(row.transcript, callData.transcript);
    assert.strictEqual(row.metrics.audioRx.pct, 98);
    assert.deepStrictEqual(row.booked_appointment, { id: 'APT-1' });
  });

  test('idempotente: dos cierres = dos upserts al mismo id (cero duplicados)', async () => {
    const db = fakeDb();
    await saveCallEnd(callData, { db });
    await saveCallEnd(callData, { db });
    assert.strictEqual(db.upserts.length, 2);
    assert.strictEqual(db.upserts[0].row.id, db.upserts[1].row.id);
    assert.strictEqual(db.upserts[1].opts.onConflict, 'id');
  });

  test('fail-open: error de BD devuelve false, jamás lanza', async () => {
    assert.strictEqual(await saveCallEnd(callData, { db: fakeDb({ failWith: 'down' }) }), false);
  });
});

describe('cableado en el pipeline', () => {
  function makePipeline(callStore) {
    const sttRouter = {
      getProvider: () => ({ createSession: () => ({}) }),
      closeSession: () => {},
      sendAudio: () => {},
      resetTranscript: () => {},
    };
    return new VoicePipeline({ sttRouter, ttsRouter: {}, llmRouter: {}, callStore });
  }

  test('startCall persiste el alta y endCall el cierre completo', async () => {
    const calls = { start: [], end: [] };
    const p = makePipeline({
      saveCallStart: async (s) => { calls.start.push(s.id); return true; },
      saveCallEnd: async (d) => { calls.end.push(d); return true; },
    });
    await p.startCall({
      callId: 'wire-1',
      assistant: { id: 'biz-w', name: 'Biz', language: 'es' },
      callerNumber: '+34600000000', calledNumber: '+34843700849', direction: 'inbound',
    });
    assert.deepStrictEqual(calls.start, ['wire-1']);

    p.endCall('wire-1');
    await new Promise(r => setImmediate(r));
    assert.strictEqual(calls.end.length, 1);
    assert.strictEqual(calls.end[0].id, 'wire-1');
    assert.ok(calls.end[0].metrics.audioRx, 'el cierre lleva la salud de audio');
  });

  test('una persistencia que revienta NO tumba la llamada', async () => {
    const p = makePipeline({
      saveCallStart: async () => { throw new Error('kaboom'); },
      saveCallEnd: async () => { throw new Error('kaboom'); },
    });
    const s = await p.startCall({
      callId: 'wire-2',
      assistant: { id: 'biz-w2', name: 'Biz', language: 'es' },
      callerNumber: 'x', calledNumber: 'y', direction: 'inbound',
    });
    assert.ok(s, 'la llamada arranca aunque la BD reviente');
    assert.ok(p.endCall('wire-2'), 'y termina limpia');
    await new Promise(r => setImmediate(r));
  });
});
