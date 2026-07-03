// ============================================================
// NodeFlow — Persistencia de llamadas (nf_calls)
// Hallazgo C1 de la auditoría 2026-07-03: db.createCall/endCall
// existían pero NADIE los llamaba (código muerto) y apuntaban a la
// tabla legacy "calls" cuyo schema real los habría rechazado
// (agency_id NOT NULL de otro diseño). Resultado: 0 llamadas
// persistidas desde el lanzamiento; cada deploy borraba el historial.
//
// Diseño:
// - Idempotente: upsert por id (= callId del stream). Reintentar o
//   duplicar eventos jamás crea filas dobles.
// - Resiliente: el cierre hace upsert COMPLETO — si el alta falló
//   (BD caída al inicio), el registro se recupera entero al colgar.
// - Fail-open: la persistencia nunca tumba una llamada. Los fallos
//   se loguean como WARN con el callId para poder reconciliar.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CALL-STORE');

function _db(deps) {
  return deps.db || require('./database').getDatabase();
}

/** Alta al iniciar la llamada. Nunca lanza. */
async function saveCallStart(session, deps = {}) {
  const db = _db(deps);
  // CallSession expone el identificador como .id (callId solo en el ctor)
  const callId = session?.id || session?.callId;
  if (!db.enabled || !callId) return false;
  try {
    const { error } = await db.client.from('nf_calls').upsert({
      id:            callId,
      org_id:        session.orgId || null,
      assistant_id:  session.assistant?.id || null,
      direction:     session.direction || 'inbound',
      caller_number: session.callerNumber || null,
      called_number: session.calledNumber || null,
      status:        'active',
      started_at:    new Date(session.startTime || Date.now()).toISOString(),
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    log.warn(`[${callId}] Alta de llamada no persistida: ${e.message}`);
    return false;
  }
}

/** Registro completo al colgar (upsert: recupera altas fallidas). Nunca lanza. */
async function saveCallEnd(callData, deps = {}) {
  const db = _db(deps);
  if (!db.enabled || !callData?.id) return false;
  try {
    const { error } = await db.client.from('nf_calls').upsert({
      id:            callData.id,
      org_id:        callData.businessId || null,
      assistant_id:  callData.assistantId || null,
      direction:     callData.direction || 'inbound',
      caller_number: callData.callerNumber || null,
      called_number: callData.calledNumber || null,
      status:        'ended',
      outcome:       callData.outcome || null,
      transcript:    callData.transcript || [],
      metrics:       callData.metrics || {},
      cost:          callData.cost || {},
      // Varias reservas en una llamada → array; una → objeto (compat lectores)
      booked_appointment: (callData.bookedAppointments && callData.bookedAppointments.length > 1)
        ? callData.bookedAppointments
        : (callData.bookedAppointment || null),
      campaign_ref:  callData.campaignRef || null,
      client_email:  callData.clientEmail || null,
      started_at:    callData.startTime || null,
      ended_at:      callData.endTime || new Date().toISOString(),
      duration_ms:   callData.duration ?? null,
      turn_count:    callData.turnCount ?? null,
    }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    log.warn(`[${callData.id}] Cierre de llamada no persistido: ${e.message}`);
    return false;
  }
}

/**
 * Cierra llamadas huérfanas: filas 'active' cuyo proceso murió sin ejecutar
 * endCall (deploy en mitad de llamada — caso real 2026-07-03: una fila
 * quedó 'active' y el portal mostraba "1989 minutos" de reloj corriendo).
 * Llamar al arrancar y periódicamente. Nunca lanza.
 * @returns {Promise<number>} filas cerradas
 */
async function reapOrphanCalls(deps = {}) {
  const db = _db(deps);
  if (!db.enabled) return 0;
  const maxAgeMinutes = deps.maxAgeMinutes || 90;
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60000).toISOString();
  try {
    const { data, error } = await db.client.from('nf_calls')
      .update({ status: 'lost', ended_at: new Date().toISOString() })
      .eq('status', 'active')
      .lt('started_at', cutoff)
      .select('id');
    if (error) throw new Error(error.message);
    const n = (data || []).length;
    if (n > 0) log.warn(`${n} llamada(s) huérfana(s) cerradas como 'lost' (proceso murió sin endCall)`);
    return n;
  } catch (e) {
    log.warn(`reapOrphanCalls: ${e.message}`);
    return 0;
  }
}

module.exports = { saveCallStart, saveCallEnd, reapOrphanCalls };
