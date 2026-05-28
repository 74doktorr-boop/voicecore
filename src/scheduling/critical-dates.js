// ============================================
// NodeFlow — Critical Dates Store (System C)
// In-memory + Supabase persistence
// ============================================

const { v4: uuidv4 }  = require('uuid');
const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('CRITICAL-DATES');

// ── Date types per sector ──────────────────────────────────────────────────────
const CRITICAL_DATE_TYPES = {
  itv_expiry:           { label: 'Vencimiento ITV',          emoji: '🚗', sectors: ['taller'] },
  service_due:          { label: 'Revisión de vehículo',      emoji: '🔧', sectors: ['taller'] },
  insurance_renewal:    { label: 'Renovación de seguro',      emoji: '📋', sectors: ['taller','asesoria'] },
  vaccine_due:          { label: 'Vacuna pendiente',          emoji: '💉', sectors: ['veterinaria','clinica'] },
  annual_checkup:       { label: 'Revisión anual',            emoji: '🩺', sectors: ['veterinaria','clinica'] },
  deworming:            { label: 'Desparasitación',           emoji: '🐾', sectors: ['veterinaria'] },
  tax_filing:           { label: 'Declaración de renta',      emoji: '📊', sectors: ['asesoria'] },
  quarterly_vat:        { label: 'Liquidación IVA',           emoji: '🧾', sectors: ['asesoria'] },
  annual_accounts:      { label: 'Cuentas anuales',           emoji: '📁', sectors: ['asesoria'] },
  prescription_renewal: { label: 'Renovación receta',         emoji: '💊', sectors: ['farmacia','clinica'] },
  membership_renewal:   { label: 'Renovación membresía',      emoji: '🏋️', sectors: ['gimnasio'] },
  exam_date:            { label: 'Fecha de examen',           emoji: '📝', sectors: ['academia'] },
  enrollment_deadline:  { label: 'Plazo de matrícula',        emoji: '🎓', sectors: ['academia'] },
  contract_expiry:      { label: 'Vencimiento contrato',      emoji: '📋', sectors: ['inmobiliaria','asesoria'] },
  birthday:             { label: 'Cumpleaños',                emoji: '🎂', sectors: [] }, // universal
  anniversary:          { label: 'Aniversario',               emoji: '💑', sectors: [] },
  passport_expiry:      { label: 'Vencimiento pasaporte',      emoji: '🛂', sectors: ['agencia_viajes'] },
  glasses_prescription: { label: 'Renovación de prescripción', emoji: '👓', sectors: ['optica'] },
  legal_deadline:       { label: 'Plazo legal / escritura',    emoji: '⚖️', sectors: ['abogados', 'notaria'] },
  driving_license:      { label: 'Renovación carnet conducir', emoji: '🪪', sectors: ['taller', 'asesoria'] },
  annual_contract:      { label: 'Vencimiento contrato anual', emoji: '📋', sectors: ['asesoria', 'reformas'] },
  treatment_cycle:      { label: 'Ciclo de tratamiento',       emoji: '✨', sectors: ['estetica_avanzada', 'laser'] },
  class_pack_expiry:    { label: 'Vencimiento pack de clases', emoji: '🧘', sectors: ['yoga', 'pilates', 'gimnasio'] },
};

class CriticalDatesStore {
  constructor() {
    this.dates = new Map(); // id → CriticalDate
  }

  /**
   * Add a new critical date entry.
   * Returns the created entry.
   */
  add({ businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays = [30, 15, 7] }) {
    if (!businessId || !clientName || !type || !dueDate) {
      throw new Error('businessId, clientName, type and dueDate are required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error(`dueDate must be YYYY-MM-DD, got: ${dueDate}`);
    }
    const entry = {
      id:             uuidv4(),
      businessId,
      clientName,
      clientEmail:    clientEmail  || null,
      clientPhone:    clientPhone  || null,
      type,
      dueDate,
      notes:          notes        || null,
      advanceDays:    advanceDays,
      sentReminders:  [],
      active:         true,
      createdAt:      new Date().toISOString(),
    };
    this.dates.set(entry.id, entry);
    log.info(`Critical date added: ${type} for ${clientName} on ${dueDate} (biz: ${businessId})`);
    // Persist async (fire-and-forget)
    this._persist(entry).catch(e => log.warn(`Persist failed for ${entry.id}`, { err: e.message }));
    return entry;
  }

  /**
   * Mark advance reminder as sent.
   */
  markSent(id, advanceDay) {
    const entry = this.dates.get(id);
    if (!entry) return false;
    if (!entry.sentReminders.includes(String(advanceDay))) {
      entry.sentReminders.push(String(advanceDay));
    }
    // Persist updated sentReminders
    this._updateDB(id, { sent_reminders: entry.sentReminders }).catch(() => {});
    return true;
  }

  deactivate(id) {
    const entry = this.dates.get(id);
    if (!entry) return false;
    entry.active = false;
    this._updateDB(id, { active: false }).catch(() => {});
    return true;
  }

  /**
   * Get all active entries for a business.
   */
  getByBusiness(businessId) {
    return [...this.dates.values()].filter(d => d.businessId === businessId && d.active);
  }

  /**
   * Get ALL active entries (for cron scan).
   */
  getAll() {
    return [...this.dates.values()].filter(d => d.active);
  }

  getById(id) { return this.dates.get(id) || null; }

  delete(id) {
    const existed = this.dates.has(id);
    this.dates.delete(id);
    return existed;
  }

  /**
   * Load all active critical dates from Supabase into memory.
   */
  async loadFromDB() {
    const db = getDatabase();
    if (!db.enabled) { log.info('DB disabled — critical dates not loaded from DB'); return 0; }
    try {
      const { data, error } = await db.client
        .from('critical_dates')
        .select('*')
        .eq('active', true);
      if (error) throw new Error(error.message);
      let n = 0;
      for (const row of (data || [])) {
        this.dates.set(row.id, {
          id:            row.id,
          businessId:    row.business_id,
          clientName:    row.client_name,
          clientEmail:   row.client_email,
          clientPhone:   row.client_phone,
          type:          row.type,
          dueDate:       row.due_date,
          notes:         row.notes,
          advanceDays:   row.advance_days  || [30, 15, 7],
          sentReminders: row.sent_reminders || [],
          active:        row.active,
          createdAt:     row.created_at,
        });
        n++;
      }
      log.info(`Loaded ${n} critical dates from DB`);
      return n;
    } catch (e) {
      log.warn('Failed to load critical dates from DB', { err: e.message });
      return 0;
    }
  }

  async _persist(entry) {
    const db = getDatabase();
    if (!db.enabled) return;
    await db.client.from('critical_dates').insert({
      id:             entry.id,
      business_id:    entry.businessId,
      client_name:    entry.clientName,
      client_email:   entry.clientEmail,
      client_phone:   entry.clientPhone,
      type:           entry.type,
      due_date:       entry.dueDate,
      notes:          entry.notes,
      advance_days:   entry.advanceDays,
      sent_reminders: entry.sentReminders,
      active:         entry.active,
    });
  }

  async _updateDB(id, patch) {
    const db = getDatabase();
    if (!db.enabled) return;
    await db.client.from('critical_dates').update(patch).eq('id', id);
  }
}

// Singleton
const criticalDatesStore = new CriticalDatesStore();

module.exports = { criticalDatesStore, CRITICAL_DATE_TYPES };
