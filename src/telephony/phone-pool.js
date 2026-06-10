// ============================================
// NodeFlow — Phone Number Pool
// Unai pre-carga números comprados (cualquier operador).
// Al llegar un pago, se auto-asigna el primero disponible.
// ============================================

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('PHONE-POOL');

const LOW_POOL_THRESHOLD = 2; // Alerta cuando queden menos de N disponibles

// ── Claim ────────────────────────────────────────────────────────────────────
/**
 * Asigna atómicamente el primer número disponible al org indicado.
 * Usa optimistic locking: SELECT + UPDATE WHERE status='available'.
 * Reintenta hasta 3 veces en caso de colisión (dos clientes simultáneos).
 * @returns {string|null} El número asignado, o null si el pool está vacío.
 */
async function claimNumber(orgId) {
  const db = getDatabase();
  if (!db.enabled) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: rows } = await db.client
      .from('nf_phone_pool')
      .select('id, phone_number')
      .eq('status', 'available')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!rows?.length) return null; // pool vacío

    const { id, phone_number } = rows[0];

    const { data: claimed, error } = await db.client
      .from('nf_phone_pool')
      .update({
        status:      'assigned',
        org_id:      orgId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'available') // guard: solo actualiza si todavía está disponible
      .select()
      .single();

    if (!error && claimed) {
      log.info(`Número ${claimed.phone_number} asignado a org ${orgId}`);
      return claimed.phone_number;
    }
    // Otro proceso lo reclamó — reintentamos con el siguiente
  }

  log.warn(`claimNumber: pool concurrido, sin número libre para ${orgId}`);
  return null;
}

// ── Release ──────────────────────────────────────────────────────────────────
/**
 * Devuelve el número de un org al pool (útil si se cancela la suscripción).
 */
async function releaseNumber(orgId) {
  const db = getDatabase();
  if (!db.enabled) return false;
  const { error } = await db.client
    .from('nf_phone_pool')
    .update({ status: 'available', org_id: null, assigned_at: null })
    .eq('org_id', orgId)
    .eq('status', 'assigned');
  if (!error) log.info(`Número liberado para org ${orgId}`);
  return !error;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function getPoolStats() {
  const db = getDatabase();
  if (!db.enabled) return { available: 0, assigned: 0, retired: 0, total: 0, low: false };
  const { data } = await db.client.from('nf_phone_pool').select('status');
  const all       = data || [];
  const available = all.filter(r => r.status === 'available').length;
  const assigned  = all.filter(r => r.status === 'assigned').length;
  const retired   = all.filter(r => r.status === 'retired').length;
  return {
    available,
    assigned,
    retired,
    total: all.length,
    low:   available < LOW_POOL_THRESHOLD,
  };
}

// ── Add ──────────────────────────────────────────────────────────────────────
async function addNumber({ phoneNumber, provider = 'manual', prefix = null, notes = null }) {
  const db = getDatabase();
  if (!db.enabled) throw new Error('DB no disponible');
  const { data, error } = await db.client
    .from('nf_phone_pool')
    .insert({ phone_number: phoneNumber, provider, prefix, notes, status: 'available' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  log.info(`Número añadido al pool: ${phoneNumber} (${provider})`);
  return data;
}

// ── List ─────────────────────────────────────────────────────────────────────
async function listNumbers({ status } = {}) {
  const db = getDatabase();
  if (!db.enabled) return [];
  let q = db.client.from('nf_phone_pool').select('*').order('created_at', { ascending: true });
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

// ── Update ────────────────────────────────────────────────────────────────────
async function updateNumber(id, patch) {
  const db = getDatabase();
  if (!db.enabled) throw new Error('DB no disponible');
  const { data, error } = await db.client
    .from('nf_phone_pool').update(patch).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { claimNumber, releaseNumber, getPoolStats, addNumber, listNumbers, updateNumber, LOW_POOL_THRESHOLD };
