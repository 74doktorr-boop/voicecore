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

// ── Disponibilidad real de Google Calendar ────────────────────────────────────
// Caché corta (TTL 45s) por negocio+rango: evita pegar a Google (freebusy) en
// cada consulta durante la llamada de voz. También cachea el "no conectado".
const _calBusyCache = new Map();

// Bloques ocupados del Google Calendar del negocio para [fromDate, toDate].
// Devuelve { 'YYYY-MM-DD': [{startMin,endMin}] }. FAIL-OPEN: {} si el negocio
// no tiene calendario conectado o Google falla — nunca bloquea una reserva.
async function _calendarBusy(businessId, fromDate, toDate) {
  try {
    const cal = getGoogleCalendar();
    if (!cal.enabled) return {};
    const key = `${businessId}:${fromDate}:${toDate}`;
    const hit = _calBusyCache.get(key);
    if (hit && Date.now() - hit.at < 45000) return hit.data;
    const db = getDatabase();
    if (!db.enabled) return {};
    const org = await db.getOrg(businessId);
    if (!org || !org.google_refresh_token) {
      _calBusyCache.set(key, { at: Date.now(), data: {} });   // negativo: no conectado
      return {};
    }
    const fresh = await cal.refreshIfNeeded({
      access_token:  org.google_access_token,
      refresh_token: org.google_refresh_token,
      expiry_date:   org.google_token_expiry,
    });
    const data = await cal.getBusyByDate(fresh, fromDate, toDate, org.google_calendar_id || 'primary');
    _calBusyCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    log.warn(`_calendarBusy failed for ${businessId}: ${e.message}`);
    return {};
  }
}

// ── Push a calendar event after a successful booking (non-blocking) ───────────
// Guarda el id del evento en la cita (google_event_id) para poder BORRARLO si
// luego se cancela (antes el id se tiraba → evento fantasma). El patch del id va
// aislado: si la columna aún no existe (migración sin aplicar) solo falla ese
// patch, no la persistencia del resto de la cita.
async function _syncToCalendar(businessId, appointment) {
  try {
    const { pushAppointmentEvent } = require('../integrations/calendar-sync');
    const eventId = await pushAppointmentEvent(businessId, appointment);
    if (eventId) {
      appointment.googleEventId = eventId;
      try {
        require('../db/appointments-store').appointmentsStore.patch(appointment.id, { googleEventId: eventId });
      } catch (_) {}
    }
  } catch (e) {
    log.warn(`_syncToCalendar failed for ${businessId}: ${e.message}`);
  }
}

// ── Notify the BUSINESS owner via WhatsApp ────────────────────────────────────
// Multi-tenant: alerta al teléfono que el dueño del negocio configuró en su
// portal (alertPhone), usando el WhatsApp del negocio o el número NodeFlow.
// Sólo cae en Callmebot→OWNER_PHONE (Unai) si el negocio no tiene teléfono
// de alerta configurado — así una urgencia llega a QUIEN debe atenderla.
function _notifyOwner(message, businessId = null) {
  // Sin businessId no podemos resolver el negocio → fallback a Callmebot (Unai)
  if (!businessId) {
    try { _wa().sendWhatsApp(message).catch(() => {}); } catch (_) {}
    return;
  }
  setImmediate(async () => {
    try {
      const cfg        = _getBizConfig(businessId);
      const alertPhone = cfg?.automations?.config?.alertPhone || cfg?.alertPhone || cfg?.ownerPhone || null;

      if (alertPhone) {
        // Credenciales WA del negocio (multi-tenant) o número NodeFlow global
        let credentials = null;
        try { credentials = await require('../whatsapp/accounts').getWaCredentials(businessId); } catch (_) {}
        const { sendText, isConfigured } = _clientWA();
        if (credentials || isConfigured()) {
          const r = await sendText(alertPhone, message, credentials);
          if (r?.ok) return;
        }
      }
      // Fallback final: Callmebot a Unai (para que al menos NodeFlow se entere)
      try { _wa().sendWhatsApp(message).catch(() => {}); } catch (_) {}
    } catch (e) {
      log.warn(`_notifyOwner(${businessId}): ${e.message}`);
      try { _wa().sendWhatsApp(message).catch(() => {}); } catch (_) {}
    }
  });
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
      add_to_waitlist:     this.addToWaitlist.bind(this),

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

      // ── Entidades (vehículos, mascotas, pólizas…) ──
      lookup_entity:       this.lookupEntity.bind(this),
      update_entity_date:  this.updateEntityDate.bind(this),
      create_entity_draft: this.createEntityDraft.bind(this),

      // ── Inmobiliaria ──
      search_properties:   this.searchProperties.bind(this),
      schedule_valuation:  this.scheduleValuation.bind(this),

      // ── Misc ──
      get_products:        this.getProducts.bind(this),
      end_call:            this.endCallTool.bind(this),
    };
  }

  // Cuelga la llamada tras la despedida. Bug real (2026-07-03): el asistente
  // se despedía pero la línea quedaba abierta hasta que colgara el cliente
  // (o para siempre, comiéndose STT/€ y dejando filas 'active').
  endCallTool(args, assistantId, context = {}) {
    const session = context.session;
    if (!session) return { success: true, message: 'Llamada finalizada.' };
    if (!session._hangupTimer) {
      session._hangupTimer = setTimeout(() => {
        try { (session.twilioWs || session.vonageWs)?.close(); } catch (_) {}
      }, 8000); // margen para que suene la despedida
      if (session._hangupTimer.unref) session._hangupTimer.unref();
    }
    return { success: true, message: 'Despídete brevemente; la llamada se cerrará sola en unos segundos.' };
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

  async checkAvailability(args, assistantId, context = {}) {
    // Candado de confianza: reservar exige haber consultado disponibilidad
    // en ESTA llamada (ver bookAppointment). Aquí se abre el candado.
    if (context.session) context.session.availabilityChecked = true;
    const businessId  = assistantId || 'demo-clinic';
    const todayMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    const fromDate    = args.from_date || todayMadrid;
    const toDate      = args.to_date || (() => {
      const d = new Date(fromDate); d.setDate(d.getDate() + 5);
      return d.toISOString().split('T')[0];
    })();
    // Disponibilidad REAL: cruza los huecos de NodeFlow con lo ocupado en el
    // Google Calendar del negocio (comida, reunión personal…), para no ofrecer
    // huecos que en realidad no lo están.
    const busyByDate = await _calendarBusy(businessId, fromDate, toDate);
    const result = scheduler.getAvailableSlots(businessId, fromDate, toDate, args.service || null, busyByDate);

    if (result.availableDays) {
      let lang = 'es';
      try { lang = _flowMgr().getLanguage(businessId); } catch (_) {}
      const lbl = {
        morning:   lang === 'eu' ? 'Goizean'       : 'Mañana',
        afternoon: lang === 'eu' ? 'Arratsaldean'  : 'Tarde',
      };
      // Muestra REPARTIDA de huecos (primera, media, última), no solo los 3
      // primeros: la IA ofrecía siempre "9:00, 9:15 o 9:30" y el cliente
      // creía que no había nada más en todo el día (bug real 2026-07-03).
      const spread = (slots) => slots.length <= 3
        ? slots.map(s => s.time)
        : [slots[0], slots[Math.floor(slots.length / 2)], slots[slots.length - 1]].map(s => s.time);
      const summary = result.availableDays.map(day => {
        const morning   = day.slots.filter(s => parseInt(s.time) < 14);
        const afternoon = day.slots.filter(s => parseInt(s.time) >= 14);
        let desc = `${day.dayName} ${day.date}:`;
        if (morning.length   > 0) desc += ` ${lbl.morning} de ${morning[0].time} a ${morning[morning.length-1].endTime} (${morning.length} huecos libres, por ejemplo ${spread(morning).join(', ')})`;
        if (afternoon.length > 0) desc += ` ${lbl.afternoon} de ${afternoon[0].time} a ${afternoon[afternoon.length-1].endTime} (${afternoon.length} huecos libres, por ejemplo ${spread(afternoon).join(', ')})`;
        return desc;
      });
      return { available: result.totalSlots > 0, service: result.service, duration: result.duration, totalSlots: result.totalSlots, days: summary };
    }
    return result;
  }

  async bookAppointment(args, assistantId, context = {}) {
    // ── Capa de confianza (bug real APT-1002, 2026-07-03): la IA reservó un
    // día y hora que el cliente JAMÁS oyó ni aceptó (el transcript no
    // menciona fecha alguna). Dos candados deterministas, server-side:
    if (context.session) {
      // 1. Regla de oro aplicada al tool: sin check_availability en ESTA
      //    llamada no hay reserva — la disponibilidad no se inventa.
      if (!context.session.availabilityChecked) {
        return {
          success: false,
          error: 'RESERVA BLOQUEADA: primero consulta check_availability y di al cliente los huecos reales. Después confirma día y hora con él antes de reservar.',
        };
      }
      // 2. Confirmación explícita: el modelo debe declarar que el cliente
      //    oyó y aceptó día y hora. Sin eso, se le devuelve al paso de
      //    confirmación (menos mágico, infinitamente más fiable).
      if (args.confirmed_with_customer !== true) {
        return {
          success: false,
          error: `RESERVA BLOQUEADA: antes de reservar debes decir al cliente en voz alta el día y la hora ("${args.date || '?'} a las ${args.time || '?'}") y esperar a que acepte. Cuando haya dicho que sí, vuelve a llamar con confirmed_with_customer=true.`,
        };
      }
    }
    const businessId = assistantId || 'demo-clinic';
    // Normalize field names across sectors (patient_name, client_name, owner_name, member_name)
    const name = args.patient_name || args.client_name || args.owner_name || args.member_name || '';
    // La hora llega como la dice el cliente ("a la una y media") — el parser
    // determinista la convierte a HH:MM. Si no se puede interpretar, se pide
    // aclaración en vez de rechazar la reserva con "Hora inválida".
    const { parseSpanishTime } = require('../scheduling/time-parser');
    const normalizedTime = parseSpanishTime(args.time);
    if (!normalizedTime) {
      return {
        success: false,
        error: `No he podido interpretar la hora "${args.time || ''}". Pregunta al cliente la hora concreta (por ejemplo: "a la una y media" o "13:30") y vuelve a intentarlo.`,
      };
    }
    // La FECHA también determinista (los LLM fallan en aritmética de calendario:
    // "el martes" → día equivocado). ISO se valida y pasa; lo hablado se resuelve
    // en Madrid; lo imposible/ambiguo → se pide aclarar, no se reserva a ciegas.
    const { parseSpanishDate } = require('../scheduling/date-parser');
    const todayMadrid = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const normalizedDate = parseSpanishDate(args.date, todayMadrid);
    if (!normalizedDate) {
      return {
        success: false,
        error: `No he podido interpretar la fecha "${args.date || ''}". Pregunta al cliente el día concreto (por ejemplo: "el martes", "mañana" o "el 15") y vuelve a intentarlo.`,
      };
    }
    // "¿Le aviso a este número?" — la promesa es DETERMINISTA: el servidor
    // conoce el número del llamante; el LLM no. Sin esto, TODAS las citas
    // se guardaban con phone null (verificado en prod 2026-07-03) y los
    // recordatorios/WhatsApp no tenían destinatario.
    const callerPhone = context.session?.callerNumber;
    const defaultPhone = (callerPhone && callerPhone !== 'unknown') ? callerPhone : '';
    // Guard final: no reservar sobre un evento del Google Calendar del negocio.
    const busyByDate = await _calendarBusy(businessId, normalizedDate, normalizedDate);
    const result = scheduler.bookAppointment(businessId, {
      patientName: name,
      phone:       args.phone  || defaultPhone,
      email:       args.email  || null,
      service:     args.service || args.treatment || args.activity || args.reason || '',
      date:        normalizedDate,
      time:        normalizedTime,
      notes:       args.notes || args.vehicle || '',
    }, busyByDate[normalizedDate] || []);

    if (result.success && result.appointment && context.session) {
      context.session.bookedAppointment = result.appointment;
      context.session.bookedAppointments = [...(context.session.bookedAppointments || []), result.appointment];
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

  // Lista de servicios+precios REAL del negocio, sellada en la sesión al inicio
  // de la llamada (la trae de BD el voice-pipeline). Fiable y sin coste extra aquí.
  _orgServiceList(context) {
    const sl = context && context.session && context.session.serviceList;
    return (Array.isArray(sl) && sl.length) ? sl : null;
  }

  getServices(args, assistantId, context = {}) {
    const real = this._orgServiceList(context);
    if (real) return { services: real.map(s => ({ name: s.name, price: s.price || 'consultar', duration: s.duration || '', notes: s.notes || '' })) };
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

    if (!phone && !name) return { isFirstCall: true, message: 'Cliente nuevo, sin historial.' };

    // Resolve UUID contact_id from the contacts table (memory is keyed by UUID, not phone)
    let contactId = null;
    try {
      const db = getDatabase();
      if (db.enabled && phone) {
        const normalizedPhone = phone.replace(/[\s\-+()]/g, '').replace(/^0034/, '').replace(/^34(?=\d{9}$)/, '');
        const { data: contact } = await db.client.from('contacts')
          .select('id')
          .eq('org_id', orgId)
          .or(`phone.eq.${normalizedPhone},phone.eq.+34${normalizedPhone},phone.eq.34${normalizedPhone}`)
          .maybeSingle();
        contactId = contact?.id || null;
      }
      // Fallback: name slug (legacy, only works if old-style contactId was used)
      if (!contactId && name) contactId = name.toLowerCase().replace(/\s+/g, '-');
    } catch (_) {
      if (name) contactId = name.toLowerCase().replace(/\s+/g, '-');
    }

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

    _notifyOwner(msg, assistantId);

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

  async addToWaitlist(args, assistantId) {
    const phone = String(args.phone || '').replace(/[\s\-().+]/g, '');
    if (!/^\d{7,15}$/.test(phone)) {
      return { success: false, message: 'Necesito un teléfono válido para apuntarte en la lista de espera.' };
    }
    try {
      const db = getDatabase();
      if (db.enabled && assistantId) {
        await db.client.from('nf_waitlist').insert({
          organization_id: assistantId,
          name:      args.name      ? String(args.name).slice(0, 80)      : null,
          phone,
          service:   args.service   ? String(args.service).slice(0, 80)   : null,
          preferred: args.preferred ? String(args.preferred).slice(0, 80) : null,
        });
      }
    } catch (e) {
      log.warn(`addToWaitlist(${assistantId}): ${e.message}`);
    }
    return { success: true, message: 'Te he apuntado en la lista de espera. En cuanto se libere un hueco que te encaje, te avisamos. ¡Gracias!' };
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

    _notifyOwner(msg, assistantId);
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

    // Fecha y hora deterministas por si el LLM las pasa habladas: ISO/HH:MM se
    // usan tal cual; "el martes"/"a la una" se resuelven. Evita "Invalid Date a
    // las a la unah" en el recordatorio al cliente.
    const { parseSpanishTime } = require('../scheduling/time-parser');
    const { parseSpanishDate } = require('../scheduling/date-parser');
    const todayMadrid = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const nDate = parseSpanishDate(date, todayMadrid) || date;
    const nTime = parseSpanishTime(time) || time;

    // Normalise date for display
    let displayDate = nDate;
    try {
      displayDate = new Date(nDate).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (_) {}

    // Día relativo correcto: no decir "mañana" si la cita no es mañana (antes se
    // hardcodeaba → "mañana tienes cita el jueves 9", contradictorio).
    let tomorrowISO = '';
    try {
      const t = new Date(todayMadrid + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
      tomorrowISO = t.toISOString().slice(0, 10);
    } catch (_) {}
    const rel = nDate === todayMadrid ? 'hoy ' : nDate === tomorrowISO ? 'mañana ' : '';
    const reminderLine = rel
      ? `Te recordamos que ${rel}tienes cita${petName} en nuestro centro:`
      : `Te recordamos tu cita${petName} en nuestro centro:`;

    const text =
      `Hola ${name} 👋\n\n` +
      `${reminderLine}\n\n` +
      `📅 ${displayDate} a las ${nTime}h\n` +
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
      `Servicio: ${service}`,
      assistantId
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
      `Enlace: ${reviewUrl}`,
      assistantId
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

  async registerLead(args, assistantId, context = {}) {
    // DEDUPE por llamada (2026-07-07, llamada real de Unai): el LLM invocó
    // register_lead DOS veces en la misma conversación → lead duplicado y un
    // "he anotado tu solicitud" repetido que suena a robot. Regla determinista
    // fuera del LLM (charter): un lead por llamada; la segunda vez se le dice
    // al modelo que YA está y que responda contenido, no otro acuse.
    if (context.session) {
      if (context.session._leadRegistered) {
        return {
          success: true, already_registered: true,
          message: 'La solicitud YA estaba registrada en esta llamada. NO repitas que la has anotado: responde a lo que el cliente acaba de preguntar.',
        };
      }
      context.session._leadRegistered = true;
    }
    const name  = args.name || args.client_name || '';
    // El teléfono del llamante entra SOLO (caller ID) — jamás pedir email
    // por voz teniendo el mejor canal ya en la mano (llamada real d7adbdb7:
    // seis intentos de dictar un email y el lead casi se pierde).
    const callerPhone = context.session?.callerNumber;
    const phone = args.phone || ((callerPhone && callerPhone !== 'unknown') ? callerPhone : '');
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
      `━━━━━━━━━━━━\nNodeFlow IA`,
      assistantId
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
      `━━━━━━━━━━━━\nNodeFlow IA`,
      assistantId
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
      `Motivo: ${args.reason || 'sin indicar'}`,
      assistantId
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
      `Motivo: ${args.reason || 'sin indicar'}`,
      assistantId
    );

    return { success: true, message: `Baja procesada para ${name}. El equipo lo confirmará por escrito.` };
  }

  getPricing(args, assistantId, context = {}) {
    const real = this._orgServiceList(context);
    if (real) return { pricing: real.map(s => `${s.name}: ${s.price || 'consultar'}${s.duration ? ' (' + s.duration + ')' : ''}`).join(', ') };
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
      (args.notes ? `Notas: ${args.notes}` : ''),
      assistantId
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
  // 9-bis. ENTIDADES v0 — "el Golf de Ane", "la ITV del 1234ABC"
  // Determinista: busca en nf_entities de LA ORG por display_name (trigram)
  // o identificador exacto normalizado (matrícula, chip, nº póliza) y
  // devuelve información compacta para el LLM. NO-OPea con gracia si la
  // feature/tablas no están (respuesta neutra, la conversación sigue).
  // ─────────────────────────────────────────────────────────────────────────

  async lookupEntity(args, assistantId) {
    const query = String(args.query || args.name || args.matricula || '').trim();
    if (!query) return { found: false, message: 'Pregunta el nombre o la matrícula/número para poder buscar la ficha.' };

    try {
      const db = getDatabase();
      const { entitiesFeatureEnabled, entityTablesExist } = require('../entities/entity-types');
      if (!db.enabled || !entitiesFeatureEnabled() || !(await entityTablesExist(db))) {
        return { found: false, message: 'No tengo acceso a las fichas ahora mismo; toma nota y continúa.' };
      }

      const { searchEntities } = require('../entities/entities');
      const matches = await searchEntities({
        orgId: assistantId, q: query,
        typeKey: args.type ? String(args.type) : undefined,
        limit: 3, db,
      });
      if (!matches.length) {
        return { found: false, message: `No encuentro ninguna ficha que coincida con "${query}". Pide otro dato (matrícula completa, nombre exacto).` };
      }

      // Nombre del dueño (si está vinculado) para confirmar identidad en la llamada
      const contactIds = [...new Set(matches.map(m => m.contact_id).filter(Boolean))];
      const owners = {};
      if (contactIds.length) {
        const { data: cs } = await db.client.from('contacts')
          .select('id, name').in('id', contactIds).eq('org_id', assistantId);
        for (const c of (cs || [])) owners[c.id] = c.name || null;
      }

      const lines = matches.map(m => {
        const type   = m._type || { fields: [] };
        const attrs  = m.attrs || {};
        const parts  = [m.display_name];
        const owner  = m.contact_id && owners[m.contact_id];
        if (owner) parts.push(`dueño: ${owner}`);
        // Solo los datos que importan al teléfono: fechas con recordatorio
        for (const f of (type.fields || [])) {
          if (f.type !== 'date' || !attrs[f.key]) continue;
          const fecha = new Date(attrs[f.key] + 'T12:00:00');
          if (!isNaN(fecha.getTime())) parts.push(`${f.label || f.key}: ${fecha.toLocaleDateString('es-ES')}`);
        }
        return parts.join(' — ');
      });

      return {
        found:   true,
        count:   matches.length,
        message: matches.length === 1
          ? `Ficha encontrada: ${lines[0]}`
          : `Hay ${matches.length} fichas que coinciden: ${lines.join(' | ')}. Pide un dato más para distinguirlas.`,
      };
    } catch (e) {
      log.warn(`lookupEntity: ${e.message}`);
      return { found: false, message: 'No puedo consultar las fichas ahora mismo; toma nota y continúa.' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9-ter. ENTIDADES v1 — la IA ESCRIBE en la ficha (con candados)
  // Engineering Charter: las reglas viven en código, no en el LLM.
  //   · update_entity_date → SOLO campos-fecha, validados contra las field
  //     defs del tipo; escribe field_change con actor:'ai' y re-materializa
  //     los avisos de ESA entidad al momento. Jamás borra ni toca texto.
  //   · create_entity_draft → alta de una ficha nueva vinculada al llamante
  //     (caller ID determinista); lo que falte queda como borrador y el
  //     portal enseña «completar ficha».
  // Ambos NO-OPean con gracia si la feature/tablas no están.
  // ─────────────────────────────────────────────────────────────────────────

  // Gate común: BD viva + feature encendida + tablas migradas → tipos de la org.
  async _entityToolGate(assistantId) {
    const db = getDatabase();
    const { entitiesFeatureEnabled, entityTablesExist, getOrgEntityTypes } = require('../entities/entity-types');
    if (!db.enabled || !entitiesFeatureEnabled() || !(await entityTablesExist(db))) return null;
    const types = await getOrgEntityTypes(assistantId, { db });
    return types.length ? { db, types } : null;
  }

  async updateEntityDate(args, assistantId, context = {}) {
    const query = String(args.query || args.entity || '').trim();
    if (!query) return { success: false, message: 'Pregunta el nombre o la matrícula/número de la ficha antes de apuntar la fecha.' };

    try {
      const gate = await this._entityToolGate(assistantId);
      if (!gate) return { success: false, message: 'No tengo acceso a las fichas ahora mismo; toma nota y el equipo lo apuntará.' };
      const { db } = gate;

      // 1) Resolver la entidad — determinista, org-scoped (mismo buscador que lookup_entity)
      const { searchEntities } = require('../entities/entities');
      const matches = await searchEntities({ orgId: assistantId, q: query, typeKey: args.type ? String(args.type) : undefined, limit: 3, db });
      if (!matches.length) {
        return { success: false, message: `No encuentro ninguna ficha que coincida con "${query}". Pide otro dato (matrícula completa, nombre exacto) y vuelve a intentarlo.` };
      }
      if (matches.length > 1) {
        return { success: false, message: `Hay ${matches.length} fichas que coinciden: ${matches.map(m => m.display_name).join(' | ')}. Pide un dato más para distinguirlas antes de apuntar nada.` };
      }
      const entity = matches[0];
      const type   = entity._type;
      if (!type) return { success: false, message: 'No puedo consultar las fichas ahora mismo; toma nota y continúa.' };

      // 2) Resolver el CAMPO — candado: solo campos tipo fecha, jamás otro
      const { resolveDateField, dateFieldLabels, resolveTargetDate } = require('../entities/entity-ai');
      const field = resolveDateField(type.fields || [], args.field);
      if (!field) {
        const labels = dateFieldLabels(type.fields || []);
        return { success: false, message: `No sé a qué fecha te refieres con "${args.field || ''}". Las fechas de esta ficha son: ${labels.join(', ')}. Pregunta cuál quiere actualizar.` };
      }

      // 3) Resolver la FECHA — parser determinista + aritmética en código
      //    ("la pasó hoy y toca en un año" → date:'hoy', plus_years:1)
      const todayMadrid = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
      const target = resolveTargetDate({
        dateRaw:    args.date,
        plusYears:  args.plus_years, plusMonths: args.plus_months, plusDays: args.plus_days,
        todayIso:   todayMadrid,
      });
      if (!target.ok) return { success: false, message: target.error };

      // 4) Escribir — updateEntity valida contra las field defs y registra
      //    el field_change con actor:'ai' (sale en el timeline como 🤖)
      const { updateEntity } = require('../entities/entities');
      const r = await updateEntity({
        orgId: assistantId, entityType: type, entityId: entity.id,
        attrs: { [field.key]: target.iso }, actor: 'ai', db,
      });
      if (!r.ok) {
        return { success: false, message: (r.errors && r.errors[0] && r.errors[0].error) || 'No se pudo guardar la fecha; toma nota y el equipo lo apuntará.' };
      }

      // 5) Re-materializar los avisos de ESTA entidad YA (fuera del hot path
      //    de la llamada: <700ms por turno — charter)
      setImmediate(() => {
        try {
          const { syncEntityRemindersNow } = require('../entities/entity-reminders');
          syncEntityRemindersNow({ orgId: assistantId, entityType: type, entity: r.entity, db }).catch(() => {});
        } catch (_) {}
      });

      const bonita = new Date(target.iso + 'T12:00:00').toLocaleDateString('es-ES');
      return {
        success: true,
        entity:  entity.display_name,
        field:   field.label || field.key,
        date:    target.iso,
        message: `Apuntado: «${field.label || field.key}» de ${entity.display_name} → ${bonita}. El aviso automático se reprograma solo. Confírmaselo al cliente.`,
      };
    } catch (e) {
      log.warn(`updateEntityDate: ${e.message}`);
      return { success: false, message: 'No puedo escribir en las fichas ahora mismo; toma nota y continúa.' };
    }
  }

  async createEntityDraft(args, assistantId, context = {}) {
    try {
      const gate = await this._entityToolGate(assistantId);
      if (!gate) return { success: false, message: 'No tengo acceso a las fichas ahora mismo; toma nota y el equipo la creará.' };
      const { db, types } = gate;

      // Tipo: por key si viene; si la org tiene uno solo (regla v0), ese.
      const type = args.type ? types.find(t => t.key === String(args.type)) : (types.length === 1 ? types[0] : null);
      if (!type) {
        return { success: false, message: `Indica el tipo de ficha (${types.map(t => t.key).join(', ')}) y vuelve a intentarlo.` };
      }

      // Datos que la IA recogió — validateAttrs limpia: claves desconocidas
      // se descartan, tipos/opciones/fechas se validan igual de estrictos.
      const data = (args.data && typeof args.data === 'object' && !Array.isArray(args.data)) ? args.data : {};

      // Dueño = el LLAMANTE, resuelto por caller ID (determinista, jamás
      // preguntar el teléfono teniendo el mejor canal ya en la mano).
      let contactId = null;
      const callerPhone = context.session?.callerNumber;
      if (callerPhone && callerPhone !== 'unknown') {
        try {
          const { phoneVariants } = require('../utils/phone');
          const { data: c } = await db.client.from('contacts')
            .select('id').eq('org_id', assistantId)
            .in('phone', phoneVariants(callerPhone)).limit(1).maybeSingle();
          contactId = c?.id || null;
        } catch (_) {}
      }

      const { createEntityDraft } = require('../entities/entities');
      const r = await createEntityDraft({ orgId: assistantId, entityType: type, attrs: data, contactId, actor: 'ai', db });
      if (!r.ok) {
        return { success: false, message: (r.errors && r.errors[0] && r.errors[0].error) || 'No se pudo crear la ficha; toma nota y el equipo la creará.' };
      }

      // Si trae fechas, sus avisos nacen YA (fuera del hot path)
      setImmediate(() => {
        try {
          const { syncEntityRemindersNow } = require('../entities/entity-reminders');
          syncEntityRemindersNow({ orgId: assistantId, entityType: type, entity: r.entity, db }).catch(() => {});
        } catch (_) {}
      });

      // 📤 AVISAR AL DUEÑO: la IA acaba de abrir una ficha en una llamada — el
      // equipo debe saberlo para completarla en el portal. Alerta interna al
      // dueño (no gasto del cliente) → siempre activa. Fuera del hot path.
      setImmediate(async () => {
        try {
          let quien = 'un cliente';
          if (contactId) {
            const { data: c } = await db.client.from('contacts')
              .select('name, phone').eq('id', contactId).eq('org_id', assistantId).maybeSingle();
            quien = (c && (c.name || c.phone)) || quien;
          } else if (callerPhone && callerPhone !== 'unknown') {
            quien = callerPhone;
          }
          _notifyOwner(
            `🗂️ *Ficha creada en una llamada*\n` +
            `La IA ha creado una ficha: *${r.entity.display_name}* de ${quien}.\n` +
            `Complétala en el portal → Entidades.`,
            assistantId
          );
        } catch (_) {}
      });

      return {
        success: true,
        entity:  r.entity.display_name,
        draft:   !!r.isDraft,
        linked_to_caller: !!contactId,
        message: `${type.label_singular} «${r.entity.display_name}» creado${contactId ? ' y vinculado al cliente' : ''}${r.isDraft ? ' como borrador (el equipo completará el resto de datos)' : ''}. Confírmaselo al cliente.`,
      };
    } catch (e) {
      log.warn(`createEntityDraft: ${e.message}`);
      return { success: false, message: 'No puedo crear fichas ahora mismo; toma nota y continúa.' };
    }
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
    const result = await this.bookAppointment({
      patient_name: name,
      phone,
      service:      'Valoración gratuita de inmueble',
      date:         args.date,
      time:         args.time,
      notes:        `${args.property_type || ''} ${args.address || ''}`.trim(),
    }, assistantId);

    // Solo avisar al dueño si REALMENTE se agendó (antes se avisaba aunque la
    // reserva fallara). Y usar la fecha/hora NORMALIZADAS de la cita (no el crudo
    // del LLM), para que no salga "el martes a las a la unah".
    if (!result.success) {
      return { success: false, message: 'No pudo agendarse en ese horario. ¿Prefiere otra fecha?' };
    }
    const appt = result.appointment || {};
    const whenDate = appt.date || args.date;
    const whenTime = appt.time || args.time;

    _notifyOwner(
      `🏠 *Valoración programada — ${biz.name || assistantId}*\n` +
      `👤 ${name} (${phone})\n` +
      `📅 ${whenDate} a las ${whenTime}h\n` +
      `📍 ${args.address || 'Sin dirección'}\n` +
      `Tipo: ${args.property_type || 'sin especificar'}`,
      assistantId
    );

    return { success: true, message: `Valoración gratuita agendada para el ${whenDate} a las ${whenTime}h. El agente confirmará por WhatsApp.` };
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
          description: 'Reserva una cita. SOLO cuando hayas dicho al cliente en voz alta el día y la hora exactos y el cliente haya ACEPTADO explícitamente. Jamás reserves un día u hora que el cliente no haya oído y confirmado.',
          parameters: {
            type: 'object',
            properties: {
              patient_name: { type: 'string' },
              phone:        { type: 'string' },
              email:        { type: 'string' },
              service:      { type: 'string' },
              date:         { type: 'string', description: 'YYYY-MM-DD' },
              time:         { type: 'string', description: 'HH:MM' },
              confirmed_with_customer: { type: 'boolean', description: 'true SOLO si has dicho al cliente el día y la hora exactos y ha respondido que sí. Si no ha confirmado, NO llames a esta función: pregunta primero.' },
            },
            required: ['patient_name', 'service', 'date', 'time', 'confirmed_with_customer'],
          },
        },
      },
      register_lead: {
        type: 'function',
        function: {
          name: 'register_lead',
          description: 'Registra a un interesado para que el equipo le llame. Úsalo SIEMPRE que alguien pida información, presupuesto o que le contacten. El teléfono del llamante se añade solo — no hace falta pedirlo.',
          parameters: {
            type: 'object',
            properties: {
              name:  { type: 'string', description: 'Nombre del interesado' },
              need:  { type: 'string', description: 'Qué necesita o le interesa, con sus palabras' },
              notes: { type: 'string', description: 'Detalles útiles adicionales' },
              urgency: { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['name', 'need'],
          },
        },
      },
      end_call: {
        type: 'function',
        function: {
          name: 'end_call',
          description: 'Cuelga la llamada. Úsalo SOLO cuando la conversación haya terminado: el cliente se ha despedido, ha dicho que no necesita nada más, o pide colgar. Despídete tú brevemente al usarlo.',
          parameters: { type: 'object', properties: {}, required: [] },
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
      lookup_entity: {
        type: 'function',
        function: {
          name: 'lookup_entity',
          description: 'Busca la ficha de una COSA del cliente (su vehículo, mascota, póliza, expediente…) por nombre o identificador (matrícula, nº de chip, nº de póliza). Úsalo cuando pregunten por fechas como la ITV, la próxima vacuna o una renovación.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Lo que ha dicho el cliente: matrícula, nombre de la mascota, nº de póliza… (ej: "1234ABC", "Luna")' },
              type:  { type: 'string', description: 'Opcional: tipo de ficha (vehiculo, mascota, poliza, expediente…) si está claro por contexto' },
            },
            required: ['query'],
          },
        },
      },
      update_entity_date: {
        type: 'function',
        function: {
          name: 'update_entity_date',
          description: 'Apunta o actualiza UNA FECHA en la ficha de una cosa del cliente (vehículo, mascota, póliza, bono…). Úsalo cuando el cliente diga que algo ya se hizo o cuándo toca lo próximo ("pasó la ITV hoy", "la vacuna es el 15 de marzo"). Si algo se hizo HOY y lo próximo toca en X tiempo, pasa date="hoy" y plus_years/plus_months — el sistema calcula la fecha, tú no hagas cuentas. Solo puede tocar fechas, nada más.',
          parameters: {
            type: 'object',
            properties: {
              query:       { type: 'string', description: 'Cómo identificar la ficha: matrícula, nombre de la mascota, nº de póliza… (ej: "1234ABC", "Luna")' },
              field:       { type: 'string', description: 'Qué fecha: como la diga el cliente ("itv", "próxima vacuna", "renovación")' },
              date:        { type: 'string', description: 'La fecha base, tal cual se dijo: "hoy", "el 15 de marzo", "2027-03-15"' },
              plus_years:  { type: 'number', description: 'Años a SUMAR a la fecha base (ej: pasó la ITV hoy y la próxima es en 1 año → date="hoy", plus_years=1)' },
              plus_months: { type: 'number', description: 'Meses a sumar a la fecha base' },
              plus_days:   { type: 'number', description: 'Días a sumar a la fecha base' },
            },
            required: ['query', 'field', 'date'],
          },
        },
      },
      create_entity_draft: {
        type: 'function',
        function: {
          name: 'create_entity_draft',
          description: 'Crea la ficha de una cosa NUEVA que menciona el cliente (un coche que no está registrado, una mascota nueva, una póliza…). Se vincula sola al teléfono del llamante. Pasa en data lo que hayas recogido en la conversación; lo que falte no importa — quedará como borrador para que el equipo lo complete. No pidas datos de más: con lo dicho basta.',
          parameters: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Tipo de ficha si hay varios (vehiculo, mascota…). Con un solo tipo en el negocio, omítelo.' },
              data: {
                type: 'object',
                description: 'Los datos recogidos, con claves en snake_case (ej: {"matricula":"1234ABC","marca":"Seat"} o {"nombre":"Luna","especie":"gato"}). Solo lo que el cliente haya dicho.',
              },
            },
            required: ['data'],
          },
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

// _notifyOwner se exporta para la red de seguridad de leads (aviso al dueño
// con las mismas credenciales multi-tenant que usa register_lead).
module.exports = { ToolExecutor, _notifyOwner, syncAppointmentToCalendar: _syncToCalendar, calendarBusyByDate: _calendarBusy };
