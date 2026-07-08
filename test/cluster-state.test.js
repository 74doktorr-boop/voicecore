// ============================================================
// VoiceCore — cluster-state: base multi-réplica DORMANTE.
// Verifica las tres propiedades que hacen SEGURO tener esto en
// producción con el flag apagado:
//   1) CLUSTER_MODE off  → todo es NO-OP y las lecturas devuelven el
//      conteo LOCAL (comportamiento idéntico al de hoy).
//   2) CLUSTER_MODE on + Redis inyectado → contador de clúster real,
//      con TTL de auto-cura por llamada.
//   3) El pipeline con el flag apagado se comporta EXACTAMENTE igual
//      que hoy en el camino del cap de concurrentes.
// No hay Redis en CI: se inyecta un cliente falso vía _setRedis.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const cluster = require('../src/utils/cluster-state');
const { VoicePipeline } = require('../src/core/voice-pipeline');

// Redis falso en memoria — solo lo que usan las primitivas: set/del/scan.
function fakeRedis() {
  const store = new Map(); // key -> value
  return {
    store,
    calls: { set: 0, del: 0, scan: 0 },
    async set(key, val /* , 'PX', ttl */) { this.calls.set++; store.set(key, val); return 'OK'; },
    async del(key) { this.calls.del++; return store.delete(key) ? 1 : 0; },
    async scan(cursor, _match, pattern /* MATCH */, _count, count) {
      this.calls.scan++;
      // Implementación mínima: devuelve TODAS las claves que casan el
      // patrón `nf:call:*` en un solo barrido (cursor '0' → fin).
      const pfx = String(pattern).replace(/\*$/, '');
      const keys = [...store.keys()].filter((k) => k.startsWith(pfx));
      return ['0', keys];
    },
  };
}

// Limpia estado global entre tests: sin Redis inyectado, flag apagado.
afterEach(() => {
  cluster._setRedis(false);
  delete process.env.CLUSTER_MODE;
});

describe('cluster-state — flag por defecto OFF (idéntico a hoy)', () => {
  test('isClusterMode() es false sin CLUSTER_MODE', () => {
    assert.strictEqual(cluster.isClusterMode({}), false);
    assert.strictEqual(cluster.isClusterMode({ CLUSTER_MODE: '0' }), false);
    assert.strictEqual(cluster.isClusterMode({ CLUSTER_MODE: 'true' }), false);
  });

  test('isClusterMode() es true SOLO con CLUSTER_MODE="1"', () => {
    assert.strictEqual(cluster.isClusterMode({ CLUSTER_MODE: '1' }), true);
  });

  test('incrCall/decrCall son NO-OP con el flag apagado (no tocan Redis)', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    // Flag apagado (env por defecto):
    assert.strictEqual(await cluster.incrCall('c1'), false);
    assert.strictEqual(await cluster.decrCall('c1'), false);
    assert.strictEqual(r.calls.set, 0, 'no debe escribir en Redis con flag off');
    assert.strictEqual(r.calls.del, 0, 'no debe borrar en Redis con flag off');
  });

  test('getClusterCallCount devuelve el conteo LOCAL con el flag apagado', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    assert.strictEqual(await cluster.getClusterCallCount(7), 7);
    assert.strictEqual(r.calls.scan, 0, 'no debe consultar Redis con flag off');
  });
});

describe('cluster-state — flag ON pero SIN Redis (fallback local)', () => {
  test('sin cliente Redis, las lecturas caen al conteo local', async () => {
    cluster._setRedis(false);
    const env = { CLUSTER_MODE: '1' };
    assert.strictEqual(await cluster.incrCall('c1', env), false);
    assert.strictEqual(await cluster.getClusterCallCount(3, env), 3);
  });

  test('Redis inyectado pero NO ready → fallback local', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: false });
    const env = { CLUSTER_MODE: '1' };
    assert.strictEqual(await cluster.incrCall('c1', env), false);
    assert.strictEqual(await cluster.getClusterCallCount(2, env), 2);
    assert.strictEqual(r.calls.set, 0);
  });
});

describe('cluster-state — flag ON + Redis (contador de clúster real)', () => {
  test('incrCall escribe una clave por llamada y getClusterCallCount las cuenta', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    const env = { CLUSTER_MODE: '1' };
    assert.strictEqual(await cluster.incrCall('a', env), true);
    assert.strictEqual(await cluster.incrCall('b', env), true);
    assert.strictEqual(await cluster.incrCall('c', env), true);
    // Local a 1 pero el clúster ve 3 (las otras réplicas):
    assert.strictEqual(await cluster.getClusterCallCount(1, env), 3);
  });

  test('decrCall retira la llamada del contador del clúster', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    const env = { CLUSTER_MODE: '1' };
    await cluster.incrCall('a', env);
    await cluster.incrCall('b', env);
    await cluster.decrCall('a', env);
    assert.strictEqual(await cluster.getClusterCallCount(0, env), 1);
  });

  test('getClusterCallCount nunca baja del conteo local (Redis por detrás)', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    const env = { CLUSTER_MODE: '1' };
    // Redis vacío pero el nodo se ve 2 llamadas locales:
    assert.strictEqual(await cluster.getClusterCallCount(2, env), 2);
  });

  test('las claves usan el prefijo aislado nf:call:', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    await cluster.incrCall('xyz', { CLUSTER_MODE: '1' });
    assert.ok(r.store.has(cluster.KEY_PREFIX + 'xyz'));
  });

  test('TTL de auto-cura definido y razonable (minutos, no segundos ni horas)', () => {
    assert.ok(cluster.CALL_TTL_MS >= 5 * 60 * 1000, 'suficiente para la llamada más larga');
    assert.ok(cluster.CALL_TTL_MS <= 60 * 60 * 1000, 'purga zombies en < 1h');
  });

  test('fallo de Redis en el conteo → fallback al conteo local (fail-safe)', async () => {
    const boom = {
      async set() { throw new Error('down'); },
      async del() { throw new Error('down'); },
      async scan() { throw new Error('down'); },
    };
    cluster._setRedis(boom, { ready: true });
    const env = { CLUSTER_MODE: '1' };
    assert.strictEqual(await cluster.incrCall('a', env), false, 'incrCall traga el error');
    assert.strictEqual(await cluster.getClusterCallCount(5, env), 5, 'lectura cae al local');
  });
});

// ── Pipeline de simulación (mismo patrón que concurrency-cap.test.js) ──
function makePipeline(opts = {}) {
  const sttRouter = {
    getProvider: () => ({ createSession: () => ({}) }),
    closeSession: () => {},
    sendAudio: () => {},
    resetTranscript: () => {},
  };
  return new VoicePipeline({ sttRouter, ttsRouter: {}, llmRouter: {}, ...opts });
}
const assistant = (id, extra = {}) => ({ id, name: id, language: 'es', ...extra });
const start = (p, callId, a) =>
  p.startCall({ callId, assistant: a, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });

describe('pipeline — flag OFF = comportamiento de HOY (propiedad crítica)', () => {
  test('con CLUSTER_MODE apagado el cap de clúster NO se aplica y NO se toca Redis', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    delete process.env.CLUSTER_MODE; // producción hoy
    // Cap de clúster minúsculo: si estuviera activo, rechazaría enseguida.
    const p = makePipeline({ maxConcurrentPerAssistant: 10, maxConcurrentCluster: 1 });
    const a = assistant('biz');
    const s1 = await start(p, 'c1', a);
    const s2 = await start(p, 'c2', a);
    const s3 = await start(p, 'c3', a);
    // Con el flag apagado el cap de clúster (=1) se IGNORA: pasan todas
    // igual que hoy (solo mandan los caps por-nodo/por-asistente).
    assert.ok(s1 && s2 && s3, 'flag off: el cap de clúster no rechaza nada');
    // Y Redis no se ha consultado para contar (cero latencia añadida):
    assert.strictEqual(r.calls.scan, 0, 'flag off: no hay SCAN de clúster');
    assert.strictEqual(r.calls.set, 0, 'flag off: no hay alta en Redis');
  });

  test('con CLUSTER_MODE encendido el cap de clúster SÍ rechaza (prueba de que el flag es el interruptor)', async () => {
    const r = fakeRedis();
    cluster._setRedis(r, { ready: true });
    process.env.CLUSTER_MODE = '1';
    try {
      const p = makePipeline({ maxConcurrentPerAssistant: 10, maxConcurrentCluster: 2 });
      const a = assistant('biz');
      const s1 = await start(p, 'c1', a);
      const s2 = await start(p, 'c2', a);
      const s3 = await start(p, 'c3', a); // clúster ya en 2 → rechazada
      assert.ok(s1 && s2, 'dos permitidas');
      assert.strictEqual(s3, null, 'tercera rechazada por el cap de clúster');
    } finally {
      delete process.env.CLUSTER_MODE;
    }
  });
});
