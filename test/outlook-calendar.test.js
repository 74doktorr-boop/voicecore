// ============================================================
// NodeFlow — Outlook / Microsoft 365 Calendar (Microsoft Graph vía fetch).
// Verifica: gating (OFF sin MS_*), construcción de evento con hora LOCAL +
// timeZone (no UTC), normalización de eventos de Graph, borrado idempotente
// (404 = ok), y que todo es fail-open/no-op sin credenciales. fetch inyectado.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { OutlookCalendar, normalizeOutlookEvent } = require('../src/integrations/outlook-calendar');

function makeCal(fetchImpl) {
  const cal = new OutlookCalendar();
  cal.clientId = 'cid'; cal.clientSecret = 'sec'; cal.enabled = true;
  cal._fetch = fetchImpl;
  return cal;
}
const TOKENS = { access_token: 'at', refresh_token: 'rt', expiry_date: Date.now() + 3600_000 };
const APT = { patientName: 'Ana', service: 'Corte', date: '2026-07-20', time: '10:00', duration: 30, phone: '666351319' };

describe('gating', () => {
  test('sin MS_CLIENT_ID/SECRET → enabled=false y CRUD no-op', async () => {
    const cal = new OutlookCalendar(); // sin env
    assert.equal(cal.enabled, false);
    assert.equal(await cal.createEvent(TOKENS, APT), null);
    assert.equal(await cal.deleteEvent(TOKENS, 'e1'), false);
    assert.deepEqual(await cal.listEventsRange(TOKENS, '2026-07-20', '2026-07-20'), []);
    assert.deepEqual(await cal.getBusyByDate(TOKENS, '2026-07-20', '2026-07-20'), {});
  });
});

describe('createEvent', () => {
  test('envía hora LOCAL + timeZone Madrid (no UTC) y devuelve el evento', async () => {
    let captured = null;
    const cal = makeCal(async (url, opts) => {
      captured = { url, method: opts.method, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
      return { ok: true, json: async () => ({ id: 'evt_out_1' }) };
    });
    const ev = await cal.createEvent(TOKENS, APT, { timezone: 'Europe/Madrid' });
    assert.equal(ev.id, 'evt_out_1');
    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/me/events'));
    assert.equal(captured.auth, 'Bearer at');
    assert.equal(captured.body.start.dateTime, '2026-07-20T10:00:00');
    assert.equal(captured.body.start.timeZone, 'Europe/Madrid');
    assert.equal(captured.body.end.dateTime, '2026-07-20T10:30:00'); // +30 min
    assert.match(captured.body.subject, /Ana/);
  });

  test('fail-open: si Graph responde error, devuelve null', async () => {
    const cal = makeCal(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'nope' } }) }));
    assert.equal(await cal.createEvent(TOKENS, APT), null);
  });
});

describe('deleteEvent', () => {
  test('204 → true', async () => {
    const cal = makeCal(async () => ({ ok: true, status: 204 }));
    assert.equal(await cal.deleteEvent(TOKENS, 'e1'), true);
  });
  test('404 (ya no existe) → true (idempotente)', async () => {
    const cal = makeCal(async () => ({ ok: false, status: 404 }));
    assert.equal(await cal.deleteEvent(TOKENS, 'e1'), true);
  });
  test('otro error → false', async () => {
    const cal = makeCal(async () => ({ ok: false, status: 403 }));
    assert.equal(await cal.deleteEvent(TOKENS, 'e1'), false);
  });
});

describe('listEventsRange + getBusyByDate', () => {
  const graphEvents = {
    value: [
      { id: 'a', subject: 'Cita 1', isAllDay: false, start: { dateTime: '2026-07-20T09:00:00.0000000' }, end: { dateTime: '2026-07-20T09:30:00.0000000' } },
      { id: 'b', subject: 'Todo el día', isAllDay: true, start: { dateTime: '2026-07-20T00:00:00.0000000' }, end: { dateTime: '2026-07-21T00:00:00.0000000' } },
    ],
  };
  test('normaliza y pide horas en Madrid (Prefer header)', async () => {
    let prefer = null;
    const cal = makeCal(async (url, opts) => { prefer = opts.headers.Prefer; return { ok: true, json: async () => graphEvents }; });
    const evs = await cal.listEventsRange(TOKENS, '2026-07-20', '2026-07-20');
    assert.match(prefer, /Europe\/Madrid/);
    assert.equal(evs.length, 2);
    assert.deepEqual(evs[0], { id: 'a', date: '2026-07-20', time: '09:00', endTime: '09:30', allDay: false, summary: 'Cita 1' });
    assert.equal(evs[1].allDay, true);
  });
  test('getBusyByDate ignora all-day y agrupa por fecha en minutos', async () => {
    const cal = makeCal(async () => ({ ok: true, json: async () => graphEvents }));
    const busy = await cal.getBusyByDate(TOKENS, '2026-07-20', '2026-07-20');
    assert.deepEqual(busy, { '2026-07-20': [{ startMin: 540, endMin: 570 }] }); // 09:00-09:30
  });
});

describe('normalizeOutlookEvent', () => {
  test('evento cronometrado', () => {
    const n = normalizeOutlookEvent({ id: 'x', subject: 'S', isAllDay: false, start: { dateTime: '2026-07-20T10:00:00.0000000' }, end: { dateTime: '2026-07-20T11:00:00.0000000' } });
    assert.deepEqual(n, { id: 'x', date: '2026-07-20', time: '10:00', endTime: '11:00', allDay: false, summary: 'S' });
  });
  test('sin start.dateTime → null', () => {
    assert.equal(normalizeOutlookEvent({ id: 'x', start: {} }), null);
  });
});
