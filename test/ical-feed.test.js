// ============================================================
// NodeFlow — Feed iCal de citas (integración universal de salida)
// El dueño se suscribe a sus citas desde cualquier calendario. Aquí: que el
// VCALENDAR salga bien formado, con TZID Madrid, DTEND por duración, escapado
// correcto y omitiendo lo que no es una cita con hora.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildIcsFeed, icalTokenMatches } = require('../src/integrations/ical-feed');

describe('icalTokenMatches — puerta del feed (PII)', () => {
  test('token correcto → true', () => assert.strictEqual(icalTokenMatches('abc123def', 'abc123def'), true));
  test('token incorrecto → false', () => assert.strictEqual(icalTokenMatches('abc123def', 'abc123xxx'), false));
  test('distinta longitud → false (no revienta timingSafeEqual)', () => {
    assert.strictEqual(icalTokenMatches('abc', 'abcdef'), false);
  });
  test('sin token guardado o sin token en la petición → false (fail-closed)', () => {
    assert.strictEqual(icalTokenMatches('', 'x'), false);
    assert.strictEqual(icalTokenMatches('x', ''), false);
    assert.strictEqual(icalTokenMatches(null, null), false);
  });
});

const NOW = new Date(Date.UTC(2026, 6, 28, 12, 0, 0));
const appt = (over = {}) => Object.assign({
  id: 'APT-1', date: '2026-07-29', time: '10:00', duration: 30,
  service: 'Limpieza', patient_name: 'Ana', phone: '+34600111222', status: 'booked',
}, over);

function feed(appts) { return buildIcsFeed('Clínica X', appts, { now: NOW }); }

describe('buildIcsFeed', () => {
  test('cabecera VCALENDAR + VTIMEZONE Madrid', () => {
    const s = feed([appt()]);
    assert.match(s, /BEGIN:VCALENDAR/); assert.match(s, /END:VCALENDAR/);
    assert.match(s, /VERSION:2\.0/);
    assert.match(s, /TZID:Europe\/Madrid/);
    assert.match(s, /X-WR-CALNAME:Cl.nica X · NodeFlow/);
    assert.ok(s.includes('\r\n'), 'líneas con CRLF');
  });

  test('un evento con DTSTART/DTEND correctos (10:00 + 30min → 10:30)', () => {
    const s = feed([appt()]);
    assert.match(s, /BEGIN:VEVENT/);
    assert.match(s, /UID:APT-1@nodeflow/);
    assert.match(s, /DTSTART;TZID=Europe\/Madrid:20260729T100000/);
    assert.match(s, /DTEND;TZID=Europe\/Madrid:20260729T103000/);
    assert.match(s, /SUMMARY:Limpieza — Ana/);
    assert.match(s, /DESCRIPTION:Tel: \+34600111222/);
  });

  test('duración por defecto 30 si falta', () => {
    const s = feed([appt({ duration: null })]);
    assert.match(s, /DTEND;TZID=Europe\/Madrid:20260729T103000/);
  });

  test('DTEND cruza medianoche bien (23:50 + 30 → día siguiente 00:20)', () => {
    const s = feed([appt({ time: '23:50', duration: 30 })]);
    assert.match(s, /DTEND;TZID=Europe\/Madrid:20260730T002000/);
  });

  test('cancelada lleva STATUS:CANCELLED', () => {
    assert.match(feed([appt({ status: 'cancelled' })]), /STATUS:CANCELLED/);
  });

  test('escapa comas/; en el texto (no rompe el formato)', () => {
    const s = feed([appt({ service: 'Corte, tinte; barba', patient_name: 'Jon' })]);
    assert.match(s, /SUMMARY:Corte\\, tinte\\; barba — Jon/);
  });

  test('omite citas sin hora válida (día completo / basura)', () => {
    const s = feed([appt({ id: 'A', time: '' }), appt({ id: 'B', time: 'xx' }), appt({ id: 'C', time: '09:00' })]);
    assert.ok(!s.includes('UID:A@nodeflow'));
    assert.ok(!s.includes('UID:B@nodeflow'));
    assert.match(s, /UID:C@nodeflow/);
  });

  test('lista vacía → VCALENDAR válido sin eventos', () => {
    const s = feed([]);
    assert.match(s, /BEGIN:VCALENDAR/); assert.ok(!s.includes('BEGIN:VEVENT'));
  });
});
