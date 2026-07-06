// ============================================================
// NodeFlow — Elección de líder multi-réplica (2026-07-06)
// A escala, sin coordinar, cada réplica correría los crons → N
// recordatorios por cita. Estos tests fijan que solo UNA lidera,
// con fail-safe (sin Redis = siempre líder; Redis caído = mantiene).
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const leader = require('../src/utils/leader');

describe('leader — elección multi-réplica', () => {
  afterEach(() => { leader._resetForTest(); delete process.env.REDIS_URL; });

  test('fail-open: sin arrancar → es líder (nunca deja crons sin correr)', () => {
    leader._resetForTest();
    assert.strictEqual(leader.isLeader(), true);
  });

  test('sin REDIS_URL → single-réplica siempre líder', () => {
    leader._resetForTest();
    delete process.env.REDIS_URL;
    leader.startLeaderElection();
    assert.strictEqual(leader.isLeader(), true);
  });

  test('con Redis: adquiere, renueva y cede si lo pierde', async () => {
    leader._resetForTest();
    let evalRet = 1;
    const stub = { set: async () => 'OK', eval: async () => evalRet, on() {} };
    leader._setRedisForTest(stub);
    await leader._tick();                       // seguidor → SET NX OK → líder
    assert.strictEqual(leader.isLeader(), true);
    await leader._tick();                       // líder → renueva (eval=1) → sigue
    assert.strictEqual(leader.isLeader(), true);
    evalRet = 0;                                // pierde el lock
    await leader._tick();
    assert.strictEqual(leader.isLeader(), false);
  });

  test('seguidor no se auto-proclama si otro tiene el lock', async () => {
    leader._resetForTest();
    const stub = { set: async () => null, eval: async () => 0, on() {} }; // SET NX falla
    leader._setRedisForTest(stub);
    await leader._tick();
    assert.strictEqual(leader.isLeader(), false);
  });

  test('Redis caído MANTIENE el estado (líder sigue; no duplica)', async () => {
    leader._resetForTest();
    let boom = false;
    const stub = {
      set: async () => { if (boom) throw new Error('down'); return 'OK'; },
      eval: async () => { if (boom) throw new Error('down'); return 1; },
      on() {},
    };
    leader._setRedisForTest(stub);
    await leader._tick();                       // adquiere
    assert.strictEqual(leader.isLeader(), true);
    boom = true;
    await leader._tick();                       // Redis caído → mantiene LÍDER
    assert.strictEqual(leader.isLeader(), true);
  });
});
