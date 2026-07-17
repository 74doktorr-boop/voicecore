'use strict';
// ============================================================
// NodeFlow — Estancias por noches / inventario por fechas (2026-07-17)
// Hotel, residencia de mascotas, guardería: reservan un RANGO de fechas con
// plazas por noche, no una cita a una hora. Este motor calcula disponibilidad
// por noche contra el aforo de la unidad y reserva/cancela. DB-gated: NO-OP sin
// la tabla nf_stays (42P01) → cero cambio de comportamiento.
//
// Config del negocio (automation_config.config.stayUnits):
//   [ { key: 'suite', label: 'Suite', capacity: 4 }, ... ]
// checkout es EXCLUSIVO: una estancia 01→04 ocupa las noches 01, 02 y 03.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('STAYS');

// ── Helpers puros (testeables sin BD) ────────────────────────────────────────

/** Lista de noches ocupadas de un rango [checkin, checkout). PURA. */
function nightsBetween(checkin, checkout) {
  const out = [];
  const [y1, m1, d1] = String(checkin).split('-').map(Number);
  const [y2, m2, d2] = String(checkout).split('-').map(Number);
  if (!y1 || !y2) return out;
  const end = new Date(y2, m2 - 1, d2);
  for (let d = new Date(y1, m1 - 1, d1); d < end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/** ¿Una estancia ocupa la noche `night`? checkin <= night < checkout. PURA. */
function occupiesNight(stay, night) {
  return String(stay.checkin) <= night && night < String(stay.checkout);
}

/**
 * ¿Cabe una reserva de `units` plazas en [checkin, checkout) dado el aforo?
 * Devuelve { available, fullNights[] }. PURA — recibe las estancias ya activas.
 */
function rangeAvailability(existingStays, checkin, checkout, capacity, units = 1) {
  const fullNights = [];
  for (const night of nightsBetween(checkin, checkout)) {
    let occupied = 0;
    for (const s of existingStays) {
      if (s.status === 'cancelled') continue;
      if (occupiesNight(s, night)) occupied += (s.units || 1);
    }
    if (occupied + units > capacity) fullNights.push(night);
  }
  return { available: fullNights.length === 0, fullNights };
}

// ── Capa BD (DB-gated) ───────────────────────────────────────────────────────

function _validRange(checkin, checkout) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return re.test(checkin || '') && re.test(checkout || '') && String(checkout) > String(checkin);
}

/** Estancias activas del negocio que solapan un rango (para el cálculo). */
async function _overlapping(db, orgId, unitKey, checkin, checkout) {
  let q = db.client.from('nf_stays')
    .select('id,unit_key,checkin,checkout,units,status')
    .eq('org_id', orgId).neq('status', 'cancelled')
    .lt('checkin', checkout).gt('checkout', checkin); // solape de rangos
  if (unitKey) q = q.eq('unit_key', unitKey);
  const { data, error } = await q;
  if (error) { if (error.code === '42P01') return null; throw error; }
  return data || [];
}

/** Disponibilidad de un rango. @returns {available, fullNights} | {available:false, reason} */
async function checkStayAvailability(orgId, { unitKey = null, checkin, checkout, units = 1, capacity }, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { available: false, reason: 'no_db' };
  if (!_validRange(checkin, checkout)) return { available: false, reason: 'rango_invalido' };
  if (!(capacity > 0)) return { available: false, reason: 'sin_aforo' };
  try {
    const stays = await _overlapping(db, orgId, unitKey, checkin, checkout);
    if (stays === null) return { available: false, reason: 'no_table' };
    return rangeAvailability(stays, checkin, checkout, capacity, units);
  } catch (e) { log.warn(`checkStayAvailability: ${e.message}`); return { available: false, reason: 'error' }; }
}

/** Reserva una estancia si hay hueco todas las noches. @returns {success, id?|error} */
async function bookStay(orgId, { unitKey = null, guestName, phone, checkin, checkout, units = 1, capacity, notes = null }, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { success: false, error: 'sin BD' };
  const av = await checkStayAvailability(orgId, { unitKey, checkin, checkout, units, capacity }, { db });
  if (!av.available) {
    return { success: false, error: av.reason || 'sin_disponibilidad', fullNights: av.fullNights || [] };
  }
  try {
    const { data, error } = await db.client.from('nf_stays').insert({
      org_id: orgId, unit_key: unitKey, guest_name: guestName, phone,
      checkin, checkout, units, notes, status: 'confirmed',
    }).select('id').single();
    if (error) { if (error.code === '42P01') return { success: false, error: 'no_table' }; throw error; }
    log.info(`Estancia reservada ${data.id} (${orgId} ${unitKey || '-'} ${checkin}→${checkout})`);
    return { success: true, id: data.id };
  } catch (e) { log.warn(`bookStay: ${e.message}`); return { success: false, error: 'error' }; }
}

/** Cancela una estancia (scoped a org). */
async function cancelStay(orgId, stayId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId || !stayId) return { success: false };
  try {
    const { data, error } = await db.client.from('nf_stays')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', stayId).eq('org_id', orgId).neq('status', 'cancelled')
      .select('id');
    if (error) { if (error.code === '42P01') return { success: false }; throw error; }
    return { success: Array.isArray(data) && data.length > 0 };
  } catch (e) { log.warn(`cancelStay: ${e.message}`); return { success: false }; }
}

module.exports = {
  nightsBetween, occupiesNight, rangeAvailability,
  checkStayAvailability, bookStay, cancelStay,
};
