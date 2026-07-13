// ============================================================
// NodeFlow — calendar-sync: fan-out a Outlook en paralelo a Google.
// Una org puede tener Google, Outlook, ambos o ninguno. Verifica que:
//  - pushAppointmentEvent crea también en Outlook y guarda outlook_event_id
//  - syncCancelToCalendar borra en AMBOS proveedores
//  - Outlook desconectado/apagado NO afecta al flujo de Google (aislamiento)
// Deps inyectables → sin googleapis, sin Graph, sin red.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { pushAppointmentEvent, syncCancelToCalendar } = require('../src/integrations/calendar-sync');

function deps(over = {}) {
  const calls = { gCreate: 0, oCreate: 0, gDelete: [], oDelete: [], patch: [] };
  const org = Object.assign({
    google_refresh_token: 'g-r', google_access_token: 'g-a', google_token_expiry: 9e15, google_calendar_id: 'primary',
    outlook_refresh_token: 'o-r', outlook_access_token: 'o-a', outlook_token_expiry: 9e15, outlook_calendar_id: 'primary',
  }, over.org || {});
  return {
    calls,
    db: { enabled: true, getOrg: async () => org, updateOrg: async () => {} },
    cal: {
      enabled: over.gEnabled !== false,
      refreshIfNeeded: async (t) => t,
      createEvent: async () => { calls.gCreate++; return { id: 'g_evt' }; },
      deleteEvent: async (t, id) => { calls.gDelete.push(id); return true; },
      updateEvent: async () => ({ id: 'g_evt' }),
    },
    ocal: {
      enabled: over.oEnabled !== false,
      refreshIfNeeded: async (t) => t,
      createEvent: async () => { calls.oCreate++; return { id: 'o_evt' }; },
      deleteEvent: async (t, id) => { calls.oDelete.push(id); return true; },
      updateEvent: async () => ({ id: 'o_evt' }),
    },
    getConfig: () => ({ timezone: 'Europe/Madrid' }),
    appointmentsStore: { patch: (id, f) => calls.patch.push({ id, f }) },
  };
}

const APT = () => ({ id: 'a1', businessId: 'org-1', patientName: 'Ana', service: 'Fisio', date: '2026-07-20', time: '10:00', duration: 45 });

describe('push fan-out', () => {
  test('crea en Google (devuelto) y en Outlook (guardado en la cita)', async () => {
    const d = deps();
    const apt = APT();
    const gid = await pushAppointmentEvent('org-1', apt, d);
    // deja que el fan-out fire-and-forget de Outlook resuelva
    await new Promise(r => setTimeout(r, 5));
    assert.equal(gid, 'g_evt');            // contrato de Google intacto
    assert.equal(d.calls.gCreate, 1);
    assert.equal(d.calls.oCreate, 1);
    assert.equal(apt.outlookEventId, 'o_evt');
    assert.ok(d.calls.patch.some(p => p.f.outlookEventId === 'o_evt'));
  });

  test('Outlook apagado no afecta a Google', async () => {
    const d = deps({ oEnabled: false });
    const apt = APT();
    const gid = await pushAppointmentEvent('org-1', apt, d);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(gid, 'g_evt');
    assert.equal(d.calls.oCreate, 0);
    assert.equal(apt.outlookEventId, undefined);
  });

  test('org sin Outlook conectado (sin refresh token) → sólo Google', async () => {
    const d = deps({ org: { outlook_refresh_token: null } });
    const apt = APT();
    await pushAppointmentEvent('org-1', apt, d);
    await new Promise(r => setTimeout(r, 5));
    assert.equal(d.calls.oCreate, 0);
    assert.equal(apt.outlookEventId, undefined);
  });
});

describe('cancel fan-out', () => {
  test('borra en ambos proveedores y limpia ambos ids', async () => {
    const d = deps();
    const apt = { ...APT(), googleEventId: 'g_evt', outlookEventId: 'o_evt' };
    const ok = await syncCancelToCalendar(apt, d);
    assert.equal(ok, true);
    assert.deepEqual(d.calls.gDelete, ['g_evt']);
    assert.deepEqual(d.calls.oDelete, ['o_evt']);
    assert.equal(apt.googleEventId, null);
    assert.equal(apt.outlookEventId, null);
  });

  test('cita sólo-Outlook (sin evento Google) también se cancela', async () => {
    const d = deps();
    const apt = { ...APT(), googleEventId: null, outlookEventId: 'o_evt' };
    const ok = await syncCancelToCalendar(apt, d);
    assert.equal(ok, true);
    assert.deepEqual(d.calls.gDelete, []);
    assert.deepEqual(d.calls.oDelete, ['o_evt']);
    assert.equal(apt.outlookEventId, null);
  });

  test('sin ningún evento → false (no llama a nada)', async () => {
    const d = deps();
    const ok = await syncCancelToCalendar({ ...APT() }, d);
    assert.equal(ok, false);
    assert.deepEqual(d.calls.gDelete, []);
    assert.deepEqual(d.calls.oDelete, []);
  });
});
