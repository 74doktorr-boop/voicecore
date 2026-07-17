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

    // ─── Lumina Centro de Estética ───
    this.setBusinessConfig('lumina-estetica', {
      name: 'Lumina Centro de Estética',
      timezone: 'Europe/Madrid',
      services: [
        // Depilación láser
        { id: 'laser-piernas',       name: 'Depilación láser piernas completas',    duration: 90,  price: 89  },
        { id: 'laser-piernas-medias',name: 'Depilación láser piernas medias',       duration: 45,  price: 55  },
        { id: 'laser-axilas',        name: 'Depilación láser axilas',               duration: 20,  price: 29  },
        { id: 'laser-bikini',        name: 'Depilación láser bikini clásica',       duration: 25,  price: 35  },
        { id: 'laser-bikini-full',   name: 'Depilación láser bikini completa',      duration: 35,  price: 55  },
        { id: 'laser-labio',         name: 'Depilación láser labio superior',       duration: 15,  price: 19  },
        { id: 'laser-combo',         name: 'Combo láser piernas+axilas+bikini',     duration: 115, price: 169 },
        // Faciales
        { id: 'facial-limpieza',     name: 'Limpieza facial profunda',              duration: 60,  price: 45  },
        { id: 'facial-hidratacion',  name: 'Hidratación profunda',                  duration: 60,  price: 65  },
        { id: 'facial-antiedad',     name: 'Tratamiento anti-edad radiofrecuencia', duration: 75,  price: 95  },
        { id: 'facial-peeling',      name: 'Peeling químico',                       duration: 45,  price: 55  },
        { id: 'facial-mesoterapia',  name: 'Mesoterapia facial sin agujas',         duration: 60,  price: 75  },
        // Corporales
        { id: 'masaje-relajante',    name: 'Masaje relajante aromaterapia',         duration: 60,  price: 55  },
        { id: 'masaje-deportivo',    name: 'Masaje deportivo descontracturante',    duration: 60,  price: 65  },
        { id: 'drenaje',             name: 'Drenaje linfático manual',              duration: 60,  price: 60  },
        { id: 'reductor',            name: 'Tratamiento reductor ultrasonidos',     duration: 60,  price: 75  },
        { id: 'envoltura',           name: 'Envoltura reafirmante algas',           duration: 60,  price: 70  },
        // Manos y pies
        { id: 'manicura',            name: 'Manicura clásica',                      duration: 30,  price: 18  },
        { id: 'manicura-semi',       name: 'Manicura semipermanente',               duration: 45,  price: 28  },
        { id: 'pedicura',            name: 'Pedicura completa',                     duration: 60,  price: 30  },
        { id: 'unas-gel',            name: 'Uñas de gel construcción',              duration: 75,  price: 45  },
        { id: 'combo-mani-pedi',     name: 'Combo manicura semi + pedicura',        duration: 90,  price: 50  },
        // Pestañas y cejas
        { id: 'lifting-pestanas',    name: 'Lifting de pestañas + tinte',           duration: 60,  price: 45  },
        { id: 'extensiones',         name: 'Extensiones pestañas pelo a pelo',      duration: 120, price: 85  },
        { id: 'extensiones-relleno', name: 'Relleno extensiones pestañas',          duration: 45,  price: 45  },
        { id: 'laminado-cejas',      name: 'Laminado de cejas + tinte',             duration: 50,  price: 38  },
        { id: 'cejas-hilo',          name: 'Depilación cejas con hilo',             duration: 15,  price: 12  },
      ],
      schedule: {
        1: { open: '09:00', close: '14:00' }, // Lunes: solo mañana
        2: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' },
        3: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' },
        4: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' },
        5: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '20:00' },
        6: { open: '09:00', close: '14:00' }, // Sábado: solo mañana
      },
      slotInterval: 15,
    });

    // BUG-40 FIX: Only seed demo data in development — never in production
    if (process.env.NODE_ENV !== 'production') {
      this._seedDemoAppointments();
      this._seedLuminaAppointments();
    }
  }

  setBusinessConfig(businessId, config) {
    this.businessConfigs.set(businessId, config);
  }

  getBusinessConfig(businessId) {
    // Return exact match, or null in production — never silently fall back to
    // a random business config. Demo IDs fall through to the first demo config.
    const exact = this.businessConfigs.get(businessId);
    if (exact) return exact;
    // Allow demo fallback only for known demo/test IDs
    const isDemoId = !businessId || businessId.startsWith('demo') || businessId === 'lumina-estetica';
    return isDemoId ? this.businessConfigs.values().next().value : null;
  }

  // ─── Get available slots for a date range ───
  // busyByDate: { 'YYYY-MM-DD': [{startMin,endMin}] } de bloques ocupados
  // EXTERNOS (p.ej. Google Calendar). Por defecto {} → comportamiento idéntico.
  // location (multi-sede): huecos del CENTRO indicado — las citas de otros
  // centros no restan disponibilidad. null → todos (comportamiento clásico).
  getAvailableSlots(businessId, fromDate, toDate, serviceId, busyByDate = {}, location = null) {
    const config = this.getBusinessConfig(businessId);
    if (!config) return { error: 'Business not configured' };
    // Never show slots in the past — clamp fromDate to today
    // BUG-47 FIX: Use Madrid timezone — UTC date can be one day off at midnight
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (fromDate < todayStr) fromDate = todayStr;

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

      const extraBusy = busyByDate[dateStr] || [];

      // Morning slots
      if (daySchedule.open && daySchedule.close) {
        const morningSlots = this._generateSlots(dateStr, daySchedule.open, daySchedule.close, duration, config.slotInterval, businessId, extraBusy, location);
        daySlots.push(...morningSlots);
      }

      // Afternoon slots
      if (daySchedule.afternoon_open && daySchedule.afternoon_close) {
        const afternoonSlots = this._generateSlots(dateStr, daySchedule.afternoon_open, daySchedule.afternoon_close, duration, config.slotInterval, businessId, extraBusy, location);
        daySlots.push(...afternoonSlots);
      }

      // Filter out past time slots for today.
      // BUG-47 follow-up: use Madrid clock, not server UTC, for the now comparison.
      const filteredSlots = dateStr === todayStr
        ? (() => {
            const madridNow = new Intl.DateTimeFormat('sv-SE', {
              timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
            }).format(new Date());
            const [nowH, nowM] = madridNow.split(':').map(Number);
            const nowMinutes = nowH * 60 + nowM;
            return daySlots.filter(s => {
              const [sh, sm] = s.time.split(':').map(Number);
              return sh * 60 + sm > nowMinutes + 30; // 30 min buffer
            });
          })()
        : daySlots;

      if (filteredSlots.length > 0) {
        slots.push({ date: dateStr, dayName: this._getDayName(dayOfWeek), slots: filteredSlots });
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

  _generateSlots(dateStr, startTime, endTime, duration, interval, businessId, extraBusy = [], location = null) {
    const slots = [];
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    for (let m = startMinutes; m + duration <= endMinutes; m += interval) {
      const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slotEnd = `${String(Math.floor((m + duration) / 60)).padStart(2, '0')}:${String((m + duration) % 60).padStart(2, '0')}`;

      // Check if slot is taken
      const isTaken = this._isSlotTaken(businessId, dateStr, slotStart, duration, extraBusy, location);
      if (!isTaken) {
        slots.push({ time: slotStart, endTime: slotEnd });
      }
    }
    return slots;
  }

  // extraBusy: bloques ocupados EXTERNOS (Google Calendar) para esta fecha,
  // en minutos del día [{startMin,endMin}]. Por defecto [] → sin cambios.
  // location: MULTI-SEDE — si se indica, las citas de OTRO centro no bloquean
  // este hueco (que Tolosa esté llena no cierra Villabona). Las citas SIN
  // centro (legado / mono-sede) bloquean siempre, por prudencia. Sin location
  // → comportamiento idéntico al de siempre (cero cambios para orgs sin centros).
  // excludeId: id de una cita que NO cuenta como conflicto (para reprogramar
  // sin que la cita choque consigo misma). null → cuenta todas.
  _isSlotTaken(businessId, date, time, duration, extraBusy = [], location = null, excludeId = null) {
    const [h, m] = time.split(':').map(Number);
    const slotStart = h * 60 + m;
    const slotEnd = slotStart + duration;

    for (const [, apt] of this.appointments) {
      if (apt.businessId !== businessId || apt.date !== date || apt.status === 'cancelled') continue;
      if (excludeId && apt.id === excludeId) continue; // no chocar consigo misma
      if (location && apt.location && apt.location !== location) continue; // otro centro no bloquea
      const [ah, am] = apt.time.split(':').map(Number);
      const aptStart = ah * 60 + am;
      const aptEnd = aptStart + apt.duration;
      // Check overlap
      if (slotStart < aptEnd && slotEnd > aptStart) return true;
    }
    // Solapes con eventos externos (Google Calendar del negocio)
    for (const b of extraBusy) {
      if (slotStart < b.endMin && slotEnd > b.startMin) return true;
    }
    return false;
  }

  // ─── Book an appointment ───
  // location (multi-sede): centro donde es la cita. Solo llega cuando la org
  // tiene centros configurados; sin él, todo funciona exactamente como antes.
  bookAppointment(businessId, { patientName, phone, email, service, date, time, notes, location }, extraBusy = [], opts = {}) {
    const config = this.getBusinessConfig(businessId);
    const serviceObj = config?.services.find(s =>
      s.id === service || s.name.toLowerCase().includes((service || '').toLowerCase())
    );

    // ── Validación de fecha y hora (la LLM puede pasar valores inválidos) ──────
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return { success: false, error: 'Fecha inválida. Usa el formato AAAA-MM-DD.' };
    }
    if (!/^\d{1,2}:\d{2}$/.test(time || '')) {
      return { success: false, error: 'Hora inválida. Usa el formato HH:MM.' };
    }
    // Fecha real (rechaza 2026-13-45) y no pasada
    const [yy, mm, dd] = date.split('-').map(Number);
    const dateObj = new Date(yy, mm - 1, dd);
    if (dateObj.getFullYear() !== yy || dateObj.getMonth() !== mm - 1 || dateObj.getDate() !== dd) {
      return { success: false, error: 'Esa fecha no existe. Por favor indica otra.' };
    }
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (date < todayStr) {
      return { success: false, error: 'No se pueden reservar citas en fechas pasadas.' };
    }
    // Dentro del horario del negocio (si hay horario configurado para ese día)
    // Los errores incluyen QUÉ días/horas SÍ — la IA los lee en voz alta y
    // ofrece alternativas reales en vez de un "elige otro" a ciegas.
    const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const daySchedule = config?.schedule?.[dateObj.getDay()];
    if (config?.schedule && !daySchedule) {
      const openDays = Object.keys(config.schedule).map(Number).sort()
        .map(d => DAY_NAMES[d]).join(', ');
      return {
        success: false,
        error: `El ${DAY_NAMES[dateObj.getDay()]} el negocio está CERRADO. Días de apertura: ${openDays}. Ofrece al cliente uno de esos días (verifica huecos con check_availability).`,
      };
    }
    if (daySchedule) {
      const t = time.padStart(5, '0');
      const inMorning   = daySchedule.open && daySchedule.close &&
                          t >= daySchedule.open && t < daySchedule.close;
      const inAfternoon = daySchedule.afternoon_open && daySchedule.afternoon_close &&
                          t >= daySchedule.afternoon_open && t < daySchedule.afternoon_close;
      if (!inMorning && !inAfternoon) {
        const franjas = [
          daySchedule.open && daySchedule.close ? `${daySchedule.open}-${daySchedule.close}` : null,
          daySchedule.afternoon_open && daySchedule.afternoon_close ? `${daySchedule.afternoon_open}-${daySchedule.afternoon_close}` : null,
        ].filter(Boolean).join(' y ');
        return {
          success: false,
          error: `Esa hora está fuera del horario del ${DAY_NAMES[dateObj.getDay()]} (${franjas || 'sin franjas'}). Ofrece una hora dentro de ese horario.`,
        };
      }
    }

    const id = `APT-${this.nextId++}`;
    const appointment = {
      id,
      businessId,
      patientName,
      phone: phone || '',
      email: email || null,
      service: serviceObj ? serviceObj.name : service,
      serviceId: serviceObj ? serviceObj.id : service,
      date,
      time,
      duration: serviceObj ? serviceObj.duration : 30,
      price: serviceObj ? serviceObj.price : 0,
      notes: notes || null,
      location: location || null,   // multi-sede: centro de la cita
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    // Verify slot is available (incluye eventos externos de Google Calendar).
    // Con centro: solo bloquean las citas de ESE centro (o sin centro).
    if (this._isSlotTaken(businessId, date, time, appointment.duration, extraBusy, location || null)) {
      return { success: false, error: `Esa hora ya está ocupada${location ? ' en ' + location : ''}. Por favor elige otra.` };
    }

    this.appointments.set(id, appointment);
    log.info(`Appointment booked: ${id} - ${patientName} on ${date} at ${time}`);

    // Persistir en Supabase (fire-and-forget)
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.upsert(appointment);
    } catch (_) {}

    // ── WhatsApp: confirmación inmediata al cliente ───────────────────────────
    // Template: nodeflow_cita_confirmada (sin botones — solo información)
    // Fire-and-forget: no bloquea la respuesta de reserva.
    // opts.skipClientWa: en reservas por VOZ la manda el post-call-handler (con
    // el toggle waConfirm) → aquí se salta para no enviar DOS confirmaciones
    // (una durante la llamada + otra al colgar). En manual/portal/externa NO se
    // salta: esta es la única confirmación al cliente.
    if (appointment.phone && !opts.skipClientWa && process.env.NODE_ENV !== 'test') {
      setImmediate(async () => {
        try {
          const { sendTemplate, isConfigured } = require('../notifications/client-whatsapp');
          const { getWaCredentials }            = require('../whatsapp/accounts');

          // Credenciales del negocio (multi-tenant) o globales como fallback
          const credentials = businessId ? await getWaCredentials(businessId) : null;
          if (!credentials && !isConfigured()) return;

          const config  = this.getBusinessConfig(businessId);
          const bizName = config?.name || 'el negocio';
          const name    = patientName.split(' ')[0];
          const lang    = config?.language || 'es';
          const dateStr = lang === 'gl'
            ? new Date(date).toLocaleDateString('gl-ES', { weekday:'long', day:'numeric', month:'long', timeZone:'Europe/Madrid' })
            : lang === 'eu'
            ? new Date(date).toLocaleDateString('eu-ES', { weekday:'long', day:'numeric', month:'long', timeZone:'Europe/Madrid' })
            : (() => {
                const [y,m,d] = date.split('-').map(Number);
                const dt = new Date(y, m-1, d);
                const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
                const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
                return `${days[dt.getDay()]} ${d} de ${months[m-1]}`;
              })();

          await sendTemplate(appointment.phone, 'nodeflow_cita_confirmada', lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es', [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: name },
                { type: 'text', text: bizName },
                { type: 'text', text: dateStr },
                { type: 'text', text: time },
                { type: 'text', text: appointment.service },
              ],
            },
          ], credentials);
          log.info(`WA booking confirmation sent → ${id} (${appointment.phone}) [${credentials ? 'business' : 'global'}]`);
        } catch (e) {
          log.warn(`WA booking confirmation failed for ${id}: ${e.message}`);
        }
      });
    }

    // Solicitud de SEÑAL/depósito (opt-in por negocio, OFF por defecto): envía al
    // cliente el enlace de pago PROPIO del negocio para dejar la señal. Anti-no-
    // show de 16 sectores (crítica sectorial). Fire-and-forget, no-op sin config.
    if (appointment.phone && process.env.NODE_ENV !== 'test') {
      Promise.resolve(require('../billing/deposit-request').maybeRequestDeposit(appointment, businessId, {}))
        .catch(() => {});
    }

    return {
      success: true,
      appointment: {
        id,
        patientName,
        phone:   appointment.phone  || null,
        email:   appointment.email  || null,
        service: appointment.service,
        date,
        time,
        endTime:  this._addMinutes(time, appointment.duration),
        duration: appointment.duration,
        price:    appointment.price,
        location: appointment.location || null,   // multi-sede: centro
      }
    };
  }

  // ─── Cancel an appointment ───
  // BUG-39 FIX: Always filter by businessId to prevent cross-business cancellations.
  // Without this, a caller could cancel another business's appointment by guessing IDs.
  cancelAppointment(appointmentId, patientName, businessId) {
    // Search by ID or by patient name, always scoped to businessId
    let apt = this.appointments.get(appointmentId);

    // Verify the appointment belongs to this business (prevents cross-tenant cancellation)
    if (apt && businessId && apt.businessId !== businessId) {
      apt = null; // Pretend it doesn't exist to avoid leaking info
    }

    if (!apt && patientName) {
      // Búsqueda por nombre — acotada al negocio y a la cita PRÓXIMA.
      // Auditoría 2026-07-16: antes cogía el PRIMER match del Map (hidratado en
      // orden ascendente con hasta 90 días de histórico) → cancelaba la cita más
      // ANTIGUA, incluso una ya pasada, dejando viva la de mañana (hueco no
      // liberado + no-show). Ahora: solo futuras, la más próxima.
      const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
      const q = patientName.toLowerCase();
      let best = null;
      for (const [, a] of this.appointments) {
        const sameBusiness = !businessId || a.businessId === businessId;
        if (!sameBusiness || a.status === 'cancelled') continue;
        if (!a.patientName || !a.patientName.toLowerCase().includes(q)) continue;
        if (a.date < todayStr) continue; // pasadas no se cancelan
        if (!best || a.date < best.date || (a.date === best.date && a.time < best.time)) best = a;
      }
      apt = best;
    }

    if (!apt) return { success: false, error: 'No se ha encontrado ninguna cita con esos datos.' };
    if (apt.status === 'cancelled') return { success: false, error: 'Esa cita ya estaba cancelada.' };

    apt.status      = 'cancelled';
    apt.cancelledAt = new Date().toISOString();
    apt.updatedAt   = new Date().toISOString();
    log.info(`Appointment cancelled: ${apt.id} - ${apt.patientName}`);

    // Persistir en Supabase (fire-and-forget)
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.patch(apt.id, { status: 'cancelled', cancelledAt: apt.cancelledAt, updatedAt: apt.updatedAt });
    } catch (_) {}

    // Fase 3: borra el evento del Google Calendar del dueño (si lo había) para
    // que no quede de fantasma — igual que la cancelación por WhatsApp/portal.
    try {
      require('../integrations/calendar-sync').syncCancelToCalendar(apt).catch(() => {});
    } catch (_) {}

    return {
      success: true,
      message: `Cita cancelada correctamente.`,
      appointment: { id: apt.id, patientName: apt.patientName, date: apt.date, time: apt.time, service: apt.service }
    };
  }

  // ─── Get all appointments for a business (for rebooking cron) ───
  getAppointments(businessId) {
    const config = this.getBusinessConfig(businessId);
    if (!config) return [];
    return [...this.appointments.values()].filter(a => a.businessId === businessId);
  }

  // ─── Look up appointments by patient ───
  // BUG-50 FIX: Scope lookup to businessId — without this, an AI assistant at business A
  // could read appointments from business B by guessing a common patient name.
  lookupAppointments(patientName, businessId) {
    const results = [];
    for (const [, apt] of this.appointments) {
      // Always filter by business (null businessId is treated as "no isolation" — dev-only)
      if (businessId && apt.businessId !== businessId) continue;
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

  // ─── Lumina: Citas pre-sembradas para el demo ───
  // Simula una semana real con muchos huecos ocupados
  _seedLuminaAppointments() {
    const d = (offset) => {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      return date.toISOString().split('T')[0];
    };

    const book = (offset, time, service, name, phone = '666000000') => {
      this.bookAppointment('lumina-estetica', {
        patientName: name, phone, service, date: d(offset), time
      });
    };

    // Mañana
    book(1, '09:00', 'facial-antiedad',     'Marta Álvarez',     '666100200');
    book(1, '10:30', 'laser-piernas',       'Laura Moreno',      '666300400');
    book(1, '13:00', 'manicura-semi',       'Isabel Ruiz',       '666500600');
    book(1, '15:30', 'reductor',            'Carmen Díez',       '666700800');
    book(1, '18:00', 'masaje-relajante',    'Ana Etxebarria',    '666900100');

    // Pasado mañana
    book(2, '09:00', 'facial-limpieza',     'Patricia González', '666111222');
    book(2, '10:00', 'extensiones',         'Nerea Iturriaga',   '666333444');
    book(2, '12:00', 'laminado-cejas',      'Ainhoa Martínez',   '666555666');
    book(2, '15:30', 'laser-piernas',       'Amaia Uriarte',     '666777888');
    book(2, '17:30', 'masaje-deportivo',    'Sofía Castillo',    '666999000');

    // En 3 días
    book(3, '09:30', 'lifting-pestanas',    'Julia López',       '666121314');
    book(3, '10:30', 'facial-hidratacion',  'Ingrid Sanz',       '666151617');
    book(3, '11:30', 'laser-combo',         'Lucía Fernández',   '666181920');
    book(3, '15:30', 'masaje-relajante',    'Elena Vega',        '666212223');
    book(3, '17:00', 'pedicura',            'Rosa Martín',       '666242526');

    // En 4 días
    book(4, '09:00', 'drenaje',             'Julia Herrera',     '666272829');
    book(4, '10:30', 'extensiones-relleno', 'Marina Soto',       '666303132');
    book(4, '12:00', 'combo-mani-pedi',     'Cristina Pérez',    '666333435');
    book(4, '15:30', 'facial-antiedad',     'Beatriz Iglesias',  '666363738');
    book(4, '17:30', 'reductor',            'Silvia Romero',     '666394041');

    log.info(`Lumina: ${[...this.appointments.values()].filter(a => a.businessId === 'lumina-estetica').length} citas de demo sembradas`);
  }
}

// Singleton
const scheduler = new SchedulingSystem();
module.exports = { scheduler, SchedulingSystem };
