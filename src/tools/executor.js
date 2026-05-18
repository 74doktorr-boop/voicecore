// ============================================
// VoiceCore — Tool Executor
// Handles function calls from LLM and connects
// to scheduling system and external services
// ============================================

const { scheduler } = require('../scheduling/scheduler');
const { Logger } = require('../utils/logger');
const log = new Logger('TOOLS');

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
    const fromDate = args.from_date || new Date().toISOString().split('T')[0];
    const toDate = args.to_date || (() => { const d = new Date(fromDate); d.setDate(d.getDate() + 5); return d.toISOString().split('T')[0]; })();
    const result = scheduler.getAvailableSlots(businessId, fromDate, toDate, args.service || null);
    if (result.availableDays) {
      const summary = result.availableDays.map(day => {
        const morning = day.slots.filter(s => parseInt(s.time) < 14);
        const afternoon = day.slots.filter(s => parseInt(s.time) >= 14);
        let desc = `${day.dayName} ${day.date}:`;
        if (morning.length > 0) desc += ` Manana ${morning[0].time}-${morning[morning.length-1].endTime} (${morning.length} huecos)`;
        if (afternoon.length > 0) desc += ` Tarde ${afternoon[0].time}-${afternoon[afternoon.length-1].endTime} (${afternoon.length} huecos)`;
        const best = day.slots.slice(0,4).map(s => s.time);
        desc += ` Primeras: ${best.join(', ')}`;
        return desc;
      });
      return { available: result.totalSlots > 0, service: result.service, duration: result.duration, totalSlots: result.totalSlots, days: summary };
    }
    return result;
  }

  bookAppointment(args, assistantId) {
    return scheduler.bookAppointment(assistantId || 'demo-clinic', {
      patientName: args.patient_name, phone: args.phone || '', service: args.service, date: args.date, time: args.time
    });
  }

  cancelAppointment(args) {
    return scheduler.cancelAppointment(args.appointment_id || '', args.patient_name || '');
  }

  lookupAppointments(args) {
    return scheduler.lookupAppointments(args.patient_name);
  }

  getServices(args, assistantId) {
    const config = scheduler.getBusinessConfig(assistantId || 'demo-clinic');
    if (!config) return { error: 'Business not configured' };
    return { services: config.services.map(s => ({ name: s.name, duration: `${s.duration} min`, price: s.price > 0 ? `${s.price}EUR` : 'Gratuita' })) };
  }
}

module.exports = { ToolExecutor };
