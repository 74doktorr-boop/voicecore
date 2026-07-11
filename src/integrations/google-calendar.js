// ============================================
// NodeFlow — Google Calendar Integration
// OAuth 2.0 + event CRUD for per-org calendars
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('GOOGLE-CAL');

class GoogleCalendar {
  constructor() {
    this.clientId     = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri  = process.env.GOOGLE_REDIRECT_URI || 'https://nodeflow.es/api/calendar/callback';
    this.enabled      = !!(this.clientId && this.clientSecret);

    if (!this.enabled) {
      log.warn('Google Calendar not configured — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET');
    }
  }

  _oauth2(tokens = null) {
    const { google } = require('googleapis');
    const client = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
    if (tokens) client.setCredentials(tokens);
    return client;
  }

  getAuthUrl(orgId) {
    return this._oauth2().generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: orgId,
      prompt: 'consent',
    });
  }

  async exchangeCode(code) {
    const { tokens } = await this._oauth2().getToken(code);
    return tokens; // { access_token, refresh_token, expiry_date }
  }

  async refreshIfNeeded(tokens) {
    if (!tokens.expiry_date || Date.now() > tokens.expiry_date - 120_000) {
      try {
        const { credentials } = await this._oauth2(tokens).refreshAccessToken();
        return credentials;
      } catch (e) {
        log.warn(`Token refresh failed: ${e.message}`);
      }
    }
    return tokens;
  }

  async createEvent(tokens, appointment, config = {}) {
    if (!this.enabled) return null;
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });

      const tz    = config.timezone || 'Europe/Madrid';

      // BUG FIX: Pass local date-time WITHOUT timezone offset so Google Calendar
      // interprets it using the `timeZone` field. Using .toISOString() would emit
      // UTC (the server's clock is UTC), making events 1-2h late in Spain.
      const startLocal = `${appointment.date}T${appointment.time}:00`;
      const [startH, startM] = (appointment.time || '00:00').split(':').map(Number);
      const totalMins  = startH * 60 + startM + (appointment.duration || 30);
      const endH       = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
      const endM       = String(totalMins % 60).padStart(2, '0');
      const endLocal   = `${appointment.date}T${endH}:${endM}:00`;

      // Título: CLIENTE primero (es lo que el negocio escanea de un vistazo) y
      // luego el servicio. Google ya muestra la hora aparte, así que no la
      // repetimos en el título. Fallbacks limpios si falta algún dato.
      const summary = [appointment.patientName, appointment.service]
        .map(s => (s || '').trim()).filter(Boolean).join(' · ') || 'Cita';

      const desc = [
        appointment.service ? `Servicio: ${appointment.service}` : '',
        appointment.phone   ? `Teléfono: ${appointment.phone}` : '',
        appointment.email   ? `Email: ${appointment.email}` : '',
        appointment.notes   ? `Notas: ${appointment.notes}` : '',
        '',
        'Reservado con NodeFlow',
      ].filter(Boolean).join('\n');

      const { data } = await cal.events.insert({
        calendarId: config.calendarId || 'primary',
        requestBody: {
          summary,
          description: desc,
          start: { dateTime: startLocal, timeZone: tz },
          end:   { dateTime: endLocal,   timeZone: tz },
          reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
        },
      });

      log.info(`Cal event created: ${data.id} — ${appointment.patientName}`);
      return data;
    } catch (e) {
      log.error(`createEvent failed: ${e.message}`);
      return null;
    }
  }

  async deleteEvent(tokens, eventId, calendarId = 'primary') {
    if (!this.enabled) return false;
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });
      await cal.events.delete({ calendarId, eventId });
      log.info(`Cal event deleted: ${eventId}`);
      return true;
    } catch (e) {
      log.error(`deleteEvent failed: ${e.message}`);
      return false;
    }
  }

  // Mueve/actualiza un evento existente (reprogramación de cita). Sin esto, al
  // cambiar fecha/hora en el portal el evento se quedaba en la hora VIEJA
  // (fantasma). Misma construcción local+timeZone que createEvent (evita desfase
  // UTC). Devuelve el evento actualizado o null. FAIL-OPEN.
  async updateEvent(tokens, eventId, appointment, config = {}) {
    if (!this.enabled || !eventId) return null;
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });
      const tz = config.timezone || 'Europe/Madrid';
      const startLocal = `${appointment.date}T${appointment.time}:00`;
      const [startH, startM] = (appointment.time || '00:00').split(':').map(Number);
      const totalMins = startH * 60 + startM + (appointment.duration || 30);
      const endH = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
      const endM = String(totalMins % 60).padStart(2, '0');
      const endLocal = `${appointment.date}T${endH}:${endM}:00`;
      const summary = [appointment.patientName, appointment.service]
        .map(s => (s || '').trim()).filter(Boolean).join(' · ') || 'Cita';
      const { data } = await cal.events.patch({
        calendarId: config.calendarId || 'primary',
        eventId,
        requestBody: {
          summary,
          start: { dateTime: startLocal, timeZone: tz },
          end:   { dateTime: endLocal,   timeZone: tz },
        },
      });
      log.info(`Cal event updated: ${eventId}`);
      return data;
    } catch (e) {
      log.error(`updateEvent failed: ${e.message}`);
      return null;
    }
  }

  async listEvents(tokens, date, calendarId = 'primary') {
    if (!this.enabled) return [];
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });

      // BUG FIX: Use local date-time + timeZone instead of hardcoded +01:00 offset.
      // Spain uses CEST (+02:00) in summer, so hardcoding +01:00 would be 1h off.
      const timeMin = `${date}T00:00:00`;
      const timeMax = `${date}T23:59:59`;

      const { data } = await cal.events.list({
        calendarId,
        timeMin,
        timeMax,
        timeZone: 'Europe/Madrid',
        singleEvents: true,
        orderBy: 'startTime',
      });

      return data.items || [];
    } catch (e) {
      log.error(`listEvents failed: ${e.message}`);
      return [];
    }
  }

  // Busy blocks across a date range in ONE request (freebusy API — mucho más
  // barato que listEvents por día, clave para no ralentizar la llamada de voz).
  // Devuelve { 'YYYY-MM-DD': [{startMin, endMin}] } en minutos del día (Madrid).
  // Fail-open: {} ante cualquier error, para que un hipo de Google NUNCA
  // bloquee una reserva (mejor un solape raro que no poder reservar nada).
  async getBusyByDate(tokens, fromDate, toDate, calendarId = 'primary') {
    if (!this.enabled) return {};
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });
      const { data } = await cal.freebusy.query({
        requestBody: {
          // Ventana UTC que cubre de sobra las horas de negocio en Madrid.
          timeMin:  `${fromDate}T00:00:00Z`,
          timeMax:  `${toDate}T23:59:59Z`,
          timeZone: 'Europe/Madrid',
          items:    [{ id: calendarId }],
        },
      });
      const busy = (data.calendars && data.calendars[calendarId] && data.calendars[calendarId].busy) || [];
      return busyIntervalsToByDate(busy);
    } catch (e) {
      log.warn(`getBusyByDate failed: ${e.message}`);
      return {};
    }
  }

  // Eventos del calendario en un rango, normalizados para pintar en el portal
  // (una sola llamada). Devuelve [{id,date,time,endTime,allDay,summary}].
  async listEventsRange(tokens, fromDate, toDate, calendarId = 'primary') {
    if (!this.enabled) return [];
    try {
      const { google } = require('googleapis');
      const cal = google.calendar({ version: 'v3', auth: this._oauth2(tokens) });
      const { data } = await cal.events.list({
        calendarId,
        timeMin:      `${fromDate}T00:00:00Z`,
        timeMax:      `${toDate}T23:59:59Z`,
        timeZone:     'Europe/Madrid',
        singleEvents: true,
        orderBy:      'startTime',
        maxResults:   250,
      });
      return (data.items || []).map(normalizeEvent).filter(Boolean);
    } catch (e) {
      log.warn(`listEventsRange failed: ${e.message}`);
      return [];
    }
  }
}

// ── Helpers puros (exportados para test) ──────────────────────────────────────
// Instante ISO → { date:'YYYY-MM-DD', min:Number } en Europe/Madrid.
function _madridDateMin(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: Number(g('hour')) * 60 + Number(g('minute')) };
}

// [{start,end} RFC3339] → { 'YYYY-MM-DD': [{startMin,endMin}] } (minutos Madrid).
// Parte los eventos que cruzan medianoche en bloques por día.
function busyIntervalsToByDate(busy) {
  const out = {};
  const add = (date, startMin, endMin) => {
    if (endMin <= startMin) return;
    (out[date] = out[date] || []).push({ startMin, endMin });
  };
  for (const b of busy || []) {
    const s = _madridDateMin(b.start), e = _madridDateMin(b.end);
    if (!s || !e) continue;
    if (s.date === e.date) { add(s.date, s.min, e.min); continue; }
    // Cruza medianoche: día de inicio hasta las 24:00, días completos en medio,
    // y día final desde las 00:00.
    add(s.date, s.min, 24 * 60);
    let cur = new Date(`${s.date}T00:00:00Z`);
    const end = new Date(`${e.date}T00:00:00Z`);
    cur.setUTCDate(cur.getUTCDate() + 1);
    while (cur < end) {
      add(cur.toISOString().slice(0, 10), 0, 24 * 60);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    add(e.date, 0, e.min);
  }
  return out;
}

// Evento crudo de la API de Google → forma normalizada para el portal (hora
// local Madrid). Devuelve null para eventos cancelados o sin inicio usable.
function normalizeEvent(ev) {
  if (!ev || ev.status === 'cancelled') return null;
  const start = ev.start || {}, end = ev.end || {};
  const summary = ev.summary || '(sin título)';
  if (start.date && !start.dateTime) {   // evento de día completo
    return { id: ev.id, date: start.date, time: null, endTime: null, allDay: true, summary };
  }
  if (!start.dateTime) return null;
  const s = _madridDateMin(start.dateTime);
  if (!s) return null;
  const e = end.dateTime ? _madridDateMin(end.dateTime) : null;
  const hhmm = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return {
    id: ev.id, date: s.date, time: hhmm(s.min),
    endTime: (e && e.date === s.date) ? hhmm(e.min) : null,
    allDay: false, summary,
  };
}

let _instance = null;
function getGoogleCalendar() {
  if (!_instance) _instance = new GoogleCalendar();
  return _instance;
}

module.exports = { GoogleCalendar, getGoogleCalendar, busyIntervalsToByDate, normalizeEvent };
