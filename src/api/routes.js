// ============================================
// VoiceCore v2.0 — REST API Routes
// Multi-tenant CRUD for orgs, assistants, calls
// ============================================

const { Logger } = require('../utils/logger');
const { generateTwiML } = require('../telephony/twilio-streams');
const { requireAuth, rateLimit, checkUsageLimits, PLAN_LIMITS } = require('../auth/middleware');
const { getDatabase } = require('../db/database');

const log = new Logger('API');

function setupRoutes(app, pipeline, assistantManager, config) {
  const auth = requireAuth(config);
  const limit = rateLimit();
  const db = getDatabase();

  // ─── Twilio Webhook (no auth - Twilio validates) ───
  app.post('/voice/inbound', (req, res) => {
    const assistantId = req.query.assistantId || null;
    const wsUrl = `wss://${req.headers.host}/media-stream`;
    log.call(`Inbound call webhook → assistant: ${assistantId || 'default'}`);
    res.type('text/xml').send(generateTwiML(wsUrl, assistantId));
  });

  app.post('/voice/inbound/:assistantId', (req, res) => {
    const wsUrl = `wss://${req.headers.host}/media-stream`;
    log.call(`Inbound call webhook → assistant: ${req.params.assistantId}`);
    res.type('text/xml').send(generateTwiML(wsUrl, req.params.assistantId));
  });

  // ─── Organization ───
  app.get('/api/org', auth, (req, res) => {
    const org = req.org;
    const limits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.starter;
    res.json({
      id: org.id,
      name: org.name,
      plan: org.plan,
      limits,
      usage: {
        minutesUsed: org.monthly_minutes_used || 0,
        minutesLimit: limits.minutesPerMonth,
      },
    });
  });

  // ─── Assistants CRUD ───
  app.get('/api/assistants', auth, async (req, res) => {
    try {
      // Try DB first
      if (db.enabled && req.org.id !== 'legacy') {
        const assistants = await db.getAssistants(req.org.id);
        return res.json({ assistants });
      }
      // Fallback to file-based
      res.json({ assistants: assistantManager.list() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const assistant = await db.getAssistant(req.org.id, req.params.id);
        if (!assistant) return res.status(404).json({ error: 'Assistant not found' });
        return res.json({ assistant });
      }
      const assistant = assistantManager.get(req.params.id);
      if (!assistant) return res.status(404).json({ error: 'Assistant not found' });
      res.json({ assistant });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/assistants', auth, limit, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const limits = PLAN_LIMITS[req.org.plan] || PLAN_LIMITS.starter;
        const existing = await db.getAssistants(req.org.id);
        if (existing.length >= limits.assistants) {
          return res.status(402).json({
            error: `Assistant limit reached (${limits.assistants} on ${req.org.plan} plan)`,
          });
        }
        const assistant = await db.createAssistant(req.org.id, req.body);
        return res.status(201).json({ assistant });
      }
      const { id, ...cfg } = req.body;
      const assistantId = id || `assistant-${Date.now()}`;
      const assistant = assistantManager.upsert(assistantId, cfg);
      res.status(201).json({ assistant });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const updated = await db.updateAssistant(req.org.id, req.params.id, req.body);
        return res.json({ assistant: updated });
      }
      const existing = assistantManager.get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Assistant not found' });
      const updated = assistantManager.upsert(req.params.id, { ...existing, ...req.body });
      res.json({ assistant: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        await db.deleteAssistant(req.org.id, req.params.id);
        return res.json({ success: true });
      }
      assistantManager.delete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Calls ───
  app.get('/api/calls/active', auth, (req, res) => {
    res.json({ calls: pipeline.getActiveCalls() });
  });

  app.get('/api/calls/history', auth, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      if (db.enabled && req.org.id !== 'legacy') {
        const calls = await db.getCalls(req.org.id, { limit });
        return res.json({ calls });
      }
      res.json({ calls: pipeline.getCallHistory(limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/calls/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const call = await db.getCall(req.org.id, req.params.id);
        if (!call) return res.status(404).json({ error: 'Call not found' });
        return res.json({ call });
      }
      res.status(404).json({ error: 'Call not found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/calls/outbound', auth, limit, checkUsageLimits(), async (req, res) => {
    const { to, assistantId, from } = req.body;
    if (!to || !assistantId) return res.status(400).json({ error: 'Missing to or assistantId' });

    try {
      const twilio = require('twilio')(config.twilioAccountSid, config.twilioAuthToken);
      const publicUrl = config.publicUrl;
      const call = await twilio.calls.create({
        to,
        from: from || config.twilioPhoneNumber,
        url: `${publicUrl}/voice/inbound/${assistantId}`,
      });
      res.json({ success: true, callSid: call.sid });
    } catch (error) {
      log.error('Outbound call failed', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Usage ───
  app.get('/api/usage', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const current = await db.getUsage(req.org.id);
        const history = await db.getUsageHistory(req.org.id, 6);
        return res.json({ current, history });
      }
      res.json({ current: null, history: [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Metrics ───
  app.get('/api/metrics', auth, (req, res) => {
    res.json({ metrics: pipeline.getMetrics() });
  });

  // ─── Health (no auth) ───
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '2.0.0',
      uptime: process.uptime(),
      activeCalls: pipeline.getActiveCalls().length,
      assistants: assistantManager.list().length,
      database: db.enabled ? 'connected' : 'memory',
      env: {
        supabase: !!process.env.SUPABASE_URL,
        stripe: !!process.env.STRIPE_SECRET_KEY,
        resend: !!process.env.RESEND_API_KEY,
        deepgram: !!process.env.DEEPGRAM_API_KEY,
      },
    });
  });

  log.info('API routes configured');
}

module.exports = { setupRoutes };
