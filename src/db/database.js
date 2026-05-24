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

  async createOrg({ name, slug, ownerEmail, ownerName, plan = 'starter', phone }) {
    const apiKey = `vc_${this._generateKey(32)}`;
    if (!this.enabled) return { id: this._uuid(), name, slug, api_key: apiKey, plan };

    const { data, error } = await this.client.from('organizations').insert({
      name, slug, owner_email: ownerEmail, owner_name: ownerName, plan, phone, api_key: apiKey,
      monthly_minutes_limit: plan === 'pro' ? 500 : plan === 'business' ? 2000 : 50,
    }).select().single();

    if (error) throw new Error(`Create org failed: ${error.message}`);
    log.info(`Org created: ${data.id} — ${name}`);
    return data;
  }

  async getOrgByApiKey(apiKey) {
    if (!this.enabled) return null;
    const { data } = await this.client.from('organizations')
      .select('*').eq('api_key', apiKey).eq('is_active', true).single();
    return data;
  }

  async getOrg(id) {
    if (!this.enabled) return null;
    const { data } = await this.client.from('organizations').select('*').eq('id', id).single();
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
    const { data } = await this.client.from('assistants')
      .select('*').eq('org_id', orgId).eq('id', assistantId).single();
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

  async createCall(orgId, callData) {
    if (!this.enabled) return { id: this._uuid(), org_id: orgId, ...callData };

    const { data, error } = await this.client.from('calls').insert({
      org_id: orgId,
      assistant_id: callData.assistantId,
      call_sid: callData.callSid,
      caller_number: callData.callerNumber,
      called_number: callData.calledNumber,
      direction: callData.direction || 'inbound',
      status: 'active',
      stt_provider: callData.sttProvider,
      llm_provider: callData.llmProvider,
      tts_provider: callData.ttsProvider,
    }).select().single();

    if (error) throw new Error(`Create call failed: ${error.message}`);
    return data;
  }

  async endCall(callId, callData) {
    if (!this.enabled) return callData;

    const { data, error } = await this.client.from('calls').update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      duration_ms: callData.duration,
      turn_count: callData.turnCount,
      transcript: callData.transcript,
      metrics: callData.metrics,
      cost: callData.cost,
      total_cost: callData.cost?.total || 0,
    }).eq('id', callId).select().single();

    if (error) log.error(`End call DB update failed: ${error.message}`);
    return data || callData;
  }

  async getCalls(orgId, { limit = 50, offset = 0, status } = {}) {
    if (!this.enabled) return [];
    let query = this.client.from('calls').select('*').eq('org_id', orgId)
      .order('started_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data || [];
  }

  async getCall(orgId, callId) {
    if (!this.enabled) return null;
    const { data } = await this.client.from('calls')
      .select('*').eq('org_id', orgId).eq('id', callId).single();
    return data;
  }

  // ─── Usage Tracking ───

  async trackUsage(orgId, usageData) {
    if (!this.enabled) return;
    const period = new Date().toISOString().substring(0, 7); // YYYY-MM

    const { data: existing } = await this.client.from('usage')
      .select('*').eq('org_id', orgId).eq('period', period).single();

    if (existing) {
      await this.client.from('usage').update({
        call_count: existing.call_count + (usageData.calls || 0),
        call_minutes: parseFloat(existing.call_minutes) + (usageData.minutes || 0),
        stt_minutes: parseFloat(existing.stt_minutes) + (usageData.sttMinutes || 0),
        llm_tokens: existing.llm_tokens + (usageData.llmTokens || 0),
        tts_characters: existing.tts_characters + (usageData.ttsCharacters || 0),
        tool_calls: existing.tool_calls + (usageData.toolCalls || 0),
        total_cost: parseFloat(existing.total_cost) + (usageData.cost || 0),
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await this.client.from('usage').insert({
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
    }
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
    const { data } = await this.client.from('webhooks')
      .select('*').eq('org_id', orgId).eq('is_active', true);
    return data || [];
  }

  // ─── Helpers ───

  _uuid() {
    return require('crypto').randomUUID();
  }

  _generateKey(length) {
    return require('crypto').randomBytes(length).toString('hex').substring(0, length);
  }
}

// Singleton
let dbInstance = null;
function getDatabase(config) {
  if (!dbInstance) dbInstance = new Database(config);
  return dbInstance;
}

module.exports = { Database, getDatabase };
