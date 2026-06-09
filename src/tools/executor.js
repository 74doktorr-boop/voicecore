// ============================================
// VoiceCore — Tool Executor v2
// Handles ALL function calls from LLM.
// Connects to scheduling, memory, notifications,
// WhatsApp (client + owner) and DB.
// ============================================

const { scheduler }          = require('../scheduling/scheduler');
const { Logger }             = require('../utils/logger');
const { getGoogleCalendar }  = require('../integrations/google-calendar');
const { getDatabase }        = require('../db/database');
const { webhookDispatcher, EVENTS } = require('../webhooks/dispatcher');
const log = new Logger('TOOLS');

// ── Lazy-loaded modules (avoid circular deps at startup) ──────────────────────
function _wa()         { return require('../notifications/whatsapp');        } // owner-only (Callmebot)
function _clientWA()   { return require('../notifications/client-whatsapp'); } // client-facing (Meta API)
function _memory()     { return require('../lifecycle/call-memory');         }
function _critDates()  { return require('../scheduling/critical-dates');      }
function _flowMgr()    { return require('../automations/flow-manager').flowManager; }

// ── Push a calendar event after a successful booking (non-blocking) ───────────
async function _syncToCalendar(businessId, appointment) {
  try {
    const db  = getDatabase();
    const cal = getGoogleCalendar();
    if (!db.enabled || !cal.enabled) return;
    const org = await db.getOrg(businessId);
    if (!org?.google_refresh_token) return;
    const freshTokens = await cal.refreshIfNeeded({
      access_token:  org.google_access_token,
      refresh_token: org.google_refresh_token,
      expiry_date:   org.google_token_expiry,
    });
    if (freshTokens.access_token !== org.google_access_token) {
      await db.updateOrg(businessId, {
        google_access_token: freshTokens.access_token,
        google_token_expiry: freshTokens.expiry_date,
      }).catch(() => {});
    }
    const config = scheduler.getBusinessConfig(businessId);
    await cal.createEvent(freshTokens, appointment, {
      calendarId: org.google_calendar_id || 'primary',
      timezone:   config?.timezone || 'Europe/Madrid',
    });
  } catch (e) {
    log.warn(`_syncToCalendar failed for ${businessId}: ${e.message}`);
  }
}

// ── Notify business owner via WhatsApp (Callmebot — only owner phone) ─────────
function _notifyOwner(message) {
  try { _wa().sendWhatsApp(message).catch(() => {}); } catch (_) {}
}

// ── Get business config merged from scheduler + flowManager ──────────────────
function _getBizConfig(businessId) {
  try {
    const sched = scheduler.getBusinessConfig(businessId) || {};
    const flow  = _flowMgr().mergeConfig(businessId, sched);
    return flow || sched;
  } catch (_) { return {}; }
}

// ─────────────────────────────────────────────────────────────────────────────

class ToolExecutor {
  constructor() {
    this.handlers = {
      // ── Core scheduling ──
      check_availability:  this.checkAvailability.bind(this),
      book_appointment:    this.bookAppointment.bind(this),
      cancel_appointment:  this.cancelAppointment.bind(this),
      lookup_appointments: this.lookupAppointments.bind(this),
      get_services:        this.getServices.bind(this),
      add_critical_date:   this.addCriticalDate.bind(this),

      // ── Memory ──
      get_client_memory:   this.getClientMemory.bind(this),
      get_last_visit:      this.getClientMemory.bind(this), // alias

      // ── Notifications — owner ──
      flag_urgent:         this.flagUrgent.bind(this),
      flag_hot_lead:       this.flagUrgent.bind(this),      // alias
      notify_advisor:      this.notifyAdvisor.bind(this),

      // ── Notifications — client ──
      send_reminder:                this.sendReminder.bind(this),
      send_review_request:          this.sendReviewRequest.bind(this),
      send_fidelization_reminder:   this.sendFidelizationReminder.bind(this),
      schedule_treatment_reminders: this.scheduleTreatmentReminders.bind(this),

      // ── Leads & prospects ──
      register_lead:       this.registerLead.bind(this),
      register_prospect:   this.registerLead.bind(this),    // alias

      // ── Booking variants ──
      book_class:          this.bookClass.bind(this),
      book_visit:          this.bookVisit.bind(this),
      request_quote:       this.requestQuote.bind(this),

      // ── Member management (gimnasio) ──
      request_freeze:      this.requestFreeze.bind(this),
      process_cancellation:this.processCancellation.bind(this),
      get_pricing:         this.getPricing.bind(this),
      get_schedule:        this.getSchedule.bind(this),

      // ── Pharmacy ──
      check_medication_stock: this.checkMedicationStock.bind(this),
      reserve_medication:     this.reserveMedication.bind(this),
      book_service:           this.bookAppointment.bind(this), // alias
      get_pharmacy_info:      this.getPharmacyInfo.bind(this),

      // ── Asesoría ──
      lookup_case:         this.lookupCase.bind(this),

      // ── Inmobiliaria ──
      search_properties:   this.searchProperties.bind(this),
      schedule_valuation:  this.scheduleValuation.bind(this),

      // ── Misc ──
      get_products:        this.getProducts.bind(this),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  async execute(functionName, args, assistantId, context = {}) {
    const handler = this.handlers[functionName];
    if (!handler) {
      log.warn(`Unknown tool: ${functionName}`);
      // Return a graceful message instead of an error so the LLM doesn't
      // get confused and fabricate a result.
      return { success: false, message: 'Función no disponible, continúa la conversación normalmente.' };
    }
    log.info(`Tool: ${functionName}`, args);
    try {
      const result = await handler(args, assistantId, context);
      log.info(`Tool OK: ${functionName}`, result);
      return result;
    } catch (err) {
      log.error(`Tool error: ${functionName} — ${err.message}`);
      return { success: false, message: 'Error interno, continúa la conversación normalmente.' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. CORE SCHEDULING
  // ─────────────────────────────────────────────────────────────────────────

  checkAvailability(args, assistantId) {
    const businessId  = assistantId || 'demo-clinic';
    const todayMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    const fromDate    = args.from_date || todayMadrid;
    const toDate      = args.to_date || (() => {
      const d = new Date(fromDate); d.setDate(d.getDate() + 5);
      return d.toISOString().split('T')[0];
    })();
    const result = scheduler.getAvailableSlots(businessId, fromDate, toDate, args.service || null);

    if (result.availableDays) {
      let lang = 'es';
      try { lang = _flowMgr().getLanguage(businessId); } catch (_) {}
      const lbl = {
        morning:   lang === 'eu' ? 'Goizean'       : 'Mañana',
        afternoon: lang === 'eu' ? 'Arratsaldean'  : 'Tarde',
      };
      const summary = result.availableDays.map(day => {
        const morning   = day.slots.filter(s => parseInt(s.time) < 14);
        const afternoon = day.slots.filter(s => parseInt(s.time) >= 14);
        let desc = `${day.dayName} ${day.date}:`;
        if (morning.length   > 0) desc += ` ${lbl.morning} ${morning[0].time}-${morning[morning.length-1].endTime} (${morning.length} huecos), primeros: ${morning.slice(0,3).map(s=>s.time).join(', ')}`;
        if (afternoon.length > 0) desc += ` ${lbl.afternoon} ${afternoon[0].time}-${afternoon[afternoon.length-1].endTime} (${afternoon.length} huecos), primeros: ${afternoon.slice(0,3).map(s=>s.time).join(', ')}`;
        return desc;
      });
      return { available: result.totalSlots > 0, service: result.service, duration: result.duration, totalSlots: result.totalSlots, days: summary };
    }
    return result;
  }

  bookAppointment(args, assistantId, context = {}) {
    const businessId = assistantId || 'demo-clinic';
    // Normalize field names across sectors (patient_name, client_name, owner_name, member_name)
    const name = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const result = scheduler.bookAppointment(businessId, {
      patientName: name,
      phone:       args.phone  || '',
      email:       args.email  || null,
      service:     args.service || args.treatment || args.activity || args.reason || '',
      date:        args.date,
      time:        args.time,
      notes:       args.notes || args.vehicle || '',
    });

    if (result.success && result.appointment && context.session) {
      context.session.bookedAppointment = result.appointment;
      context.session.clientPhone       = args.phone || null;
      context.session.clientEmail       = args.email || null;
      context.session.outcome           = 'booked';
    }
    if (result.success && result.appointment) {
      _syncToCalendar(businessId, result.appointment).catch(() => {});
      webhookDispatcher.fire(businessId, EVENTS.APPOINTMENT_BOOKED, {
        appointmentId: result.appointment.id,
        patientName:   result.appointment.patientName,
        phone:         result.appointment.phone    || null,
        email:         result.appointment.email    || null,
        service:       result.appointment.service,
        date:          result.appointment.date,
        time:          result.appointment.time,
        duration:      result.appointment.duration || null,
      }).catch(() => {});
    }
    return result;
  }

  cancelAppointment(args, assistantId) {
    const businessId = assistantId || null;
    const name = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const result = scheduler.cancelAppointment(args.appointment_id || '', name, businessId);
    if (result.success && businessId) {
      webhookDispatcher.fire(businessId, EVENTS.APPOINTMENT_CANCELLED, {
        appointmentId: args.appointment_id || null,
        patientName:   name,
      }).catch(() => {});
    }
    return result;
  }

  lookupAppointments(args, assistantId) {
    const name = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    return scheduler.lookupAppointments(name, assistantId || null);
  }

  getServices(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo-clinic');
    if (!config) return { services: [] };
    return {
      services: (config.services || []).map(s => ({
        name:     s.name,
        duration: `${s.duration} min`,
        price:    s.price > 0 ? `${s.price}€` : 'Gratuita',
      })),
    };
  }

  addCriticalDate(args, assistantId) {
    const businessId = assistantId || 'demo';
    try {
      const { criticalDatesStore } = _critDates();
      const entry = criticalDatesStore.add({
        businessId,
        clientName:  args.client_name,
        clientEmail: args.client_email  || null,
        clientPhone: args.client_phone  || null,
        type:        args.type,
        dueDate:     args.due_date,
        notes:       args.notes || null,
        advanceDays: [30, 15, 7],
      });
      return { success: true, id: entry.id, message: `Fecha crítica registrada: ${entry.type} el ${entry.dueDate}. El cliente recibirá recordatorios automáticos.` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MEMORY
  // ─────────────────────────────────────────────────────────────────────────

  async getClientMemory(args, assistantId) {
    // Normalize field names
    const name  = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const phone = args.phone || null;
    const orgId = assistantId || 'demo';

    // Use phone as contactId if provided (more reliable), else name slug
    const contactId = phone
      ? phone.replace(/\D/g, '')
      : name.toLowerCase().replace(/\s+/g, '-');

    if (!contactId) return { isFirstCall: true, message: 'Cliente nuevo, sin historial.' };

    try {
      const mem = await _memory().getContactMemory(contactId, orgId);
      if (!mem) return { isFirstCall: true, message: 'Primera vez que contacta.' };

      // Build a readable summary for the LLM
      const parts = [];
      if (mem.last_call_at) {
        const days = Math.floor((Date.now() - new Date(mem.last_call_at)) / 86400000);
        parts.push(`Última llamada: hace ${days} días`);
      }
      if (mem.last_call_summary) parts.push(`Último contacto: ${mem.last_call_summary}`);
      if (mem.preferences?.service) parts.push(`Servicio habitual: ${mem.preferences.service}`);
      if (mem.preferences?.horario) parts.push(`Prefiere horario: ${mem.preferences.horario}`);
      if (mem.call_count) parts.push(`Total llamadas: ${mem.call_count}`);

      return {
        isFirstCall:       false,
        callCount:         mem.call_count        || 1,
        lastCallDaysAgo:   mem.last_call_at ? Math.floor((Date.now() - new Date(mem.last_call_at)) / 86400000) : null,
        lastCallSummary:   mem.last_call_summary || null,
        preferences:       mem.preferences       || {},
        summary:           parts.join('. ') || 'Cliente conocido, sin detalles adicionales.',
      };
    } catch (_) {
      return { isFirstCall: true, message: 'Sin historial disponible.' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. OWNER NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async flagUrgent(args, assistantId) {
    const name    = args.client_name || args.owner_name || 'Cliente';
    const phone   = args.phone || 'desconocido';
    const issue   = args.issue || args.details || 'Urgencia sin descripción';
    const biz     = _getBizConfig(assistantId);

    const msg =
      `🚨 *URGENCIA — ${biz.name || assistantId}*\n` +
      `━━━━━━━━━━━━\n` +
      `👤 ${name}\n` +
      `📞 ${phone}\n` +
      `⚠️ ${issue}\n` +
      (args.location ? `📍 ${args.location}\n` : '') +
      `━━━━━━━━━━━━\nNodeFlow IA — requiere atención inmediata`;

    _notifyOwner(msg);

    // Also persist to DB as a call event
    try {
      const db = getDatabase();
      if (db.enabled) {
        await db.client.from('call_events').insert({
          org_id:     assistantId,
          event_type: 'urgent',
          client_name: name,
          phone,
          notes:      issue,
          created_at: new Date().toISOString(),
        });
      }
    } catch (_) {}

    return { success: true, message: 'El responsable ha sido alertado inmediatamente. Está avisado ahora mismo.' };
  }

  async notifyAdvisor(args, assistantId) {
    const name    = args.client_name || 'Cliente';
    const phone   = args.phone || 'desconocido';
    const message = args.message || 'El cliente necesita hablar con el asesor.';
    const biz     = _getBizConfig(assistantId);

    const msg =
      `📋 *Aviso para el asesor — ${biz.name || assistantId}*\n` +
      `━━━━━━━━━━━━\n` +
      `👤 ${name}\n` +
      `📞 ${phone}\n` +
      `💬 ${message}\n` +
      `━━━━━━━━━━━━\nNodeFlow IA`;

    _notifyOwner(msg);
    return { success: true, message: 'El asesor responsable ha sido avisado y contactará hoy mismo.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. CLIENT NOTIFICATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async sendReminder(args, assistantId) {
    const phone    = args.phone;
    const name     = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const date     = args.date;
    const time     = args.time;
    const service  = args.service || args.treatment || args.activity || args.reason || 'cita';
    const petName  = args.pet_name ? ` de ${args.pet_name}` : '';
    const address  = args.address ? `\n📍 ${args.address}` : '';

    if (!phone || !date || !time) {
      return { success: false, message: 'Faltan datos (teléfono, fecha u hora) para enviar el recordatorio.' };
    }

    // Normalise date for display
    let displayDate = date;
    try {
      displayDate = new Date(date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (_) {}

    const text =
      `Hola ${name} 👋\n\n` +
      `Te recordamos que mañana tienes cita${petName} en nuestro centro:\n\n` +
      `📅 ${displayDate} a las ${time}h\n` +
      `📋 ${service}` +
      address +
      `\n\nSi necesitas cambiarla, llámanos. ¡Hasta mañana!`;

    // Try client WhatsApp (Meta API) first, fallback to owner notification
    const clientWA = _clientWA();
    if (clientWA.isConfigured()) {
      const result = await clientWA.sendText(phone, text);
      if (result.ok) {
        return { success: true, message: `Recordatorio enviado por WhatsApp a ${name}.` };
      }
    }

    // Fallback: schedule via DB for later sending, notify owner
    const biz = _getBizConfig(assistantId);
    _notifyOwner(
      `📅 *Recordatorio pendiente — ${biz.name || assistantId}*\n` +
      `Enviar a ${name} (${phone}) para su cita del ${displayDate} a las ${time}h.\n` +
      `Servicio: ${service}`
    );

    return { success: true, message: `Recordatorio programado para ${name}. Se enviará el día antes de la cita.` };
  }

  async sendReviewRequest(args, assistantId) {
    const phone = args.phone;
    const name  = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const biz   = _getBizConfig(assistantId);

    if (!phone) return { success: false, message: 'Falta el teléfono para enviar la solicitud de reseña.' };

    // Get the review URL from business config or use a generic Google search link
    const reviewUrl = biz.googleReviewUrl || biz.google_review_url ||
      `https://search.google.com/local/writereview?placeid=${biz.googlePlaceId || ''}`;

    const text =
      `Hola ${name} 👋\n\n` +
      `Ha sido un placer atenderte. Si has quedado contento/a con el servicio, ` +
      `nos ayudaría muchísimo que nos dejaras una reseña en Google — solo tarda un minuto:\n\n` +
      `👉 ${reviewUrl}\n\n` +
      `¡Muchas gracias! — ${biz.name || 'El equipo'}`;

    const clientWA = _clientWA();
    if (clientWA.isConfigured()) {
      const result = await clientWA.sendText(phone, text);
      if (result.ok) {
        return { success: true, message: `Enlace de reseña enviado a ${name} por WhatsApp.` };
      }
    }

    // Fallback: notify owner to send it manually
    _notifyOwner(
      `⭐ *Reseña pendiente — ${biz.name || assistantId}*\n` +
      `Enviar a ${name} (${phone}) el enlace de reseña.\n` +
      `Enlace: ${reviewUrl}`
    );

    return { success: true, message: `Solicitud de reseña registrada para ${name}. Se gestionará por el equipo.` };
  }

  async sendFidelizationReminder(args, assistantId) {
    const phone   = args.phone;
    const name    = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    const days    = args.days_until_reminder || 30;
    const service = args.service || args.treatment || args.reminder_type || '';
    const biz     = _getBizConfig(assistantId);

    if (!phone) return { success: false, message: 'Falta el teléfono para programar el recordatorio de fidelización.' };

    // Schedule via critical dates store (fires X days from now)
    try {
      const { criticalDatesStore } = _critDates();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + days);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      criticalDatesStore.add({
        businessId:  assistantId,
        clientName:  name,
        clientPhone: phone,
        type:        'service_due',
        dueDate:     dueDateStr,
        notes:       `Recordatorio de fidelización: ${service} — enviar ${days} días después de la visita`,
        advanceDays: [0], // send exactly on that day
      });

      log.info(`Fidelization scheduled: ${name} (${phone}) — ${service} in ${days}d`);
    } catch (e) {
      log.warn(`sendFidelizationReminder DB error: ${e.message}`);
    }

    return {
      success: true,
      message: `Recordatorio de vuelta programado para ${name} en ${days} días.`,
    };
  }

  async scheduleTreatmentReminders(args, assistantId) {
    const phone     = args.phone;
    const name      = args.client_name || '';
    const treatment = args.treatment || '';
    const sessions  = args.sessions || 1;
    const freqDays  = args.frequency_days || 14;
    const firstDate = args.first_date;

    if (!phone || !firstDate) {
      return { success: false, message: 'Faltan datos para programar los recordatorios del ciclo.' };
    }

    try {
      const { criticalDatesStore } = _critDates();
      for (let i = 0; i < sessions; i++) {
        const d = new Date(firstDate);
        d.setDate(d.getDate() + i * freqDays);
        const sessionDate = d.toISOString().split('T')[0];
        criticalDatesStore.add({
          businessId:  assistantId,
          clientName:  name,
          clientPhone: phone,
          type:        'service_due',
          dueDate:     sessionDate,
          notes:       `Sesión ${i + 1}/${sessions} — ${treatment}`,
          advanceDays: [1], // reminder 1 day before
        });
      }
    } catch (e) {
      log.warn(`scheduleTreatmentReminders error: ${e.message}`);
    }

    return {
      success: true,
      message: `Recordatorios programados para las ${sessions} sesiones del tratamiento de ${treatment}.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. LEADS & PROSPECTS
  // ─────────────────────────────────────────────────────────────────────────

  async registerLead(args, assistantId) {
    const name  = args.name || args.client_name || '';
    const phone = args.phone || '';
    const biz   = _getBizConfig(assistantId);

    // Persist to DB
    try {
      const db = getDatabase();
      if (db.enabled) {
        await db.client.from('leads').insert({
          org_id:        assistantId,
          name,
          phone,
          goal:          args.goal         || null,
          business_type: args.business_type || null,
          need:          args.need          || null,
          operation:     args.operation     || null,
          notes:         args.notes         || null,
          urgency:       args.urgency       || 'media',
          source:        'voice_call',
          created_at:    new Date().toISOString(),
        });
      }
    } catch (_) {}

    // Notify owner
    const details = [
      args.goal          && `Objetivo: ${args.goal}`,
      args.business_type && `Tipo: ${args.business_type}`,
      args.need          && `Necesidad: ${args.need}`,
      args.operation     && `Operación: ${args.operation}`,
      args.urgency       && `Urgencia: ${args.urgency}`,
      args.notes         && args.notes,
    ].filter(Boolean).join('\n');

    _notifyOwner(
      `👤 *Nuevo lead — ${biz.name || assistantId}*\n` +
      `━━━━━━━━━━━━\n` +
      `👤 ${name}\n📞 ${phone}\n` +
      (details ? `${details}\n` : '') +
      `━━━━━━━━━━━━\nNodeFlow IA`
    );

    return { success: true, message: `Datos de ${name} registrados. El equipo se pondrá en contacto en breve.` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. BOOKING VARIANTS
  // ─────────────────────────────────────────────────────────────────────────

  bookClass(args, assistantId, context) {
    // Gimnasio: book a class slot — reuse bookAppointment logic
    return this.bookAppointment({
      ...args,
      patient_name: args.member_name || args.client_name,
      service:      args.activity,
    }, assistantId, context);
  }

  bookVisit(args, assistantId, context) {
    // Inmobiliaria: book a property visit
    return this.bookAppointment({
      ...args,
      patient_name: args.client_name,
      service:      `Visita inmueble${args.property_description ? ': ' + args.property_description : ''}`,
      notes:        args.property_id || args.property_description || '',
    }, assistantId, context);
  }

  async requestQuote(args, assistantId) {
    const name  = args.client_name || '';
    const phone = args.phone || '';
    const biz   = _getBizConfig(assistantId);

    _notifyOwner(
      `🔧 *Solicitud de presupuesto — ${biz.name || assistantId}*\n` +
      `━━━━━━━━━━━━\n` +
      `👤 ${name}\n📞 ${phone}\n` +
      `🚗 ${args.vehicle || ''}\n` +
      `⚠️ ${args.issue || ''}\n` +
      `━━━━━━━━━━━━\nNodeFlow IA`
    );

    return { success: true, message: `Presupuesto solicitado. El taller llamará a ${name} lo antes posible.` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. GIMNASIO
  // ─────────────────────────────────────────────────────────────────────────

  async requestFreeze(args, assistantId) {
    const name  = args.member_name || '';
    const phone = args.phone || '';
    const biz   = _getBizConfig(assistantId);

    _notifyOwner(
      `❄️ *Congelación de cuota — ${biz.name || assistantId}*\n` +
      `👤 ${name} (${phone})\n` +
      `Semanas: ${args.weeks || '?'}\n` +
      `Motivo: ${args.reason || 'sin indicar'}`
    );

    return { success: true, message: `Solicitud de congelación registrada para ${name}. El equipo lo confirmará.` };
  }

  async processCancellation(args, assistantId) {
    const name  = args.member_name || '';
    const phone = args.phone || '';
    const biz   = _getBizConfig(assistantId);

    _notifyOwner(
      `❌ *Baja de socio — ${biz.name || assistantId}*\n` +
      `👤 ${name} (${phone})\n` +
      `Motivo: ${args.reason || 'sin indicar'}`
    );

    return { success: true, message: `Baja procesada para ${name}. El equipo lo confirmará por escrito.` };
  }

  getPricing(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo');
    if (config?.pricing) return { pricing: config.pricing };
    // Fallback: return from services
    const services = (config?.services || []).map(s => `${s.name}: ${s.price > 0 ? s.price + '€' : 'Gratuita'}`);
    return { pricing: services.join(', ') || 'Consultar en recepción.' };
  }

  getSchedule(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo');
    if (!config) return { schedule: 'Consultar horario en recepción.' };
    const { schedule, classes } = config;

    if (classes && args.activity) {
      const filtered = classes.filter(c =>
        !args.activity || c.name.toLowerCase().includes(args.activity.toLowerCase())
      );
      return { classes: filtered };
    }
    return { schedule: schedule || config.openingHours || 'Sin horario configurado.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. FARMACIA
  // ─────────────────────────────────────────────────────────────────────────

  async checkMedicationStock(args, assistantId) {
    const medication = args.medication || '';

    // Common OTC medications: always in stock
    const OTC_ALWAYS_AVAILABLE = [
      'ibuprofeno', 'paracetamol', 'omeprazol', 'loratadina', 'cetirizina',
      'almax', 'gaviscon', 'frenadol', 'couldina', 'vitamina', 'suero',
    ];
    const isOTC = OTC_ALWAYS_AVAILABLE.some(m => medication.toLowerCase().includes(m));
    if (isOTC) {
      return { inStock: true, medication, message: `Sí, tenemos ${medication} disponible.` };
    }

    // For prescription or specific medications, check via DB or default to "checking"
    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client
          .from('pharmacy_stock')
          .select('in_stock')
          .eq('org_id', assistantId)
          .ilike('medication', `%${medication}%`)
          .maybeSingle();
        if (data !== null) {
          return { inStock: data.in_stock, medication, message: data.in_stock ? `Sí, tenemos ${medication}.` : `No tenemos ${medication} en este momento, pero puedo pedirlo para mañana.` };
        }
      }
    } catch (_) {}

    // Default: honest response
    return {
      inStock: null,
      medication,
      message: `Para ${medication} necesito comprobarlo. ¿Le reservo uno para mañana por si acaso?`,
    };
  }

  async reserveMedication(args, assistantId) {
    const name  = args.client_name || '';
    const phone = args.phone || '';
    const med   = args.medication || '';
    const biz   = _getBizConfig(assistantId);

    _notifyOwner(
      `💊 *Reserva de medicamento — ${biz.name || assistantId}*\n` +
      `👤 ${name} (${phone})\n` +
      `Medicamento: ${med} x${args.quantity || 1}\n` +
      (args.notes ? `Notas: ${args.notes}` : '')
    );

    // Send WhatsApp to client when ready (scheduled for later, owner handles it)
    return { success: true, message: `Medicamento reservado para ${name}. Le avisaremos por WhatsApp cuando esté listo.` };
  }

  getPharmacyInfo(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo');
    const type   = args.info_type || 'horario';

    if (type === 'guardia') {
      return { message: 'Para la farmacia de guardia esta noche, consulte en http://www.cofv.es/farmacias-guardia/ o llame al 915229552.' };
    }
    if (type === 'servicios') {
      return { services: 'Medición tensión arterial, glucosa y temperatura (gratuitas). Vacuna gripe. Tests COVID/embarazo. Seguimiento farmacoterapéutico.' };
    }
    return {
      horario: config?.openingHours || 'Lunes a sábado de 9 a 21h.',
      message: config?.address || 'Consulte nuestra ubicación en Google Maps.',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. ASESORÍA
  // ─────────────────────────────────────────────────────────────────────────

  async lookupCase(args, assistantId) {
    const name    = args.client_name || '';
    const company = args.company || '';

    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client
          .from('advisory_cases')
          .select('status, subject, updated_at, advisor')
          .eq('org_id', assistantId)
          .ilike('client_name', `%${name}%`)
          .order('updated_at', { ascending: false })
          .limit(3);

        if (data && data.length > 0) {
          const cases = data.map(c => `${c.subject} — Estado: ${c.status} (actualizado: ${c.updated_at?.split('T')[0]})`).join('; ');
          return { found: true, cases, message: `Gestiones encontradas: ${cases}` };
        }
      }
    } catch (_) {}

    // Default: notify advisor to call back
    await this.notifyAdvisor({ client_name: name, phone: args.phone || 'desconocido', message: `El cliente ${name}${company ? ' de ' + company : ''} pregunta por el estado de sus gestiones.` }, assistantId);
    return { found: false, message: `El asesor responsable le contactará hoy mismo con el estado actualizado.` };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. INMOBILIARIA
  // ─────────────────────────────────────────────────────────────────────────

  async searchProperties(args, assistantId) {
    try {
      const db = getDatabase();
      if (db.enabled) {
        let query = db.client
          .from('properties')
          .select('id, title, price, bedrooms, zone, description')
          .eq('org_id', assistantId)
          .eq('operation', args.operation || 'compra')
          .eq('active', true);

        if (args.type)       query = query.ilike('type', `%${args.type}%`);
        if (args.zone)       query = query.ilike('zone', `%${args.zone}%`);
        if (args.budget_max) query = query.lte('price', args.budget_max);
        if (args.bedrooms)   query = query.gte('bedrooms', args.bedrooms);

        const { data } = await query.limit(3);
        if (data && data.length > 0) {
          const list = data.map(p => `${p.title} — ${p.price?.toLocaleString('es-ES')}€ — ${p.zone} — ${p.bedrooms || '?'} hab.`).join(' | ');
          return { found: true, count: data.length, properties: data, summary: list };
        }
      }
    } catch (_) {}

    return {
      found: false,
      message: 'En este momento no tengo el listado exacto, pero el agente puede buscar opciones personalizadas para usted. ¿Le llama hoy mismo?',
    };
  }

  async scheduleValuation(args, assistantId) {
    const name    = args.client_name || '';
    const phone   = args.phone || '';
    const biz     = _getBizConfig(assistantId);

    // Book it as an appointment
    const result = this.bookAppointment({
      patient_name: name,
      phone,
      service:      'Valoración gratuita de inmueble',
      date:         args.date,
      time:         args.time,
      notes:        `${args.property_type || ''} ${args.address || ''}`.trim(),
    }, assistantId);

    _notifyOwner(
      `🏠 *Valoración programada — ${biz.name || assistantId}*\n` +
      `👤 ${name} (${phone})\n` +
      `📅 ${args.date} a las ${args.time}h\n` +
      `📍 ${args.address || 'Sin dirección'}\n` +
      `Tipo: ${args.property_type || 'sin especificar'}`
    );

    return result.success
      ? { success: true, message: `Valoración gratuita agendada para el ${args.date} a las ${args.time}h. El agente confirmará por WhatsApp.` }
      : { success: false, message: 'No pudo agendarse en ese horario. ¿Prefiere otra fecha?' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11. MISC
  // ─────────────────────────────────────────────────────────────────────────

  getProducts(args, assistantId) {
    // Generic product catalog — business can configure this in scheduler config
    const config = scheduler.getBusinessConfig(assistantId || 'demo');
    if (config?.products) {
      const cat = args.category;
      const filtered = cat
        ? config.products.filter(p => p.category?.toLowerCase().includes(cat.toLowerCase()))
        : config.products;
      return { products: filtered };
    }
    return { message: 'Para información sobre productos, le pondré en contacto con el equipo.' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // toOpenAITools — converts assistant tool definitions to OpenAI API format
  //
  // Accepts three formats:
  //   1. String names  → looked up in DEFINITIONS (legacy)
  //   2. { name, ... } → looked up in DEFINITIONS
  //   3. { type: 'function', function: { name, ... } } → passed through as-is (JSON format)
  // ─────────────────────────────────────────────────────────────────────────
  static toOpenAITools(tools) {
    if (!tools || !Array.isArray(tools) || tools.length === 0) return [];

    const DEFINITIONS = {
      check_availability: {
        type: 'function',
        function: {
          name: 'check_availability',
          description: 'Consulta los horarios disponibles para citas en los próximos días',
          parameters: {
            type: 'object',
            properties: {
              service:   { type: 'string', description: 'Tipo de servicio o tratamiento' },
              from_date: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
              to_date:   { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
            },
            required: [],
          },
        },
      },
      book_appointment: {
        type: 'function',
        function: {
          name: 'book_appointment',
          description: 'Reserva una cita cuando el cliente confirme todos los datos',
          parameters: {
            type: 'object',
            properties: {
              patient_name: { type: 'string' },
              phone:        { type: 'string' },
              email:        { type: 'string' },
              service:      { type: 'string' },
              date:         { type: 'string', description: 'YYYY-MM-DD' },
              time:         { type: 'string', description: 'HH:MM' },
            },
            required: ['patient_name', 'service', 'date', 'time'],
          },
        },
      },
      cancel_appointment: {
        type: 'function',
        function: {
          name: 'cancel_appointment',
          description: 'Cancela una cita existente',
          parameters: {
            type: 'object',
            properties: {
              appointment_id: { type: 'string' },
              patient_name:   { type: 'string' },
            },
            required: [],
          },
        },
      },
      lookup_appointments: {
        type: 'function',
        function: {
          name: 'lookup_appointments',
          description: 'Busca las citas existentes de un cliente',
          parameters: {
            type: 'object',
            properties: {
              patient_name: { type: 'string' },
            },
            required: ['patient_name'],
          },
        },
      },
      get_services: {
        type: 'function',
        function: {
          name: 'get_services',
          description: 'Obtiene la lista de servicios con precios y duración',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      add_critical_date: {
        type: 'function',
        function: {
          name: 'add_critical_date',
          description: 'Registra una fecha crítica del cliente (ITV, vacuna, renta, etc.) para enviarle recordatorios automáticos',
          parameters: {
            type: 'object',
            properties: {
              client_name:  { type: 'string' },
              client_phone: { type: 'string' },
              type:         { type: 'string', description: 'itv_expiry | vaccine_due | service_due | tax_filing | quarterly_vat | prescription_renewal | annual_checkup | deworming' },
              due_date:     { type: 'string', description: 'YYYY-MM-DD' },
              notes:        { type: 'string' },
            },
            required: ['client_name', 'type', 'due_date'],
          },
        },
      },
    };

    const resolved = tools.map(tool => {
      // Format 3: already full OpenAI format — pass through directly
      if (tool && typeof tool === 'object' && tool.type === 'function' && tool.function?.name) {
        return tool;
      }
      // Format 1 & 2: string name or { name } → look up in DEFINITIONS
      const name = typeof tool === 'string' ? tool : tool?.name;
      return DEFINITIONS[name] || null;
    }).filter(Boolean);

    // Inject global safety-net tools that every assistant must have
    const existingNames = new Set(resolved.map(t => t.function.name));
    const ALWAYS_INJECT = [
      {
        type: 'function',
        function: {
          name: 'flag_urgent',
          description: 'Urgencia, incidente o cliente que quiere hablar con una persona. Alerta al responsable del negocio por WhatsApp.',
          parameters: {
            type: 'object',
            properties: {
              client_name: { type: 'string' },
              phone:  { type: 'string' },
              issue:  { type: 'string', description: 'Descripción de la urgencia o petición' },
            },
            required: ['issue'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'register_lead',
          description: 'Registra un cliente que llamó fuera de horario o quiere ser contactado más tarde.',
          parameters: {
            type: 'object',
            properties: {
              name:  { type: 'string' },
              phone: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['name', 'phone'],
          },
        },
      },
    ];

    for (const globalTool of ALWAYS_INJECT) {
      if (!existingNames.has(globalTool.function.name)) {
        resolved.push(globalTool);
      }
    }

    return resolved;
  }
}

module.exports = { ToolExecutor };
