// ============================================================
// NodeFlow — Persistencia de citas: reintento + aviso (Tema D, 2026-07)
// Bug: upsert era fire-and-forget de UN intento tragado. Un hipo de Supabase
// = cita fantasma que el bot ya había confirmado al cliente y que desaparecía
// en el siguiente deploy, EN SILENCIO. Ahora reintenta los fallos transitorios
// y, si aun así no persiste (o hay colisión de hueco 23505), AVISA al dueño.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AppointmentsStore } = require('../src/db/appointments-store');

// Cliente Supabase falso: devuelve un resultado por intento (el último se repite).
function fakeClient(results) {
  let calls = 0;
  const c = {
    from() { return { upsert() { const r = results[Math.min(calls, results.length - 1)]; calls++; return Promise.resolve(r); } }; },
  };
  c.calls = () => calls;
  return c;
}

function makeStore(client) {
  const store = new AppointmentsStore();
  store.init(client);
  store._retryDelayMs = 0;          // sin esperas en test
  const alerts = [];
  store._notify = (msg, org) => { alerts.push({ msg, org }); };
  return { store, alerts };
}

const APT = { id: 'APT-1', businessId: 'org1', patientName: 'Ana', phone: '+34600111222', date: '2026-07-20', time: '10:00', service: 'Sesión', price: 45 };

describe('AppointmentsStore.upsert — reintento y aviso', () => {
  test('éxito al primer intento → true, sin aviso', async () => {
    const client = fakeClient([{ error: null }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, true);
    assert.strictEqual(client.calls(), 1);
    assert.strictEqual(alerts.length, 0);
  });

  test('falla 2 veces y a la 3ª persiste → true (reintentó), sin aviso', async () => {
    const client = fakeClient([{ error: { message: 'net' } }, { error: { message: 'net' } }, { error: null }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, true);
    assert.strictEqual(client.calls(), 3);
    assert.strictEqual(alerts.length, 0);
  });

  test('falla siempre → false tras 3 intentos + AVISO al dueño con los datos', async () => {
    const client = fakeClient([{ error: { message: 'boom' } }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, false);
    assert.strictEqual(client.calls(), 3);
    assert.strictEqual(alerts.length, 1);
    assert.match(alerts[0].msg, /Ana/);
    assert.match(alerts[0].msg, /\+34600111222/);
    assert.match(alerts[0].msg, /2026-07-20/);
    assert.strictEqual(alerts[0].org, 'org1');
  });

  test('colisión de hueco (23505) → false SIN reintento + aviso de doble reserva', async () => {
    const client = fakeClient([{ error: { code: '23505', message: 'dup' } }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, false);
    assert.strictEqual(client.calls(), 1, 'no reintenta una colisión');
    assert.strictEqual(alerts.length, 1);
    assert.match(alerts[0].msg, /doble reserva|ocupado/i);
  });

  test('solape parcial rechazado por el EXCLUDE (23P01) → false sin reintento + aviso', async () => {
    const client = fakeClient([{ error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }]);
    const { store, alerts } = makeStore(client);
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, false);
    assert.strictEqual(client.calls(), 1, 'no reintenta un solape');
    assert.strictEqual(alerts.length, 1);
    assert.match(alerts[0].msg, /doble reserva|ocupado/i);
  });

  test('store deshabilitado → false, sin tocar el cliente', async () => {
    const store = new AppointmentsStore(); // sin init → deshabilitado
    const ok = await store.upsert(APT);
    assert.strictEqual(ok, false);
  });
});
