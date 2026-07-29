// ============================================================
// PILOT-001 — La persistencia sobrevive a un apagado (F1 + F3)
// ------------------------------------------------------------
// Hallazgo del piloto (3 agentes coincidieron): en un despliegue, `activeCalls`
// llega a 0 en cuanto la llamada cuelga, pero la escritura sigue viajando a la
// BD — y process.exit(0) la mataba. Se perdía el transcript ENTERO y los
// minutos de la última llamada no se facturaban nunca.
//
// Aquí se fija el contrato: el apagado (1) cierra las llamadas vivas para que
// se escriban y (2) ESPERA a las escrituras en vuelo antes de dejar morir el
// proceso. Más F3: el alta ocurre antes del saludo, no después.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

// Pipeline con STT/TTS/LLM mudos y un callStore controlable.
function makePipeline(callStore) {
  const sttRouter = {
    getProvider: () => ({ createSession: () => ({}) }),
    createSession: () => ({}), closeSession: () => {},
    sendAudio: () => {}, resetTranscript: () => {},
  };
  return new VoicePipeline({ sttRouter, ttsRouter: {}, llmRouter: {}, callStore });
}
const assistant = { id: 'biz-1', name: 'Biz', language: 'es' };
const startArgs = (callId) => ({ callId, assistant, callerNumber: '+34600000000', calledNumber: '+34843700849', direction: 'inbound' });

describe('F1 · drenado de escrituras en el apagado', () => {
  test('shutdownPersist cierra las llamadas vivas y espera a que se escriban', async () => {
    let resolveWrite; const written = [];
    const callStore = {
      saveCallStart: async () => true,
      saveCallEnd: (d) => new Promise(res => { resolveWrite = () => { written.push(d.id); res(true); }; }),
    };
    const p = makePipeline(callStore);
    await p.startCall(startArgs('c1'));
    assert.strictEqual(p.activeCalls.size, 1);

    const shutdown = p.shutdownPersist(3000);          // apagado en marcha
    await new Promise(r => setImmediate(r));
    assert.strictEqual(p.activeCalls.size, 0, 'cierra la llamada viva');
    assert.ok(p.pendingWrites() > 0, 'la escritura está en vuelo y REGISTRADA');

    resolveWrite();                                     // la BD responde
    const r = await shutdown;
    assert.strictEqual(r.closed, 1);
    assert.strictEqual(r.unwritten, 0, 'no queda nada sin confirmar');
    assert.deepStrictEqual(written, ['c1'], 'el cierre llegó de verdad a la BD');
  });

  test('espera a una escritura de una llamada YA colgada (el caso que perdía datos)', async () => {
    let resolveWrite;
    const callStore = {
      saveCallStart: async () => true,
      saveCallEnd: () => new Promise(res => { resolveWrite = () => res(true); }),
    };
    const p = makePipeline(callStore);
    await p.startCall(startArgs('c2'));
    p.endCall('c2');                                    // cuelga ANTES del apagado
    assert.strictEqual(p.activeCalls.size, 0, 'activeCalls ya está a 0…');
    assert.ok(p.pendingWrites() > 0, '…pero la escritura sigue en vuelo');

    const shutdown = p.shutdownPersist(3000);
    await new Promise(r => setTimeout(r, 30));
    resolveWrite();
    assert.strictEqual((await shutdown).unwritten, 0);
  });

  test('una BD colgada NO cuelga el apagado: sale por timeout y lo reporta', async () => {
    const callStore = {
      saveCallStart: async () => true,
      saveCallEnd: () => new Promise(() => {}),          // nunca resuelve
    };
    const p = makePipeline(callStore);
    await p.startCall(startArgs('c3'));
    const t0 = Date.now();
    const r = await p.shutdownPersist(400);
    assert.ok(Date.now() - t0 < 2000, 'el apagado no se queda colgado');
    assert.strictEqual(r.closed, 1);
    assert.ok(r.unwritten > 0, 'reporta lo que no pudo confirmar (no lo oculta)');
  });

  test('sin llamadas ni escrituras → apagado inmediato y limpio', async () => {
    const p = makePipeline({ saveCallStart: async () => true, saveCallEnd: async () => true });
    assert.deepStrictEqual(await p.shutdownPersist(500), { closed: 0, unwritten: 0, failed: 0 });
  });

  test('en apagado NO se dispara el post-call (nada de WhatsApps/emails reales)', async () => {
    // Revisión D5: cerrar por SIGTERM una llamada que estaba en el saludo
    // enviaría confirmaciones por una conversación que nunca ocurrió.
    const p = makePipeline({ saveCallStart: async () => true, saveCallEnd: async () => true });
    await p.startCall(startArgs('c6'));
    await p.shutdownPersist(500);
    assert.strictEqual(p._shuttingDown, true, 'el pipeline queda marcado como en apagado');
  });

  test('una persistencia que revienta no impide el apagado', async () => {
    const p = makePipeline({
      saveCallStart: async () => { throw new Error('kaboom'); },
      saveCallEnd: async () => { throw new Error('kaboom'); },
    });
    await p.startCall(startArgs('c4'));
    const r = await p.shutdownPersist(500);
    assert.strictEqual(r.closed, 1);
    assert.strictEqual(r.unwritten, 0);
  });
});

describe('L5 · el cierre nunca adelanta al alta', () => {
  test('saveCallEnd espera al saveCallStart aunque el alta vaya lenta', async () => {
    // Si el alta aterrizaba después del cierre, devolvía la fila a 'active':
    // reloj corriendo en el portal y, a los 90 min, marcada como perdida
    // habiendo terminado bien.
    const orden = [];
    let resolveStart;
    const callStore = {
      saveCallStart: () => new Promise(res => { resolveStart = () => { orden.push('start'); res(true); }; }),
      saveCallEnd: async () => { orden.push('end'); return true; },
    };
    const p = makePipeline(callStore);
    await p.startCall(startArgs('c7'));
    p.endCall('c7');                          // cuelga con el alta aún en vuelo
    await new Promise(r => setTimeout(r, 30));
    assert.deepStrictEqual(orden, [], 'el cierre NO se ha escrito todavía');
    resolveStart();                            // el alta por fin aterriza
    await p.drainPendingWrites(1000);
    assert.deepStrictEqual(orden, ['start', 'end'], 'el orden queda garantizado');
  });
});

describe('L4 · el proceso deja de anunciarse al apagarse', () => {
  const lifecycle = require('../src/utils/lifecycle');
  test('arranca disponible; al marcar apagado deja de estarlo (irreversible)', () => {
    lifecycle._reset();
    assert.strictEqual(lifecycle.isShuttingDown(), false);
    lifecycle.markShuttingDown();
    assert.strictEqual(lifecycle.isShuttingDown(), true);
    assert.ok(lifecycle.shuttingDownSince() > 0);
    lifecycle.markShuttingDown();              // idempotente
    assert.strictEqual(lifecycle.isShuttingDown(), true);
    lifecycle._reset();
  });
});

describe('L1 · el post-call REGISTRA sus escrituras internas', () => {
  test('handle() acepta un registrador y lo usa para lo que vale dinero', async () => {
    // Sin esto, esperar a handle() era un falso "todo OK": esa promesa solo
    // aguarda a los emails, no a los minutos facturables ni al contacto.
    const { postCallHandler } = require('../src/automations/post-call-handler');
    const tracked = [];
    await postCallHandler.handle(
      { id: 'x1', businessId: 'biz-1', assistantId: 'biz-1', duration: 60000, outcome: 'info',
        transcript: [{ role: 'user', content: 'hola' }], callerNumber: '+34600000000',
        direction: 'inbound', metrics: {} },
      { track: (p) => { tracked.push(p); return p; } },
    );
    assert.ok(tracked.length > 0, 'las escrituras internas quedan registradas');
  });

  test('sin registrador sigue funcionando igual (compatibilidad)', async () => {
    const { postCallHandler } = require('../src/automations/post-call-handler');
    await assert.doesNotReject(() => postCallHandler.handle(
      { id: 'x2', businessId: 'biz-1', assistantId: 'biz-1', duration: 1000, outcome: 'abandoned', transcript: [], metrics: {} },
    ));
  });
});

describe('F3 · el alta ocurre ANTES del saludo', () => {
  test('startCall persiste el alta aunque el saludo (TTS) sea lento', async () => {
    const starts = [];
    const callStore = { saveCallStart: async (s) => { starts.push(s.id); return true; }, saveCallEnd: async () => true };
    const p = makePipeline(callStore);
    // Saludo lento: si el alta fuera después del TTS, no habría fila todavía.
    p._speakText = () => new Promise(r => setTimeout(r, 120));
    const call = p.startCall({ ...startArgs('c5'), assistant: { ...assistant, firstMessage: 'Hola, ¿en qué te ayudo?' } });
    await new Promise(r => setTimeout(r, 40));           // en mitad del saludo
    assert.deepStrictEqual(starts, ['c5'], 'la llamada YA existe en BD durante el saludo');
    await call;
  });
});
