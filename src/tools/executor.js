// ============================================
// VoiceCore — Tool Executor
// Handles function calls from LLM and connects
// to scheduling system and external services
// ============================================

const { scheduler }          = require('../scheduling/scheduler');
const { Logger }             = require('../utils/logger');
const { getGoogleCalendar }  = require('../integrations/google-calendar');
const { getDatabase }        = require('../db/database');
const log = new Logger('TOOLS');

// Push a calendar event after a successful booking (non-blocking, best-effort)
async function _syncToCalendar(businessId, appointment) {
  try {
    const db  = getDatabase();
    const cal = getGoogleCalendar();
    if (!db.enabled || !cal.enabled) return;

    const org = await db.getOrg(businessId);
    if (!org?.google_refresh_token) return; // org hasn't connected Calendar

    const freshTokens = await cal.refreshIfNeeded({
      access_token:  org.google_access_token,
      refresh_token: org.google_refresh_token,
      expiry_date:   org.google_token_expiry,
    });

    // Persist refreshed token if it changed
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

class ToolExecutor {
  constructor() {
    this.handlers = {
      check_availability: this.checkAvailability.bind(this),
      book_appointment: this.bookAppointment.bind(this),
      cancel_appointment: this.cancelAppointment.bind(this),
      lookup_appointments: this.lookupAppointments.bind(this),
      get_services: this.getServices.bind(this),
    };
  }

  async execute(functionName, args, assistantId) {
    const handler = this.handlers[functionName];
    if (!handler) {
      log.warn(`Unknown tool: ${functionName}`);
      return { error: `Tool "${functionName}" not available.` };
    }
    log.info(`Executing: ${functionName}`, args);
    try {
      const result = await handler(args, assistantId);
      log.info(`Result: ${functionName}`, result);
      return result;
    } catch (err) {
      log.error(`Error: ${functionName} - ${err.message}`);
      return { error: err.message };
    }
  }

  checkAvailability(args, assistantId) {
    const businessId = assistantId || 'demo-clinic';
    // BUG-47 follow-up: use Madrid date for default, not UTC date which can be a day off
    const todayMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    const fromDate   = args.from_date || todayMadrid;
    const toDate     = args.to_date || (() => { const d = new Date(fromDate); d.setDate(d.getDate() + 5); return d.toISOString().split('T')[0]; })();
    const result     = scheduler.getAvailableSlots(businessId, fromDate, toDate, args.service || null);

    if (result.availableDays) {
      // Determine language for morning/afternoon labels
      let lang = 'es';
      try { const { flowManager } = require('../automations/flow-manager'); lang = flowManager.getLanguage(businessId); } catch(_) {}
      const lbl = {
        morning:   lang === 'eu' ? 'Goizean'   : lang === 'gl' ? 'Mañá'  : 'Mañana',
        afternoon: lang === 'eu' ? 'Arratsaldean' : lang === 'gl' ? 'Tarde' : 'Tarde',
        first:     lang === 'eu' ? 'Lehenak'   : lang === 'gl' ? 'Primeiras' : 'Primeras',
      };

      const summary = result.availableDays.map(day => {
        const morning   = day.slots.filter(s => parseInt(s.time) < 14);
        const afternoon = day.slots.filter(s => parseInt(s.time) >= 14);
        let desc = `${day.dayName} ${day.date}:`;
        if (morning.length   > 0) desc += ` ${lbl.morning} ${morning[0].time}-${morning[morning.length-1].endTime} (${morning.length} huecos)`;
        if (afternoon.length > 0) desc += ` ${lbl.afternoon} ${afternoon[0].time}-${afternoon[afternoon.length-1].endTime} (${afternoon.length} huecos)`;
        desc += ` ${lbl.first}: ${day.slots.slice(0, 4).map(s => s.time).join(', ')}`;
        return desc;
      });
      return { available: result.totalSlots > 0, service: result.service, duration: result.duration, totalSlots: result.totalSlots, days: summary };
    }
    return result;
  }

  bookAppointment(args, assistantId) {
    const businessId = assistantId || 'demo-clinic';
    const result = scheduler.bookAppointment(businessId, {
      patientName: args.patient_name,
      phone:       args.phone  || '',
      email:       args.email  || null,
      service:     args.service,
      date:        args.date,
      time:        args.time,
    });
    // Best-effort Google Calendar sync (non-blocking)
    if (result.success && result.appointment) {
      _syncToCalendar(businessId, result.appointment).catch(() => {});
    }
    return result;
  }

  cancelAppointment(args, assistantId) {
    // BUG-39 follow-up: pass businessId so cancelAppointment scopes the search correctly
    const businessId = assistantId || null;
    return scheduler.cancelAppointment(args.appointment_id || '', args.patient_name || '', businessId);
  }

  lookupAppointments(args) {
    return scheduler.lookupAppointments(args.patient_name);
  }

  getServices(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo-clinic');
    if (!config) return { error: 'Business not configured' };
    return { services: config.services.map(s => ({ name: s.name, duration: `${s.duration} min`, price: s.price > 0 ? `${s.price}EUR` : 'Gratuita' })) };
  }

  /**
   * Convert assistant tool names to OpenAI function-calling format
   * Called as ToolExecutor.toOpenAITools(assistant.tools)
   */
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
              service:   { type: 'string', description: 'Tipo de servicio o tratamiento solicitado' },
              from_date: { type: 'string', description: 'Fecha inicio búsqueda (YYYY-MM-DD)' },
              to_date:   { type: 'string', description: 'Fecha fin búsqueda (YYYY-MM-DD)' },
            },
            required: [],
          },
        },
      },
      book_appointment: {
        type: 'function',
        function: {
          name: 'book_appointment',
          description: 'Reserva una cita para el paciente en el horario indicado',
          parameters: {
            type: 'object',
            properties: {
              patient_name: { type: 'string', description: 'Nombre completo del paciente' },
              phone:        { type: 'string', description: 'Teléfono de contacto del paciente' },
              email:        { type: 'string', description: 'Email del paciente para enviarle recordatorio (opcional)' },
              service:      { type: 'string', description: 'Tipo de servicio a reservar' },
              date:         { type: 'string', description: 'Fecha de la cita (YYYY-MM-DD)' },
              time:         { type: 'string', description: 'Hora de la cita (HH:MM)' },
            },
            required: ['patient_name', 'service', 'date', 'time'],
          },
        },
      },
      cancel_appointment: {
        type: 'function',
        function: {
          name: 'cancel_appointment',
          description: 'Cancela una cita existente del paciente',
          parameters: {
            type: 'object',
            properties: {
              appointment_id: { type: 'string', description: 'ID de la cita a cancelar' },
              patient_name:   { type: 'string', description: 'Nombre del paciente' },
            },
            required: [],
          },
        },
      },
      lookup_appointments: {
        type: 'function',
        function: {
          name: 'lookup_appointments',
          description: 'Busca las citas existentes de un paciente',
          parameters: {
            type: 'object',
            properties: {
              patient_name: { type: 'string', description: 'Nombre del paciente a buscar' },
            },
            required: ['patient_name'],
          },
        },
      },
      get_services: {
        type: 'function',
        function: {
          name: 'get_services',
          description: 'Obtiene la lista de servicios disponibles con precios y duración',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
    };

    return tools
      .map(tool => {
        const name = typeof tool === 'string' ? tool : tool?.name;
        return DEFINITIONS[name] || null;
      })
      .filter(Boolean);
  }
}

module.exports = { ToolExecutor };
