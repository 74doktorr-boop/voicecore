// ============================================================
// NodeFlow — Fase 3: al confirmar/cancelar por WhatsApp, la cita se refleja en
// Google Calendar. ensureCalendarEvent (crear al confirmar) y
// removeCalendarEvent (borrar al cancelar), con deps inyectables.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ensureCalendarEvent, removeCalendarEvent } = require('../src/whatsapp/reply-handler');

function fakeStore() {
  const patches = [];
  return { patches, patch: (id, fields) => patches.push({ id, fields }) };
}

describe('ensureCalendarEvent (confirmar → crear evento si falta)', () => {
  test('cita sin evento → lo crea y guarda el id', async () => {
    const store = fakeStore();
    const apt = { id: 'a1', businessId: 'org-1' };
    const id = await ensureCalendarEvent(apt, {
      pushAppointmentEvent: async () => 'evt_new',
      appointmentsStore: store,
    });
    assert.strictEqual(id, 'evt_new');
    assert.strictEqual(apt.googleEventId, 'evt_new');
    assert.deepStrictEqual(store.patches, [{ id: 'a1', fields: { googleEventId: 'evt_new' } }]);
  });

  test('cita que YA tiene evento → no crea nada (idempotente)', async () => {
    const store = fakeStore();
    let called = 0;
    const apt = { id: 'a1', businessId: 'org-1', googleEventId: 'evt_old' };
    const r = await ensureCalendarEvent(apt, {
      pushAppointmentEvent: async () => { called++; return 'evt_x'; },
      appointmentsStore: store,
    });
    assert.strictEqual(r, null);
    assert.strictEqual(called, 0);
    assert.strictEqual(apt.googleEventId, 'evt_old');
    assert.strictEqual(store.patches.length, 0);
  });

  test('sin businessId → no toca nada', async () => {
    const store = fakeStore();
    const r = await ensureCalendarEvent({ id: 'a1' }, { pushAppointmentEvent: async () => 'x', appointmentsStore: store });
    assert.strictEqual(r, null);
    assert.strictEqual(store.patches.length, 0);
  });

  test('Google no conectado (push devuelve null) → no guarda id', async () => {
    const store = fakeStore();
    const apt = { id: 'a1', businessId: 'org-1' };
    const r = await ensureCalendarEvent(apt, { pushAppointmentEvent: async () => null, appointmentsStore: store });
    assert.strictEqual(r, null);
    assert.strictEqual(apt.googleEventId, undefined);
    assert.strictEqual(store.patches.length, 0);
  });
});

describe('removeCalendarEvent (cancelar → borrar el evento fantasma)', () => {
  test('cita con evento → lo borra y limpia el id', async () => {
    const store = fakeStore();
    const apt = { id: 'a1', businessId: 'org-1', googleEventId: 'evt_1' };
    const ok = await removeCalendarEvent(apt, {
      removeAppointmentEvent: async (biz, ev) => { assert.strictEqual(ev, 'evt_1'); return true; },
      appointmentsStore: store,
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(apt.googleEventId, null);
    assert.deepStrictEqual(store.patches, [{ id: 'a1', fields: { googleEventId: null } }]);
  });

  test('cita sin evento → no llama a Google ni patchea', async () => {
    const store = fakeStore();
    let called = 0;
    const ok = await removeCalendarEvent({ id: 'a1', businessId: 'org-1' }, {
      removeAppointmentEvent: async () => { called++; return true; },
      appointmentsStore: store,
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(called, 0);
    assert.strictEqual(store.patches.length, 0);
  });

  test('el borrado falla (Google caído) → no limpia el id (se reintentará)', async () => {
    const store = fakeStore();
    const apt = { id: 'a1', businessId: 'org-1', googleEventId: 'evt_1' };
    const ok = await removeCalendarEvent(apt, { removeAppointmentEvent: async () => false, appointmentsStore: store });
    assert.strictEqual(ok, false);
    assert.strictEqual(apt.googleEventId, 'evt_1', 'conserva el id si no se pudo borrar');
    assert.strictEqual(store.patches.length, 0);
  });
});
