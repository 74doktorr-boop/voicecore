// ============================================
// NodeFlow — Critical Dates API Routes (System C)
// POST   /api/critical-dates          — apiKey or session
// GET    /api/critical-dates/:bizId   — admin
// DELETE /api/critical-dates/:id      — admin
// PATCH  /api/critical-dates/:id      — admin
// ============================================

const express  = require('express');
const router   = express.Router();
const { criticalDatesStore } = require('../scheduling/critical-dates');
const { Logger } = require('../utils/logger');

const log = new Logger('ROUTES-CRIT-DATES');

// ── Simple api-key auth middleware (same pattern as other routes) ──────────────
function apiKeyAuth(req, res, next) {
  // BUG-33 FIX: Always deny when no key is configured — the old 'allow all' default
  // exposed these endpoints publicly in deployments that hadn't set the env var.
  const validKey = process.env.INTERNAL_API_KEY || process.env.ADMIN_SECRET;
  if (!validKey) {
    return res.status(503).json({ error: 'Critical dates API not configured — set INTERNAL_API_KEY in server env' });
  }
  // Accept session JWT (magic link / portal)
  try {
    const { verifySessionToken } = require('./routes-auth');
    const token = req.cookies?.[process.env.SESSION_KEY || 'nf_session'] || req.headers.authorization?.replace('Bearer ', '');
    if (token && verifySessionToken(token)) return next();
  } catch(_) {}
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key && key === validKey) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/critical-dates — add a new critical date entry
// Used by: ToolExecutor (add_critical_date tool callback), admin panel
router.post('/', apiKeyAuth, (req, res) => {
  const { businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays } = req.body;
  if (!businessId || !clientName || !type || !dueDate) {
    return res.status(400).json({ error: 'businessId, clientName, type and dueDate are required' });
  }
  try {
    const entry = criticalDatesStore.add({ businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays });
    log.info(`POST /api/critical-dates: added ${type} for ${clientName} (biz:${businessId})`);
    return res.json({ ok: true, entry });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// GET /api/critical-dates/:businessId — list all active dates for a business
router.get('/:businessId', apiKeyAuth, (req, res) => {
  const entries = criticalDatesStore.getByBusiness(req.params.businessId);
  return res.json({ ok: true, count: entries.length, entries });
});

// DELETE /api/critical-dates/:id — deactivate an entry
router.delete('/:id', apiKeyAuth, (req, res) => {
  const ok = criticalDatesStore.deactivate(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Entry not found' });
  return res.json({ ok: true });
});

// PATCH /api/critical-dates/:id — update dueDate or notes
router.patch('/:id', apiKeyAuth, (req, res) => {
  const entry = criticalDatesStore.getById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const { dueDate, notes, advanceDays } = req.body;
  if (dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
    entry.dueDate = dueDate;
    entry.sentReminders = []; // reset sent reminders on date change
  }
  if (notes !== undefined) entry.notes = notes;
  if (advanceDays) entry.advanceDays = advanceDays;
  return res.json({ ok: true, entry });
});

module.exports = router;
