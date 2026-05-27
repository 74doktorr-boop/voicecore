// ============================================
// NodeFlow — Google Calendar API Routes
// GET  /api/calendar/status        → connected?
// GET  /api/calendar/auth          → OAuth redirect URL
// GET  /api/calendar/callback      → OAuth code exchange
// POST /api/calendar/disconnect    → revoke
// GET  /api/calendar/events?date=  → list events for date
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { getGoogleCalendar } = require('../integrations/google-calendar');
const { getDatabase } = require('../db/database');

const log = new Logger('API:CALENDAR');

function setupCalendarRoutes(app, config) {
  const auth = requireAuth(config);
  const cal  = getGoogleCalendar();
  const db   = getDatabase();

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/calendar/status', auth, (req, res) => {
    res.json({
      enabled:    cal.enabled,
      connected:  !!(req.org.google_refresh_token),
      calendarId: req.org.google_calendar_id || 'primary',
    });
  });

  // ── Start OAuth flow ────────────────────────────────────────────────────────
  app.get('/api/calendar/auth', auth, (req, res) => {
    if (!cal.enabled) return res.status(503).json({ error: 'Google Calendar not configured on this server' });
    const url = cal.getAuthUrl(req.org.id);
    res.json({ url });
  });

  // ── OAuth callback (Google redirects here) ──────────────────────────────────
  // No auth middleware — this is the OAuth return URL
  app.get('/api/calendar/callback', async (req, res) => {
    const { code, state: orgId, error: oauthError } = req.query;

    if (oauthError) {
      log.warn(`OAuth denied for org ${orgId}: ${oauthError}`);
      return res.redirect('/portal/?cal=denied');
    }
    if (!code || !orgId) return res.status(400).send('Parámetros inválidos');

    try {
      const tokens = await cal.exchangeCode(code);

      if (db.enabled) {
        await db.updateOrg(orgId, {
          google_refresh_token:  tokens.refresh_token,
          google_access_token:   tokens.access_token,
          google_token_expiry:   tokens.expiry_date,
          google_calendar_id:    'primary',
        });
        log.info(`Google Calendar connected for org: ${orgId}`);
      }

      res.redirect('/portal/?cal=connected');
    } catch (e) {
      log.error(`Calendar OAuth callback error: ${e.message}`);
      res.redirect('/portal/?cal=error');
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  app.post('/api/calendar/disconnect', auth, async (req, res) => {
    try {
      if (db.enabled) {
        await db.updateOrg(req.org.id, {
          google_refresh_token: null,
          google_access_token:  null,
          google_token_expiry:  null,
          google_calendar_id:   null,
        });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Helper: get fresh tokens (refreshes + persists if needed) ───────────────
  async function getFreshTokens(org) {
    const raw = {
      access_token:  org.google_access_token,
      refresh_token: org.google_refresh_token,
      expiry_date:   org.google_token_expiry,
    };
    const fresh = await cal.refreshIfNeeded(raw);
    // Persist only if the access_token actually changed (avoid unnecessary writes)
    if (fresh.access_token !== raw.access_token && db.enabled) {
      await db.updateOrg(org.id, {
        google_access_token: fresh.access_token,
        google_token_expiry: fresh.expiry_date,
      }).catch(() => {});
    }
    return fresh;
  }

  // ── List events for a date ───────────────────────────────────────────────────
  app.get('/api/calendar/events', auth, async (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

    const org = req.org;
    if (!org.google_refresh_token) return res.json({ events: [], connected: false });

    try {
      const tokens = await getFreshTokens(org);
      const events = await cal.listEvents(tokens, date, org.google_calendar_id || 'primary');
      res.json({ events, connected: true });
    } catch (e) {
      log.error(`listEvents error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create calendar event manually from portal ───────────────────────────────
  app.post('/api/calendar/events', auth, async (req, res) => {
    const org = req.org;
    if (!org.google_refresh_token) return res.status(400).json({ error: 'Google Calendar not connected', connected: false });

    const { patientName, phone, email, service, date, time, duration, notes } = req.body;
    if (!patientName || !date || !time) return res.status(400).json({ error: 'patientName, date, time required' });

    try {
      const tokens = await getFreshTokens(org);
      const event  = await cal.createEvent(tokens, { patientName, phone, email, service, date, time, duration, notes }, {
        calendarId: org.google_calendar_id || 'primary',
        timezone:   'Europe/Madrid',
      });
      if (!event) return res.status(500).json({ error: 'Event creation failed' });
      res.json({ ok: true, event: { id: event.id, htmlLink: event.htmlLink, summary: event.summary } });
    } catch (e) {
      log.error(`createEvent error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete calendar event ────────────────────────────────────────────────────
  app.delete('/api/calendar/events/:eventId', auth, async (req, res) => {
    const org = req.org;
    if (!org.google_refresh_token) return res.status(400).json({ error: 'Google Calendar not connected' });

    try {
      const tokens = await getFreshTokens(org);
      const ok = await cal.deleteEvent(tokens, req.params.eventId, org.google_calendar_id || 'primary');
      res.json({ ok });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  log.info('Calendar routes configured → /api/calendar/*');
}

module.exports = { setupCalendarRoutes };
