// ============================================================
// NodeFlow — calendar-sync: crear/borrar el evento de Google Calendar de una
// cita (Fase 3). Encapsula org+token+refresh y devuelve el id del evento para
// poder BORRARLO al cancelar (antes el id se tiraba → evento fantasma). Deps
// inyectables → sin googleapis ni red.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { pushAppointmentEvent, removeAppointmentEvent, updateAppointmentEvent, syncCancelToCalendar } = require('../src/integrations/calendar-sync');

function fakeDeps(over = {}) {
  const calls = { createEvent: [], deleteEvent: [], updateOrg: [] };
  const org = Object.assign({
    google_refresh_token: 'refresh-1',
    google_access_token:  'access-1',
    google_token_expiry:  1000,
    google_calendar_id:   'primary',
  }, over.org || {});
  const deps = {
    db: {
      enabled: over.dbEnabled !== false,
      getOrg: async () => (over.org === null ? null : org),
      updateOrg: async (id, patch) => { calls.updateOrg.push({ id, patch }); },
    },
    cal: {
      enabled: over.calEnabled !== false,
      refreshIfNeeded: over.refreshIfNeeded || (async (t) => t),  // por defecto no cambia
      createEvent: async (tokens, apt, cfg) => { calls.createEvent.push({ tokens, apt, cfg }); return over.createReturns !== undefined ? over.createReturns : { id: 'evt_123' }; },
      deleteEvent: async (tokens, eventId, calId) => { calls.deleteEvent.push({ tokens, eventId, calId }); return over.deleteReturns !== undefined ? over.deleteReturns : true; },
      updateEvent: async (tokens, eventId, apt, cfg) => { calls.updateEvent = calls.updateEvent || []; calls.updateEvent.push({ eventId, apt, cfg }); return over.updateReturns !== undefined ? over.updateReturns : { id: eventId }; },
    },
    getConfig: () => ({ timezone: 'Europe/Madrid' }),
  };
  return { deps, calls, org };
}

const APT = { id: 'a1', businessId: 'org-1', patientName: 'Ana', service: 'Fisio', date: '2026-07-20', time: '10:00', duration: 45 };

describe('pushAppointmentEvent', () => {
  test('crea el evento y devuelve su id', async () => {
    const { deps, calls } = fakeDeps();
    const id = await pushAppointmentEvent('org-1', APT, deps);
    assert.strictEqual(id, 'evt_123');
    assert.strictEqual(calls.createEvent.length, 1);
    assert.strictEqual(calls.createEvent[0].cfg.calendarId, 'primary');
    assert.strictEqual(calls.createEvent[0].cfg.timezone, 'Europe/Madrid');
  });

  test('si el token se refresca, lo guarda en la org', async () => {
    const { deps, calls } = fakeDeps({ refreshIfNeeded: async () => ({ access_token: 'access-2', expiry_date: 2000 }) });
    await pushAppointmentEvent('org-1', APT, deps);
    assert.strictEqual(calls.updateOrg.length, 1);
    assert.strictEqual(calls.updateOrg[0].patch.google_access_token, 'access-2');
  });

  test('sin token no cambia → NO reescribe la org', async () => {
    const { deps, calls } = fakeDeps();   // refresh devuelve el mismo token
    await pushAppointmentEvent('org-1', APT, deps);
    assert.strictEqual(calls.updateOrg.length, 0);
  });

  test('org no conectada a Google → null, sin crear nada', async () => {
    const { deps, calls } = fakeDeps({ org: { google_refresh_token: null } });
    const id = await pushAppointmentEvent('org-1', APT, deps);
    assert.strictEqual(id, null);
    assert.strictEqual(calls.createEvent.length, 0);
  });

  test('db o calendario deshabilitado → null (fail-open)', async () => {
    const a = fakeDeps({ dbEnabled: false });
    assert.strictEqual(await pushAppointmentEvent('org-1', APT, a.deps), null);
    const b = fakeDeps({ calEnabled: false });
    assert.strictEqual(await pushAppointmentEvent('org-1', APT, b.deps), null);
  });

  test('createEvent devuelve null (fallo de Google) → null, no revienta', async () => {
    const { deps } = fakeDeps({ createReturns: null });
    assert.strictEqual(await pushAppointmentEvent('org-1', APT, deps), null);
  });
});

describe('tokens cifrados en reposo (auditoría 2026-07-16)', () => {
  // Regresión del bug "cita manual no aparece en Google Calendar": el callback
  // OAuth guarda los tokens cifrados, pero calendar-sync los pasaba a Google en
  // crudo → invalid_grant silencioso y ninguna cita se sincronizaba.
  test('descifra los tokens antes de llamar a Google y re-cifra al persistir', async () => {
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    try {
      const { encryptSecret, decryptSecret } = require('../src/utils/crypto');
      const { deps, calls } = fakeDeps({
        org: {
          google_refresh_token: encryptSecret('refresh-1'),
          google_access_token:  encryptSecret('access-1'),
        },
        refreshIfNeeded: async (t) => {
          assert.strictEqual(t.refresh_token, 'refresh-1');
          assert.strictEqual(t.access_token, 'access-1');
          return { ...t, access_token: 'access-2', expiry_date: 2000 };
        },
      });
      const id = await pushAppointmentEvent('org-1', APT, deps);
      assert.strictEqual(id, 'evt_123');
      assert.strictEqual(calls.createEvent[0].tokens.access_token, 'access-2');
      // El token refrescado vuelve a la BD CIFRADO, nunca en claro.
      assert.strictEqual(calls.updateOrg.length, 1);
      const stored = calls.updateOrg[0].patch.google_access_token;
      assert.notStrictEqual(stored, 'access-2');
      assert.strictEqual(decryptSecret(stored), 'access-2');
    } finally {
      if (prev === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = prev;
    }
  });
});

describe('removeAppointmentEvent', () => {
  test('borra el evento por su id y devuelve true', async () => {
    const { deps, calls } = fakeDeps();
    const ok = await removeAppointmentEvent('org-1', 'evt_123', deps);
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.deleteEvent.length, 1);
    assert.strictEqual(calls.deleteEvent[0].eventId, 'evt_123');
    assert.strictEqual(calls.deleteEvent[0].calId, 'primary');
  });

  test('sin eventId → false, no llama a Google', async () => {
    const { deps, calls } = fakeDeps();
    assert.strictEqual(await removeAppointmentEvent('org-1', null, deps), false);
    assert.strictEqual(calls.deleteEvent.length, 0);
  });

  test('org no conectada → false', async () => {
    const { deps } = fakeDeps({ org: { google_refresh_token: null } });
    assert.strictEqual(await removeAppointmentEvent('org-1', 'evt_1', deps), false);
  });
});

describe('updateAppointmentEvent (reprogramación)', () => {
  test('mueve el evento por su id con la nueva fecha/hora', async () => {
    const { deps, calls } = fakeDeps();
    const apt2 = { ...APT, date: '2026-07-21', time: '12:00' };
    const ok = await updateAppointmentEvent('org-1', 'evt_9', apt2, deps);
    assert.strictEqual(ok, true);
    assert.strictEqual(calls.updateEvent.length, 1);
    assert.strictEqual(calls.updateEvent[0].eventId, 'evt_9');
    assert.strictEqual(calls.updateEvent[0].apt.time, '12:00');
  });
  test('sin eventId → false, no llama a Google', async () => {
    const { deps, calls } = fakeDeps();
    assert.strictEqual(await updateAppointmentEvent('org-1', null, APT, deps), false);
    assert.strictEqual(calls.updateEvent, undefined);
  });
  test('org no conectada → false', async () => {
    const { deps } = fakeDeps({ org: { google_refresh_token: null } });
    assert.strictEqual(await updateAppointmentEvent('org-1', 'evt_9', APT, deps), false);
  });
});

describe('syncCancelToCalendar (canónico: WhatsApp / voz / portal)', () => {
  function store() { const patches = []; return { patches, patch: (id, f) => patches.push({ id, f }) }; }

  test('cita con evento → lo borra y limpia el id en memoria + store', async () => {
    const s = store();
    const apt = { id: 'a1', businessId: 'org-1', googleEventId: 'evt_9' };
    const ok = await syncCancelToCalendar(apt, {
      removeAppointmentEvent: async (biz, ev) => { assert.strictEqual(ev, 'evt_9'); return true; },
      appointmentsStore: s,
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(apt.googleEventId, null);
    assert.deepStrictEqual(s.patches, [{ id: 'a1', f: { googleEventId: null } }]);
  });

  test('cita sin evento (o sin businessId) → no toca Google', async () => {
    const s = store();
    let called = 0;
    const r1 = await syncCancelToCalendar({ id: 'a1', businessId: 'org-1' }, { removeAppointmentEvent: async () => { called++; return true; }, appointmentsStore: s });
    const r2 = await syncCancelToCalendar({ id: 'a2', googleEventId: 'e' }, { removeAppointmentEvent: async () => { called++; return true; }, appointmentsStore: s });
    assert.strictEqual(r1, false);
    assert.strictEqual(r2, false);
    assert.strictEqual(called, 0);
    assert.strictEqual(s.patches.length, 0);
  });

  test('el borrado falla → conserva el id (se reintentará)', async () => {
    const s = store();
    const apt = { id: 'a1', businessId: 'org-1', googleEventId: 'evt_9' };
    const ok = await syncCancelToCalendar(apt, { removeAppointmentEvent: async () => false, appointmentsStore: s });
    assert.strictEqual(ok, false);
    assert.strictEqual(apt.googleEventId, 'evt_9');
    assert.strictEqual(s.patches.length, 0);
  });
});
