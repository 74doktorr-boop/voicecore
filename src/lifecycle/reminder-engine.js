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
// Los seguimientos "de fábrica" de cada sector viven en el CATÁLOGO
// (sector-catalog.js), fuente única con etiquetas + campos del motor.
// Aquí solo derivamos la forma que necesita el motor.
//
// Trigger types:
//   from_last_appointment  → date of last appointment + N days
//   before_sector_field    → sector_data[field] - N days
//   from_sector_field      → sector_data[field] + N days (with optional days_offset)
//   from_last_if_no_new    → from_last_appointment only if no newer appointment booked
//   custom_frequency       → sector_data[frequency_field] days after last appointment
//   only_if_completed      → flag: only schedule if appointment.status === 'completed'
//   seasonal               → goes to org_campaigns, not individual reminders
const { toEngineDefaults, serviceLabelFor, CUSTOM_TRIGGERS } = require('./sector-catalog');
const SECTOR_DEFAULTS = toEngineDefaults();

/**
 * Get the effective reminder config for an org.
 * Merges, en este orden:
 *   1) defaults del sector (catálogo)
 *   2) overrides del dueño por serviceKey (días/canal/activado)
 *   3) seguimientos PERSONALIZADOS del dueño (orgConfig._custom)
 * Cada entrada lleva serviceLabel para construir el mensaje.
 * @returns {object} { serviceKey: { days, trigger, channel, enabled, serviceLabel, custom? } }
 */
async function getOrgReminderConfig(orgId, sectorSlug, opts = {}) {
  const db = opts.db || getDatabase();
  const sectorDefaults = SECTOR_DEFAULTS[sectorSlug] || {};

  const result = {};
  const orgConfig = await _loadOrgConfig(db, orgId);

  // 1+2) defaults del sector con overrides del dueño
  for (const [key, def] of Object.entries(sectorDefaults)) {
    result[key] = {
      ...def,
      channel: 'whatsapp',
      enabled: true,
      serviceLabel: serviceLabelFor(sectorSlug, key),
      ...(orgConfig[key] || {}),
    };
  }

  // 3) seguimientos personalizados (no pisan defaults; trigger acotado)
  const custom = Array.isArray(orgConfig._custom) ? orgConfig._custom : [];
  for (const c of custom) {
    if (!c || !c.key || result[c.key] || !CUSTOM_TRIGGERS.includes(c.trigger)) continue;
    result[c.key] = {
      trigger:      c.trigger,
      days:         c.days,
      serviceFilter: Array.isArray(c.serviceFilter) && c.serviceFilter.length ? c.serviceFilter : undefined,
      channel:      c.channel || 'whatsapp',
      enabled:      c.enabled !== false,
      serviceLabel: c.serviceLabel || c.label || 'tu próxima cita',
      label:        c.label,
      custom:       true,
    };
  }
  return result;
}

async function _loadOrgConfig(db, orgId) {
  if (!db.enabled) return {};
  const { data, error } = await db.client
    .from('org_reminder_config').select('config').eq('org_id', orgId).maybeSingle();
  if (error) log.warn('getOrgReminderConfig: failed to load org config', { err: error.message, orgId });
  return (data && data.config) || {};
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
    .then(undefined, e => log.warn('scheduleReminder: cancel existing failed', { err: e.message }));

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
    .then(undefined, e => log.warn('cancelRemindersForService failed', { err: e.message }));
}

/**
 * Recalculate reminders for a contact after sector_data changes.
 */
async function recalculate(contactId, orgId, ctx = {}) {
  const db = ctx.db || getDatabase();
  if (!db.enabled) return;

  // Contexto precargado (recalculateOrg) para no releer por cada contacto.
  let contact = ctx.contact;
  if (!contact) {
    const { data } = await db.client.from('contacts')
      .select('sector_data, phone').eq('id', contactId).maybeSingle();
    contact = data;
  }
  if (!contact) return;

  // Sector (vive en assistant_config; no hay columna 'sector' en organizations).
  // SIEMPRE por resolveSector: el valor guardado puede ser un alias o plural
  // ("peluquerias", "estetica") que no casa con las claves del catálogo.
  let sectorSlug = ctx.sectorSlug;
  if (!sectorSlug) {
    const { data: org } = await db.client.from('organizations')
      .select('assistant_config').eq('id', orgId).maybeSingle();
    const raw = org && org.assistant_config && org.assistant_config.sector;
    if (!raw) return;
    sectorSlug = require('../sectors/sector-registry').resolveSector(raw).slug;
  }
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

  const config = ctx.config || await getOrgReminderConfig(orgId, sectorSlug, { db });

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
      messagePreview: def.serviceLabel || null,   // el texto del servicio para el mensaje
    });
  }
}

// Evita recálculos solapados de la misma cartera (guardas de re-entrada).
const _orgRecalcInFlight = new Set();

/**
 * Recalcula TODA la cartera de un negocio. Se dispara al cambiar reglas /
 * aplicar una sugerencia, para que el ajuste tenga efecto en los clientes
 * ACTUALES (no solo en los que vuelvan a tener actividad).
 * Carga sector + config UNA vez; itera contactos con concurrencia y tope.
 * @returns {Promise<{ processed, total, capped, skipped? }>}
 */
async function recalculateOrg(orgId, opts = {}) {
  const db = opts.db || getDatabase();
  if (!db.enabled || !orgId) return { processed: 0, total: 0, capped: false };
  if (_orgRecalcInFlight.has(orgId)) return { processed: 0, total: 0, capped: false, skipped: true };
  _orgRecalcInFlight.add(orgId);
  try {
    const { data: org } = await db.client.from('organizations')
      .select('assistant_config').eq('id', orgId).maybeSingle();
    const rawSector = org && org.assistant_config && org.assistant_config.sector;
    if (!rawSector) return { processed: 0, total: 0, capped: false };
    const sectorSlug = require('../sectors/sector-registry').resolveSector(rawSector).slug;

    const config = await getOrgReminderConfig(orgId, sectorSlug, { db });
    const LIMIT = opts.limit || 3000;
    const { data: contacts } = await db.client.from('contacts')
      .select('id, phone, sector_data').eq('org_id', orgId).is('deleted_at', null).limit(LIMIT + 1);
    const list = contacts || [];
    const capped = list.length > LIMIT;
    const work = capped ? list.slice(0, LIMIT) : list;

    const CONC = Math.min(opts.concurrency || 5, Math.max(1, work.length));
    let idx = 0, processed = 0;
    async function worker() {
      while (idx < work.length) {
        const c = work[idx++];
        try { await recalculate(c.id, orgId, { contact: c, sectorSlug, config, db }); processed++; }
        catch (e) { log.warn(`recalculateOrg: contacto ${c.id} falló: ${e.message}`); }
      }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    if (capped) log.warn(`recalculateOrg(${orgId}): cartera > ${LIMIT}; recalculados ${LIMIT} (resto se irá al tener actividad)`);
    log.info(`recalculateOrg(${orgId}): ${processed}/${work.length} contactos recalculados`);
    return { processed, total: work.length, capped };
  } finally {
    _orgRecalcInFlight.delete(orgId);
  }
}

module.exports = {
  SECTOR_DEFAULTS,
  getOrgReminderConfig,
  calculateScheduledFor,
  scheduleReminder,
  cancelRemindersForService,
  recalculate,
  recalculateOrg,
};
