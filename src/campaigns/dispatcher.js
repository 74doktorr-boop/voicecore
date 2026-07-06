// ============================================================
// NodeFlow — Campaign Core: dispatcher de trabajos salientes
// ------------------------------------------------------------
// CIEGO AL DOMINIO (regla de plataforma): no sabe qué es una
// peluquería ni qué vende nadie. Solo sabe:
//   colas · ventana horaria · ritmo (1 en vuelo por org) ·
//   reintentos con espera · resultados.
// El "qué decir" viaja en payload.promptBlock, que calcula la capa
// de producto AL ENCOLAR (junto con las comprobaciones de dominio:
// do_not_contact, consentimiento — responsabilidad del encolador).
//
// Consumidores: recuperación, anti no-show, informe semanal por voz,
// Auto-QA. Cada trabajo terminado con su outcome alimenta al
// Intelligence Core.
// ============================================================
'use strict';

const { getDatabase }       = require('../db/database');
const { startOutboundCall } = require('../telephony/outbound');
const { Logger }            = require('../utils/logger');

const log = new Logger('CAMPAIGN');

const TICK_MS          = 60 * 1000;      // resolución del dispatcher
const BATCH_LIMIT      = 5;              // trabajos por tick (global)
const STUCK_AFTER_MS   = 10 * 60 * 1000; // 'calling' sin cierre = colgado
const RETRY_DELAYS_MS  = [30 * 60 * 1000, 2 * 60 * 60 * 1000]; // 30min, 2h

// ── Helpers puros (testeables) ────────────────────────────────────────

// Ventana de llamadas: L-S 10:00-19:59 Europe/Madrid. Nadie quiere que
// un negocio le llame un domingo o a las 22:00.
function isWithinCallingWindow(date = new Date()) {
  const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
  }).format(date), 10);
  const dow = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short',
  }).format(date);
  if (dow === 'Sun') return false;
  return hour >= 10 && hour < 20;
}

// Espera creciente entre reintentos: 30 min, luego 2 h.
function nextRetryAt(attempts, now = Date.now()) {
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1) - 1, RETRY_DELAYS_MS.length - 1)];
  return new Date(now + delay).toISOString();
}

// ── API para la capa de producto ──────────────────────────────────────

/**
 * Encola un trabajo saliente. El ENCOLADOR es responsable de:
 * (1) haber comprobado do_not_contact/consentimiento del contacto,
 * (2) calcular payload.promptBlock (el propósito que leerá el asistente).
 */
async function enqueueCampaignCall({ orgId, campaignType, phone, contactId = null, payload = {}, notBefore = null, maxAttempts = 2 }) {
  if (!orgId || !campaignType || !phone) throw new Error('orgId, campaignType y phone son obligatorios');
  const db = getDatabase();
  if (!db.enabled) throw new Error('BD no disponible');
  const { data, error } = await db.client.from('nf_campaign_calls').insert({
    org_id:        orgId,
    campaign_type: campaignType,
    phone:         String(phone).replace(/[^\d+]/g, ''),
    contact_id:    contactId,
    payload,
    max_attempts:  maxAttempts,
    not_before:    notBefore || new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);
  log.info(`Encolado ${campaignType} → ${phone} (org ${orgId}, job ${data.id})`);
  return data.id;
}

// ── El tick ───────────────────────────────────────────────────────────

async function tick() {
  // Multi-réplica: solo el LÍDER despacha (duplicar = llamar 2 veces al cliente).
  if (!require('../utils/leader').isLeader()) return { skipped: 'no líder' };
  if (!isWithinCallingWindow()) return { skipped: 'fuera de ventana' };
  const db = getDatabase();
  if (!db.enabled) return { skipped: 'sin BD' };

  const nowIso = new Date().toISOString();

  // 1. Rescatar colgados: 'calling' demasiado tiempo → reintento o failed.
  try {
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { data: stuck } = await db.client.from('nf_campaign_calls')
      .select('id, attempts, max_attempts')
      .eq('status', 'calling').lt('started_at', stuckBefore).limit(20);
    for (const job of (stuck || [])) {
      const dead = job.attempts >= job.max_attempts;
      await db.client.from('nf_campaign_calls').update(
        dead ? { status: 'failed', error: 'sin cierre (timeout)', finished_at: nowIso }
             : { status: 'queued', not_before: nextRetryAt(job.attempts) }
      ).eq('id', job.id);
    }
  } catch (e) { log.warn(`rescate de colgados: ${e.message}`); }

  // 2. Orgs con llamada en vuelo (ritmo: 1 por negocio).
  let inFlight = new Set();
  try {
    const { data } = await db.client.from('nf_campaign_calls')
      .select('org_id').eq('status', 'calling');
    inFlight = new Set((data || []).map(r => r.org_id));
  } catch (e) { log.warn(`in-flight: ${e.message}`); return { error: e.message }; }

  // 3. Trabajos que tocan.
  let due = [];
  try {
    const { data, error } = await db.client.from('nf_campaign_calls')
      .select('*')
      .eq('status', 'queued').lte('not_before', nowIso)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw new Error(error.message);
    due = data || [];
  } catch (e) { log.warn(`due: ${e.message}`); return { error: e.message }; }

  let launched = 0;
  for (const job of due) {
    if (inFlight.has(job.org_id)) continue;

    // 4. Reclamar de forma atómica (si otro proceso lo cogió, saltar).
    const { data: claimed } = await db.client.from('nf_campaign_calls')
      .update({ status: 'calling', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('id', job.id).eq('status', 'queued')
      .select('id');
    if (!claimed || !claimed.length) continue;
    inFlight.add(job.org_id);

    // 5. Lanzar. El outcome lo cierra el post-call (vía campaignRef).
    try {
      const result = await startOutboundCall({
        businessId: job.org_id,
        to:         job.phone,
        context: {
          purpose:     job.campaign_type,
          ref:         job.id,
          promptBlock: (job.payload && job.payload.promptBlock) || '',
        },
      });
      await db.client.from('nf_campaign_calls')
        .update({ call_sid: result.callSid || null }).eq('id', job.id);
      launched++;
      log.info(`Lanzado ${job.campaign_type} → ${job.phone} (job ${job.id})`);
    } catch (e) {
      const dead = job.attempts + 1 >= job.max_attempts;
      await db.client.from('nf_campaign_calls').update(
        dead ? { status: 'failed', error: String(e.message).slice(0, 300), finished_at: new Date().toISOString() }
             : { status: 'queued', error: String(e.message).slice(0, 300), not_before: nextRetryAt(job.attempts + 1) }
      ).eq('id', job.id).then(undefined, () => {});
      log.warn(`Fallo al lanzar job ${job.id}: ${e.message}${dead ? ' (agotado)' : ' (reintento programado)'}`);
    }
  }
  return { launched, due: due.length };
}

/** Cierra un trabajo con el resultado real de la llamada (lo llama post-call). */
async function completeCampaignCall(jobId, { outcome = null, callSid = null } = {}) {
  const db = getDatabase();
  if (!db.enabled || !jobId) return;
  await db.client.from('nf_campaign_calls').update({
    status:      'done',
    outcome,
    call_sid:    callSid || undefined,
    finished_at: new Date().toISOString(),
  }).eq('id', jobId).then(undefined, e => log.warn(`completeCampaignCall(${jobId}): ${e.message}`));
}

// ── Arranque/parada del bucle ─────────────────────────────────────────
let _interval = null;
function startCampaignDispatcher() {
  if (_interval) return;
  _interval = setInterval(() => { tick().catch(e => log.warn(`tick: ${e.message}`)); }, TICK_MS);
  log.info(`Campaign dispatcher activo (tick ${TICK_MS / 1000}s, ventana L-S 10-20h Madrid)`);
}
function stopCampaignDispatcher() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = {
  enqueueCampaignCall,
  completeCampaignCall,
  tick,
  startCampaignDispatcher,
  stopCampaignDispatcher,
  isWithinCallingWindow,
  nextRetryAt,
};
