// ============================================
// NodeFlow — Flow Management API
// GET    /api/flows              → list all business flows
// GET    /api/flows/stats        → aggregated stats
// GET    /api/flows/:id          → get one flow
// PATCH  /api/flows/:id          → update config (enable/disable, Place ID…)
// POST   /api/flows/:id/test/reminder → send test reminder email
// POST   /api/flows/:id/test/review   → send test review request
// ============================================

const { Logger } = require('../utils/logger');
const { flowManager } = require('../automations/flow-manager');
const { scheduler }   = require('../scheduling/scheduler');
const {
  sendAppointmentReminder,
  sendReviewRequest,
} = require('../notifications/reminders');

const log = new Logger('FLOWS-API');

function setupFlowRoutes(app) {

  // ── List all flows ─────────────────────────────────────────────────────────
  app.get('/api/flows', (req, res) => {
    const flows = flowManager.list().map(sanitize);
    res.json({ count: flows.length, flows });
  });

  // ── Aggregated stats ───────────────────────────────────────────────────────
  app.get('/api/flows/stats', (req, res) => {
    res.json(flowManager.stats());
  });

  // ── Get one flow ───────────────────────────────────────────────────────────
  app.get('/api/flows/:id', (req, res) => {
    const flow = flowManager.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(sanitize(flow));
  });

  // ── Update flow config ─────────────────────────────────────────────────────
  // Accepts any subset of: googlePlaceId, reviewUrl, automations.reminders.enabled,
  // automations.reviews.enabled, automations.reminders.hoursBefore, etc.
  app.patch('/api/flows/:id', async (req, res) => {
    const flow = flowManager.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    const allowed = ['googlePlaceId', 'reviewUrl', 'ownerPhone', 'automations'];
    const patch   = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const updated = flowManager.patch(req.params.id, patch);
    // Best-effort persist to DB (non-blocking)
    flowManager.saveToDB(req.params.id).catch(() => {});
    log.info(`Flow patched via API: ${req.params.id}`);
    res.json(sanitize(updated));
  });

  // ── Toggle automation on/off (shortcut) ────────────────────────────────────
  app.post('/api/flows/:id/toggle/:type', (req, res) => {
    const { id, type } = req.params;
    if (!['reminders', 'reviews', 'waConfirm'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    const flow = flowManager.get(id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    const current = flow.automations[type].enabled;
    const updated = flowManager.patch(id, { automations: { [type]: { enabled: !current } } });
    flowManager.saveToDB(id).catch(() => {});
    res.json({ [type]: { enabled: !current }, flow: sanitize(updated) });
  });

  // ── Test: send reminder to a specific appointment ──────────────────────────
  app.post('/api/flows/:id/test/reminder', async (req, res) => {
    const { appointmentId, email } = req.body;
    const flow = flowManager.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    // Build a fake appointment if no real one provided
    const apt = appointmentId
      ? scheduler.appointments.get(appointmentId)
      : {
          id:          'TEST-001',
          businessId:  req.params.id,
          patientName: 'Cliente de Prueba',
          phone:       '600000000',
          email:       email || flow.ownerEmail,
          service:     'Servicio de prueba',
          date:        new Date(Date.now() + 24 * 3600 * 1000).toISOString().split('T')[0],
          time:        '10:00',
          duration:    30,
          price:       0,
          status:      'confirmed',
        };

    if (!apt) return res.status(404).json({ error: 'Appointment not found' });
    if (!apt.email && !email) return res.status(400).json({ error: 'No email on appointment — pass email in body' });

    const testApt  = email ? { ...apt, email } : apt;
    const config   = flowManager.mergeConfig(req.params.id, scheduler.getBusinessConfig(req.params.id));
    const ok       = await sendAppointmentReminder(testApt, config);
    res.json({ ok, sentTo: testApt.email, flow: req.params.id });
  });

  // ── Test: send review request ──────────────────────────────────────────────
  app.post('/api/flows/:id/test/review', async (req, res) => {
    const { appointmentId, email } = req.body;
    const flow = flowManager.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });

    const apt = appointmentId
      ? scheduler.appointments.get(appointmentId)
      : {
          id:          'TEST-002',
          businessId:  req.params.id,
          patientName: 'Cliente de Prueba',
          phone:       '600000000',
          email:       email || flow.ownerEmail,
          service:     'Servicio de prueba',
          date:        new Date(Date.now() - 24 * 3600 * 1000).toISOString().split('T')[0],
          time:        '10:00',
          status:      'confirmed',
        };

    if (!apt) return res.status(404).json({ error: 'Appointment not found' });
    if (!apt.email && !email) return res.status(400).json({ error: 'No email on appointment — pass email in body' });

    const testApt = email ? { ...apt, email } : apt;
    const config  = flowManager.mergeConfig(req.params.id, scheduler.getBusinessConfig(req.params.id));
    const ok      = await sendReviewRequest(testApt, config);
    res.json({ ok, sentTo: testApt.email, flow: req.params.id });
  });

  log.info('Flow routes configured → /api/flows/*');
}

function sanitize(flow) {
  return {
    businessId:    flow.businessId,
    name:          flow.name,
    plan:          flow.plan,
    sector:        flow.sector,
    language:      flow.language || 'es',
    ownerEmail:    flow.ownerEmail,
    googlePlaceId: flow.googlePlaceId,
    reviewUrl:     flow.reviewUrl,
    automations:   flow.automations,
    registeredAt:  flow.registeredAt,
    updatedAt:     flow.updatedAt,
  };
}

module.exports = { setupFlowRoutes };
