// ============================================
// NodeFlow — Flow Manager
// Cada negocio (org) tiene su propio flujo de
// automatizaciones: reminders, reseñas, WA confirm
// Se registran en el pago y se persisten en Supabase
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');

const log = new Logger('FLOWS');

const DEFAULTS = {
  reminders: { enabled: true,  hoursBefore: 24 },
  reviews:   { enabled: true,  hoursAfter:  24 },
  waConfirm: { enabled: true },
  rebooking: { enabled: true,  daysThreshold: null, maxPerYear: 4 },
};

class FlowManager {
  constructor() {
    this.flows = new Map(); // businessId -> FlowConfig
  }

  // ── Register or update a business flow ────────────────────────────────────
  register(businessId, config = {}) {
    const prev = this.flows.get(businessId) || {};
    const flow = {
      businessId,
      name:          config.name          || prev.name          || businessId,
      ownerEmail:    config.ownerEmail    || prev.ownerEmail    || null,
      ownerPhone:    config.ownerPhone    || prev.ownerPhone    || process.env.OWNER_PHONE || null,
      plan:          config.plan          || prev.plan          || null,
      sector:        config.sector        || prev.sector        || null,
      language:      config.language      || prev.language      || 'es', // 'es' | 'eu' | 'gl'
      googlePlaceId: config.googlePlaceId || prev.googlePlaceId || null,
      reviewUrl:     config.reviewUrl     || prev.reviewUrl     || null,
      automations: {
        reminders: { ...DEFAULTS.reminders, ...(prev.automations?.reminders || {}), ...(config.automations?.reminders || {}) },
        reviews:   { ...DEFAULTS.reviews,   ...(prev.automations?.reviews   || {}), ...(config.automations?.reviews   || {}) },
        waConfirm: { ...DEFAULTS.waConfirm, ...(prev.automations?.waConfirm || {}), ...(config.automations?.waConfirm || {}) },
        rebooking: { ...DEFAULTS.rebooking, ...(prev.automations?.rebooking || {}), ...(config.automations?.rebooking || {}) },
      },
      registeredAt: prev.registeredAt || new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
    };
    this.flows.set(businessId, flow);
    log.info(`Flow registered: ${businessId} (${flow.name}) — reminders:${flow.automations.reminders.enabled} reviews:${flow.automations.reviews.enabled}`);
    return flow;
  }

  // ── Patch specific fields ──────────────────────────────────────────────────
  patch(businessId, patch = {}) {
    const flow = this.flows.get(businessId);
    if (!flow) return null;
    const { automations, ...rest } = patch;
    const updated = {
      ...flow,
      ...rest,
      automations: automations
        ? {
            reminders: { ...flow.automations.reminders, ...(automations.reminders || {}) },
            reviews:   { ...flow.automations.reviews,   ...(automations.reviews   || {}) },
            waConfirm: { ...flow.automations.waConfirm, ...(automations.waConfirm || {}) },
            rebooking: { ...flow.automations.rebooking, ...(automations.rebooking || {}) },
          }
        : flow.automations,
      updatedAt: new Date().toISOString(),
    };
    this.flows.set(businessId, updated);
    log.info(`Flow patched: ${businessId}`);
    return updated;
  }

  // ── Getters ───────────────────────────────────────────────────────────────
  get(businessId)   { return this.flows.get(businessId) || null; }
  list()            { return [...this.flows.values()]; }
  has(businessId)   { return this.flows.has(businessId); }

  isEnabled(businessId, type) {
    const flow = this.get(businessId);
    // Default true if flow not registered yet — don't block automations
    return flow ? (flow.automations?.[type]?.enabled ?? true) : true;
  }

  getHoursBefore(businessId) {
    return this.get(businessId)?.automations?.reminders?.hoursBefore ?? 24;
  }

  getHoursAfter(businessId) {
    return this.get(businessId)?.automations?.reviews?.hoursAfter ?? 24;
  }

  getLanguage(businessId) {
    return this.get(businessId)?.language ?? 'es';
  }

  // ── Merge scheduler + flow config for email templates ─────────────────────
  mergeConfig(businessId, schedulerConfig = {}) {
    const flow = this.get(businessId) || {};
    return {
      name:          flow.name          || schedulerConfig.name          || businessId,
      googlePlaceId: flow.googlePlaceId || schedulerConfig.googlePlaceId || null,
      reviewUrl:     flow.reviewUrl     || schedulerConfig.reviewUrl     || null,
      ownerPhone:    flow.ownerPhone    || schedulerConfig.ownerPhone    || process.env.OWNER_PHONE,
      language:      flow.language      || schedulerConfig.language      || 'es',
    };
  }

  // ── Load all active orgs from Supabase ────────────────────────────────────
  async loadFromDB() {
    const db = getDatabase();
    if (!db.enabled) { log.warn('DB not enabled — flows not loaded'); return 0; }
    try {
      const { data, error } = await db.client
        .from('organizations')
        .select('id, name, owner_email, phone, plan, google_place_id, review_url, automation_config, language')
        .eq('is_active', true);

      if (error) throw new Error(error.message);
      let n = 0;
      for (const org of (data || [])) {
        this.register(org.id, {
          name:          org.name,
          ownerEmail:    org.owner_email,
          ownerPhone:    org.phone,
          plan:          org.plan,
          googlePlaceId: org.google_place_id,
          reviewUrl:     org.review_url,
          automations:   org.automation_config || {},
          language:      org.language || 'es',
        });
        n++;
      }
      log.info(`Loaded ${n} flows from DB`);
      return n;
    } catch (e) {
      log.error('Failed to load flows from DB', { error: e.message });
      return 0;
    }
  }

  // ── Persist flow config to Supabase ───────────────────────────────────────
  async saveToDB(businessId) {
    const flow = this.get(businessId);
    if (!flow) return false;
    const db = getDatabase();
    if (!db.enabled) return false;
    try {
      await db.client.from('organizations').update({
        automation_config: flow.automations,
        google_place_id:   flow.googlePlaceId,
        review_url:        flow.reviewUrl,
        language:          flow.language || 'es',
      }).eq('id', businessId);
      log.info(`Flow saved to DB: ${businessId}`);
      return true;
    } catch (e) {
      log.error('Failed to save flow to DB', { error: e.message });
      return false;
    }
  }

  stats() {
    const all = this.list();
    return {
      total:             all.length,
      remindersEnabled:  all.filter(f => f.automations.reminders.enabled).length,
      reviewsEnabled:    all.filter(f => f.automations.reviews.enabled).length,
      withPlaceId:       all.filter(f => f.googlePlaceId).length,
    };
  }
}

// Singleton
const flowManager = new FlowManager();
module.exports = { flowManager, FlowManager };
