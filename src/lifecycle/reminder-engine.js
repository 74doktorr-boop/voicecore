// ============================================================
// NodeFlow — Reminder Engine (Lifecycle System)
// Knows WHEN to remind each client based on sector + trigger type.
// Creates/cancels entries in scheduled_reminders.
// ============================================================

const { getDatabase }    = require('../db/database');
const { getContactMemory, isCoolingOff } = require('./call-memory');
const { Logger }          = require('../utils/logger');

const log = new Logger('REMINDER-ENGINE');

// ── Sector defaults ──────────────────────────────────────────────────────────
// Trigger types:
//   from_last_appointment  → date of last appointment + N days
//   before_sector_field    → sector_data[field] - N days
//   from_sector_field      → sector_data[field] + N days (with optional days_offset)
//   from_last_if_no_new    → from_last_appointment only if no newer appointment booked
//   custom_frequency       → sector_data[frequency_field] days after last appointment
//   only_if_completed      → flag: only schedule if appointment.status === 'completed'
//   seasonal               → goes to org_campaigns, not individual reminders
const SECTOR_DEFAULTS = {
  peluqueria: {
    corte_pelo:    { days: 24,  trigger: 'from_last_appointment', serviceFilter: ['corte','pelo','cabello'] },
    color_tinte:   { days: 35,  trigger: 'from_last_appointment', serviceFilter: ['color','tinte'] },
    tratamiento:   { days: 28,  trigger: 'from_last_appointment', serviceFilter: ['tratamiento'] },
    permanente:    { days: 70,  trigger: 'from_last_appointment', serviceFilter: ['permanente'] },
  },
  taller: {
    cambio_aceite: { days: 335, trigger: 'from_sector_field',  field: 'fecha_ultimo_aceite' },
    itv:           { days: 60,  trigger: 'before_sector_field', field: 'fecha_vencimiento_itv' },
    revision:      { days: 335, trigger: 'from_last_appointment' },
  },
  dental: {
    revision_anual:   { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','revision','check'] },
    limpieza:         { days: 165, trigger: 'from_last_appointment', serviceFilter: ['limpieza'] },
    ortodoncia:       { days: 25,  trigger: 'from_last_appointment', serviceFilter: ['ortodoncia'], onlyIfCompleted: true },
    post_tratamiento: { days: 12,  trigger: 'from_last_appointment', serviceFilter: ['extracción','implante','endodoncia'], onlyIfCompleted: true },
  },
  estetica: {
    facial:               { days: 28, trigger: 'from_last_appointment', serviceFilter: ['facial'] },
    depilacion_laser:     { days: 35, trigger: 'from_last_appointment', serviceFilter: ['láser','laser'] },
    depilacion_cera:      { days: 28, trigger: 'from_last_appointment', serviceFilter: ['cera'] },
    tratamiento_corporal: { days: 21, trigger: 'from_last_appointment', serviceFilter: ['corporal'] },
  },
  veterinaria: {
    vacuna_anual:    { days: 14,  trigger: 'before_sector_field',  field: 'fecha_proxima_vacuna' },
    desparasitacion: { days: 70,  trigger: 'from_last_appointment', serviceFilter: ['desparasitación','desparasitacion'] },
    revision_anual:  { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','revision','chequeo'] },
    post_cirugia:    { days: 10,  trigger: 'from_last_appointment', serviceFilter: ['cirugía','cirugia','operación'], onlyIfCompleted: true },
  },
  gimnasio: {
    renovacion_cuota: { days: 5, trigger: 'before_sector_field', field: 'fecha_vencimiento_cuota' },
  },
  fisioterapia: {
    seguimiento_post: { days: 14,  trigger: 'from_last_appointment', onlyIfCompleted: true },
    mantenimiento:    { days: 90,  trigger: 'from_sector_field',  field: 'fecha_alta' },
  },
  psicologia: {
    sesion_habitual: { trigger: 'custom_frequency', frequencyField: 'frecuencia_sesiones', onlyIfCompleted: true },
  },
  nutricion: {
    revision_mensual: { days: 28, trigger: 'from_last_appointment' },
    reactivacion:     { days: 42, trigger: 'from_last_if_no_new' },
  },
  optica: {
    revision_vista:       { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','graduación'] },
    reposicion_lentillas: { trigger: 'from_sector_field', field: 'suministro_lentillas_dias', daysOffset: -5 },
  },
  hotel: {
    aniversario:  { days: 21,  trigger: 'before_sector_field', field: 'fecha_aniversario' },
    cumpleanos:   { days: 21,  trigger: 'before_sector_field', field: 'fecha_cumpleanos' },
    recuperacion: { days: 270, trigger: 'from_last_if_no_new' },
  },
  academia: {
    renovacion_matricula: { days: 21, trigger: 'before_sector_field', field: 'fecha_fin_curso' },
  },
};

/**
 * Get the effective reminder config for an org.
 * Merges org overrides on top of sector defaults.
 * @returns {object} { serviceKey: { days, channel, enabled } }
 */
async function getOrgReminderConfig(orgId, sectorSlug) {
  const db = getDatabase();
  const sectorDefaults = SECTOR_DEFAULTS[sectorSlug] || {};

  if (!db.enabled) return sectorDefaults;

  const { data, error: configErr } = await db.client
    .from('org_reminder_config')
    .select('config')
    .eq('org_id', orgId)
    .maybeSingle();
  if (configErr) log.warn('getOrgReminderConfig: failed to load org config', { err: configErr.message, orgId });

  const orgConfig = data?.config || {};

  // Merge: org config overrides sector defaults per service key
  const result = {};
  for (const [key, def] of Object.entries(sectorDefaults)) {
    result[key] = {
      ...def,
      channel: 'whatsapp', // default channel
      enabled: true,
      ...(orgConfig[key] || {}),
    };
  }
  return result;
}

/**
 * Calculate scheduledFor date from a trigger definition and data.
 * Returns a Date or null if trigger cannot be resolved.
 */
function calculateScheduledFor(def, sectorData, lastAppointmentDate) {
  const now = new Date();

  if (def.trigger === 'from_last_appointment' || def.trigger === 'from_last_if_no_new') {
    if (!lastAppointmentDate) return null;
    const d = new Date(lastAppointmentDate);
    d.setDate(d.getDate() + (def.days || 30));
    return d > now ? d : null; // Don't schedule in the past
  }

  if (def.trigger === 'before_sector_field') {
    const fieldValue = sectorData?.[def.field];
    if (!fieldValue) return null;
    const target = new Date(fieldValue);
    if (isNaN(target.getTime())) return null;
    target.setDate(target.getDate() - (def.days || 30));
    return target > now ? target : null;
  }

  if (def.trigger === 'from_sector_field') {
    const fieldValue = sectorData?.[def.field];
    if (!fieldValue) return null;
    // For numeric fields like suministro_lentillas_dias, calculate from today
    if (typeof fieldValue === 'number') {
      const d = new Date();
      d.setDate(d.getDate() + fieldValue + (def.daysOffset || 0));
      return d > now ? d : null;
    }
    // For date fields
    const base = new Date(fieldValue);
    if (isNaN(base.getTime())) return null;
    base.setDate(base.getDate() + (def.days || 335) + (def.daysOffset || 0));
    return base > now ? base : null;
  }

  if (def.trigger === 'custom_frequency') {
    if (!lastAppointmentDate || !sectorData?.[def.frequencyField]) return null;
    const freq = parseInt(sectorData[def.frequencyField], 10);
    if (isNaN(freq) || freq <= 0) return null;
    const d = new Date(lastAppointmentDate);
    d.setDate(d.getDate() + freq);
    return d > now ? d : null;
  }

  return null;
}

/**
 * Schedule (or update) a reminder for a contact.
 * Idempotent: if a pending reminder already exists for (contact, service), cancels it and creates new.
 */
async function scheduleReminder({ orgId, contactId, serviceKey, scheduledFor, channel = 'whatsapp', messagePreview = null }) {
  const db = getDatabase();
  if (!db.enabled) return;

  // Check do_not_contact and cooling-off
  const memory = await getContactMemory(contactId, orgId);
  if (memory) {
    const blocked = (channel === 'whatsapp' && memory.no_whatsapp)
                 || (channel === 'sms'      && memory.no_sms)
                 || (channel === 'email'    && memory.no_email);
    if (blocked) {
      log.info(`scheduleReminder: contact ${contactId} blocked on ${channel} — skipping`);
      return;
    }
    if (isCoolingOff(memory)) {
      log.info(`scheduleReminder: contact ${contactId} in cooling-off period — skipping`);
      return;
    }
  }

  // Cancel existing pending/postponed reminders for same (contact, service)
  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('service_key', serviceKey)
    .in('status', ['pending', 'postponed'])
    .catch(e => log.warn('scheduleReminder: cancel existing failed', { err: e.message }));

  // Insert new reminder
  const { error } = await db.client.from('scheduled_reminders').insert({
    org_id:          orgId,
    contact_id:      contactId,
    service_key:     serviceKey,
    channel,
    scheduled_for:   scheduledFor.toISOString(),
    status:          'pending',
    message_preview: messagePreview,
  });

  if (error) {
    log.error('scheduleReminder: insert failed', { err: error.message, orgId, contactId, serviceKey });
  } else {
    log.info(`Reminder scheduled: ${serviceKey} for contact ${contactId} on ${scheduledFor.toLocaleDateString('es-ES')} via ${channel}`);
  }
}

/**
 * Cancel all pending reminders for a contact + service.
 * Call when a new appointment is booked.
 */
async function cancelRemindersForService(contactId, serviceKey) {
  const db = getDatabase();
  if (!db.enabled) return;
  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', failed_reason: 'appointment_booked', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('service_key', serviceKey)
    .in('status', ['pending', 'postponed'])
    .catch(e => log.warn('cancelRemindersForService failed', { err: e.message }));
}

/**
 * Recalculate reminders for a contact after sector_data changes.
 */
async function recalculate(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return;

  // Get contact sector_data + phone (phone is the join key to nf_appointments)
  const { data: contact } = await db.client.from('contacts')
    .select('sector_data, phone')
    .eq('id', contactId).maybeSingle();
  if (!contact) return;

  // Get org sector
  const { data: org } = await db.client.from('organizations')
    .select('sector').eq('id', orgId).maybeSingle();
  const sectorSlug = org?.sector;
  if (!sectorSlug) return;

  // Get all appointments for this contact via phone (nf_appointments has no contact_id)
  let allApts = [];
  if (contact.phone) {
    const { data: aptsData } = await db.client.from('nf_appointments')
      .select('date, service, status')
      .eq('organization_id', orgId)
      .eq('phone', contact.phone)
      .order('date', { ascending: false })
      .limit(20);
    allApts = aptsData || [];
  }

  const config = await getOrgReminderConfig(orgId, sectorSlug);

  for (const [serviceKey, def] of Object.entries(config)) {
    if (!def.enabled) continue;
    if (def.trigger === 'seasonal') continue;
    // Only schedule post-completion reminders if last appointment was completed
    if (def.onlyIfCompleted && !(allApts || []).some(a => a.status === 'completed')) continue;

    // Find the most recent relevant appointment for this service
    const relevantApt = def.serviceFilter
      ? (allApts || []).find(a =>
          def.serviceFilter.some(f => (a.service || '').toLowerCase().includes(f))
        )
      : (allApts || [])[0];

    // from_last_if_no_new: skip if contact has any future appointment
    if (def.trigger === 'from_last_if_no_new') {
      if (!contact.phone) continue; // can't check without phone
      const { count: futureCount } = await db.client.from('nf_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('phone', contact.phone)
        .gte('date', new Date().toISOString().split('T')[0])
        .in('status', ['confirmed', 'pending']);
      if ((futureCount || 0) > 0) continue;
    }

    // onlyIfCompleted: only schedule if the relevant appointment was completed
    if (def.onlyIfCompleted && relevantApt?.status !== 'completed') continue;

    const scheduledFor = calculateScheduledFor(def, contact.sector_data, relevantApt?.date);
    if (!scheduledFor) continue;

    await scheduleReminder({
      orgId, contactId, serviceKey,
      scheduledFor,
      channel: def.channel || 'whatsapp',
    });
  }
}

module.exports = {
  SECTOR_DEFAULTS,
  getOrgReminderConfig,
  calculateScheduledFor,
  scheduleReminder,
  cancelRemindersForService,
  recalculate,
};
