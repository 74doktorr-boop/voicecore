// ============================================================
// NodeFlow — WhatsApp Accounts (multi-tenant credential cache)
// Cada negocio tiene su propio WABA conectado via 360dialog.
// Este módulo gestiona credenciales por businessId con caché
// en memoria (TTL 5 min) para evitar queries a Supabase en
// cada mensaje.
//
// Dependencias:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — Supabase
//   ENCRYPTION_KEY                     — AES-256 para access_token
// ============================================================

'use strict';

const crypto   = require('crypto');
const { Logger } = require('../utils/logger');

const log = new Logger('WA-ACCOUNTS');

// ── Supabase client (lazy init) ─────────────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = require('@supabase/supabase-js');
  _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  return _supabase;
}

// ── Encryption helpers (AES-256-GCM) ───────────────────────────────────────
// ENCRYPTION_KEY debe ser exactamente 32 bytes (64 hex chars).
// Si no está configurada, se almacena sin cifrar (solo para desarrollo local).

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  // Acepta hex (64 chars) o base64 (44 chars) o texto plano (32 chars)
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length === 44) return Buffer.from(raw, 'base64');
  return Buffer.from(raw.padEnd(32, '0').slice(0, 32), 'utf8');
}

function encrypt(text) {
  const key = getEncryptionKey();
  if (!key) return text; // dev mode — sin cifrar
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: iv(24) + tag(32) + ciphertext — todo base64
  return iv.toString('base64') + ':' + tag.toString('base64') + ':' + encrypted.toString('base64');
}

function decrypt(stored) {
  const key = getEncryptionKey();
  if (!key) return stored; // dev mode — sin cifrar
  const parts = stored.split(':');
  if (parts.length !== 3) return stored; // no cifrado (legacy)
  const [ivB64, tagB64, dataB64] = parts;
  try {
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    log.warn(`decrypt error: ${e.message} — returning raw`);
    return stored;
  }
}

// ── In-memory cache ─────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const cache = new Map(); // businessId → { credentials, expiresAt }

function cacheSet(businessId, credentials) {
  cache.set(businessId, { credentials, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheGet(businessId) {
  const entry = cache.get(businessId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(businessId); return null; }
  return entry.credentials;
}

function cacheDelete(businessId) {
  cache.delete(businessId);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Obtiene las credenciales WA de un negocio.
 * Primero busca en caché, luego en Supabase.
 *
 * @param {string} businessId  — organization_id del negocio
 * @returns {Promise<{phoneNumberId, accessToken, wabaId, phoneNumber, apiBase} | null>}
 *   null si el negocio no tiene WhatsApp conectado o está suspendido.
 */
async function getWaCredentials(businessId) {
  if (!businessId) return null;

  // 1. Caché
  const cached = cacheGet(businessId);
  if (cached) return cached;

  // 2. Supabase
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('whatsapp_accounts')
      .select('phone_number_id, access_token, waba_id, phone_number, api_base, status')
      .eq('organization_id', businessId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      if (error?.code !== 'PGRST116') { // PGRST116 = no rows found (normal)
        log.warn(`getWaCredentials(${businessId}): ${error?.message}`);
      }
      return null;
    }

    const credentials = {
      phoneNumberId: data.phone_number_id,
      accessToken:   decrypt(data.access_token),
      wabaId:        data.waba_id,
      phoneNumber:   data.phone_number,
      // 360dialog usa base URL diferente a Meta; null = usar Meta directamente
      apiBase:       data.api_base || null,
    };

    cacheSet(businessId, credentials);
    return credentials;

  } catch (e) {
    log.error(`getWaCredentials(${businessId}) exception: ${e.message}`);
    return null;
  }
}

/**
 * Guarda o actualiza credenciales WA de un negocio en Supabase.
 * Cifra el access_token antes de persistir.
 *
 * @param {string} businessId
 * @param {{ wabaId, phoneNumberId, accessToken, phoneNumber, displayName?, apiBase? }} creds
 */
async function saveWaCredentials(businessId, creds) {
  cacheDelete(businessId); // invalidar caché
  const sb = getSupabase();

  const row = {
    organization_id: businessId,
    waba_id:         creds.wabaId,
    phone_number_id: creds.phoneNumberId,
    phone_number:    creds.phoneNumber,
    display_name:    creds.displayName || null,
    access_token:    encrypt(creds.accessToken),
    api_base:        creds.apiBase || null,
    status:          'active',
    connected_at:    new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  };

  const { error } = await sb
    .from('whatsapp_accounts')
    .upsert(row, { onConflict: 'organization_id' });

  if (error) {
    log.error(`saveWaCredentials(${businessId}): ${error.message}`);
    throw error;
  }

  log.info(`WA credentials saved for business ${businessId} (${creds.phoneNumber})`);
}

/**
 * Revoca credenciales WA de un negocio (marca como revoked en Supabase).
 *
 * @param {string} businessId
 */
async function revokeWaCredentials(businessId) {
  cacheDelete(businessId);
  const sb = getSupabase();

  const { error } = await sb
    .from('whatsapp_accounts')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('organization_id', businessId);

  if (error) {
    log.error(`revokeWaCredentials(${businessId}): ${error.message}`);
    throw error;
  }

  log.info(`WA credentials revoked for business ${businessId}`);
}

/**
 * Limpia la caché de un negocio (útil tras actualizar credenciales).
 */
function invalidateCache(businessId) {
  cacheDelete(businessId);
}

module.exports = { getWaCredentials, saveWaCredentials, revokeWaCredentials, invalidateCache };
