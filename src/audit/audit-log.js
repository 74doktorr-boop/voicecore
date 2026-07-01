// ============================================================
// NodeFlow — Registro de auditoría (quién hizo qué y cuándo)
// ------------------------------------------------------------
// Traza las acciones sensibles del panel admin (login, alta/edición/baja
// de clientes, cambios de plan, etc.) en la tabla `audit_log`.
// BEST-EFFORT: si la tabla no existe o falla, NUNCA bloquea la acción
// (solo loguea un warning). El `db` es inyectable → testeable sin Supabase.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('AUDIT');

function _db(deps) {
  if (deps && deps.db) return deps.db;
  return require('../db/database').getDatabase();
}

/**
 * Registra un evento de auditoría (no lanza nunca).
 * @param {object} evt { actor, action, targetType, targetId, details, ip }
 * @param {object} [deps] { db }  (para tests)
 */
async function recordAudit(evt, deps) {
  try {
    const db = _db(deps);
    if (!db || !db.enabled) return { ok: false, skipped: 'db' };
    const row = {
      actor: evt.actor || 'admin',
      action: evt.action,
      target_type: evt.targetType || null,
      target_id: evt.targetId != null ? String(evt.targetId) : null,
      details: evt.details || {},
      ip: evt.ip || null,
    };
    const { error } = await db.client.from('audit_log').insert(row);
    if (error) { log.warn(`audit insert: ${error.message}`); return { ok: false, error: error.message }; }
    return { ok: true };
  } catch (e) {
    log.warn(`audit insert exception: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * Lista eventos de auditoría (más recientes primero). Filtros opcionales.
 * @param {object} [opts] { limit, action, actor }
 * @param {object} [deps] { db }
 */
async function listAudit(opts = {}, deps) {
  try {
    const db = _db(deps);
    if (!db || !db.enabled) return [];
    let q = db.client.from('audit_log').select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(opts.limit) || 100, 500));
    if (opts.action) q = q.eq('action', opts.action);
    if (opts.actor) q = q.eq('actor', opts.actor);
    const { data, error } = await q;
    if (error) { log.warn(`audit list: ${error.message}`); return []; }
    return data || [];
  } catch (e) {
    log.warn(`audit list exception: ${e.message}`);
    return [];
  }
}

/** Helper: extrae la IP del request de forma segura. */
function ipOf(req) {
  return (req && (req.ip || req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress)) || null;
}

module.exports = { recordAudit, listAudit, ipOf };
