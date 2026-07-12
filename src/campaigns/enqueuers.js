// ============================================================
// NodeFlow — Encoladores de campañas (CAPA DE PRODUCTO)
// ------------------------------------------------------------
// Aquí SÍ se conoce el dominio: qué es una cita, quién es un
// cliente perdido, qué se dice en cada tipo de llamada. Este es
// el lugar (y no el dispatcher) donde se comprueban las bajas
// (do_not_contact) y se construye el promptBlock.
// Consumidores v1: recuperación en lote + confirmación anti no-show.
// ============================================================
'use strict';

const { enqueueCampaignCall } = require('./dispatcher');
const { PURPOSE_BLOCKS }      = require('../telephony/outbound');
const { getDatabase }         = require('../db/database');
const { Logger }              = require('../utils/logger');

const log = new Logger('CAMPAIGN:ENQUEUE');

// ── Dominio: bajas y nombre del contacto ─────────────────────────────
// El analyzer marca do_not_contact poniendo no_whatsapp+no_email+no_sms.
// Si las tres están, el cliente pidió que no le contacten: NO se le llama.
async function contactInfo(orgId, phone) {
  const db = getDatabase();
  if (!db.enabled) return { blocked: false, contactId: null, name: null };
  try {
    const { data: contact } = await db.client.from('contacts')
      .select('id, name').eq('org_id', orgId).eq('phone', phone).maybeSingle();
    if (!contact) return { blocked: false, contactId: null, name: null };
    const { data: mem } = await db.client.from('contact_memory')
      .select('no_whatsapp, no_email, no_sms')
      .eq('org_id', orgId).eq('contact_id', contact.id).maybeSingle();
    const blocked = !!(mem && mem.no_whatsapp && mem.no_email && mem.no_sms);
    return { blocked, contactId: contact.id, name: contact.name || null };
  } catch (e) {
    log.warn(`contactInfo(${orgId}, ${phone}): ${e.message}`);
    return { blocked: false, contactId: null, name: null };
  }
}

// ── Bloque de propósito: confirmación anti no-show ───────────────────
function buildNoShowBlock(bizName, apt) {
  return `

## LLAMADA SALIENTE DE CONFIRMACIÓN DE CITA
Llamas TÚ en nombre de ${bizName} para confirmar la cita de MAÑANA de ${apt.patientName || 'un cliente'}: ${apt.service || 'su cita'} a las ${apt.time}. El identificador de la cita es ${apt.id}.
Preséntate, di de dónde llamas y pregunta con amabilidad si podrá venir.
- Si CONFIRMA: agradece y despídete («perfecto, le esperamos mañana a las ${apt.time}»).
- Si quiere CAMBIARLA: busca hueco con check_availability, cancela la actual con cancel_appointment (id ${apt.id}) y reserva la nueva.
- Si CANCELA: cancélala con cancel_appointment y despídete con amabilidad, sin insistir.
- Si salta un buzón de voz o no contesta un humano, cuelga sin dejar mensaje.`;
}

// ¿Ya hay una llamada de recuperación EN CURSO (queued/calling) para este
// teléfono en esta org? Evita la DOBLE LLAMADA si el dueño pulsa el botón de
// recuperación dos veces (el reactivación automática ya está protegida por su
// propio log de cooldown; este lote manual no lo estaba). fail-open: ante un
// fallo de lectura, se encola igual (mejor una llamada que ninguna).
async function _recoveryAlreadyQueued(orgId, phone) {
  try {
    const db = getDatabase();
    if (!db.enabled) return false;
    const { data } = await db.client.from('nf_campaign_calls')
      .select('id').eq('org_id', orgId).eq('campaign_type', 'recovery')
      .eq('phone', phone).in('status', ['queued', 'calling']).limit(1);
    return !!(data && data.length);
  } catch (_) { return false; }
}

// ── Consumidor 1: recuperación en lote ───────────────────────────────
/**
 * Encola llamadas de recuperación para una lista de teléfonos
 * (previamente validada server-side contra las oportunidades reales).
 * deps inyectables para test.
 */
async function enqueueRecoveryBatch(orgId, orgName, phones, deps = {}) {
  const _contactInfo   = deps.contactInfo   || contactInfo;
  const _enqueue       = deps.enqueue       || enqueueCampaignCall;
  const _alreadyQueued = deps.alreadyQueued || _recoveryAlreadyQueued;
  let queued = 0, skipped = 0;
  for (const rawPhone of phones) {
    const phone = String(rawPhone || '').replace(/[^\d+]/g, '');
    if (phone.replace(/\D/g, '').length < 7) { skipped++; continue; }
    const info = await _contactInfo(orgId, phone);
    if (info.blocked) { skipped++; log.info(`Recuperación: ${phone} saltado (baja)`); continue; }
    // Anti-duplicado: no encolar si ya hay una recuperación en curso a ese número.
    if (await _alreadyQueued(orgId, phone)) { skipped++; log.info(`Recuperación: ${phone} ya en cola — no se duplica`); continue; }
    try {
      await _enqueue({
        orgId,
        campaignType: 'recovery',
        phone,
        contactId: info.contactId,
        payload: { promptBlock: PURPOSE_BLOCKS.recovery(orgName, info.name) },
      });
      queued++;
    } catch (e) {
      skipped++;
      log.warn(`Recuperación: no se pudo encolar ${phone}: ${e.message}`);
    }
  }
  return { queued, skipped };
}

// ── Consumidor 3: reactivación por VOZ (add-on Crecimiento) ──────────
// El canal por defecto de la reactivación es email; con rebooking.channel
// = 'voice' el asistente LLAMA al cliente antiguo. La elegibilidad es la
// misma que la de email pero por TELÉFONO (no email): sin cita próxima,
// con última visita, y pasado el umbral del sector. Predicado puro para
// poder testear la regla de negocio sin BD (charter: reglas fuera del LLM).
function reactivationEligible(client, threshold, now = Date.now()) {
  if (!client || !client.phone) return false;         // la voz necesita móvil
  if (client.upcomingCount !== 0) return false;        // ya va a volver
  if (!client.lastVisitDate) return false;             // sin historial de visita
  const t = new Date(client.lastVisitDate).getTime();
  if (Number.isNaN(t)) return false;
  const days = Math.floor((now - t) / 86400000);
  return days >= threshold;
}

/**
 * Encola UNA llamada de reactivación para un cliente antiguo. Respeta las
 * bajas (do_not_contact). Devuelve {queued, reason}. Una sola llamada por
 * cliente/umbral (el anti-spam vive en el cron, como en email).
 */
async function enqueueReactivationCall(orgId, bizName, client) {
  const phone = String((client && client.phone) || '').replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 7) return { queued: false, reason: 'phone_invalid' };
  const info = await contactInfo(orgId, phone);
  if (info.blocked) { log.info(`Reactivación: ${phone} saltado (baja)`); return { queued: false, reason: 'blocked' }; }
  await enqueueCampaignCall({
    orgId,
    campaignType: 'reactivation',
    phone,
    contactId: info.contactId,
    payload: { promptBlock: PURPOSE_BLOCKS.reactivation(bizName, info.name || client.name, client.lastVisitDate) },
  });
  return { queued: true };
}

// ── Consumidor 2: confirmación anti no-show (cron) ───────────────────
// Franja de encolado: 16:00-18:59 Madrid — las llamadas salen la tarde
// anterior a la cita, cuando el cliente puede reorganizarse.
function isNoShowEnqueueWindow(date = new Date()) {
  const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
  }).format(date), 10);
  return hour >= 16 && hour < 19;
}

/**
 * Recorre las citas de MAÑANA sin confirmar y encola una llamada de
 * confirmación por cada una (una sola vez por cita — dedupe en BD).
 */
async function enqueueNoShowConfirmations({ scheduler, flowManager }) {
  if (!isNoShowEnqueueWindow()) return { skipped: 'fuera de franja' };
  const db = getDatabase();
  if (!db.enabled) return { skipped: 'sin BD' };

  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(tomorrow);

  let queued = 0;
  for (const flow of flowManager.list()) {
    const orgId = flow.businessId;
    let appointments = [];
    try { appointments = scheduler.getAppointments(orgId) || []; } catch (_) { continue; }
    // Confirmamos las citas de mañana SIN confirmar (pending) — y, además, las
    // ya confirmadas de clientes con RIESGO DE PLANTÓN alto (2026-07-07): son
    // justo los que más faltan, así que merecen el recordatorio igualmente.
    const { computeNoShowRisk } = require('../lifecycle/no-show-risk');
    const { normalizePhone } = require('../utils/phone');
    const tomorrowApts = appointments.filter(a => a.date === tomorrowStr && a.phone && a.status !== 'cancelled');
    const targets = tomorrowApts.filter(a => {
      if (a.status === 'pending') return true;
      if (a.status !== 'confirmed') return false;
      const p9 = normalizePhone(a.phone);
      const history = appointments.filter(h => normalizePhone(h.phone) === p9 && h !== a);
      return computeNoShowRisk(history).level === 'high';
    });

    for (const apt of targets) {
      try {
        // Dedupe: una llamada de confirmación por cita, para siempre.
        const { data: existing } = await db.client.from('nf_campaign_calls')
          .select('id').eq('campaign_type', 'no_show')
          .eq('payload->>aptId', String(apt.id)).limit(1).maybeSingle();
        if (existing) continue;

        const info = await contactInfo(orgId, apt.phone);
        if (info.blocked) continue;

        await enqueueCampaignCall({
          orgId,
          campaignType: 'no_show',
          phone: apt.phone,
          contactId: info.contactId,
          payload: { aptId: String(apt.id), promptBlock: buildNoShowBlock(flow.name, apt) },
        });
        queued++;
      } catch (e) {
        log.warn(`no-show ${apt.id}: ${e.message}`);
      }
    }
  }
  if (queued) log.info(`Anti no-show: ${queued} confirmaciones encoladas para ${tomorrowStr}`);
  return { queued };
}

module.exports = { enqueueRecoveryBatch, enqueueNoShowConfirmations, buildNoShowBlock, isNoShowEnqueueWindow, contactInfo, reactivationEligible, enqueueReactivationCall };
