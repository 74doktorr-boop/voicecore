// ============================================================
// NodeFlow — Busy desde feeds iCal (2026-07-17)
// La integración universal de lectura (Fresha/Booksy/Mews… exportan .ics):
// sus citas bloquean huecos en NodeFlow → fin de la doble agenda (66% del
// churn simulado). Tests del parser puro (zonas, multi-día, omisiones
// conscientes) + fetch con caché y anti-SSRF, todo fail-open.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { unfoldIcs, parseIcsDate, busyFromIcs, isSafeFeedUrl, icalBusyByDate, _clearCache } = require('../src/integrations/ical-busy');

function ics(events) {
  return 'BEGIN:VCALENDAR\r\n' + events.map(e => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join('\r\n') + '\r\nEND:VCALENDAR';
}

describe('unfoldIcs / parseIcsDate', () => {
  test('despliega líneas plegadas RFC 5545', () => {
    assert.strictEqual(unfoldIcs('DTSTART:2026\r\n 0717T090000Z'), 'DTSTART:20260717T090000Z');
  });
  test('UTC, local y all-day', () => {
    assert.deepStrictEqual(parseIcsDate('20260717T090000Z', ''), { allDay: false, utc: true, y: 2026, mo: 7, d: 17, h: 9, mi: 0 });
    assert.strictEqual(parseIcsDate('20260717T090000', ';TZID=Europe/Madrid').utc, false);
    assert.strictEqual(parseIcsDate('20260717', ';VALUE=DATE').allDay, true);
    assert.strictEqual(parseIcsDate('garbage', ''), null);
  });
});

describe('busyFromIcs — pared de Madrid', () => {
  test('evento con TZID Madrid bloquea su franja exacta', () => {
    const r = busyFromIcs(ics(['DTSTART;TZID=Europe/Madrid:20260720T100000\nDTEND;TZID=Europe/Madrid:20260720T113000']), '2026-07-20', '2026-07-20');
    assert.deepStrictEqual(r.busy['2026-07-20'], [{ startMin: 600, endMin: 690 }]);
  });
  test('evento UTC en julio → +2h de pared (CEST)', () => {
    const r = busyFromIcs(ics(['DTSTART:20260720T090000Z\nDTEND:20260720T100000Z']), '2026-07-20', '2026-07-20');
    assert.deepStrictEqual(r.busy['2026-07-20'], [{ startMin: 660, endMin: 720 }]);  // 11:00-12:00 Madrid
  });
  test('sin DTEND → bloquea 30 min', () => {
    const r = busyFromIcs(ics(['DTSTART;TZID=Europe/Madrid:20260720T160000']), '2026-07-20', '2026-07-20');
    assert.deepStrictEqual(r.busy['2026-07-20'], [{ startMin: 960, endMin: 990 }]);
  });
  test('multi-día se reparte y recorta al rango', () => {
    const r = busyFromIcs(ics(['DTSTART;TZID=Europe/Madrid:20260720T230000\nDTEND;TZID=Europe/Madrid:20260721T010000']), '2026-07-20', '2026-07-21');
    assert.deepStrictEqual(r.busy['2026-07-20'], [{ startMin: 1380, endMin: 1440 }]);
    assert.deepStrictEqual(r.busy['2026-07-21'], [{ startMin: 0, endMin: 60 }]);
  });
  test('all-day y RRULE se OMITEN (v1 consciente) y se cuentan', () => {
    const r = busyFromIcs(ics([
      'DTSTART;VALUE=DATE:20260720',                                             // festivo
      'DTSTART;TZID=Europe/Madrid:20260720T100000\nRRULE:FREQ=WEEKLY',           // clase recurrente
      'DTSTART;TZID=Europe/Madrid:20260720T120000\nDTEND;TZID=Europe/Madrid:20260720T123000',
    ]), '2026-07-20', '2026-07-20');
    assert.strictEqual(r.skipped.allDay, 1);
    assert.strictEqual(r.skipped.rrule, 1);
    assert.strictEqual(r.busy['2026-07-20'].length, 1);
  });
  test('fuera de rango no aparece', () => {
    const r = busyFromIcs(ics(['DTSTART;TZID=Europe/Madrid:20260801T100000\nDTEND;TZID=Europe/Madrid:20260801T110000']), '2026-07-20', '2026-07-25');
    assert.deepStrictEqual(r.busy, {});
  });
});

describe('isSafeFeedUrl (anti-SSRF)', () => {
  test('https público sí', () => assert.strictEqual(isSafeFeedUrl('https://fresha.com/feed.ics'), true));
  test('http, localhost y rangos privados no', () => {
    assert.strictEqual(isSafeFeedUrl('http://fresha.com/feed.ics'), false);
    assert.strictEqual(isSafeFeedUrl('https://localhost/x'), false);
    assert.strictEqual(isSafeFeedUrl('https://192.168.1.10/x'), false);
    assert.strictEqual(isSafeFeedUrl('https://10.0.0.5/x'), false);
    assert.strictEqual(isSafeFeedUrl('no-es-url'), false);
  });
});

describe('icalBusyByDate (fetch mockeado)', () => {
  test('combina feeds y cachea; el feed caído es fail-open', async () => {
    _clearCache();
    let hits = 0;
    const fakeFetch = async (url) => {
      hits++;
      if (url.includes('roto')) throw new Error('ECONNREFUSED');
      return { ok: true, text: async () => ics(['DTSTART;TZID=Europe/Madrid:20260720T100000\nDTEND;TZID=Europe/Madrid:20260720T110000']) };
    };
    const feeds = ['https://ok.example/feed.ics', 'https://roto.example/feed.ics'];
    const b1 = await icalBusyByDate('org1', feeds, '2026-07-20', '2026-07-20', { fetch: fakeFetch });
    assert.deepStrictEqual(b1['2026-07-20'], [{ startMin: 600, endMin: 660 }]);
    const b2 = await icalBusyByDate('org1', feeds, '2026-07-20', '2026-07-20', { fetch: fakeFetch });
    assert.deepStrictEqual(b2, b1);
    assert.strictEqual(hits, 3);   // ok cacheado (1 hit), roto reintenta (2 hits)
  });
  test('URL insegura se rechaza sin fetch', async () => {
    let hits = 0;
    await icalBusyByDate('org1', ['https://192.168.1.1/f.ics'], '2026-07-20', '2026-07-20', { fetch: async () => { hits++; return { ok: true, text: async () => '' }; } });
    assert.strictEqual(hits, 0);
  });
});
