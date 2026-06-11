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
const { getOrgReminderConfig, scheduleReminder, recalculate } = require('../lifecycle/reminder-engine');
const { SECTOR_REQUIRED_FIELDS, getCompletionStatus } = require('../lifecycle/sector-fields');

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
          .eq('is_active', true)
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
function setupPortalRoutes(app, pipeline, config) {
  config = config || {};

  // ── GET /api/portal/referral ───────────────────────────────
  // Devuelve el código de referido del negocio (lo crea si no existe),
  // estadísticas y un mensaje listo para compartir.
  app.get('/api/portal/referral', portalAuth, async (req, res) => {
    try {
      const referrals = require('../referrals/referrals');
      const bizName = req.flowConfig?.name || 'tu negocio';
      const email   = req.session?.email || req.flowConfig?.ownerEmail || null;

      const code  = await referrals.getOrCreateCode(req.businessId, { name: bizName, email });
      if (!code) return res.json({ available: false });

      const stats = await referrals.getStats(req.businessId);
      const link  = `https://nodeflow.es/onboarding?coupon=${encodeURIComponent(code)}`;
      const shareText =
        `He automatizado las llamadas de mi negocio con NodeFlow (recepcionista IA 24/7) y va genial. ` +
        `Si lo pruebas con mi código *${code}* tienes ${referrals.REFEREE_DISCOUNT}% de descuento: ${link}`;

      res.json({
        available: true,
        code,
        link,
        shareText,
        refereeDiscount: referrals.REFEREE_DISCOUNT,
        timesShared:    stats?.times_shared    || 0,
        timesConverted: stats?.times_converted || 0,
        rewardPending:  stats?.reward_pending  || 0,
      });
    } catch (e) {
      log.warn(`/api/portal/referral error: ${e.message}`);
      res.status(500).json({ error: 'No se pudo obtener el código de referido' });
    }
  });

  // ── GET /api/portal/widget ─────────────────────────────────
  // Devuelve el snippet del widget "¿Te llamamos?" listo para pegar
  // y las últimas solicitudes recibidas.
  app.get('/api/portal/widget', portalAuth, async (req, res) => {
    try {
      const orgId = req.businessId;
      const snippet = `<script src="https://nodeflow.es/widget/nf-widget.js" data-org="${orgId}"></script>`;

      let callbacks = [];
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client
          .from('nf_callbacks')
          .select('name, phone, message, status, created_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20);
        callbacks = data || [];
      }
      res.json({ snippet, callbacks });
    } catch (e) {
      log.warn(`/api/portal/widget error: ${e.message}`);
      res.status(500).json({ error: 'No se pudo cargar el widget' });
    }
  });

  // ── GET /api/portal/dashboard ──────────────────────────────
  app.get('/api/portal/dashboard', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;

    const todayStr   = new Date().toISOString().slice(0, 10);
    const allCalls   = pipeline.getCallHistory(500);
    const bizCalls   = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);
    // BUG-30 FIX: callSession.toJSON() emits 'endTime'/'startTime', not 'endedAt'/'startedAt'.
    // Wrong field names made todayCalls always empty, so dashboard always showed zero calls.
    const todayCalls = bizCalls.filter(c => (c.endTime || c.startTime || '').startsWith(todayStr));

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
      time: c.endTime || c.startTime || null,
    }));

    const registeredAt = flowConfig.registeredAt || null;
    const daysActive   = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86400000)
      : 0;

    // ── Onboarding status — muestra al cliente qué pasos están completos ──────
    const custom        = flowConfig.automations?.config || {};
    const nodeflowNum   = custom.nodeflowNumber || custom.outboundNumber || null;
    const onboarding    = {
      paid:            true,                    // si llegaron aquí, pagaron
      org_created:     true,                    // si llegaron aquí, la org existe
      number_assigned: !!nodeflowNum,           // auto-asignado post-pago
      // activation_sent = true si number_assigned (el email se envía junto con la asignación)
      activation_sent: !!nodeflowNum,
      nodeflowNumber:  nodeflowNum,
      complete:        !!nodeflowNum,
    };

    res.json({
      businessName: flowConfig.name,
      plan:         flowConfig.plan,
      daysActive,
      aiStatus:     nodeflowNum ? 'active' : 'pending',
      totalCalls:   bizCalls.length,
      today:        { callCount, bookedToday, convRate, emailsSent, hoursSaved },
      upcoming,
      recentActivity,
      onboarding,
    });
  });

  // ── GET /api/portal/calls ──────────────────────────────────
  app.get('/api/portal/calls', portalAuth, (req, res) => {
    const { businessId } = req;
    const { from, to, outcome } = req.query;

    let calls = pipeline.getCallHistory(500)
      .filter(c => (c.businessId || c.assistantId) === businessId);

    if (from) {
      calls = calls.filter(c => (c.endTime || c.startTime || '') >= from);
    }
    if (to) {
      const toEnd = to + 'T23:59:59';
      calls = calls.filter(c => (c.endTime || c.startTime || '') <= toEnd);
    }
    if (outcome && ['booked', 'info', 'abandoned'].includes(outcome)) {
      calls = calls.filter(c => c.outcome === outcome);
    }

    const formatted = calls.map(c => ({
      callId:       c.id,
      startedAt:    c.startTime,
      endedAt:      c.endTime,
      duration:     c.duration || 0,
      outcome:      c.outcome || 'abandoned',
      clientEmail:  c.clientEmail || null,
      callerNumber: c.callerNumber || null,
      appointment:  c.bookedAppointment || null,
      turnCount:    c.turnCount || 0,
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
    const { patientName, phone, email, service, date, time, notes } = req.body;
    if (!patientName || !service || !date || !time) {
      return res.status(400).json({ error: 'patientName, service, date y time son obligatorios' });
    }
    const result = scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time, notes });
    if (!result.success) return res.status(409).json({ error: result.error });
    log.info(`Portal: appointment created ${result.appointment.id} for ${patientName}`);
    res.json({ ok: true, appointment: result.appointment });
  });

  // ── GET /api/portal/appointments/:id ─────────────────────
  app.get('/api/portal/appointments/:id', portalAuth, (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    res.json({ appointment: apt });
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

    // Persistir en Supabase
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.upsert(apt);
    } catch (_) {}

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

    // Persistir cancelación en Supabase
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.patch(apt.id, {
        status:      'cancelled',
        cancelledAt: apt.cancelledAt,
        cancelledBy: 'portal',
        updatedAt:   new Date().toISOString(),
      });
    } catch (_) {}

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
    // BUG-30 FIX: same field name issue — use endTime/startTime from toJSON()
    const periodCalls = bizCalls.filter(c => (c.endTime || c.startTime || '') >= fromStr);
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
      const d = new Date(c.endTime || c.startTime || Date.now());
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
        reviewUrl:      custom.reviewUrl       || '',
        outboundNumber: custom.outboundNumber  || '',   // assigned by admin — read-only for portal users
        alertPhone:     custom.alertPhone      || '',   // teléfono personal dueño para alertas WA
        notifyEmail:    custom.notifyEmail     || flowConfig.ownerEmail || '',
        address:        custom.address         || '',
      },
    });
  });

  // ── PATCH /api/portal/config ──────────────────────────────
  app.patch('/api/portal/config', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const { name, language, sector, avgTicket, welcomeMessage, services, schedule, reviewUrl, alertPhone, notifyEmail, address } = req.body;

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
      ...(reviewUrl      !== undefined && { reviewUrl }),
      ...(alertPhone     !== undefined && { alertPhone }),
      ...(notifyEmail    !== undefined && { notifyEmail }),
      ...(address        !== undefined && { address }),
    };
    flow.updatedAt = new Date().toISOString();

    // Persist to DB
    const db = getDatabase();
    if (db.enabled) {
      try {
        const dbUpdate = { automation_config: flow.automations };
        if (name)     dbUpdate.name     = name;
        if (language) dbUpdate.language = language;
        if (sector)   dbUpdate.sector   = sector;
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
        reviewUrl:      custom.reviewUrl       || '',
        outboundNumber: custom.outboundNumber  || '',
        alertPhone:     custom.alertPhone      || '',
        notifyEmail:    custom.notifyEmail     || flow.ownerEmail || '',
        address:        custom.address         || '',
      },
    });
  });

  // ── GET /api/portal/contacts ───────────────────────────────
  app.get('/api/portal/contacts', portalAuth, async (req, res) => {
    const { businessId } = req;
    const q  = (req.query.q || '').trim();
    const db = getDatabase();
    if (!db.enabled) return res.json({ contacts: [] });

    let query = db.client
      .from('contacts')
      .select('id,phone,name,email,call_count,last_call_at,created_at')
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (q) {
      // BUG-48 FIX: Sanitize search query before interpolating into PostgREST .or() filter
      // string.  Raw user input can inject additional filter conditions (e.g. commas and
      // parentheses are special in PostgREST filter syntax).  Strip everything except
      // characters that legitimately appear in names, phone numbers and email addresses.
      const safeQ = q.replace(/[^a-zA-Z0-9 .@+\-_áéíóúàèìòùäëïöüñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇ]/g, '').slice(0, 100);
      if (safeQ) {
        query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,email.ilike.%${safeQ}%`);
      }
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Enrich: if contact has no name, try appointments for display name
    const apts = scheduler.getAppointments(businessId);
    const aptByPhone = {};
    apts.forEach(a => { if (a.phone && !aptByPhone[a.phone]) aptByPhone[a.phone] = a; });

    const contacts = (data || []).map(c => ({
      id:          c.id,
      phone:       c.phone,
      name:        c.name || null,
      email:       c.email || null,
      callCount:   c.call_count || 0,
      lastCallAt:  c.last_call_at || null,
      createdAt:   c.created_at,
      displayName: c.name || (aptByPhone[c.phone] && aptByPhone[c.phone].patientName) || c.phone,
    }));

    res.json({ ok: true, count: contacts.length, contacts });
  });

  // ── GET /api/portal/contacts/:id ──────────────────────────
  app.get('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    // 1. Fetch contact
    const { data: contact, error: cErr } = await db.client
      .from('contacts')
      .select('*')
      .eq('id', id)
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .single();

    if (cErr || !contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    // 2. Fetch linked calls by phone
    const { data: calls } = await db.client
      .from('calls')
      .select('call_sid,outcome,started_at,ended_at,duration_ms,turn_count')
      .eq('org_id', businessId)
      .eq('caller_number', contact.phone)
      .order('started_at', { ascending: false })
      .limit(50);

    // 3. Fetch linked appointments by phone (in-memory)
    const apts = scheduler.getAppointments(businessId)
      .filter(a => a.phone === contact.phone)
      .sort((a, b) => new Date(b.date + 'T' + (b.time || '00:00')) - new Date(a.date + 'T' + (a.time || '00:00')));

    res.json({
      ok: true,
      contact: {
        id:          contact.id,
        phone:       contact.phone,
        name:        contact.name  || null,
        email:       contact.email || null,
        notes:       contact.notes || '',
        callCount:   contact.call_count || 0,
        lastCallAt:  contact.last_call_at || null,
        createdAt:   contact.created_at,
        displayName: contact.name || contact.phone,
      },
      calls: (calls || []).map(c => ({
        callSid:    c.call_sid,
        outcome:    c.outcome    || 'abandoned',
        startedAt:  c.started_at || null,
        endedAt:    c.ended_at   || null,
        durationMs: c.duration_ms || 0,
        turnCount:  c.turn_count  || 0,
      })),
      appointments: apts,
    });
  });

  // ── PATCH /api/portal/contacts/:id ────────────────────────
  app.patch('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const { name, email, notes } = req.body;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const patch = {};
    if (name  !== undefined) patch.name  = name  || null;
    if (email !== undefined) patch.email = email || null;
    if (notes !== undefined) patch.notes = notes || null;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    const { data, error } = await db.client
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Contacto no encontrado' });
    res.json({ ok: true, contact: data });
  });

  // ── DELETE /api/portal/contacts/:id ───────────────────────
  app.delete('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const { error } = await db.client
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', businessId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── GET /api/portal/calls/:callSid/transcript ──────────────
  app.get('/api/portal/calls/:callSid/transcript', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { callSid } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.json({ transcript: [], available: false });

    const { data, error } = await db.client
      .from('calls')
      .select('transcript,outcome,started_at,ended_at,duration_ms,caller_number')
      .eq('call_sid', callSid)
      .eq('org_id', businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Transcripción no disponible para esta llamada' });
    }

    res.json({
      ok:           true,
      transcript:   data.transcript   || [],
      outcome:      data.outcome      || null,
      startedAt:    data.started_at   || null,
      endedAt:      data.ended_at     || null,
      durationMs:   data.duration_ms  || 0,
      callerNumber: data.caller_number || null,
      available:    (data.transcript || []).length > 0,
    });
  });

  // ── GET /api/portal/assistant ─────────────────────────────────
  app.get('/api/portal/assistant', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.json({ config: {} });
    try {
      const { data } = await db.client
        .from('organizations')
        .select('name, assistant_config')
        .eq('id', businessId)
        .single();
      res.json({ config: data?.assistant_config || {}, orgName: data?.name || '' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PUT /api/portal/assistant ─────────────────────────────────
  // Portal users can edit their config but CANNOT set customPromptOverride or model.
  app.put('/api/portal/assistant', portalAuth, async (req, res) => {
    const { businessId } = req;
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'body debe ser el objeto config' });
    }

    // Strip fields portal users must not control
    const safe = { ...incoming };
    delete safe.customPromptOverride;
    delete safe.model;

    const db = getDatabase();
    try {
      // Merge with existing config (don't overwrite fields not sent)
      const { data: existing } = await db.client
        .from('organizations').select('name, assistant_config').eq('id', businessId).single();
      const merged = { ...(existing?.assistant_config || {}), ...safe };

      const { generatePrompt } = require('../assistants/prompt-generator');
      const prompt = generatePrompt(merged, existing?.name || '');

      await db.client
        .from('organizations')
        .update({ assistant_config: merged })
        .eq('id', businessId);

      // Sync scheduler in-memory config so changes take effect immediately
      // (no restart required for schedule/services changes)
      try {
        const { scheduler } = require('../scheduling/scheduler');
        const current = scheduler.getBusinessConfig(businessId) || {};
        if (merged.schedule !== undefined) current.schedule = merged.schedule;
        if (merged.services  !== undefined) current.services = merged.services;
        if (merged.assistantName !== undefined) current.name = merged.assistantName;
        scheduler.setBusinessConfig(businessId, current);
      } catch (_) { /* scheduler not critical */ }

      log.info(`Portal: assistant config updated for ${businessId}`);
      res.json({ ok: true, prompt });
    } catch (e) {
      log.error(`Portal PUT assistant error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/calls/outbound ──────────────────────────
  // Inicia una llamada saliente desde el portal del cliente.
  // Plan gate: sólo Negocio y Pro. Starter no puede hacer llamadas salientes.
  // body: { to: string, assistantId?: string, provider?: 'auto'|'vonage'|'twilio' }
  app.post('/api/portal/calls/outbound', portalAuth, async (req, res) => {
    const { flowConfig, businessId } = req;

    // Plan gate
    const plan = (flowConfig.plan || 'starter').toLowerCase();
    if (!['negocio', 'pro'].includes(plan)) {
      return res.status(403).json({
        error: 'Las llamadas salientes requieren el plan Negocio o Pro.',
        upgrade: true,
      });
    }

    const { to, assistantId, provider = 'auto' } = req.body;
    if (!to) return res.status(400).json({ error: 'El campo "to" (número destino) es obligatorio' });

    // Sanitise: only digits, +, spaces, hyphens — no other chars
    const safeTo = String(to).replace(/[^\d+\s\-]/g, '').slice(0, 20);
    if (safeTo.replace(/[+\s\-]/g, '').length < 7) {
      return res.status(400).json({ error: 'Número de teléfono no válido' });
    }

    // Resolve assistant: prefer explicit id, then fall back to businessId (org's own assistant)
    const effAssistantId = assistantId || businessId;

    const publicUrl = config.publicUrl || process.env.PUBLIC_URL || '';

    try {
      const useVonage = (provider === 'vonage') ||
        (provider === 'auto' && config.vonageApiKey && config.vonageApplicationId);

      if (useVonage) {
        const { Vonage } = require('@vonage/server-sdk');
        const vonage = new Vonage({
          apiKey:        config.vonageApiKey,
          apiSecret:     config.vonageApiSecret,
          applicationId: config.vonageApplicationId,
          privateKey:    config.vonagePrivateKeyPath || './vonage_private.key',
        });
        const result = await vonage.voice.createOutboundCall({
          to:         [{ type: 'phone', number: safeTo }],
          from:       { type: 'phone', number: (flowConfig.automations && flowConfig.automations.config && flowConfig.automations.config.outboundNumber) || config.vonagePhoneNumber },
          answer_url: [`${publicUrl}/vonage/answer/${effAssistantId}`],
          event_url:  [`${publicUrl}/vonage/event`],
        });
        log.info(`Portal: Vonage outbound call → ${safeTo} for ${businessId}`);
        res.json({ ok: true, callUUID: result.uuid, provider: 'vonage' });
      } else {
        const twilio = require('twilio')(
          config.twilioAccountSid  || process.env.TWILIO_ACCOUNT_SID,
          config.twilioAuthToken   || process.env.TWILIO_AUTH_TOKEN,
        );
        // Per-org outbound number takes priority over global config
        const fromNumber = (flowConfig.automations && flowConfig.automations.config && flowConfig.automations.config.outboundNumber)
          || config.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;
        if (!fromNumber) {
          return res.status(503).json({ error: 'No hay número de teléfono saliente configurado para este negocio. Contacta con soporte.' });
        }
        const call = await twilio.calls.create({
          to:   safeTo,
          from: fromNumber,
          url:  `${publicUrl}/voice/inbound/${effAssistantId}`,
        });
        log.info(`Portal: Twilio outbound call → ${safeTo} for ${businessId}`);
        res.json({ ok: true, callSid: call.sid, provider: 'twilio' });
      }
    } catch (e) {
      log.error(`Portal: outbound call failed for ${businessId}: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Lifecycle: Reminder Config
  // ============================================================

  app.get('/api/portal/reminder-config', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;
      const { data: org } = await db.client.from('organizations')
        .select('sector').eq('id', orgId).maybeSingle();
      const config = await getOrgReminderConfig(orgId, org?.sector || '');
      res.json({ ok: true, config });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/reminder-config', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;
      const { config: cfg } = req.body;
      if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'config object required' });
      const { error } = await db.client.from('org_reminder_config')
        .upsert({ org_id: orgId, config: cfg, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Sector Completion (wizard data)
  // IMPORTANT: Must be registered BEFORE /contacts/:id/sector-data
  // to prevent Express matching 'sector-completion' as a contact :id
  // ============================================================

  app.get('/api/portal/contacts/sector-completion', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;

      // Get org sector
      const { data: org, error: orgErr } = await db.client
        .from('organizations').select('sector').eq('id', orgId).maybeSingle();
      if (orgErr) return res.status(500).json({ error: orgErr.message });
      if (!org)   return res.status(404).json({ error: 'Organization not found' });

      const sectorSlug = org.sector || '';
      const fields     = SECTOR_REQUIRED_FIELDS[sectorSlug];

      // Sectors with no manual fields — wizard not needed
      if (!fields || fields.length === 0) {
        return res.json({ wizardNeeded: false, sector: sectorSlug, fields: [], contacts: [], pendingCount: 0, totalCount: 0 });
      }

      // Fetch all contacts for this org
      const { data: contacts, error: contactsErr } = await db.client
        .from('contacts')
        .select('id, name, phone, sector_data')
        .eq('org_id', orgId)
        .order('name', { ascending: true });

      if (contactsErr) return res.status(500).json({ error: contactsErr.message });

      const list = (contacts || []).map(function(c) {
        const { status, missing } = getCompletionStatus(sectorSlug, c.sector_data);
        return {
          id:         c.id,
          name:       c.name       || null,
          phone:      c.phone      || null,
          sectorData: c.sector_data || {},   // included so wizard can pre-fill existing values
          status,
          missing,
        };
      });

      const pendingCount = list.filter(function(c) { return c.status !== 'complete'; }).length;

      res.json({
        wizardNeeded: true,
        sector:       sectorSlug,
        fields,
        contacts:     list,
        pendingCount,
        totalCount:   list.length,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Contact Sector Data
  // ============================================================

  app.get('/api/portal/contacts/:id/sector-data', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data, error } = await db.client.from('contacts')
        .select('id, name, phone, sector_data')
        .eq('id', req.params.id)
        .eq('org_id', req.businessId)
        .maybeSingle();
      if (error || !data) return res.status(404).json({ error: 'Contact not found' });
      res.json({ ok: true, sectorData: data.sector_data || {} });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/contacts/:id/sector-data', portalAuth, async (req, res) => {
    try {
      const db        = getDatabase();
      const orgId     = req.businessId;
      const contactId = req.params.id;
      const { sectorData } = req.body;
      if (!sectorData || typeof sectorData !== 'object') return res.status(400).json({ error: 'sectorData object required' });

      const { error } = await db.client.from('contacts')
        .update({ sector_data: sectorData })
        .eq('id', contactId).eq('org_id', orgId);
      if (error) return res.status(500).json({ error: error.message });

      // Recalculate reminders in background (fire-and-forget)
      recalculate(contactId, orgId).catch(() => {});

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Reminders Dashboard
  // ============================================================

  app.get('/api/portal/reminders', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { status = 'pending' } = req.query;
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 50));
      const offset = Math.max(0,              parseInt(req.query.offset, 10) || 0);

      let query = db.client.from('scheduled_reminders')
        .select('*, contacts(name, phone)')
        .eq('org_id', req.businessId)
        .order('scheduled_for', { ascending: true })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (status !== 'all') query = query.eq('status', status);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, reminders: data || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/portal/reminders/upcoming', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db.client.from('scheduled_reminders')
        .select('*, contacts(name, phone)')
        .eq('org_id', req.businessId)
        .eq('status', 'pending')
        .lte('scheduled_for', until)
        .order('scheduled_for', { ascending: true })
        .limit(100);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, reminders: data || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/send-now', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data: existing } = await db.client.from('scheduled_reminders')
        .select('*').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Reminder not found' });

      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'manual_send_now', updated_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('org_id', req.businessId);

      await scheduleReminder({
        orgId:        req.businessId,
        contactId:    existing.contact_id,
        serviceKey:   existing.service_key,
        scheduledFor: new Date(Date.now() + 5000), // 5 seconds from now
        channel:      existing.channel,
      });

      res.json({ ok: true, message: 'Reminder queued for immediate dispatch' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/postpone', portalAuth, async (req, res) => {
    try {
      const db   = getDatabase();
      const days = Math.max(1, Math.min(90, Number(req.body.days) || 7));

      const { data: existing } = await db.client.from('scheduled_reminders')
        .select('*').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Reminder not found' });

      const newDate = new Date(existing.scheduled_for);
      newDate.setDate(newDate.getDate() + days);

      await db.client.from('scheduled_reminders')
        .update({ status: 'postponed', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);

      await db.client.from('scheduled_reminders').insert({
        org_id:         req.businessId,
        contact_id:     existing.contact_id,
        service_key:    existing.service_key,
        channel:        existing.channel,
        scheduled_for:  newDate.toISOString(),
        status:         'pending',
        postponed_from: req.params.id,
        postponed_days: days,
      });

      res.json({ ok: true, newDate: newDate.toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/cancel', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { error } = await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'manual_cancel', updated_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('org_id', req.businessId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Opt-out (PUBLIC — no auth required)
  // ============================================================

  // ── GET /api/portal/onboarding-status ── PUBLIC (no auth) ───────────────────
  // Polled by /gracias page to show real-time onboarding progress.
  // Returns steps completed for a given registroId.
  app.get('/api/portal/onboarding-status', async (req, res) => {
    const { registroId } = req.query;
    if (!registroId || typeof registroId !== 'string' || registroId.length > 80) {
      return res.status(400).json({ error: 'registroId requerido' });
    }

    const db = getDatabase();

    // Default: all pending (DB not available or registro not found)
    const result = {
      steps: {
        paid:            false,
        org_created:     false,
        number_assigned: false,
        activation_sent: false,
      },
      complete:       false,
      nodeflowNumber: null,
      portalReady:    false,
    };

    if (!db.enabled) return res.json(result);

    try {
      // 1. Check registro status
      const { data: reg } = await db.client
        .from('registros')
        .select('id, status, email, paid_at')
        .eq('id', registroId)
        .maybeSingle();

      if (!reg) return res.json(result);

      result.steps.paid = !!(reg.paid_at || reg.status === 'active');

      // 2. Check org
      const { data: org } = await db.client
        .from('organizations')
        .select('id, automation_config, is_active')
        .eq('owner_email', reg.email.trim().toLowerCase())
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (org) {
        result.steps.org_created = true;
        result.portalReady       = true;

        const cfg = org.automation_config?.config || {};
        const num = cfg.nodeflowNumber || cfg.outboundNumber || null;
        if (num) {
          result.steps.number_assigned = true;
          result.steps.activation_sent = true;
          result.nodeflowNumber        = num;
          result.complete              = true;
        }
      }

      result.steps.paid = result.steps.paid || result.steps.org_created;

      res.json(result);
    } catch (e) {
      log.warn('onboarding-status error', { err: e.message });
      res.json(result); // fail open — return default pending state
    }
  });

  app.get('/api/portal/unsubscribe', async (req, res) => {
    try {
      const { c: contactId, o: orgId, ch: channel } = req.query;
      if (!contactId || !orgId || !['whatsapp','email','sms'].includes(channel)) {
        return res.status(400).send('Enlace inválido');
      }
      const db    = getDatabase();
      const field = channel === 'whatsapp' ? 'no_whatsapp' : channel === 'sms' ? 'no_sms' : 'no_email';
      // Verify contact belongs to this org (prevents cross-tenant opt-out)
      const { data: contactExists } = await db.client.from('contacts')
        .select('id').eq('id', contactId).eq('org_id', orgId).maybeSingle();
      if (!contactExists) {
        return res.status(400).send('Enlace inválido o expirado');
      }
      await db.client.from('contact_memory')
        .upsert(
          { org_id: orgId, contact_id: contactId, [field]: true, updated_at: new Date().toISOString() },
          { onConflict: 'org_id,contact_id' }
        ).catch(() => {});
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ Preferencia guardada</h2>
        <p>No recibirás más recordatorios por ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'email'} de este negocio.</p>
      </body></html>`);
    } catch (e) { res.status(500).send('Error interno'); }
  });

} // end setupPortalRoutes

module.exports = { setupPortalRoutes, portalAuth };
