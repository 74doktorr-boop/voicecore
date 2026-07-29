// ============================================================
// NodeFlow — La agenda no atiende llamadas a medio cargar (A3/A4, 2026-07-29)
//
// A4: `isHydrated()` existía en el store y NO lo invocaba nadie. Entre
// `server.listen()` y el final de la carga de citas había una ventana con el
// Map VACÍO: _isSlotTaken devolvía "libre" para todo y el bot ofrecía —y
// reservaba— huecos ya ocupados. Con un redeploy a las 10:00 y una llamada a
// las 10:00:03, eso ocurre de verdad.
//
// A3: ni googleapis ni gaxios imponen timeout. check_availability corre DENTRO
// de la llamada: un incidente de Google que dejase las conexiones colgadas se
// traducía en "un momento, por favor…" seguido de 60 s de aire muerto.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AppointmentsStore } = require('../src/db/appointments-store');
const { withDeadline, calendarTimeoutMs } = require('../src/integrations/google-calendar');

const enabledStore = () => {
  const s = new AppointmentsStore();
  s.init({ from: () => ({}) });   // marca _enabled sin tocar red
  return s;
};

describe('A4 — whenHydrated', () => {
  test('espera a que termine la carga y confirma que está hidratado', async () => {
    const store = enabledStore();
    let resolveLoad;
    store.setHydrationPromise(new Promise(r => { resolveLoad = r; }));

    let done = false;
    const waiting = store.whenHydrated(1000).then(v => { done = v; });
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(done, false, 'todavía no debe haber continuado');

    store._hydrated = true;
    resolveLoad();
    await waiting;
    assert.strictEqual(done, true);
  });

  test('ya hidratado → resuelve al instante (coste cero en régimen normal)', async () => {
    const store = enabledStore();
    store._hydrated = true;
    const t0 = Date.now();
    assert.strictEqual(await store.whenHydrated(5000), true);
    assert.ok(Date.now() - t0 < 50, 'no puede añadir latencia a cada llamada');
  });

  test('FAIL-OPEN: si la carga se eterniza, se atiende igual', async () => {
    const store = enabledStore();
    store.setHydrationPromise(new Promise(() => {}));   // nunca resuelve
    const t0 = Date.now();
    assert.strictEqual(await store.whenHydrated(60), false,
      'perder la llamada es peor que arriesgar un solape: la BD tiene su anti-solape');
    assert.ok(Date.now() - t0 < 2000);
  });

  test('si la carga FALLA, tampoco bloquea', async () => {
    const store = enabledStore();
    store.setHydrationPromise(Promise.reject(new Error('supabase caído')));
    assert.strictEqual(await store.whenHydrated(500), false);
  });

  test('store deshabilitado (modo memoria) → no espera a nada', async () => {
    assert.strictEqual(await new AppointmentsStore().whenHydrated(5000), true);
  });

  test('sin promesa registrada → no se queda colgado', async () => {
    assert.strictEqual(await enabledStore().whenHydrated(5000), false);
  });
});

describe('A3 — techo de tiempo al hablar con Google', () => {
  test('una operación que se cuelga se corta con un mensaje claro', async () => {
    const t0 = Date.now();
    await assert.rejects(
      () => withDeadline(new Promise(() => {}), 40, 'Google token refresh'),
      /Google token refresh no respondió en 40ms/,
    );
    assert.ok(Date.now() - t0 < 2000, 'el cliente no puede esperar 60s al teléfono');
  });

  test('una operación rápida pasa intacta', async () => {
    assert.strictEqual(await withDeadline(Promise.resolve('ok'), 1000, 'x'), 'ok');
  });

  test('un error real se propaga tal cual (no se disfraza de timeout)', async () => {
    await assert.rejects(() => withDeadline(Promise.reject(new Error('403 forbidden')), 1000, 'x'), /403 forbidden/);
  });

  test('el presupuesto es configurable y tiene un valor sensato por defecto', () => {
    const prev = process.env.GOOGLE_CAL_TIMEOUT_MS;
    delete process.env.GOOGLE_CAL_TIMEOUT_MS;
    assert.strictEqual(calendarTimeoutMs(), 6000);
    process.env.GOOGLE_CAL_TIMEOUT_MS = '2500';
    assert.strictEqual(calendarTimeoutMs(), 2500);
    for (const bad of ['0', '-1', 'abc']) {
      process.env.GOOGLE_CAL_TIMEOUT_MS = bad;
      assert.strictEqual(calendarTimeoutMs(), 6000, `no debe aceptar "${bad}"`);
    }
    if (prev === undefined) delete process.env.GOOGLE_CAL_TIMEOUT_MS; else process.env.GOOGLE_CAL_TIMEOUT_MS = prev;
  });
});
