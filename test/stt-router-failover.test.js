// ============================================================
// NodeFlow — STT Router: FAILOVER + circuit breaker (Tema F, 2026-07)
// Si el proveedor primario (Deepgram) no abre la conexión, la llamada
// quedaba SORDA aunque AssemblyAI/Google estuvieran configurados. Ahora:
//   - watchdog de apertura → si no abre en openTimeoutMs, salta al siguiente
//     proveedor sano y recablea los callbacks del pipeline;
//   - circuit breaker → tras N fallos, el proveedor se salta en frío
//     (las llamadas nuevas ni lo tocan) durante un cooldown.
// Proveedores FALSOS inyectados: sin SDKs ni red.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { STTRouter } = require('../src/stt/router');

// Proveedor de mentira con la superficie que usa el router.
function fakeProvider(name, { opens = true, openDelay = 1 } = {}) {
  const connections = new Map();
  return {
    _name: name,
    connections,
    created: 0,
    createSession(callId, options) {
      this.created++;
      const s = { callId, isOpen: false, _name: name, options };
      connections.set(callId, s);
      if (opens) setTimeout(() => { s.isOpen = true; }, openDelay);
      return s;
    },
    closeSession(callId) { connections.delete(callId); },
    sendAudio() {},
    resetTranscript() {},
  };
}

function routerWith(providers, opts = {}) {
  const r = new STTRouter({});                 // sin claves → 0 providers reales
  let prio = 1;
  for (const [name, inst] of providers) {
    r.providers.set(name, { instance: inst, priority: prio++, avgLatency: 100, costPerMinute: 0.004, languages: ['es'], models: [], features: [] });
  }
  Object.assign(r, opts);
  return r;
}
const wait = (ms) => new Promise(res => setTimeout(res, ms));

describe('STT breaker (salud del proveedor)', () => {
  test('tras N fallos se abre; se vuelve sano pasado el cooldown', () => {
    const r = routerWith([['deepgram', fakeProvider('deepgram')]], { breakerThreshold: 2, breakerCooldownMs: 1000 });
    const t0 = 1_000_000;
    assert.strictEqual(r._isHealthy('deepgram', t0), true);
    r._recordFailure('deepgram', t0);
    assert.strictEqual(r._isHealthy('deepgram', t0), true, 'un fallo aún no abre el breaker');
    r._recordFailure('deepgram', t0);
    assert.strictEqual(r._isHealthy('deepgram', t0), false, 'dos fallos → breaker abierto');
    assert.strictEqual(r._isHealthy('deepgram', t0 + 1001), true, 'pasado el cooldown, sano otra vez');
  });

  test('un éxito resetea el contador de fallos', () => {
    const r = routerWith([['deepgram', fakeProvider('deepgram')]], { breakerThreshold: 2, breakerCooldownMs: 1000 });
    r._recordFailure('deepgram', 5);
    r._recordSuccess('deepgram');
    r._recordFailure('deepgram', 6);
    assert.strictEqual(r._isHealthy('deepgram', 6), true, 'el éxito borró el fallo previo → sigue sano');
  });
});

describe('STT orden de candidatos', () => {
  test('por prioridad; el preferido va primero si existe', () => {
    const r = routerWith([['deepgram', fakeProvider('deepgram')], ['assemblyai', fakeProvider('assemblyai')], ['google', fakeProvider('google')]]);
    assert.deepStrictEqual(r._candidateOrder(null), ['deepgram', 'assemblyai', 'google']);
    assert.deepStrictEqual(r._candidateOrder('google'), ['google', 'deepgram', 'assemblyai']);
    assert.deepStrictEqual(r._candidateOrder('inexistente'), ['deepgram', 'assemblyai', 'google']);
  });
});

describe('STT failover al crear la sesión', () => {
  test('Deepgram NO abre → salta a AssemblyAI y recablea callbacks', async () => {
    const down = fakeProvider('deepgram', { opens: false });
    const up   = fakeProvider('assemblyai', { opens: true, openDelay: 1 });
    const r = routerWith([['deepgram', down], ['assemblyai', up]], { openTimeoutMs: 15 });

    const session = r.createSession('c1', {});
    const cb = () => {};
    session.onUtteranceEnd = cb;       // el pipeline pone callbacks tras crear
    session.onSpeechStart = cb;

    await wait(40);                     // deja disparar el watchdog

    assert.strictEqual(down.connections.has('c1'), false, 'la sesión muerta de Deepgram se cerró');
    assert.strictEqual(up.connections.has('c1'), true, 'la llamada vive ahora en AssemblyAI');
    assert.strictEqual(up.connections.get('c1').onUtteranceEnd, cb, 'se recableó onUtteranceEnd');
    assert.strictEqual(up.connections.get('c1').onSpeechStart, cb, 'se recableó onSpeechStart');
    assert.ok(r._failoverCount >= 1, 'contabiliza el failover');
  });

  test('primario sano → ni failover ni cierre (sin coste extra)', async () => {
    const dg = fakeProvider('deepgram', { opens: true, openDelay: 1 });
    const aa = fakeProvider('assemblyai', { opens: true });
    const r = routerWith([['deepgram', dg], ['assemblyai', aa]], { openTimeoutMs: 15 });
    r.createSession('c2', {});
    await wait(40);
    assert.strictEqual(dg.connections.has('c2'), true, 'sigue en Deepgram');
    assert.strictEqual(aa.created, 0, 'AssemblyAI ni se tocó');
    assert.strictEqual(r._isHealthy('deepgram'), true);
  });

  test('breaker abierto → la llamada nueva ni toca Deepgram (0 latencia)', async () => {
    const down = fakeProvider('deepgram', { opens: false });
    const up   = fakeProvider('assemblyai', { opens: true });
    const r = routerWith([['deepgram', down], ['assemblyai', up]], { openTimeoutMs: 10, breakerThreshold: 1, breakerCooldownMs: 5000 });
    r._recordFailure('deepgram', Date.now());          // breaker ya abierto (threshold 1)
    const s = r.createSession('c3', {});
    assert.strictEqual(s._sttProviderName, 'assemblyai', 'primario elegido salta el proveedor en frío');
    assert.strictEqual(down.created, 0, 'Deepgram ni se instancia');
  });

  test('cerrar la sesión cancela el watchdog (llamada corta no marca fallo)', async () => {
    const dg = fakeProvider('deepgram', { opens: false }); // nunca abre
    const aa = fakeProvider('assemblyai', { opens: true });
    const r = routerWith([['deepgram', dg], ['assemblyai', aa]], { openTimeoutMs: 15 });
    r.createSession('c4', {});
    r.closeSession('c4');               // colgó antes de que el watchdog opine
    await wait(40);
    assert.strictEqual(aa.created, 0, 'no hubo failover: la llamada ya había terminado');
    assert.strictEqual(r._isHealthy('deepgram'), true, 'no se marcó fallo por una llamada corta');
  });
});
