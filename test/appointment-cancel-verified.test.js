// ============================================================
// NodeFlow — Cancelar cita: escritura VERIFICADA (2026-07-19)
// Bug reportado por Unai: cancela en el portal pero la cita sigue confirmada.
// Causa: patch era fire-and-forget → el portal respondía 200 aunque la BD no
// cambiara (redeploy a mitad, error de escritura); al re-hidratar la cita
// REVIVÍA confirmada. Ahora patch devuelve {ok,count} y el cancel del portal
// ESPERA y VERIFICA: si la BD no confirma, revierte y da error (no éxito falso).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AppointmentsStore } = require('../src/db/appointments-store');

function storeWith(selectResult) {
  const s = new AppointmentsStore();
  s._enabled = true;
  s._client = { from() { return { update() { return this; }, eq() { return this; }, select() { return Promise.resolve(selectResult); } }; } };
  return s;
}

describe('appointmentsStore.patch — awaitable y verificable', () => {
  test('escritura OK → {ok:true, count:1}', async () => {
    const r = await storeWith({ data: [{ id: 'APT-1' }], error: null }).patch('APT-1', { status: 'cancelled' });
    assert.deepStrictEqual(r, { ok: true, count: 1 });
  });

  test('error de BD (RLS/red) → {ok:false} (el cancel debe revertir y dar error)', async () => {
    const r = await storeWith({ data: null, error: { message: 'permission denied' } }).patch('APT-1', { status: 'cancelled' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.count, 0);
  });

  test('fila inexistente → {ok:true, count:0} (no error, pero no tocó nada)', async () => {
    const r = await storeWith({ data: [], error: null }).patch('APT-X', { status: 'cancelled' });
    assert.deepStrictEqual(r, { ok: true, count: 0 });
  });

  test('sin BD → skipped (in-memory es la verdad, no bloquea el cancel en dev)', async () => {
    const s = new AppointmentsStore(); s._enabled = false;
    assert.deepStrictEqual(await s.patch('APT-1', { status: 'cancelled' }), { ok: true, count: 0, skipped: true });
  });

  test('sin campos válidos → skipped (no lanza)', async () => {
    const r = await storeWith({ data: [], error: null }).patch('APT-1', {});
    assert.strictEqual(r.skipped, true);
  });
});
