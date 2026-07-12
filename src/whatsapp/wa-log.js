'use strict';
// ============================================================
// NodeFlow — Transcript de WhatsApp (log de mensajes)
// Guarda cada mensaje entrante/saliente en nf_wa_messages para poder ver el
// hilo en el portal y depurar. FAIL-OPEN: si la tabla no existe (migración sin
// aplicar) o la BD falla, no rompe nada; simplemente no registra.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('WA-LOG');

// Teléfono en forma canónica '+<digitos>' para que entrante ("34..") y saliente
// ("+34..") caigan en el mismo hilo.
function _canon(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? '+' + d : '';
}

/**
 * Registra un mensaje de WhatsApp. Fire-and-forget, nunca lanza.
 * @param {{orgId:string, phone:string, direction:'in'|'out', body:string, kind?:string, contactId?:string}} m
 */
function logWaMessage(m = {}) {
  try {
    const { orgId, phone, direction, body, kind, contactId } = m;
    if (!orgId || !phone || !direction) return;
    const { getDatabase } = require('../db/database');
    const db = getDatabase();
    if (!db.enabled) return;
    db.client.from('nf_wa_messages').insert({
      org_id:     orgId,
      contact_id: contactId || null,
      phone:      _canon(phone),
      direction,
      body:       String(body || '').slice(0, 2000),
      kind:       kind || 'text',
    }).then(() => {}, (e) => log.warn(`logWaMessage: ${e.message || e}`));
  } catch (_) { /* fail-open */ }
}

/**
 * Devuelve el hilo de WhatsApp de un teléfono (cronológico).
 * @returns {Promise<Array<{direction, body, kind, created_at}>>}
 */
async function getWaThread(orgId, phone, limit = 100) {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();
    if (!db.enabled || !orgId || !phone) return [];
    const { data, error } = await db.client
      .from('nf_wa_messages')
      .select('direction, body, kind, created_at')
      .eq('org_id', orgId)
      .eq('phone', _canon(phone))
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch (_) { return []; }
}

module.exports = { logWaMessage, getWaThread, _canon };
