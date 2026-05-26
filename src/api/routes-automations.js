// ============================================
// NodeFlow — Automation API routes
// GET  /api/automations/stats
// POST /api/automations/run
// GET  /api/citas/:businessId
// GET  /api/citas/:businessId/:aptId/wa-confirm
// POST /api/citas/book
// ============================================

const { Logger } = require('../utils/logger');
const { scheduler } = require('../scheduling/scheduler');
const { runAutomations, getCronStats } = require('../scheduling/cron');
const { generateWhatsAppConfirmation, sendAppointmentReminder, sendReviewRequest } = require('../notifications/reminders');

const log = new Logger('AUTO');

function setupAutomationRoutes(app) {

  // ── Stats dashboard ────────────────────────────────────────────────────────
  app.get('/api/automations/stats', (req, res) => {
    const all  = [...scheduler.appointments.values()];
    const now  = Date.now();

    const upcoming = all.filter(a => {
      if (a.status === 'cancelled') return false;
      const t = new Date(`${a.date}T${a.time}:00`).getTime();
      return t > now;
    });

    res.json({
      cron:              getCronStats(),
      appointments: {
        total:           all.length,
        confirmed:       all.filter(a => a.status === 'confirmed').length,
        cancelled:       all.filter(a => a.status === 'cancelled').length,
        upcoming:        upcoming.length,
      },
      automations: {
        reminders_sent:    all.filter(a => a.reminder_sent).length,
        reminders_pending: all.filter(a => a.status === 'confirmed' && !a.reminder_sent && a.email).length,
        reviews_sent:      all.filter(a => a.review_requested).length,
        reviews_pending:   all.filter(a => {
          if (a.status === 'cancelled' || a.review_requested || !a.email) return false;
          const elapsed = now - new Date(`${a.date}T${a.time}:00`).getTime();
          return elapsed > 0; // past appointments without review request
        }).length,
      },
    });
  });

  // ── Manual trigger ─────────────────────────────────────────────────────────
  app.post('/api/automations/run', async (req, res) => {
    try {
      await runAutomations();
      res.json({ ok: true, stats: getCronStats() });
    } catch (e) {
      log.error('Manual run error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── Send reminder for specific appointment ─────────────────────────────────
  app.post('/api/automations/reminder/:aptId', async (req, res) => {
    const apt = scheduler.appointments.get(req.params.aptId);
    if (!apt) return res.status(404).json({ error: 'Appointment not found' });
    const config = scheduler.getBusinessConfig(apt.businessId);
    const ok = await sendAppointmentReminder(apt, config);
    if (ok) apt.reminder_sent = true;
    res.json({ ok, appointment: req.params.aptId });
  });

  // ── Send review request for specific appointment ───────────────────────────
  app.post('/api/automations/review/:aptId', async (req, res) => {
    const apt = scheduler.appointments.get(req.params.aptId);
    if (!apt) return res.status(404).json({ error: 'Appointment not found' });
    const config = scheduler.getBusinessConfig(apt.businessId);
    const ok = await sendReviewRequest(apt, config);
    if (ok) apt.review_requested = true;
    res.json({ ok, appointment: req.params.aptId });
  });

  // ── List appointments for a business ──────────────────────────────────────
  app.get('/api/citas/:businessId', (req, res) => {
    const { businessId } = req.params;
    const { date, status, upcoming } = req.query;
    const now = Date.now();

    let apts = [...scheduler.appointments.values()].filter(a => a.businessId === businessId);
    if (date)     apts = apts.filter(a => a.date === date);
    if (status)   apts = apts.filter(a => a.status === status);
    if (upcoming === '1') apts = apts.filter(a => new Date(`${a.date}T${a.time}:00`).getTime() > now);

    apts.sort((a, b) => {
      const ta = `${a.date}T${a.time}`;
      const tb = `${b.date}T${b.time}`;
      return ta < tb ? -1 : 1;
    });

    res.json({
      businessId,
      count: apts.length,
      appointments: apts.map(a => ({
        id:               a.id,
        patientName:      a.patientName,
        phone:            a.phone,
        email:            a.email || null,
        service:          a.service,
        date:             a.date,
        time:             a.time,
        duration:         a.duration,
        price:            a.price,
        status:           a.status,
        reminder_sent:    !!a.reminder_sent,
        review_requested: !!a.review_requested,
        createdAt:        a.createdAt,
      })),
    });
  });

  // ── Get appointment by ID ──────────────────────────────────────────────────
  app.get('/api/citas/_/:aptId', (req, res) => {
    const apt = scheduler.appointments.get(req.params.aptId);
    if (!apt) return res.status(404).json({ error: 'Not found' });
    res.json(apt);
  });

  // ── WhatsApp confirmation link ─────────────────────────────────────────────
  app.get('/api/citas/:businessId/:aptId/wa-confirm', (req, res) => {
    const apt = scheduler.appointments.get(req.params.aptId);
    if (!apt || apt.businessId !== req.params.businessId) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    const config = scheduler.getBusinessConfig(req.params.businessId);
    const link   = generateWhatsAppConfirmation(apt, config, process.env.OWNER_PHONE);
    res.json({
      link,
      appointment: {
        id:          apt.id,
        patientName: apt.patientName,
        date:        apt.date,
        time:        apt.time,
        service:     apt.service,
      },
    });
  });

  // ── External booking (e.g. from web form or third-party) ──────────────────
  app.post('/api/citas/book', async (req, res) => {
    try {
      const { businessId, patientName, phone, email, service, date, time } = req.body;

      if (!businessId || !patientName || !service || !date || !time) {
        return res.status(400).json({ error: 'Campos requeridos: businessId, patientName, service, date, time' });
      }

      const result = scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time });
      if (!result.success) return res.status(409).json({ error: result.error });

      const config  = scheduler.getBusinessConfig(businessId);
      const waLink  = generateWhatsAppConfirmation(result.appointment, config, process.env.OWNER_PHONE);

      log.info(`External booking: ${result.appointment.id} — ${patientName} — ${date} ${time}`);
      res.json({ ...result, whatsappConfirmLink: waLink });
    } catch (e) {
      log.error('Booking error', { error: e.message });
      res.status(500).json({ error: 'Error interno al reservar' });
    }
  });

  log.info('Automation routes configured');
}

module.exports = { setupAutomationRoutes };
