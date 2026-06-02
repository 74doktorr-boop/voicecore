// ============================================================
// NodeFlow — Contact Memory (Lifecycle System)
// Persistent per-contact call history and preferences.
// ============================================================

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('CALL-MEMORY');

/**
 * Get a contact's memory record.
 * Returns null if not found (cold start — first call).
 */
async function getContactMemory(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return null;

  const { data, error } = await db.client
    .from('contact_memory')
    .select('*')
    .eq('contact_id', contactId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) { log.warn('getContactMemory failed', { err: error.message }); return null; }
  return data;
}

/**
 * Upsert contact memory. Merges preferences/sensitivities with existing values.
 * do_not_contact flags are one-way: only set to true, never auto-cleared.
 *
 * @param {string} contactId
 * @param {string} orgId
 * @param {object} updates
 *   - incrementCallCount {boolean}
 *   - last_call_at {string} ISO timestamp
 *   - last_call_summary {string}
 *   - preferences {object} — merged into existing
 *   - sensitivities {object} — merged into existing
 *   - no_whatsapp {boolean} — only applied if true
 *   - no_email {boolean}
 *   - no_sms {boolean}
 */
async function upsertContactMemory(contactId, orgId, updates) {
  const db = getDatabase();
  if (!db.enabled) return;

  const existing = await getContactMemory(contactId, orgId);

  const row = {
    org_id:            orgId,
    contact_id:        contactId,
    call_count:        (existing?.call_count || 0) + (updates.incrementCallCount ? 1 : 0),
    last_call_at:      updates.last_call_at      ?? existing?.last_call_at      ?? null,
    last_call_summary: updates.last_call_summary ?? existing?.last_call_summary ?? null,
    // Merge: new values overwrite existing keys, existing keys not in updates are kept
    preferences:   { ...(existing?.preferences   || {}), ...(updates.preferences   || {}) },
    sensitivities: { ...(existing?.sensitivities  || {}), ...(updates.sensitivities  || {}) },
    // Keep existing flags, only ever set to true
    no_whatsapp: existing?.no_whatsapp || updates.no_whatsapp === true,
    no_email:    existing?.no_email    || updates.no_email    === true,
    no_sms:      existing?.no_sms      || updates.no_sms      === true,
    updated_at:      new Date().toISOString(),
  };

  const { error } = await db.client
    .from('contact_memory')
    .upsert(row, { onConflict: 'org_id,contact_id' });

  if (error) log.error('upsertContactMemory failed', { err: error.message, contactId });
}

/**
 * Increment failed_attempts counter for a contact.
 * Uses a DB-side RPC to avoid race conditions.
 */
async function incrementFailedAttempts(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return;
  const { error } = await db.client.rpc('increment_failed_attempts', {
    p_contact_id: contactId,
    p_org_id:     orgId,
  });
  if (error) log.warn('incrementFailedAttempts failed', { err: error.message });
}

/**
 * Check if a contact has too many failed attempts (cooling-off period).
 * Returns true if we should skip this contact for now.
 */
function isCoolingOff(memory) {
  if (!memory) return false;
  if (memory.failed_attempts < 3) return false;
  if (!memory.last_failed_at) return false;
  const daysSince = (Date.now() - new Date(memory.last_failed_at).getTime()) / 86400000;
  return daysSince < 30;
}

/**
 * Build call context for the prompt generator.
 * Returns { isFirstCall, callCount, lastCallSummary, preferences,
 *           sensitivities, recentCalls, sectorData }
 */
async function buildCallContext(contactId, orgId) {
  if (!contactId || !orgId) return { isFirstCall: true, sectorData: {} };
  const db = getDatabase();
  if (!db.enabled) return { isFirstCall: true, sectorData: {} };

  const [memRes, callsRes, contactRes] = await Promise.all([
    db.client.from('contact_memory').select('*')
      .eq('contact_id', contactId).eq('org_id', orgId).maybeSingle(),
    db.client.from('call_summaries')
      .select('summary, outcome, topics, created_at')
      .eq('contact_id', contactId).eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(5),
    db.client.from('contacts').select('name, phone, sector_data')
      .eq('id', contactId).maybeSingle(),
  ]);

  const memory     = memRes.data;
  const recentCalls = callsRes.data || [];
  const sectorData  = contactRes.data?.sector_data || {};

  if (!memory || memory.call_count === 0) {
    return { isFirstCall: true, sectorData };
  }

  return {
    isFirstCall:       false,
    callCount:         memory.call_count,
    lastCallAt:        memory.last_call_at,
    lastCallSummary:   memory.last_call_summary,
    preferences:       memory.preferences    || {},
    sensitivities:     memory.sensitivities  || {},
    recentCalls,
    sectorData,
  };
}

module.exports = {
  getContactMemory,
  upsertContactMemory,
  incrementFailedAttempts,
  isCoolingOff,
  buildCallContext,
};
