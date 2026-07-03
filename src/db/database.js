// ============================================
// VoiceCore — Database Client
// Supabase PostgreSQL connection + queries
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('DB');

class Database {
  constructor(config = {}) {
    this.supabaseUrl = config.supabaseUrl || process.env.SUPABASE_URL;
    this.supabaseKey = config.supabaseKey || process.env.SUPABASE_SERVICE_KEY;
    this.client = null;
    this.enabled = false;

    if (this.supabaseUrl && this.supabaseKey) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        this.client = createClient(this.supabaseUrl, this.supabaseKey);
        this.enabled = true;
        log.info('Database connected (Supabase)');
        // Auto-create registros table if missing (critical for first client onboarding)
        this._ensureRegistrosTable().catch(e =>
          log.warn(`registros table check failed: ${e.message}`)
        );
      } catch (e) {
        log.error(`Supabase init failed: ${e.message}`);
        log.warn('Supabase client not available, running in memory mode');
      }
    } else {
      log.warn('No database configured — running in memory mode');
    }
  }

  async _ensureRegistrosTable() {
    // Supabase doesn't support raw DDL via the JS client — we just do a SELECT
    // to detect if the table exists. If it doesn't, log a clear warning.
    const { error } = await this.client.from('registros').select('id').limit(1);
    if (error?.code === '42P01') {
      log.error('⚠️  registros table does NOT exist in Supabase! Run db/schema.sql to create it.');
      log.error('   Without this table, new client registrations will only persist in memory.');
    } else if (!error) {
      log.info('registros table OK');
    }
  }

  // ─── Organizations ───

  async createOrg({ name, slug, ownerEmail, ownerName, plan = 'negocio', phone, language = 'es' }) {
    const apiKey = `vc_${this._generateKey(32)}`;
    if (!this.enabled) return { id: this._uuid(), name, slug, api_key: apiKey, plan, language };

    // Ensure slug uniqueness: append a short random suffix if needed
    const baseSlug = slug || 'org';
    const uniqueSlug = `${baseSlug}-${this._generateKey(4)}`;

    const { data, error } = await this.client.from('organizations').insert({
      name, slug: uniqueSlug, owner_email: ownerEmail, owner_name: ownerName, plan, phone, language, api_key: apiKey,
      monthly_minutes_limit: plan === 'enterprise' ? 99999 : 500,
    }).select().single();

    if (error) throw new Error(`Create org failed: ${error.message}`);
    log.info(`Org created: ${data.id} — ${name}`);
    return data;
  }

  async getOrgByApiKey(apiKey) {
    if (!this.enabled) return null;
    // BUG-36 FIX: Log Supabase errors that were previously silently swallowed
    const { data, error } = await this.client.from('organizations')
      .select('*').eq('api_key', apiKey).eq('is_active', true).single();
    if (error && error.code !== 'PGRST116') log.error(`getOrgByApiKey failed: ${error.message}`);
    return data;
  }

  async getOrg(id) {
    if (!this.enabled) return null;
    const { data, error } = await this.client.from('organizations').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') log.error(`getOrg failed: ${error.message}`);
    return data;
  }

  async updateOrg(id, updates) {
    if (!this.enabled) return updates;
    const { data, error } = await this.client.from('organizations')
      .update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw new Error(`Update org failed: ${error.message}`);
    return data;
  }

  // ─── Assistants ───

  async createAssistant(orgId, config) {
    if (!this.enabled) return { id: this._uuid(), org_id: orgId, ...config };

    const { data, error } = await this.client.from('assistants').insert({
      org_id: orgId,
      slug: config.slug || config.id || `assistant-${Date.now()}`,
      name: config.name,
      system_prompt: config.systemPrompt || config.system_prompt,
      first_message: config.firstMessage || config.first_message,
      voice: config.voice || 'nova',
      language: config.language || 'es',
      model: config.model || 'gpt-4o-mini',
      fallback_model: config.fallbackModel,
      stt_provider: config.sttProvider || 'deepgram',
      tts_provider: config.ttsProvider || 'openai',
      tts_strategy: config.ttsStrategy || 'latency',
      temperature: config.temperature || 0.7,
      max_tokens: config.maxTokens || 500,
      speed: config.speed || 1.0,
      tools: config.tools || [],
      phone_number: config.phoneNumber,
      metadata: config.metadata || {},
    }).select().single();

    if (error) throw new Error(`Create assistant failed: ${error.message}`);
    log.info(`Assistant created: ${data.id} — ${config.name}`);
    return data;
  }

  async getAssistants(orgId) {
    if (!this.enabled) return [];
    const { data } = await this.client.from('assistants')
      .select('*').eq('org_id', orgId).eq('is_active', true).order('created_at', { ascending: false });
    return data || [];
  }

  async getAssistant(orgId, assistantId) {
    if (!this.enabled) return null;
    const { data, error } = await this.client.from('assistants')
      .select('*').eq('org_id', orgId).eq('id', assistantId).single();
    if (error && error.code !== 'PGRST116') log.error(`getAssistant failed: ${error.message}`);
    return data;
  }

  async updateAssistant(orgId, assistantId, updates) {
    if (!this.enabled) return updates;
    const { data, error } = await this.client.from('assistants')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('id', assistantId).select().single();
    if (error) throw new Error(`Update assistant failed: ${error.message}`);
    return data;
  }

  async deleteAssistant(orgId, assistantId) {
    if (!this.enabled) return true;
    await this.client.from('assistants')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('id', assistantId);
    return true;
  }

  // ─── Calls ───
  // (createCall/endCall legacy eliminados 2026-07-03: eran código muerto —
  // ningún módulo los invocaba y el schema real de "calls" los rechazaba.
  // La persistencia vive en src/db/call-store.js → nf_calls.)

  // nf_calls es el registro real (2026-07-03): la tabla legacy "calls" quedó
  // vacía desde el lanzamiento (schema de otro diseño rechazaba los inserts).
  async getCalls(orgId, { limit = 50, offset = 0, status } = {}) {
    if (!this.enabled) return [];
    let query = this.client.from('nf_calls').select('*').eq('org_id', orgId)
      .order('started_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  }

  async getCall(orgId, callId) {
    if (!this.enabled) return null;
    const { data } = await this.client.from('nf_calls')
      .select('*').eq('org_id', orgId).eq('id', callId).single();
    return data;
  }

  // ─── Usage Tracking ───

  // BUG-33 FIX: Serialize usage updates per org using an in-process promise chain.
  // Without this, two concurrent calls ending at the same time would both read the
  // same usage row, then both write "existing + delta", losing one update.
  // Note: this serialization is per-process — for multi-replica deployments a DB-level
  // upsert-with-increment RPC is needed (see db/schema.sql for the increment_usage fn).
  trackUsage(orgId, usageData) {
    if (!this.enabled) return Promise.resolve();
    if (!this._usageLocks) this._usageLocks = new Map();

    const key = `usage:${orgId}`;
    const prev = this._usageLocks.get(key) || Promise.resolve();
    const next = prev.then(() => this._doTrackUsage(orgId, usageData));
    // Store the chained promise but swallow errors so the chain keeps going
    this._usageLocks.set(key, next.catch(() => {}));
    return next;
  }

  async _doTrackUsage(orgId, usageData) {
    const period = new Date().toISOString().substring(0, 7); // YYYY-MM

    const { data: existing } = await this.client.from('usage')
      .select('*').eq('org_id', orgId).eq('period', period).single();

    if (existing) {
      const { error } = await this.client.from('usage').update({
        call_count: existing.call_count + (usageData.calls || 0),
        call_minutes: parseFloat(existing.call_minutes) + (usageData.minutes || 0),
        stt_minutes: parseFloat(existing.stt_minutes) + (usageData.sttMinutes || 0),
        llm_tokens: existing.llm_tokens + (usageData.llmTokens || 0),
        tts_characters: existing.tts_characters + (usageData.ttsCharacters || 0),
        tool_calls: existing.tool_calls + (usageData.toolCalls || 0),
        total_cost: parseFloat(existing.total_cost) + (usageData.cost || 0),
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      if (error) log.error(`trackUsage update failed: ${error.message}`);
    } else {
      const { error } = await this.client.from('usage').insert({
        org_id: orgId,
        period,
        call_count: usageData.calls || 0,
        call_minutes: usageData.minutes || 0,
        stt_minutes: usageData.sttMinutes || 0,
        llm_tokens: usageData.llmTokens || 0,
        tts_characters: usageData.ttsCharacters || 0,
        tool_calls: usageData.toolCalls || 0,
        total_cost: usageData.cost || 0,
      });
      if (error) log.error(`trackUsage insert failed: ${error.message}`);
    }
  }

  /**
   * Increment monthly_minutes_used for an org AND write to the usage table.
   * Uses the same per-org promise chain as trackUsage to avoid lost updates.
   * @param {string} orgId
   * @param {number} deltaMinutes - call duration in minutes (decimal)
   * @param {object} [extra] - optional additional usage fields (llmTokens, toolCalls, cost)
   */
  incrementMinutesUsed(orgId, deltaMinutes, extra = {}) {
    if (!this.enabled || !deltaMinutes || deltaMinutes <= 0) return Promise.resolve();
    if (!this._usageLocks) this._usageLocks = new Map();

    const key = `usage:${orgId}`;
    const prev = this._usageLocks.get(key) || Promise.resolve();
    const next = prev.then(() => this._doIncrementMinutes(orgId, deltaMinutes, extra));
    this._usageLocks.set(key, next.catch(() => {}));
    return next;
  }

  async _doIncrementMinutes(orgId, deltaMinutes, extra = {}) {
    // 1. Increment monthly_minutes_used in organizations (read-modify-write, serialized by mutex)
    const { data: org, error: orgErr } = await this.client
      .from('organizations')
      .select('monthly_minutes_used, plan, stripe_customer_id')
      .eq('id', orgId)
      .single();
    if (!orgErr && org) {
      const prevTotal = parseFloat(org.monthly_minutes_used || 0);
      const newTotal  = prevTotal + deltaMinutes;
      await this.client.from('organizations')
        .update({ monthly_minutes_used: Math.round(newTotal * 100) / 100 })
        .eq('id', orgId);

      // Overage: reporta a Stripe los minutos por encima de lo incluido (best-effort,
      // no-op hasta configurar STRIPE_OVERAGE_METER_EVENT). No bloquea el flujo.
      if (org.stripe_customer_id) {
        try {
          const { getBilling } = require('../billing/stripe');
          getBilling().reportOverage({
            plan:             org.plan,
            stripeCustomerId: org.stripe_customer_id,
            prevMinutes:      prevTotal,
            newMinutes:       newTotal,
          }).catch(() => {});
        } catch (_) { /* billing no disponible */ }
      }
    }

    // 2. Write to granular usage table (same period key)
    await this._doTrackUsage(orgId, {
      calls:     1,
      minutes:   deltaMinutes,
      llmTokens: extra.llmTokens  || 0,
      toolCalls: extra.toolCalls  || 0,
      cost:      extra.cost       || 0,
    });
  }

  async getUsage(orgId, period) {
    if (!this.enabled) return null;
    const p = period || new Date().toISOString().substring(0, 7);
    const { data } = await this.client.from('usage')
      .select('*').eq('org_id', orgId).eq('period', p).single();
    return data;
  }

  async getUsageHistory(orgId, months = 6) {
    if (!this.enabled) return [];
    const { data } = await this.client.from('usage')
      .select('*').eq('org_id', orgId).order('period', { ascending: false }).limit(months);
    return data || [];
  }

  // ─── Appointments ───

  async createAppointment(orgId, aptData) {
    if (!this.enabled) return { id: this._uuid(), ...aptData };
    const { data, error } = await this.client.from('appointments').insert({
      org_id: orgId, business_id: aptData.businessId, call_id: aptData.callId,
      patient_name: aptData.patientName, phone: aptData.phone, email: aptData.email,
      service: aptData.service, service_id: aptData.serviceId,
      date: aptData.date, time: aptData.time, duration: aptData.duration || 30,
      price: aptData.price || 0, notes: aptData.notes,
    }).select().single();
    if (error) throw new Error(`Create appointment failed: ${error.message}`);
    return data;
  }

  async getAppointments(orgId, { date, status } = {}) {
    if (!this.enabled) return [];
    let query = this.client.from('appointments').select('*').eq('org_id', orgId)
      .order('date').order('time');
    if (date) query = query.eq('date', date);
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  }

  // ─── Webhooks ───

  async getWebhooks(orgId) {
    if (!this.enabled) return [];
    // BUG FIX: tabla renombrada a webhook_configs; la antigua 'webhooks' ya no se usa
    const { data } = await this.client.from('webhook_configs')
      .select('*').eq('business_id', orgId).eq('enabled', true);
    return data || [];
  }

  // ─── Helpers ───

  _uuid() {
    return require('crypto').randomUUID();
  }

  // BUG-32 FIX: Previous implementation called randomBytes(length) then substring(0, length),
  // discarding half the entropy (randomBytes(N) gives 2N hex chars). Now we generate exactly
  // ceil(length/2) bytes so the output has the full entropy of `length` hex characters.
  _generateKey(length) {
    return require('crypto').randomBytes(Math.ceil(length / 2)).toString('hex').substring(0, length);
  }
}

// Singleton
let dbInstance = null;
function getDatabase(config) {
  if (!dbInstance) dbInstance = new Database(config);
  return dbInstance;
}

module.exports = { Database, getDatabase };
