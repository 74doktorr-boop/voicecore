// ============================================================
// NodeFlow — Sistema de Referidos
// Cada negocio activo tiene un código único. Otro negocio que se
// registra y paga con él entra con descuento, y el que refirió
// gana una recompensa.
//
// Tablas: nf_referrals, nf_referral_conversions (ver migración).
// ============================================================

'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { Logger } = require('../utils/logger');

const log = new Logger('REFERRALS');

const REFEREE_DISCOUNT = 15; // % de descuento para el negocio nuevo

// Caché en memoria: orgId → code (los códigos no cambian)
const _codeCache = new Map();

/** Slug corto y limpio a partir del nombre del negocio. */
function slugify(name) {
  return String(name || 'NF')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar acentos
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'NF';
}

/** Genera un código único: REF-<SLUG>-<4 hex>. */
function buildCode(bizName) {
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `REF-${slugify(bizName)}-${rand}`;
}

/**
 * Devuelve el código de referido de un negocio, creándolo si no existe.
 * @param {string} orgId
 * @param {{ name?: string, email?: string }} [info]
 * @returns {Promise<string|null>}
 */
async function getOrCreateCode(orgId, info = {}) {
  if (!orgId) return null;
  if (_codeCache.has(orgId)) return _codeCache.get(orgId);

  const db = getDatabase();
  if (!db.enabled) return null;

  try {
    // ¿Ya tiene código?
    const { data: existing } = await db.client
      .from('nf_referrals')
      .select('code')
      .eq('referrer_org_id', orgId)
      .limit(1)
      .maybeSingle();

    if (existing?.code) {
      _codeCache.set(orgId, existing.code);
      return existing.code;
    }

    // Crear uno nuevo (reintenta si colisiona el PK)
    for (let i = 0; i < 5; i++) {
      const code = buildCode(info.name);
      const { error } = await db.client.from('nf_referrals').insert({
        code,
        referrer_org_id: orgId,
        referrer_email:  info.email || null,
        referee_discount: REFEREE_DISCOUNT,
      });
      if (!error) {
        _codeCache.set(orgId, code);
        log.info(`Código de referido creado para ${orgId}: ${code}`);
        return code;
      }
      if (error.code !== '23505') { // 23505 = colisión PK → reintenta
        log.warn(`getOrCreateCode(${orgId}): ${error.message}`);
        return null;
      }
    }
    return null;
  } catch (e) {
    log.warn(`getOrCreateCode(${orgId}) exception: ${e.message}`);
    return null;
  }
}

/**
 * Valida un código de referido. Devuelve datos como un cupón si es válido.
 * @param {string} code
 * @returns {Promise<{ code, discount, source, stripeCode, referrerOrgId } | null>}
 */
async function lookupReferral(code) {
  if (!code) return null;
  const norm = code.toUpperCase().trim();
  if (!norm.startsWith('REF-')) return null; // atajo: los referidos siempre empiezan REF-

  const db = getDatabase();
  if (!db.enabled) return null;

  try {
    const { data } = await db.client
      .from('nf_referrals')
      .select('code, referrer_org_id, referee_discount')
      .eq('code', norm)
      .maybeSingle();
    if (!data) return null;
    return {
      code:        data.code,
      discount:    data.referee_discount || REFEREE_DISCOUNT,
      source:      'referral',
      stripeCode:  null, // los referidos no usan promo code de Stripe; el descuento se aplica manualmente o vía Stripe coupon genérico
      referrerOrgId: data.referrer_org_id,
    };
  } catch (e) {
    log.warn(`lookupReferral(${norm}): ${e.message}`);
    return null;
  }
}

/**
 * Registra que un nuevo negocio se ha REGISTRADO con un código (aún no pagó).
 */
async function recordSignup(code, refereeRegistroId, refereeEmail) {
  const db = getDatabase();
  if (!db.enabled || !code) return;
  try {
    await db.client.from('nf_referral_conversions').insert({
      code: code.toUpperCase().trim(),
      referee_registro_id: refereeRegistroId || null,
      referee_email: refereeEmail || null,
      status: 'signup',
    });
    await _bumpCounter(db, code, 'times_shared');
    log.info(`Referido usado en registro: ${code} ← ${refereeEmail || refereeRegistroId}`);
  } catch (e) {
    // El índice único evita duplicados por registro — error esperado si se reintenta
    if (e.code !== '23505') log.warn(`recordSignup(${code}): ${e.message}`);
  }
}

/**
 * Marca una conversión (el referido PAGÓ). Suma recompensa pendiente al referrer.
 * @returns {Promise<{ referrerOrgId, referrerEmail } | null>} datos del referrer para notificar
 */
async function recordConversion(code, refereeRegistroId) {
  const db = getDatabase();
  if (!db.enabled || !code) return null;
  const norm = code.toUpperCase().trim();
  try {
    // Marcar la conversión (si existe el registro de signup)
    if (refereeRegistroId) {
      await db.client.from('nf_referral_conversions')
        .update({ status: 'converted', converted_at: new Date().toISOString() })
        .eq('referee_registro_id', refereeRegistroId);
    }
    // Sumar conversión + recompensa pendiente al referrer
    const { data: ref } = await db.client
      .from('nf_referrals')
      .select('referrer_org_id, referrer_email, times_converted, reward_pending')
      .eq('code', norm)
      .maybeSingle();
    if (!ref) return null;

    await db.client.from('nf_referrals').update({
      times_converted: (ref.times_converted || 0) + 1,
      reward_pending:  (ref.reward_pending || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('code', norm);

    log.info(`Conversión de referido: ${norm} → recompensa pendiente para ${ref.referrer_org_id}`);
    return { referrerOrgId: ref.referrer_org_id, referrerEmail: ref.referrer_email };
  } catch (e) {
    log.warn(`recordConversion(${norm}): ${e.message}`);
    return null;
  }
}

/** Estadísticas para mostrar en el portal del referrer. */
async function getStats(orgId) {
  const db = getDatabase();
  if (!db.enabled || !orgId) return null;
  try {
    const { data } = await db.client
      .from('nf_referrals')
      .select('code, times_shared, times_converted, reward_pending')
      .eq('referrer_org_id', orgId)
      .maybeSingle();
    return data || null;
  } catch (e) {
    log.warn(`getStats(${orgId}): ${e.message}`);
    return null;
  }
}

async function _bumpCounter(db, code, field) {
  const norm = code.toUpperCase().trim();
  const { data } = await db.client.from('nf_referrals').select(field).eq('code', norm).maybeSingle();
  if (data) {
    await db.client.from('nf_referrals')
      .update({ [field]: (data[field] || 0) + 1, updated_at: new Date().toISOString() })
      .eq('code', norm);
  }
}

module.exports = {
  getOrCreateCode, lookupReferral, recordSignup, recordConversion, getStats,
  slugify, buildCode, REFEREE_DISCOUNT,
};
