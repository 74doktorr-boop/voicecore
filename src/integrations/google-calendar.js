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

      const desc = [
        `Cliente: ${appointment.patientName}`,
        appointment.phone ? `Tel: ${appointment.phone}` : '',
        appointment.email ? `Email: ${appointment.email}` : '',
        appointment.service ? `Servicio: ${appointment.service}` : '',
        appointment.notes  ? `Notas: ${appointment.notes}` : '',
      ].filter(Boolean).join('\n');

      const { data } = await cal.events.insert({
        calendarId: config.calendarId || 'primary',
        requestBody: {
          summary: `${appointment.service || 'Cita'} — ${appointment.patientName}`,
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
}

let _instance = null;
function getGoogleCalendar() {
  if (!_instance) _instance = new GoogleCalendar();
  return _instance;
}

module.exports = { GoogleCalendar, getGoogleCalendar };
