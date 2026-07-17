'use strict';
// ============================================================
// NodeFlow — Bonos / paquetes prepagados de sesiones (2026-07-17)
// Objeción nº3 de la crítica sectorial (~15 sectores: wellness, estética, láser,
// fisio por sesiones): venden BONOS ("10 sesiones"), con saldo y caducidad.
// DB-gated: si la tabla nf_bonos no existe (42P01) o la DB está off → NO-OP
// (todo se comporta como hasta ahora). Consumo ATÓMICO (CAS por fila) para que
// dos reservas simultáneas no gasten la misma sesión dos veces.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('BONOS');

function _variants(phone) {
  try { return require('../utils/phone').phoneVariants(phone); } catch (_) { return [phone]; }
}
function _todayMadrid() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}
function _notExpired(b, today) { return !b.expires_at || b.expires_at >= today; }
function _left(b) { return Math.max(0, (b.total_sessions || 0) - (b.used_sessions || 0)); }

/** Bonos ACTIVOS (no caducados, con saldo) del contacto para un servicio. */
async function _activeBonos(orgId, phone, serviceKey, db, today) {
  let q = db.client.from('nf_bonos')
    .select('id,total_sessions,used_sessions,expires_at,service_key,label')
    .eq('org_id', orgId).in('phone', _variants(phone));
  const { data, error } = await q;
  if (error) { if (error.code === '42P01') return null; throw error; }
  return (data || [])
    .filter(b => _notExpired(b, today))
    .filter(b => !serviceKey || !b.service_key || b.service_key === serviceKey)
    .filter(b => _left(b) > 0);
}

/**
 * Saldo total de sesiones del contacto para un servicio.
 * @returns {Promise<number|null>} nº de sesiones, o null si NO tiene bono
 *          (null ≠ 0: "sin bono" es distinto de "bono agotado").
 */
async function getBalance(orgId, phone, serviceKey = null, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !phone) return null;
  try {
    const rows = await _activeBonos(orgId, phone, serviceKey, db, opts.today || _todayMadrid());
    if (rows === null) return null;                 // sin tabla
    // ¿tiene ALGÚN bono (aunque agotado/caducado)? — para distinguir null vs 0
    const all = await db.client.from('nf_bonos').select('id').eq('org_id', orgId).in('phone', _variants(phone)).limit(1);
    const hasAny = Array.isArray(all.data) && all.data.length > 0;
    const remaining = rows.reduce((s, b) => s + _left(b), 0);
    return hasAny ? remaining : null;
  } catch (e) { log.warn(`getBalance: ${e.message}`); return null; }
}

/**
 * Consume UNA sesión del bono activo más próximo a caducar. ATÓMICO (CAS).
 * @returns {Promise<{consumed:boolean, remaining?:number, bonoId?:string}>}
 */
async function consumeOne(orgId, phone, serviceKey = null, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !phone) return { consumed: false };
  const today = opts.today || _todayMadrid();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = await _activeBonos(orgId, phone, serviceKey, db, today);
      if (rows === null || !rows.length) return { consumed: false };
      // el que antes caduca primero (los sin caducidad, al final)
      rows.sort((a, b) => (a.expires_at || '9999').localeCompare(b.expires_at || '9999'));
      const b = rows[0];
      const { data, error } = await db.client.from('nf_bonos')
        .update({ used_sessions: (b.used_sessions || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', b.id).eq('used_sessions', b.used_sessions || 0) // CAS: solo si nadie lo tocó
        .select('id,total_sessions,used_sessions');
      if (error) { if (error.code === '42P01') return { consumed: false }; throw error; }
      if (Array.isArray(data) && data.length) {
        // Ledger persistente (best-effort): enlaza cita↔bono para poder reembolsar
        // con exactitud al cancelar aunque el server se reinicie. Sin la tabla
        // (42P01) el reembolso cae al bonoId en memoria — no se pierde robustez.
        if (opts.appointmentId) {
          try {
            const { error: le } = await db.client.from('nf_bono_consumptions')
              .insert({ org_id: orgId, bono_id: b.id, appointment_id: opts.appointmentId });
            if (le && le.code !== '42P01' && le.code !== '23505') log.warn(`ledger consumo: ${le.message}`);
          } catch (_) {}
        }
        return { consumed: true, bonoId: b.id, remaining: _left(data[0]) };
      }
      // colisión: otro proceso consumió; reintenta con datos frescos
    }
    return { consumed: false };
  } catch (e) { log.warn(`consumeOne: ${e.message}`); return { consumed: false }; }
}

/**
 * Devuelve UNA sesión a un bono concreto (reembolso al cancelar la cita).
 * ATÓMICO (CAS). No baja de 0. @returns {Promise<{refunded:boolean, remaining?:number}>}
 */
async function refundOne(orgId, bonoId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !bonoId) return { refunded: false };
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: rows, error } = await db.client.from('nf_bonos')
        .select('id,used_sessions,total_sessions').eq('id', bonoId).eq('org_id', orgId).limit(1);
      if (error) { if (error.code === '42P01') return { refunded: false }; throw error; }
      const b = rows && rows[0];
      if (!b || (b.used_sessions || 0) <= 0) return { refunded: false };
      const { data, error: e2 } = await db.client.from('nf_bonos')
        .update({ used_sessions: b.used_sessions - 1, updated_at: new Date().toISOString() })
        .eq('id', bonoId).eq('used_sessions', b.used_sessions) // CAS
        .select('id,total_sessions,used_sessions');
      if (e2) { if (e2.code === '42P01') return { refunded: false }; throw e2; }
      if (Array.isArray(data) && data.length) return { refunded: true, remaining: _left(data[0]) };
    }
    return { refunded: false };
  } catch (e) { log.warn(`refundOne: ${e.message}`); return { refunded: false }; }
}

/**
 * Reembolsa la sesión que consumió una cita, localizándola en el ledger
 * persistente (sobrevive a reinicios). Borra el registro para no reembolsar dos
 * veces. Si no hay ledger/registro → {refunded:false} (el llamante puede caer al
 * bonoId en memoria). @returns {Promise<{refunded:boolean, remaining?:number, reason?:string}>}
 */
async function refundByAppointment(orgId, appointmentId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !appointmentId) return { refunded: false };
  try {
    const { data, error } = await db.client.from('nf_bono_consumptions')
      .select('id,bono_id').eq('org_id', orgId).eq('appointment_id', appointmentId).limit(1);
    if (error) { if (error.code === '42P01') return { refunded: false, reason: 'no_ledger' }; throw error; }
    const row = data && data[0];
    if (!row) return { refunded: false, reason: 'no_consumption' };
    const r = await refundOne(orgId, row.bono_id, { db });
    try { await db.client.from('nf_bono_consumptions').delete().eq('id', row.id); } catch (_) {}
    return r;
  } catch (e) { log.warn(`refundByAppointment: ${e.message}`); return { refunded: false }; }
}

/** Alta/recarga de un bono (uso admin/portal). */
async function grantBono(orgId, { phone, contactId = null, serviceKey = null, label = null, sessions, expiresAt = null }, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !phone || !(sessions > 0)) return { ok: false };
  try {
    const { data, error } = await db.client.from('nf_bonos').insert({
      org_id: orgId, contact_id: contactId, phone, service_key: serviceKey,
      label, total_sessions: sessions, used_sessions: 0, expires_at: expiresAt,
    }).select('id').single();
    if (error) { if (error.code === '42P01') return { ok: false, reason: 'no_table' }; throw error; }
    return { ok: true, id: data.id };
  } catch (e) { log.warn(`grantBono: ${e.message}`); return { ok: false }; }
}

module.exports = { getBalance, consumeOne, refundOne, refundByAppointment, grantBono, _left, _notExpired };
