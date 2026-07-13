'use strict';
// ============================================
// NodeFlow — Outlook / Microsoft 365 Calendar
// OAuth 2.0 (Microsoft identity) + event CRUD vía Microsoft Graph.
// Espejo funcional de google-calendar.js para orgs que usan Outlook.
// Sin SDK: sólo fetch → cero dependencias nuevas.
//
// Env: MS_CLIENT_ID, MS_CLIENT_SECRET, (MS_REDIRECT_URI opcional)
// APAGADO si faltan credenciales → this.enabled = false y todo es no-op.
//
// Fechas: Graph acepta { dateTime:'YYYY-MM-DDTHH:MM:SS', timeZone:'Europe/Madrid' }
// igual que Google → pasamos hora LOCAL sin offset y dejamos que Graph la
// interprete con timeZone (el servidor corre en UTC; usar toISOString desfasaría).
// ============================================

const { Logger } = require('../utils/logger');
const { busyIntervalsToByDate } = require('./google-calendar'); // helper puro reutilizable

const log = new Logger('OUTLOOK-CAL');

const AUTH_BASE  = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPES     = 'offline_access Calendars.ReadWrite';

class OutlookCalendar {
  constructor() {
    this.clientId     = process.env.MS_CLIENT_ID;
    this.clientSecret = process.env.MS_CLIENT_SECRET;
    this.redirectUri  = process.env.MS_REDIRECT_URI || 'https://nodeflow.es/api/outlook/callback';
    this.enabled      = !!(this.clientId && this.clientSecret);
    this._fetch       = fetch;

    if (!this.enabled) {
      log.warn('Outlook Calendar not configured — set MS_CLIENT_ID + MS_CLIENT_SECRET');
    }
  }

  // ── OAuth ────────────────────────────────────────────────────────────────────
  getAuthUrl(orgId) {
    const p = new URLSearchParams({
      client_id:     this.clientId,
      response_type: 'code',
      redirect_uri:  this.redirectUri,
      response_mode: 'query',
      scope:         SCOPES,
      state:         orgId,
    });
    return `${AUTH_BASE}/authorize?${p.toString()}`;
  }

  async _token(params) {
    const resp = await this._fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        redirect_uri:  this.redirectUri,
        scope:         SCOPES,
        ...params,
      }).toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error_description || data.error || `HTTP ${resp.status}`);
    return {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      // Normalizamos a la MISMA forma que Google (expiry_date en ms epoch) para
      // que el resto del código trate ambos proveedores igual.
      expiry_date:   Date.now() + (Number(data.expires_in || 3600) * 1000),
    };
  }

  async exchangeCode(code) {
    return this._token({ grant_type: 'authorization_code', code });
  }

  async refreshIfNeeded(tokens) {
    if (!tokens) return tokens;
    if (!tokens.expiry_date || Date.now() > tokens.expiry_date - 120_000) {
      try {
        const fresh = await this._token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
        // Microsoft puede NO devolver refresh_token nuevo → conservar el anterior.
        if (!fresh.refresh_token) fresh.refresh_token = tokens.refresh_token;
        return fresh;
      } catch (e) {
        log.warn(`Token refresh failed: ${e.message}`);
      }
    }
    return tokens;
  }

  // ── Helpers de petición Graph ────────────────────────────────────────────────
  _eventsPath(calendarId) {
    // 'primary'/vacío → calendario por defecto (/me/events). Otro id → /me/calendars/{id}/events.
    return (!calendarId || calendarId === 'primary')
      ? '/me/events'
      : `/me/calendars/${encodeURIComponent(calendarId)}/events`;
  }

  async _graph(method, path, accessToken, { body, prefer } = {}) {
    const headers = { 'Authorization': `Bearer ${accessToken}` };
    if (body)   headers['Content-Type'] = 'application/json';
    if (prefer) headers['Prefer'] = prefer;
    const resp = await this._fetch(`${GRAPH_BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'DELETE') return { ok: resp.ok, status: resp.status };
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = (data.error && (data.error.message || data.error.code)) || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    return data;
  }

  _buildEventBody(appointment, tz) {
    const startLocal = `${appointment.date}T${appointment.time}:00`;
    const [startH, startM] = (appointment.time || '00:00').split(':').map(Number);
    const totalMins = startH * 60 + startM + (appointment.duration || 30);
    const endH = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
    const endM = String(totalMins % 60).padStart(2, '0');
    const endLocal = `${appointment.date}T${endH}:${endM}:00`;

    const subject = [appointment.patientName, appointment.service]
      .map(s => (s || '').trim()).filter(Boolean).join(' · ') || 'Cita';
    const content = [
      appointment.service ? `Servicio: ${appointment.service}` : '',
      appointment.phone   ? `Teléfono: ${appointment.phone}` : '',
      appointment.email   ? `Email: ${appointment.email}` : '',
      appointment.notes   ? `Notas: ${appointment.notes}` : '',
      '', 'Reservado con NodeFlow',
    ].filter(Boolean).join('\n');

    return {
      subject,
      body:  { contentType: 'text', content },
      start: { dateTime: startLocal, timeZone: tz },
      end:   { dateTime: endLocal,   timeZone: tz },
    };
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  async createEvent(tokens, appointment, config = {}) {
    if (!this.enabled) return null;
    try {
      const tz = config.timezone || 'Europe/Madrid';
      const data = await this._graph('POST', this._eventsPath(config.calendarId), tokens.access_token, {
        body: this._buildEventBody(appointment, tz),
      });
      log.info(`Outlook event created: ${data.id} — ${appointment.patientName}`);
      return data; // { id, ... }
    } catch (e) {
      log.error(`createEvent failed: ${e.message}`);
      return null;
    }
  }

  async deleteEvent(tokens, eventId, calendarId = 'primary') {
    if (!this.enabled || !eventId) return false;
    try {
      const base = this._eventsPath(calendarId);
      const r = await this._graph('DELETE', `${base}/${encodeURIComponent(eventId)}`, tokens.access_token);
      // 204 = borrado; 404 = ya no existe → lo damos por bueno (idempotente).
      const ok = r.ok || r.status === 404;
      if (ok) log.info(`Outlook event deleted: ${eventId}`);
      return ok;
    } catch (e) {
      log.error(`deleteEvent failed: ${e.message}`);
      return false;
    }
  }

  async updateEvent(tokens, eventId, appointment, config = {}) {
    if (!this.enabled || !eventId) return null;
    try {
      const tz = config.timezone || 'Europe/Madrid';
      const body = this._buildEventBody(appointment, tz);
      const base = this._eventsPath(config.calendarId);
      const data = await this._graph('PATCH', `${base}/${encodeURIComponent(eventId)}`, tokens.access_token, { body });
      log.info(`Outlook event updated: ${eventId}`);
      return data;
    } catch (e) {
      log.error(`updateEvent failed: ${e.message}`);
      return null;
    }
  }

  // Eventos en un rango, normalizados para pintar en el portal (misma forma que
  // Google: [{id,date,time,endTime,allDay,summary}]). Pedimos las horas ya en
  // Europe/Madrid vía cabecera Prefer → parseo directo, sin cálculo de offset.
  async listEventsRange(tokens, fromDate, toDate, calendarId = 'primary') {
    if (!this.enabled) return [];
    try {
      const base = (!calendarId || calendarId === 'primary') ? '/me/calendarView' : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;
      const q = new URLSearchParams({
        startDateTime: `${fromDate}T00:00:00`,
        endDateTime:   `${toDate}T23:59:59`,
        '$top':        '250',
        '$orderby':    'start/dateTime',
        '$select':     'id,subject,start,end,isAllDay',
      });
      const data = await this._graph('GET', `${base}?${q.toString()}`, tokens.access_token, {
        prefer: 'outlook.timezone="Europe/Madrid"',
      });
      return (data.value || []).map(normalizeOutlookEvent).filter(Boolean);
    } catch (e) {
      log.warn(`listEventsRange failed: ${e.message}`);
      return [];
    }
  }

  // Bloques ocupados por día en minutos Madrid (para prevenir doble-reserva).
  // Fail-open: {} ante cualquier error (un hipo de Graph NUNCA bloquea reservar).
  async getBusyByDate(tokens, fromDate, toDate, calendarId = 'primary') {
    if (!this.enabled) return {};
    try {
      const evs = await this.listEventsRange(tokens, fromDate, toDate, calendarId);
      const out = {};
      const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
      for (const ev of evs) {
        if (ev.allDay || !ev.time || !ev.endTime) continue;
        (out[ev.date] = out[ev.date] || []).push({ startMin: toMin(ev.time), endMin: toMin(ev.endTime) });
      }
      return out;
    } catch (e) {
      log.warn(`getBusyByDate failed: ${e.message}`);
      return {};
    }
  }
}

// Evento crudo de Graph (horas ya en Madrid vía Prefer) → forma normalizada.
function normalizeOutlookEvent(ev) {
  if (!ev) return null;
  const summary = ev.subject || '(sin título)';
  const start = ev.start || {}, end = ev.end || {};
  if (ev.isAllDay) {
    const date = (start.dateTime || '').slice(0, 10) || null;
    return date ? { id: ev.id, date, time: null, endTime: null, allDay: true, summary } : null;
  }
  const sdt = start.dateTime;               // 'YYYY-MM-DDTHH:MM:SS.0000000'
  if (!sdt) return null;
  const date = sdt.slice(0, 10);
  const time = sdt.slice(11, 16);
  const edt  = end.dateTime;
  const endTime = (edt && edt.slice(0, 10) === date) ? edt.slice(11, 16) : null;
  return { id: ev.id, date, time, endTime, allDay: false, summary };
}

let _instance = null;
function getOutlookCalendar() {
  if (!_instance) _instance = new OutlookCalendar();
  return _instance;
}

module.exports = { OutlookCalendar, getOutlookCalendar, normalizeOutlookEvent, busyIntervalsToByDate };
