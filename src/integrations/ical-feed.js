'use strict';
// ============================================================
// NodeFlow — Feed iCal de las CITAS (integración universal de SALIDA)
// ------------------------------------------------------------
// La contrapartida de ical-busy (lectura): aquí EXPORTAMOS las citas de NodeFlow
// como un feed iCal al que el dueño se suscribe desde CUALQUIER calendario
// (Google, Outlook, Apple, Proton…). Sin OAuth, sin Azure, sin partnerships:
// pega una URL secreta y sus citas aparecen en su calendario de siempre.
// Ataca el bloqueo "solo Google Calendar" (66% del churn en la simulación) de
// forma universal.
//
// Zona horaria: se emite con TZID=Europe/Madrid + un VTIMEZONE estándar (CET/
// CEST) para que la hora sea correcta con y sin horario de verano.
// ============================================================

// VTIMEZONE estándar de Europa/Madrid (reglas UE de cambio de hora).
const MADRID_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

// Escapa texto para un valor iCal (RFC 5545): backslash, ; , y saltos de línea.
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// "2026-07-29" + "10:00" → "20260729T100000" (hora local, va con TZID).
function _local(date, time) {
  const d = String(date || '').replace(/-/g, '');
  const t = String(time || '00:00').replace(/[^\d]/g, '').padEnd(6, '0').slice(0, 6);
  return `${d}T${t}`;
}

// Suma minutos a (date,time) devolviendo [date, time] de reloj (para DTEND).
// Se usa Date.UTC solo como aritmética de reloj (no hay conversión de zona).
function _addMinutes(date, time, minutes) {
  const [Y, M, D] = String(date).split('-').map(Number);
  const [h, m] = String(time || '00:00').split(':').map(Number);
  const dt = new Date(Date.UTC(Y, (M || 1) - 1, D || 1, h || 0, (m || 0) + (minutes || 0)));
  const p = (n) => String(n).padStart(2, '0');
  return [`${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`,
          `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`];
}

function _utcStamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T`
       + `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}

const HORA_RE = /^\d{1,2}:\d{2}/;

/**
 * Construye el feic iCal (VCALENDAR) de las citas de un negocio.
 * @param {string} orgName
 * @param {Array<{id,date,time,duration,service,patient_name,phone,location,status}>} appointments
 * @param {{now?:Date}} opts
 * @returns {string} texto iCal con CRLF
 */
function buildIcsFeed(orgName, appointments = [], opts = {}) {
  const stamp = _utcStamp(opts.now || new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NodeFlow//Agenda//ES',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${_esc(orgName || 'Agenda')} · NodeFlow`,
    'X-WR-TIMEZONE:Europe/Madrid',
    ...MADRID_VTIMEZONE,
  ];
  for (const a of (appointments || [])) {
    // Sin fecha u hora válida no hay evento con hora → se omite (no ensuciar).
    if (!a || !a.date || !HORA_RE.test(String(a.time || ''))) continue;
    const dur = Number(a.duration) > 0 ? Number(a.duration) : 30;
    const [ed, et] = _addMinutes(a.date, a.time, dur);
    const summary = [a.service, a.patient_name].filter(Boolean).join(' — ') || 'Cita';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${_esc(String(a.id || (a.date + (a.time || '') + (a.patient_name || ''))))}@nodeflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Madrid:${_local(a.date, a.time)}`,
      `DTEND;TZID=Europe/Madrid:${_local(ed, et)}`,
      `SUMMARY:${_esc(summary)}`,
    );
    if (a.phone) lines.push(`DESCRIPTION:${_esc('Tel: ' + a.phone)}`);
    if (a.location) lines.push(`LOCATION:${_esc(a.location)}`);
    if (String(a.status) === 'cancelled') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// Validación del token del feed en tiempo constante. Fail-closed: sin token
// guardado o sin token en la petición → false (nunca sirve). El feed expone
// citas con datos de clientes, así que la puerta es estricta.
function icalTokenMatches(stored, provided) {
  if (!stored || !provided) return false;
  const a = Buffer.from(String(stored)), b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

module.exports = { buildIcsFeed, MADRID_VTIMEZONE, icalTokenMatches };
