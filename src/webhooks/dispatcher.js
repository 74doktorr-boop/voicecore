// ============================================
// NodeFlow — Webhook Dispatcher
// Fires signed HTTP events to business endpoints
// with retry logic and in-memory config cache.
//
// Usage:
//   const { webhookDispatcher } = require('./dispatcher');
//   webhookDispatcher.fire(businessId, 'call.completed', { callId, duration, ... });
// ============================================

const crypto = require('crypto');
const { Logger } = require('../utils/logger');

const log = new Logger('WEBHOOK');

// ─── Event types ───────────────────────────────────────────────────────────────
const EVENTS = {
  CALL_COMPLETED:       'call.completed',
  CALL_MISSED:          'call.missed',
  APPOINTMENT_BOOKED:   'appointment.booked',
  APPOINTMENT_CANCELLED:'appointment.cancelled',
  REMINDER_SENT:        'reminder.sent',
  REVIEW_REQUEST_SENT:  'review_request.sent',
};

// ─── Delivery constants ────────────────────────────────────────────────────────
const MAX_RETRIES  = 3;
const RETRY_DELAYS = [1_000, 5_000, 30_000]; // 1s, 5s, 30s
const TIMEOUT_MS   = 10_000;                  // 10s per attempt

// ─── HMAC-SHA256 signature ─────────────────────────────────────────────────────
function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Single delivery attempt ───────────────────────────────────────────────────
async function _attempt(config, eventType, payload) {
  const body = JSON.stringify(payload);
  const sig  = sign(config.secret, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(config.url, {
      method:  'POST',
      headers: {
        'Content-Type':         'application/json',
        'X-NodeFlow-Signature': sig,
        'X-NodeFlow-Event':     eventType,
        'X-NodeFlow-Delivery':  payload.deliveryId,
        'User-Agent':           'NodeFlow-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok ? 'ok' : `http-${res.status}`;
  } catch (err) {
    clearTimeout(timer);
    return err.name === 'AbortError' ? 'timeout' : `error:${err.message}`;
  }
}

// ─── Delivery with retry ───────────────────────────────────────────────────────
async function deliver(config, eventType, payload, attempt = 0) {
  const result = await _attempt(config, eventType, payload);
  if (result === 'ok') {
    log.info(`[webhook] ✓ ${eventType} → ${config.url} (attempt ${attempt + 1})`);
    return true;
  }

  log.warn(`[webhook] ✗ ${eventType} → ${config.url}: ${result} (attempt ${attempt + 1})`);

  if (attempt < MAX_RETRIES - 1) {
    const delay = RETRY_DELAYS[attempt];
    setTimeout(() => deliver(config, eventType, payload, attempt + 1), delay);
  } else {
    log.error(`[webhook] giving up after ${MAX_RETRIES} attempts: ${eventType} → ${config.url}`);
  }
  return false;
}

// ─── In-memory config cache (businessId → [configs]) ───────────────────────────
class WebhookDispatcher {
  constructor() {
    // businessId → Array<{id, url, secret, events, enabled}>
    this._cache  = new Map();
    // businessId → Promise (serializes DB reads per business)
    this._loads  = new Map();
    this._db     = null;
  }

  /** Call once during server init with the Database singleton */
  init(db) {
    this._db = db;
  }

  /** Evict cache entry — call after save/delete */
  invalidate(businessId) {
    this._cache.delete(businessId);
    this._loads.delete(businessId);
  }

  /** Get all enabled webhook configs for a business (cached) */
  async getConfigs(businessId) {
    if (this._cache.has(businessId)) return this._cache.get(businessId);

    // Serialize DB fetches per business to avoid redundant round-trips
    if (!this._loads.has(businessId)) {
      const load = this._fetchFromDB(businessId)
        .then(cfgs => { this._cache.set(businessId, cfgs); return cfgs; })
        .catch(() => { this._cache.set(businessId, []); return []; })
        .finally(() => this._loads.delete(businessId));
      this._loads.set(businessId, load);
    }
    return this._loads.get(businessId);
  }

  async _fetchFromDB(businessId) {
    if (!this._db?.enabled) return [];
    const { data, error } = await this._db.client
      .from('webhook_configs')
      .select('*')
      .eq('business_id', businessId)
      .eq('enabled', true);
    if (error && error.code !== '42P01') log.warn(`webhook DB read: ${error.message}`);
    return data || [];
  }

  /**
   * Fire an event to all matching webhook endpoints for a business.
   * Non-blocking — safe to call without await.
   *
   * @param {string} businessId
   * @param {string} eventType  — one of EVENTS.*
   * @param {object} data       — event-specific payload
   */
  async fire(businessId, eventType, data = {}) {
    let configs;
    try {
      configs = await this.getConfigs(businessId);
    } catch (_) {
      return;
    }

    const active = configs.filter(c =>
      c.enabled &&
      (
        (c.events && c.events.includes('*')) ||
        (c.events && c.events.includes(eventType)) ||
        !c.events || c.events.length === 0  // no filter = all events
      )
    );

    if (active.length === 0) return;

    const payload = {
      event:       eventType,
      businessId,
      timestamp:   new Date().toISOString(),
      deliveryId:  crypto.randomUUID(),
      data,
    };

    log.info(`[webhook] fire ${eventType} for ${businessId} (${active.length} endpoint${active.length > 1 ? 's' : ''})`);

    for (const config of active) {
      // Fully non-blocking — errors handled inside deliver()
      deliver(config, eventType, payload).catch(() => {});
    }
  }
}

const webhookDispatcher = new WebhookDispatcher();

module.exports = { webhookDispatcher, EVENTS };
