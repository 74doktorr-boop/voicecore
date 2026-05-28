// src/api/routes-portal.js
// ─────────────────────────────────────────────────────────────
// NodeFlow — Portal de Negocio API
// All routes require a valid session JWT (Authorization: Bearer)
// businessId resolved from session.email → flowManager or DB
// ─────────────────────────────────────────────────────────────
'use strict';

const { Logger }             = require('../utils/logger');
const { verifySessionToken } = require('./routes-auth');
const { flowManager }        = require('../automations/flow-manager');
const { scheduler }          = require('../scheduling/scheduler');
const { getDatabase }        = require('../db/database');

const log = new Logger('ROUTES-PORTAL');

// ── Auth middleware ──────────────────────────────────────────
async function portalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let session;
  try {
    session = verifySessionToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
  }

  // Resolve businessId: in-memory first, then DB fallback
  let businessId = null;
  let flowConfig = null;

  const inMemory = flowManager.list().find(f => f.ownerEmail === session.email);
  if (inMemory) {
    businessId = inMemory.businessId;
    flowConfig  = inMemory;
  } else {
    const db = getDatabase();
    if (db.enabled) {
      try {
        const { data } = await db.client
          .from('organizations')
          .select('id, name, owner_email, phone, plan, sector, language, automation_config, registered_at, created_at')
          .eq('owner_email', session.email.toLowerCase())
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) {
          businessId = data.id;
          flowConfig  = {
            businessId:   data.id,
            name:         data.name,
            ownerEmail:   data.owner_email,
            ownerPhone:   data.phone,
            plan:         data.plan,
            sector:       data.sector,
            language:     data.language || 'es',
            automations:  data.automation_config || {},
            registeredAt: data.registered_at || data.created_at,
          };
        }
      } catch (e) {
        log.warn(`DB lookup failed for ${session.email}: ${e.message}`);
      }
    }
  }

  if (!businessId) {
    return res.status(404).json({ error: 'No se encontró ningún negocio para esta cuenta.' });
  }

  req.session    = session;
  req.businessId = businessId;
  req.flowConfig = flowConfig;
  next();
}

// ── setupPortalRoutes ────────────────────────────────────────
function setupPortalRoutes(app, pipeline) {

  // ── GET /api/portal/dashboard ──────────────────────────────
  app.get('/api/portal/dashboard', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;

    const todayStr   = new Date().toISOString().slice(0, 10);
    const allCalls   = pipeline.getCallHistory(500);
    const bizCalls   = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);
    const todayCalls = bizCalls.filter(c => (c.endedAt || c.startedAt || '').startsWith(todayStr));

    const callCount   = todayCalls.length;
    const bookedToday = todayCalls.filter(c => c.outcome === 'booked').length;
    const convRate    = callCount > 0 ? Math.round((bookedToday / callCount) * 100) : 0;
    const emailsSent  = todayCalls.filter(c => c.outcome === 'booked' && c.clientEmail).length;
    // 4 min average per call vs manual handling
    const hoursSaved  = Math.round((callCount * 4) / 60 * 10) / 10;

    // Upcoming appointments (today onwards, not cancelled)
    const appointments = scheduler.getAppointments(businessId);
    const upcoming = appointments
      .filter(a => a.status !== 'cancelled' && a.date >= todayStr)
      .sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`))
      .slice(0, 5);

    // Recent AI activity (last 8 relevant calls)
    const recentActivity = bizCalls.slice(0, 8).map(c => ({
      type: c.outcome === 'booked' ? 'reserva'
           : c.outcome === 'info'  ? 'info'
           :                         'llamada',
      text: c.outcome === 'booked' && c.bookedAppointment
          ? `${c.bookedAppointment.patientName} · ${c.bookedAppointment.service}`
          : c.outcome === 'info'
          ? `Consulta · ${(c.callId || '---').toString().replace(/(\d{3})\d{4,}/, '$1···')}`
          : 'Llamada no completada',
      time: c.endedAt || c.startedAt || null,
    }));

    const registeredAt = flowConfig.registeredAt || null;
    const daysActive   = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86400000)
      : 0;

    res.json({
      businessName: flowConfig.name,
      plan:         flowConfig.plan,
      daysActive,
      aiStatus: 'active',
      today:    { callCount, bookedToday, convRate, emailsSent, hoursSaved },
      upcoming,
      recentActivity,
    });
  });

  // ── GET /api/portal/calls ──────────────────────────────────
  app.get('/api/portal/calls', portalAuth, (req, res) => {
    const { businessId } = req;
    const { from, to, outcome } = req.query;

    let calls = pipeline.getCallHistory(500)
      .filter(c => (c.businessId || c.assistantId) === businessId);

    if (from) {
      calls = calls.filter(c => (c.endedAt || c.startedAt || '') >= from);
    }
    if (to) {
      const toEnd = to + 'T23:59:59';
      calls = calls.filter(c => (c.endedAt || c.startedAt || '') <= toEnd);
    }
    if (outcome && ['booked', 'info', 'abandoned'].includes(outcome)) {
      calls = calls.filter(c => c.outcome === outcome);
    }

    const formatted = calls.map(c => ({
      callId:      c.callId,
      startedAt:   c.startedAt,
      endedAt:     c.endedAt,
      duration:    c.duration || 0,
      outcome:     c.outcome || 'abandoned',
      clientEmail: c.clientEmail || null,
      appointment: c.bookedAppointment || null,
      turnCount:   c.turnCount || 0,
    }));

    res.json({ ok: true, count: formatted.length, calls: formatted });
  });

  // ── GET /api/portal/appointments ──────────────────────────
  app.get('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const appointments = scheduler.getAppointments(businessId)
      .sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
    res.json({ ok: true, count: appointments.length, appointments });
  });

  // ── POST /api/portal/appointments ─────────────────────────
  app.post('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const { patientName, phone, email, service, date, time } = req.body;
    if (!patientName || !service || !date || !time) {
      return res.status(400).json({ error: 'patientName, service, date y time son obligatorios' });
    }
    const result = scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time });
    if (!result.success) return res.status(409).json({ error: result.error });
    log.info(`Portal: appointment created ${result.appointment.id} for ${patientName}`);
    res.json({ ok: true, appointment: result.appointment });
  });

  // ── PATCH /api/portal/appointments/:id ────────────────────
  app.patch('/api/portal/appointments/:id', portalAuth, (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    if (apt.status === 'cancelled') return res.status(409).json({ error: 'La cita ya está cancelada' });

    const allowed = ['patientName', 'phone', 'email', 'service', 'date', 'time', 'notes'];
    for (const field of allowed) {
      if (req.body[field] !== undefined) apt[field] = req.body[field];
    }
    apt.updatedAt = new Date().toISOString();
    log.info(`Portal: appointment updated ${apt.id}`);
    res.json({ ok: true, appointment: apt });
  });

  // ── DELETE /api/portal/appointments/:id ───────────────────
  // Soft-cancel: sets status='cancelled', keeps the record
  app.delete('/api/portal/appointments/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    if (apt.status === 'cancelled') return res.status(409).json({ error: 'La cita ya estaba cancelada' });

    apt.status      = 'cancelled';
    apt.cancelledAt = new Date().toISOString();

    // Send cancellation email if client email is present (fire-and-forget)
    if (apt.email) {
      try {
        const { sendMagicLinkEmail } = require('../notifications/email');
        // sendMagicLinkEmail is the generic transporter; use it for the cancellation
        // (If a dedicated sendCancellationEmail is added later, swap it here)
        const { flowConfig } = req;
        const { sendEmail } = require('../notifications/email');
        if (typeof sendEmail === 'function') {
          sendEmail({
            to:      apt.email,
            subject: `Cita cancelada — ${flowConfig.name}`,
            html: `<p style="font-family:Inter,sans-serif">Hola ${apt.patientName},</p>
<p>Tu cita del <strong>${apt.date}</strong> a las <strong>${apt.time}h</strong> en ${flowConfig.name} ha sido cancelada.</p>
<p>Contacta con nosotros si quieres reagendar.</p>`,
          }).catch(() => {});
        }
      } catch (_) {
        // email module may not export sendEmail — silently skip
      }
    }

    log.info(`Portal: appointment cancelled ${apt.id}`);
    res.json({ ok: true });
  });

  // ── GET /api/portal/reports ───────────────────────────────
  app.get('/api/portal/reports', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;
    const period  = req.query.period || 'month';
    const days    = period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
    const fromTs  = Date.now() - days * 86400000;
    const fromStr = new Date(fromTs).toISOString().slice(0, 10);

    const allCalls = pipeline.getCallHistory(500);
    const bizCalls = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);

    // Period calls
    const periodCalls = bizCalls.filter(c => (c.endedAt || c.startedAt || '') >= fromStr);
    const totalCalls  = periodCalls.length;
    const bookings    = periodCalls.filter(c => c.outcome === 'booked').length;
    const convRate    = totalCalls > 0 ? Math.round((bookings / totalCalls) * 100) : 0;
    const hoursSaved  = Math.round((totalCalls * 4) / 60 * 10) / 10;
    const avgTicket   = flowConfig.automations?.config?.avgTicket || 35;
    const revenueEst  = bookings * avgTicket;

    // Calls by day-of-week
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const callsByDow = Array(7).fill(0);
    for (const c of periodCalls) {
      const d = new Date(c.endedAt || c.startedAt || Date.now());
      callsByDow[d.getDay()]++;
    }
    const callsByDayOfWeek = DOW_LABELS.map((label, i) => ({ label, value: callsByDow[i] }));

    // All-time stats
    const allTotal    = bizCalls.length;
    const allBookings = bizCalls.filter(c => c.outcome === 'booked').length;
    const allHours    = Math.round((allTotal * 4) / 60 * 10) / 10;
    const allRevenue  = allBookings * avgTicket;

    res.json({
      ok: true,
      period,
      summary: { totalCalls, bookings, convRate, hoursSaved, revenueEst },
      callsByDayOfWeek,
      allTime: { totalCalls: allTotal, bookings: allBookings, hoursSaved: allHours, revenueEst: allRevenue },
    });
  });

  // ── GET /api/portal/automations ───────────────────────────
  app.get('/api/portal/automations', portalAuth, (req, res) => {
    const { flowConfig } = req;
    res.json({ ok: true, automations: flowConfig.automations || {} });
  });

  // ── PATCH /api/portal/automations ────────────────────────
  app.patch('/api/portal/automations', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { reminders, reviews, waConfirm, rebooking } = req.body;

    const patch = {};
    if (reminders !== undefined) patch.reminders = reminders;
    if (reviews   !== undefined) patch.reviews   = reviews;
    if (waConfirm !== undefined) patch.waConfirm = waConfirm;
    if (rebooking !== undefined) patch.rebooking = rebooking;

    const updated = flowManager.patch(businessId, { automations: patch });
    if (!updated) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });

    flowManager.saveToDB(businessId).catch(e =>
      log.warn(`Portal: automations DB save failed for ${businessId}: ${e.message}`)
    );

    log.info(`Portal: automations updated for ${businessId}`);
    res.json({ ok: true, automations: updated.automations });
  });

  // ── GET /api/portal/config ────────────────────────────────
  app.get('/api/portal/config', portalAuth, (req, res) => {
    const { flowConfig } = req;
    const custom = flowConfig.automations?.config || {};
    res.json({
      ok: true,
      config: {
        name:           flowConfig.name        || '',
        ownerEmail:     flowConfig.ownerEmail  || '',
        phone:          flowConfig.ownerPhone  || '',
        language:       flowConfig.language    || 'es',
        sector:         flowConfig.sector      || custom.sector || '',
        plan:           flowConfig.plan        || '',
        avgTicket:      custom.avgTicket       || 35,
        welcomeMessage: custom.welcomeMessage  || '',
        services:       custom.services        || '',
        schedule:       custom.schedule        || '',
      },
    });
  });

  // ── PATCH /api/portal/config ──────────────────────────────
  app.patch('/api/portal/config', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const { name, language, sector, avgTicket, welcomeMessage, services, schedule } = req.body;

    if (language && !['es', 'eu', 'gl'].includes(language)) {
      return res.status(400).json({ error: "language debe ser 'es', 'eu' o 'gl'" });
    }

    // Update top-level fields via patch
    const topLevelPatch = {};
    if (name)     topLevelPatch.name     = name;
    if (language) topLevelPatch.language = language;
    if (sector)   topLevelPatch.sector   = sector;

    if (Object.keys(topLevelPatch).length > 0) {
      flowManager.patch(businessId, topLevelPatch);
    }

    // flowManager.patch() doesn't pass through custom automations keys,
    // so directly update the config sub-object on the live flow reference
    const flow = flowManager.get(businessId);
    if (!flow) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });
    if (!flow.automations) flow.automations = {};
    const existingCustom = flow.automations.config || {};
    flow.automations.config = {
      ...existingCustom,
      ...(sector         !== undefined && { sector }),
      ...(avgTicket      !== undefined && { avgTicket: Number(avgTicket) }),
      ...(welcomeMessage !== undefined && { welcomeMessage }),
      ...(services       !== undefined && { services }),
      ...(schedule       !== undefined && { schedule }),
    };
    flow.updatedAt = new Date().toISOString();

    // Persist to DB
    const db = getDatabase();
    if (db.enabled) {
      try {
        const dbUpdate = { automation_config: flow.automations };
        if (name)     dbUpdate.name     = name;
        if (language) dbUpdate.language = language;
        await db.client.from('organizations').update(dbUpdate).eq('id', businessId);
      } catch (e) {
        log.warn(`Portal: config DB save failed for ${businessId}: ${e.message}`);
      }
    }

    const custom = flow.automations.config || {};
    log.info(`Portal: config updated for ${businessId}`);
    res.json({
      ok: true,
      config: {
        name:           flow.name        || '',
        ownerEmail:     flow.ownerEmail  || '',
        phone:          flow.ownerPhone  || '',
        language:       flow.language    || 'es',
        sector:         flow.sector      || custom.sector || '',
        plan:           flow.plan        || '',
        avgTicket:      custom.avgTicket       || 35,
        welcomeMessage: custom.welcomeMessage  || '',
        services:       custom.services        || '',
        schedule:       custom.schedule        || '',
      },
    });
  });

} // end setupPortalRoutes

module.exports = { setupPortalRoutes };
