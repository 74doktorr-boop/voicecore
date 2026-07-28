// ============================================
// NodeFlow — Outlook / Microsoft 365 Calendar Routes
// GET  /api/outlook/status        → connected?
// GET  /api/outlook/auth          → OAuth redirect URL
// GET  /api/outlook/callback      → OAuth code exchange
// POST /api/outlook/disconnect    → revoke
// GET  /api/outlook/events?date=  → list events for date/range
// Espejo de routes-calendar.js (Google). Apagado si MS_* no están.
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { issueOAuthState, consumeOAuthState } = require('../auth/oauth-state');
const { getOutlookCalendar } = require('../integrations/outlook-calendar');
const { getDatabase } = require('../db/database');

const log = new Logger('API:OUTLOOK');

function setupOutlookRoutes(app, config) {
  const auth = requireAuth(config);
  const cal  = getOutlookCalendar();
  const db   = getDatabase();

  // ── Status ──────────────────────────────────────────────────────────────────
  app.get('/api/outlook/status', auth, (req, res) => {
    res.json({
      enabled:    cal.enabled,
      connected:  !!(req.org.outlook_refresh_token),
      calendarId: req.org.outlook_calendar_id || 'primary',
    });
  });

  // ── Start OAuth flow ────────────────────────────────────────────────────────
  app.get('/api/outlook/auth', auth, async (req, res) => {
    if (!cal.enabled) return res.status(503).json({ error: 'Outlook no configurado en este servidor' });
    // `state` = nonce de un solo uso ligado a ESTA org autenticada (ver oauth-state.js).
    const state = await issueOAuthState(req.org.id, 'outlook');
    res.json({ url: cal.getAuthUrl(state) });
  });

  // ── OAuth callback (Microsoft redirects here) ───────────────────────────────
  // Sin middleware de auth — es la URL de retorno del OAuth.
  app.get('/api/outlook/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      log.warn(`OAuth denied: ${oauthError}`);
      return res.redirect('/portal/?outlook=denied');
    }
    if (!code || !state) return res.status(400).send('Parámetros inválidos');

    // El org destino sale del nonce, NUNCA de la query (hallazgo S1).
    const orgId = await consumeOAuthState(state, 'outlook');
    if (!orgId) {
      log.warn('OAuth callback con state inválido, caducado o ya usado — rechazado');
      return res.redirect('/portal/?outlook=error');
    }

    try {
      const tokens = await cal.exchangeCode(code);
      if (db.enabled) {
        const { encryptSecret } = require('../utils/crypto');
        await db.updateOrg(orgId, {
          // Cifrados en reposo, igual que Google (antes se guardaban en claro).
          outlook_refresh_token: encryptSecret(tokens.refresh_token),
          outlook_access_token:  encryptSecret(tokens.access_token),
          outlook_token_expiry:  tokens.expiry_date,
          outlook_calendar_id:   'primary',
        });
        log.info(`Outlook Calendar connected for org: ${orgId}`);
      }
      res.redirect('/portal/?outlook=connected');
    } catch (e) {
      log.error(`Outlook OAuth callback error: ${e.message}`);
      res.redirect('/portal/?outlook=error');
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  app.post('/api/outlook/disconnect', auth, async (req, res) => {
    try {
      if (db.enabled) {
        await db.updateOrg(req.org.id, {
          outlook_refresh_token: null,
          outlook_access_token:  null,
          outlook_token_expiry:  null,
          outlook_calendar_id:   null,
        });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Helper: get fresh tokens (refresca + persiste si cambió) ─────────────────
  async function getFreshTokens(org) {
    const { encryptSecret, decryptSecret } = require('../utils/crypto');
    // Descifrado al leer / cifrado al escribir (decryptSecret tolera legacy en claro).
    const raw = {
      access_token:  decryptSecret(org.outlook_access_token),
      refresh_token: decryptSecret(org.outlook_refresh_token),
      expiry_date:   org.outlook_token_expiry,
    };
    const fresh = await cal.refreshIfNeeded(raw);
    if ((fresh.access_token !== raw.access_token || fresh.refresh_token !== raw.refresh_token) && db.enabled) {
      await db.updateOrg(org.id, {
        outlook_access_token:  encryptSecret(fresh.access_token),
        outlook_refresh_token: encryptSecret(fresh.refresh_token),
        outlook_token_expiry:  fresh.expiry_date,
      }).catch(() => {});
    }
    return fresh;
  }

  // ── List events for a date or range ──────────────────────────────────────────
  app.get('/api/outlook/events', auth, async (req, res) => {
    const { date, from, to } = req.query;
    if (!date && !(from && to)) return res.status(400).json({ error: 'date o from/to requeridos (YYYY-MM-DD)' });

    const org = req.org;
    if (!org.outlook_refresh_token) return res.json({ events: [], connected: false });

    try {
      const tokens = await getFreshTokens(org);
      const calId  = org.outlook_calendar_id || 'primary';
      const [f, t] = (from && to) ? [from, to] : [date, date];
      const events = await cal.listEventsRange(tokens, f, t, calId);
      res.json({ events, connected: true });
    } catch (e) {
      log.error(`listEventsRange error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  log.info('Outlook routes configured → /api/outlook/*');
}

module.exports = { setupOutlookRoutes };
