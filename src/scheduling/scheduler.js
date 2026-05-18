// ============================================
// VoiceCore — Scheduling System
// In-memory appointment manager with availability,
// booking, and cancellation support
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('SCHEDULER');

class SchedulingSystem {
  constructor() {
    // In-memory store (replace with DB in production)
    this.appointments = new Map(); // id -> appointment
    this.nextId = 1000;

    // Default business config (customizable per assistant)
    this.businessConfigs = new Map();

    // Load demo config
    this.setBusinessConfig('demo-clinic', {
      name: 'Clínica Dental Demo',
      timezone: 'Europe/Madrid',
      services: [
        { id: 'revision', name: 'Revisión general', duration: 30, price: 40 },
        { id: 'limpieza', name: 'Limpieza dental', duration: 45, price: 60 },
        { id: 'blanqueamiento', name: 'Blanqueamiento', duration: 60, price: 150 },
        { id: 'empaste', name: 'Empaste', duration: 30, price: 50 },
        { id: 'extraccion', name: 'Extracción', duration: 45, price: 80 },
        { id: 'ortodoncia-consulta', name: 'Consulta ortodoncia', duration: 30, price: 0 },
      ],
      // Weekly schedule: day 0=Sun, 1=Mon...6=Sat
      schedule: {
        1: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
        2: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
        3: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
        4: { open: '09:00', close: '14:00', afternoon_open: '16:00', afternoon_close: '20:00' },
        5: { open: '09:00', close: '14:00' }, // Fridays: morning only
      },
      slotInterval: 10, // minutes between slot starts
    });

    // Seed some demo appointments
    this._seedDemoAppointments();
  }

  setBusinessConfig(businessId, config) {
    this.businessConfigs.set(businessId, config);
  }

  getBusinessConfig(businessId) {
    return this.businessConfigs.get(businessId) || this.businessConfigs.values().next().value;
  }

  // ─── Get available slots for a date range ───
  getAvailableSlots(businessId, fromDate, toDate, serviceId) {
    const config = this.getBusinessConfig(businessId);
    if (!config) return { error: 'Business not configured' };

    const service = config.services.find(s => s.id === serviceId || s.name.toLowerCase().includes((serviceId || '').toLowerCase()));
    const duration = service ? service.duration : 30;

    const from = new Date(fromDate);
    const to = new Date(toDate);
    const slots = [];

    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const daySchedule = config.schedule[dayOfWeek];
      if (!daySchedule) continue; // closed

      const dateStr = d.toISOString().split('T')[0];
      const daySlots = [];

      // Morning slots
      if (daySchedule.open && daySchedule.close) {
        const morningSlots = this._generateSlots(dateStr, daySchedule.open, daySchedule.close, duration, config.slotInterval, businessId);
        daySlots.push(...morningSlots);
      }

      // Afternoon slots
      if (daySchedule.afternoon_open && daySchedule.afternoon_close) {
        const afternoonSlots = this._generateSlots(dateStr, daySchedule.afternoon_open, daySchedule.afternoon_close, duration, config.slotInterval, businessId);
        daySlots.push(...afternoonSlots);
      }

      if (daySlots.length > 0) {
        slots.push({ date: dateStr, dayName: this._getDayName(dayOfWeek), slots: daySlots });
      }
    }

    return {
      businessName: config.name,
      service: service ? service.name : 'General',
      duration,
      availableDays: slots,
      totalSlots: slots.reduce((sum, d) => sum + d.slots.length, 0)
    };
  }

  _generateSlots(dateStr, startTime, endTime, duration, interval, businessId) {
    const slots = [];
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    for (let m = startMinutes; m + duration <= endMinutes; m += interval) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slotEnd = `${String(Math.floor((m + duration) / 60)).padStart(2, '0')}:${String((m + duration) % 60).padStart(2, '0')}`;

      // Check if slot is taken
      const isTaken = this._isSlotTaken(businessId, dateStr, slotStart, duration);
      if (!isTaken) {
        slots.push({ time: slotStart, endTime: slotEnd });
      }
    }
    return slots;
  }

  _isSlotTaken(businessId, date, time, duration) {
    const [h, m] = time.split(':').map(Number);
    const slotStart = h * 60 + m;
    const slotEnd = slotStart + duration;

    for (const [, apt] of this.appointments) {
      if (apt.businessId !== businessId || apt.date !== date || apt.status === 'cancelled') continue;
      const [ah, am] = apt.time.split(':').map(Number);
      const aptStart = ah * 60 + am;
      const aptEnd = aptStart + apt.duration;
      // Check overlap
      if (slotStart < aptEnd && slotEnd > aptStart) return true;
    }
    return false;
  }

  // ─── Book an appointment ───
  bookAppointment(businessId, { patientName, phone, service, date, time }) {
    const config = this.getBusinessConfig(businessId);
    const serviceObj = config?.services.find(s =>
      s.id === service || s.name.toLowerCase().includes((service || '').toLowerCase())
    );

    const id = `APT-${this.nextId++}`;
    const appointment = {
      id,
      businessId,
      patientName,
      phone: phone || '',
      service: serviceObj ? serviceObj.name : service,
      serviceId: serviceObj ? serviceObj.id : service,
      date,
      time,
      duration: serviceObj ? serviceObj.duration : 30,
      price: serviceObj ? serviceObj.price : 0,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    // Verify slot is available
    if (this._isSlotTaken(businessId, date, time, appointment.duration)) {
      return { success: false, error: 'Esa hora ya está ocupada. Por favor elige otra.' };
    }

    this.appointments.set(id, appointment);
    log.info(`Appointment booked: ${id} - ${patientName} on ${date} at ${time}`);

    return {
      success: true,
      appointment: {
        id,
        patientName,
        service: appointment.service,
        date,
        time,
        endTime: this._addMinutes(time, appointment.duration),
        duration: appointment.duration,
        price: appointment.price
      }
    };
  }

  // ─── Cancel an appointment ───
  cancelAppointment(appointmentId, patientName) {
    // Search by ID or by patient name
    let apt = this.appointments.get(appointmentId);

    if (!apt && patientName) {
      // Search by name
      for (const [, a] of this.appointments) {
        if (a.patientName.toLowerCase().includes(patientName.toLowerCase()) && a.status !== 'cancelled') {
          apt = a;
          break;
        }
      }
    }

    if (!apt) return { success: false, error: 'No se ha encontrado ninguna cita con esos datos.' };
    if (apt.status === 'cancelled') return { success: false, error: 'Esa cita ya estaba cancelada.' };

    apt.status = 'cancelled';
    log.info(`Appointment cancelled: ${apt.id} - ${apt.patientName}`);

    return {
      success: true,
      message: `Cita cancelada correctamente.`,
      appointment: { id: apt.id, patientName: apt.patientName, date: apt.date, time: apt.time, service: apt.service }
    };
  }

  // ─── Look up appointments by patient ───
  lookupAppointments(patientName) {
    const results = [];
    for (const [, apt] of this.appointments) {
      if (apt.patientName.toLowerCase().includes(patientName.toLowerCase()) && apt.status !== 'cancelled') {
        results.push({ id: apt.id, date: apt.date, time: apt.time, service: apt.service, status: apt.status });
      }
    }
    return results.length > 0
      ? { found: true, appointments: results }
      : { found: false, message: 'No se han encontrado citas a ese nombre.' };
  }

  // ─── Helpers ───
  _getDayName(day) {
    return ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][day];
  }

  _addMinutes(time, mins) {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + mins;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  _seedDemoAppointments() {
    // Add a few demo appointments for today and tomorrow
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);

    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const dayAfterStr = dayAfter.toISOString().split('T')[0];

    // Some booked slots
    this.bookAppointment('demo-clinic', { patientName: 'Ana García', phone: '666111222', service: 'revisión', date: tomorrowStr, time: '10:00' });
    this.bookAppointment('demo-clinic', { patientName: 'Carlos López', phone: '666333444', service: 'limpieza', date: tomorrowStr, time: '11:00' });
    this.bookAppointment('demo-clinic', { patientName: 'Elena Martín', phone: '666555666', service: 'empaste', date: dayAfterStr, time: '09:30' });

    log.info(`Seeded ${this.appointments.size} demo appointments`);
  }
}

// Singleton
const scheduler = new SchedulingSystem();
module.exports = { scheduler, SchedulingSystem };
