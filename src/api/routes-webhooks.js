// ============================================
// NodeFlow — Webhook Config API
// CRUD endpoints for portal webhook management
//
// GET    /api/portal/webhooks          → list all configs for authenticated org
// POST   /api/portal/webhooks          → create a new endpoint
// PATCH  /api/portal/webhooks/:id      → update (url, events, enabled)
// DELETE /api/portal/webhooks/:id      → remove endpoint
// POST   /api/portal/webhooks/:id/test → send a test ping
// ============================================

const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const { webhookDispatcher, EVENTS } = require('../webhooks/dispatcher');
const { getDatabase } = require('../db/database');

const log = new Logger('WEBHOOKS-API');

// ─── Valid event types ─────────────────────────────────────────────────────────
const VALID_EVENTS = Object.values(EVENTS).concat(['*']);

// Anti-SSRF (auditoría seguridad 2026-07-16): el dueño configura la URL del
// webhook y el endpoint "test" hace un fetch inmediato → sin este filtro podría
// sondear la red interna (169.254.169.254 metadata, 127.x, 10.x, etc.). Bloquea
// los destinos privados/loopback/link-local más evidentes.
function _isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)) return true;
  }
  return false;
}
// Valida la URL de un webhook: HTTPS + host público. Devuelve mensaje de error o null.
function _validateWebhookUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { return 'url must be a valid HTTPS URL'; }
  if (parsed.protocol !== 'https:') return 'url must use HTTPS';
  if (_isPrivateHost(parsed.hostname)) return 'url must point to a public host';
  return null;
}

// ─── In-memory fallback store (used when Supabase not configured) ───────────────
// businessId → Map<id, config>
const _memStore = new Map();

function _memGet(businessId) {
  if (!_memStore.has(businessId)) _memStore.set(businessId, new Map());
  return _memStore.get(businessId);
}

// ─── DB helpers ────────────────────────────────────────────────────────────────

async function dbList(db, businessId) {
  if (!db.enabled) {
    return Array.from(_memGet(businessId).values());
  }
  const { data, error } = await db.client
    .from('webhook_configs')
    .select('id, business_id, url, events, enabled, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error && error.code !== '42P01') throw new Error(error.message);
  return data || [];
}

async function dbCreate(db, businessId, { url, events, enabled = true }) {
  const id     = crypto.randomUUID();
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const record = {
    id,
    business_id: businessId,
    url,
    secret,
    events: events || ['*'],
    enabled,
    created_at: new Date().toISOString(),
  };

  if (!db.enabled) {
    _memGet(businessId).set(id, record);
    return record;
  }

  const { data, error } = await db.client
    .from('webhook_configs')
    .insert(record)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbUpdate(db, businessId, id, patch) {
  if (!db.enabled) {
    const store = _memGet(businessId);
    const rec   = store.get(id);
    if (!rec || rec.business_id !== businessId) return null;
    const updated = { ...rec, ...patch, updated_at: new Date().toISOString() };
    store.set(id, updated);
    return updated;
  }

  const { data, error } = await db.client
    .from('webhook_configs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function dbDelete(db, businessId, id) {
  if (!db.enabled) {
    return _memGet(businessId).delete(id);
  }
  const { error } = await db.client
    .from('webhook_configs')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw new Error(error.message);
}

async function dbGetOne(db, businessId, id) {
  if (!db.enabled) {
    return _memGet(businessId).get(id) || null;
  }
  const { data, error } = await db.client
    .from('webhook_configs')
    .select('*')
    .eq('id', id)
    .eq('business_id', businessId)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data || null;
}

// ─── Route setup ───────────────────────────────────────────────────────────────

function setupWebhookRoutes(app) {
  const { portalAuth } = require('./routes-portal');

  // ── List webhooks ────────────────────────────────────────────────────────────
  app.get('/api/portal/webhooks', portalAuth, async (req, res) => {
    const db = getDatabase();
    try {
      const configs = await dbList(db, req.businessId);
      // Never expose the secret in list response
      const safe = configs.map(({ secret: _s, ...rest }) => rest);
      res.json({ count: safe.length, webhooks: safe });
    } catch (e) {
      log.error(`list webhooks: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create webhook ───────────────────────────────────────────────────────────
  app.post('/api/portal/webhooks', portalAuth, async (req, res) => {
    const { url, events } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    {
      const err = _validateWebhookUrl(url);
      if (err) return res.status(400).json({ error: err });
    }

    if (events !== undefined) {
      if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' });
      const invalid = events.filter(e => !VALID_EVENTS.includes(e));
      if (invalid.length) return res.status(400).json({ error: `Unknown events: ${invalid.join(', ')}. Valid: ${VALID_EVENTS.join(', ')}` });
    }

    const db = getDatabase();
    try {
      const record = await dbCreate(db, req.businessId, { url, events });
      webhookDispatcher.invalidate(req.businessId);
      log.info(`webhook created: ${record.id} → ${url} (${req.businessId})`);
      res.status(201).json({
        message: 'Webhook created. Save the secret — it is only shown once.',
        webhook: record,
      });
    } catch (e) {
      log.error(`create webhook: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Update webhook ───────────────────────────────────────────────────────────
  app.patch('/api/portal/webhooks/:id', portalAuth, async (req, res) => {
    const allowed = ['url', 'events', 'enabled'];
    const patch   = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    if (patch.url) {
      const err = _validateWebhookUrl(patch.url);
      if (err) return res.status(400).json({ error: err });
    }

    if (patch.events !== undefined) {
      if (!Array.isArray(patch.events)) return res.status(400).json({ error: 'events must be an array' });
      const invalid = patch.events.filter(e => !VALID_EVENTS.includes(e));
      if (invalid.length) return res.status(400).json({ error: `Unknown events: ${invalid.join(', ')}` });
    }

    const db = getDatabase();
    try {
      const updated = await dbUpdate(db, req.businessId, req.params.id, patch);
      if (!updated) return res.status(404).json({ error: 'Webhook not found' });
      webhookDispatcher.invalidate(req.businessId);
      const { secret: _s, ...safe } = updated;
      res.json(safe);
    } catch (e) {
      log.error(`update webhook: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete webhook ───────────────────────────────────────────────────────────
  app.delete('/api/portal/webhooks/:id', portalAuth, async (req, res) => {
    const db = getDatabase();
    try {
      const rec = await dbGetOne(db, req.businessId, req.params.id);
      if (!rec) return res.status(404).json({ error: 'Webhook not found' });
      await dbDelete(db, req.businessId, req.params.id);
      webhookDispatcher.invalidate(req.businessId);
      log.info(`webhook deleted: ${req.params.id} (${req.businessId})`);
      res.json({ success: true });
    } catch (e) {
      log.error(`delete webhook: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Send test ping ───────────────────────────────────────────────────────────
  app.post('/api/portal/webhooks/:id/test', portalAuth, async (req, res) => {
    const db = getDatabase();
    try {
      const config = await dbGetOne(db, req.businessId, req.params.id);
      if (!config) return res.status(404).json({ error: 'Webhook not found' });
      if (!config.enabled) return res.status(400).json({ error: 'Webhook is disabled' });

      const payload = {
        event:      'webhook.test',
        businessId: req.businessId,
        timestamp:  new Date().toISOString(),
        deliveryId: crypto.randomUUID(),
        data:       { message: 'This is a test delivery from NodeFlow.' },
      };

      const body = JSON.stringify(payload);
      const sig  = 'sha256=' + require('crypto').createHmac('sha256', config.secret).update(body).digest('hex');

      let status = null;
      let ok     = false;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const resp = await fetch(config.url, {
          method:  'POST',
          headers: {
            'Content-Type':         'application/json',
            'X-NodeFlow-Signature': sig,
            'X-NodeFlow-Event':     'webhook.test',
            'X-NodeFlow-Delivery':  payload.deliveryId,
            'User-Agent':           'NodeFlow-Webhook/1.0',
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        status = resp.status;
        ok     = resp.ok;
      } catch (err) {
        status = 0;
        ok     = false;
      }

      log.info(`webhook test: ${config.url} → ${status}`);
      res.json({ ok, status, url: config.url });
    } catch (e) {
      log.error(`test webhook: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Expose valid event types ─────────────────────────────────────────────────
  app.get('/api/portal/webhooks/events', portalAuth, (_req, res) => {
    res.json({ events: VALID_EVENTS });
  });

  log.info('Webhook routes configured → /api/portal/webhooks/*');
}

module.exports = { setupWebhookRoutes };
