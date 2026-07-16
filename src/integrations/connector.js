'use strict';
// ============================================================
// NodeFlow — Conector de integraciones (2026-07-17)
// ------------------------------------------------------------
// La objeción nº1 de la crítica sectorial (gravedad 5 × 32 sectores): "solo
// hablamos con Google Calendar; el negocio vive en su software vertical → doble
// tecleo, agenda paralela, overbooking". Este es el motor genérico que EMPUJA
// los eventos de NodeFlow (cita creada/actualizada/cancelada, lead) a cualquier
// sistema externo (Zapier/Make, un PMS con inbox, un endpoint propio) por
// webhook FIRMADO (HMAC-SHA256), con reintentos. Y verifica el INGRESO de vuelta.
//
// Config por negocio en automation_config.config.integrations:
//   { enabled: true,
//     outbound: [ { url, secret?, events?: ['appointment.saved', ...] } ],
//     inboundSecret: '...' }   // para verificar lo que entra
// Sin config → NO-OP total (coste cero para quien no la use). FAIL-OPEN: un
// webhook caído JAMÁS afecta al flujo de citas/llamadas.
// ============================================================

const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const log = new Logger('CONNECTOR');

const TIMEOUT_MS   = Number(process.env.INTEGRATION_TIMEOUT_MS) || 5000;
const MAX_ATTEMPTS = Math.max(1, Number(process.env.INTEGRATION_MAX_ATTEMPTS) || 3);
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

// ── Firma ────────────────────────────────────────────────────────────────────
function sign(signedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/** Verifica una petición ENTRANTE de un sistema externo. `${timestamp}.${rawBody}`
 *  firmado con el inboundSecret del negocio. Rechaza timestamps viejos (replay). PURA. */
function verifyInbound({ rawBody, signature, timestamp, secret }, now = Date.now()) {
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > REPLAY_WINDOW_MS) return false;
  const expected = sign(`${timestamp}.${rawBody != null ? rawBody : ''}`, secret);
  try {
    const a = Buffer.from(expected), b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}

// ── Config (cache corto por org, no golpear la BD en cada evento) ────────────
const _cache = new Map(); // orgId -> { cfg, ts }
function _fromOrg(org) {
  return (org && org.automation_config && org.automation_config.config && org.automation_config.config.integrations) || null;
}
async function configFor(orgId, opts = {}) {
  if (opts.config !== undefined) return opts.config;
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return null;
  const now = opts.now || Date.now();
  const hit = _cache.get(orgId);
  if (hit && now - hit.ts < 60000) return hit.cfg;
  let cfg = null;
  try {
    const { data } = await db.client.from('organizations')
      .select('automation_config').eq('id', orgId).maybeSingle();
    cfg = (data && data.automation_config && data.automation_config.config && data.automation_config.config.integrations) || null;
  } catch (e) { log.warn(`configFor(${orgId}): ${e.message}`); }
  _cache.set(orgId, { cfg, ts: now });
  return cfg;
}
function _clearCache() { _cache.clear(); }

// ── Envío saliente ──────────────────────────────────────────────────────────
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _deliver(fetchImpl, hook, event, bodyStr, opts = {}) {
  const ts = opts.ts || Date.now();
  const headers = {
    'Content-Type': 'application/json',
    'X-NodeFlow-Event': event,
    'X-NodeFlow-Timestamp': String(ts),
  };
  if (hook.secret) headers['X-NodeFlow-Signature'] = sign(`${ts}.${bodyStr}`, hook.secret);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      let res;
      try {
        res = await fetchImpl(hook.url, { method: 'POST', headers, body: bodyStr, signal: ctrl ? ctrl.signal : undefined });
      } finally { if (timer) clearTimeout(timer); }
      if (res && res.ok) return true;
      const code = res && res.status;
      // 4xx (salvo 429) = error del destino, no reintentar.
      if (code && code >= 400 && code < 500 && code !== 429) {
        log.warn(`webhook ${hook.url} rechazó ${code} (no se reintenta)`);
        return false;
      }
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) log.warn(`webhook ${hook.url} falló: ${e.message}`);
    }
    if (attempt < MAX_ATTEMPTS) await _sleep((opts.backoffMs != null ? opts.backoffMs : 300) * attempt);
  }
  log.warn(`webhook ${hook.url} no entregó tras ${MAX_ATTEMPTS} intentos`);
  return false;
}

/**
 * Dispara un evento a los webhooks salientes suscritos del negocio.
 * FAIL-OPEN y no bloqueante para el llamante (usa emit()). deps inyectables.
 * @returns {Promise<{delivered:number,total:number,skipped?:boolean}>}
 */
async function dispatch(orgId, event, data, opts = {}) {
  const cfg = await configFor(orgId, opts);
  if (!cfg || cfg.enabled === false) return { delivered: 0, total: 0, skipped: true };
  const hooks = (cfg.outbound || []).filter(h => h && h.url && (!Array.isArray(h.events) || h.events.includes(event)));
  if (!hooks.length) return { delivered: 0, total: 0 };

  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) { log.warn('sin fetch disponible para webhooks salientes'); return { delivered: 0, total: hooks.length }; }

  const payload = { event, org_id: orgId, at: opts.nowIso || new Date().toISOString(), data };
  const bodyStr = JSON.stringify(payload);
  let delivered = 0;
  for (const h of hooks) {
    if (await _deliver(fetchImpl, h, event, bodyStr, opts)) delivered++;
  }
  if (delivered) log.info(`evento '${event}' → ${delivered}/${hooks.length} webhook(s) de ${orgId}`);
  return { delivered, total: hooks.length };
}

/** Versión fire-and-forget para HOT PATHS (crear/cancelar cita): nunca lanza ni
 *  bloquea. Úsala sin await desde el pipeline de voz / persistencia. */
function emit(orgId, event, data, opts = {}) {
  try {
    Promise.resolve(dispatch(orgId, event, data, opts)).catch(e => log.warn(`emit ${event}: ${e.message}`));
  } catch (e) { log.warn(`emit ${event}: ${e.message}`); }
}

module.exports = { sign, verifyInbound, configFor, dispatch, emit, _clearCache, TIMEOUT_MS, MAX_ATTEMPTS };
