// ============================================================
// NodeFlow — LA ENTIDAD LLAMA (v0): campos-fecha → llamada saliente
// ------------------------------------------------------------
// La jugada maestra de ENTIDADES: cuando a una ficha le llega una
// fecha con recordatorio (ITV, vacuna, renovación de póliza…), el
// asistente del negocio LLAMA al dueño de la cosa, le ofrece el
// servicio DEL NEGOCIO (directiva Unai: la pre-ITV del taller, no la
// ITV de la estación) y reserva la cita EN LA MISMA LLAMADA con
// book_appointment. Voz = canal propio, sin dependencia de Meta.
//
// Reutiliza el 100% del Campaign Core (dispatcher: ventana L-S 10-20h
// Madrid, ritmo 1 por org, reintentos, outcome vía post-call) — aquí
// vive solo la capa de PRODUCTO, como en enqueuers.js:
//   - elegibilidad (opt-in de la org, plantilla "oportunidad de
//     servicio", ventana del aviso, bajas/cooling-off)
//   - dedupe por (entidad, campo, ciclo) en BD
//   - el promptBlock que leerá el asistente
//
// Opt-in: automation_config.config.entityCalls === true (defecto OFF).
// Se lee FRESCO de BD: la config en memoria pierde .config al reiniciar
// (register() del flow-manager solo conserva las 5 automations base).
//
// Leader-gated: se invoca desde runAutomations (src/scheduling/cron.js),
// que ya solo corre en el líder. Dedupe en BD → reejecutar es no-op.
// ============================================================
'use strict';

const { getDatabase }        = require('../db/database');
const { computeDisplayName } = require('./entities');
const { Logger }             = require('../utils/logger');

const log = new Logger('ENTITY-CALLS');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Válvula de seguridad: tras una importación masiva de fichas, que el
// primer barrido no dispare 200 llamadas el mismo día. Lo que no cabe
// hoy sale mañana (la ventana del aviso dura días y el dedupe es por ciclo).
const MAX_CALLS_PER_ORG_PER_RUN = 10;

// ── Gating por plantilla: ¿este recordatorio es una OPORTUNIDAD DE SERVICIO? ──
// Se llama para VENDER una cita (pre-ITV, vacuna, renovación…), nunca para
// logística de algo ya reservado ni por cortesía. Lista negra por
// campaign_kind: avisos de eventos ya agendados/preparados (entrada/recogida
// de residencia, reconfirmación de grupo, firma de notaría, sesión de láser,
// hito de obra, dispensación de farmacia) y felicitaciones (cumple).
const NON_CALLABLE_KINDS = new Set([
  'cumple', 'cumpleanos',           // relación, no venta — jamás por teléfono
  'entrada', 'recogida',            // logística de una estancia ya reservada
  'reconfirmacion',                 // el evento ya está reservado
  'firma',                          // la firma ya está señalada
  'sesion',                         // la sesión ya está en agenda
  'hito',                           // coordinación de obra, no una cita nueva
  'dispensacion',                   // el pedido ya está preparado
]);

/** PURA — ¿el reminder de este campo justifica una llamada comercial? */
function isServiceOpportunity(reminder) {
  if (!reminder) return false;
  return !NON_CALLABLE_KINDS.has(String(reminder.campaign_kind || ''));
}

/** PURA — clave de dedupe por ciclo: la MISMA fecha nunca genera 2 llamadas.
 *  Cuando el campo cambia (ITV del año que viene), el ciclo es nuevo. */
function entityCallDedupeKey(entityId, fieldKey, dueDate) {
  return `${entityId}|${fieldKey}|${dueDate}`;
}

// ── Franja de ENCOLADO: mañanas 10:00-13:59 Madrid ──────────────────────
// (mismo espíritu que isNoShowEnqueueWindow, 16-19h). El dispatcher ya
// impone su propia ventana L-S 10-20h al LANZAR; esta franja concentra
// las llamadas frías por la mañana, cuando mejor se reciben.
function isEntityCallEnqueueWindow(date = new Date()) {
  const hour = parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
  }).format(date), 10);
  return hour >= 10 && hour < 14;
}

/**
 * PURA — plan de llamadas de UNA entidad: por cada campo date con reminder
 * "oportunidad de servicio" y valor, se llama si HOY está dentro de la
 * ventana del aviso [fecha + offset_days, fecha) — nunca el día D ni
 * después (la pre-ITV solo tiene sentido ANTES de la ITV).
 * @returns Array<{ fieldKey, fieldLabel, dueDate, dueDatePretty,
 *                  displayName, serviceHint, dedupeKey }>
 */
function buildEntityCallPlan(entityType, entity, now = new Date()) {
  const plan  = [];
  const attrs = entity.attrs || {};

  for (const f of (entityType.fields || [])) {
    if (f.type !== 'date' || !f.reminder) continue;
    if (!isServiceOpportunity(f.reminder)) continue;
    const value = attrs[f.key];
    if (!value || !DATE_RE.test(String(value))) continue;

    const dueStart = new Date(`${value}T00:00:00`);
    if (isNaN(dueStart.getTime())) continue;
    const windowStart = new Date(`${value}T09:00:00`);
    windowStart.setDate(windowStart.getDate() + (Number(f.reminder.offset_days) || 0));

    // Fuera de la ventana del aviso: aún no toca, o la fecha ya llegó/pasó.
    if (now < windowStart || now >= dueStart) continue;

    const dueDatePretty = new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
    const displayName   = entity.display_name
      || computeDisplayName(entityType.label_template, attrs, entityType.label_singular);
    // message_hint = el CTA curado de la plantilla (vende el servicio DEL
    // negocio con la fecha como gancho) → semilla del objetivo de la llamada.
    const serviceHint = f.reminder.message_hint
      ? f.reminder.message_hint
          .replace(/\{\{\s*entity\s*\}\}/gi, displayName)
          .replace(/\{\{\s*value\s*\}\}/gi, dueDatePretty)
          .slice(0, 240)
      : `${f.label || f.key}: ${dueDatePretty}`;

    plan.push({
      fieldKey:      f.key,
      fieldLabel:    f.label || f.key,
      dueDate:       value,
      dueDatePretty,
      displayName,
      serviceHint,
      dedupeKey:     entityCallDedupeKey(entity.id, f.key, value),
    });
  }
  return plan;
}

// ── Bloque de propósito (mismo formato que buildNoShowBlock) ─────────────
function buildEntityCallBlock(bizName, { clientName, entityName, fieldLabel, dueDatePretty, serviceHint }) {
  return `

## LLAMADA SALIENTE — AVISO DE FECHA IMPORTANTE
Llamas TÚ en nombre de ${bizName} a ${clientName || 'un cliente'}: su ${entityName} tiene «${fieldLabel}» el ${dueDatePretty}.
Preséntate, di de dónde llamas y explica el motivo en una frase. Ofrece el servicio del negocio con este enfoque: «${serviceHint}»
- Si le interesa: busca hueco con check_availability y reserva la cita con book_appointment en esta misma llamada.
- Si prefiere pensarlo o es mal momento: despídete con amabilidad y NO insistas — es una invitación, no una venta.
- Si no contesta un humano o salta un buzón de voz, cuelga sin dejar mensaje.
Sé breve y humano: dos frases para el motivo, y a escuchar.`;
}

/**
 * Recorre las fichas de las orgs con el opt-in activo y encola una llamada
 * por cada campo-fecha que entra en su ventana de aviso. Idempotente:
 * dedupe por (entidad, campo, fecha) en nf_campaign_calls, para siempre.
 * Respeta bajas (do_not_contact = no_whatsapp+no_email+no_sms, como la voz
 * de reactivación) y cooling-off, y como mucho 1 llamada por contacto y
 * ejecución (si un cliente tiene 3 fechas, no se le llama 3 veces hoy).
 * @returns {Promise<{orgs, scanned, queued, skipped}>}
 */
async function enqueueEntityDateCalls(opts = {}) {
  const out = { orgs: 0, scanned: 0, queued: 0, skipped: 0 };
  const { entitiesFeatureEnabled, entityTablesExist } = require('./entity-types');
  if (!entitiesFeatureEnabled()) return out;
  const now = opts.now || new Date();
  if (!isEntityCallEnqueueWindow(now)) return { ...out, skippedReason: 'fuera de franja' };

  const db = opts.db || getDatabase();
  if (!db.enabled || !(await entityTablesExist(db))) return out;

  // Mismo barrido que el materializador: tipos activos de todas las orgs.
  const { data: types, error: typesErr } = await db.client
    .from('nf_entity_types')
    .select('id, organization_id, key, label_singular, label_template, fields')
    .eq('is_active', true)
    .limit(500);
  if (typesErr || !types?.length) return out;

  const byOrg = new Map();
  for (const t of types) {
    if (!byOrg.has(t.organization_id)) byOrg.set(t.organization_id, []);
    byOrg.get(t.organization_id).push(t);
  }

  const { contactInfo }        = require('../campaigns/enqueuers');
  const { enqueueCampaignCall } = require('../campaigns/dispatcher');

  for (const [orgId, orgTypes] of byOrg) {
    try {
      // Opt-in FRESCO de BD (defecto OFF): la memoria pierde .config al arrancar.
      const { data: org } = await db.client.from('organizations')
        .select('name, automation_config').eq('id', orgId).maybeSingle();
      const cfgVal  = org?.automation_config?.config?.entityCalls;
      const enabled = cfgVal === true || cfgVal?.enabled === true;
      if (!enabled) continue;
      out.orgs++;

      const bizName        = org.name || 'el negocio';
      let   queuedThisOrg  = 0;
      const calledContacts = new Set();

      for (const type of orgTypes) {
        if (queuedThisOrg >= MAX_CALLS_PER_ORG_PER_RUN) break;
        const callable = (type.fields || []).some(f => f.type === 'date' && f.reminder && isServiceOpportunity(f.reminder));
        if (!callable) continue;

        const { data: entities } = await db.client
          .from('nf_entities')
          .select('id, contact_id, display_name, attrs')
          .eq('organization_id', orgId)
          .eq('entity_type_id', type.id)
          .eq('is_archived', false)
          .not('contact_id', 'is', null)
          .limit(2000);

        for (const entity of (entities || [])) {
          if (queuedThisOrg >= MAX_CALLS_PER_ORG_PER_RUN) break;
          out.scanned++;

          const plan = buildEntityCallPlan(type, entity, now);
          if (!plan.length) continue;
          if (calledContacts.has(entity.contact_id)) { out.skipped += plan.length; continue; }

          // Dueño de la cosa: nombre + teléfono (la voz necesita móvil)
          const { data: contact } = await db.client.from('contacts')
            .select('id, name, phone').eq('org_id', orgId).eq('id', entity.contact_id).maybeSingle();
          const phone = String(contact?.phone || '').replace(/[^\d+]/g, '');
          if (phone.replace(/\D/g, '').length < 7) { out.skipped += plan.length; continue; }

          // Bajas (mismo criterio que la voz de reactivación) + cooling-off
          const info = await contactInfo(orgId, contact.phone);
          if (info.blocked) { out.skipped += plan.length; continue; }
          let cooling = false;
          try {
            const { getContactMemory, isCoolingOff } = require('../lifecycle/call-memory');
            cooling = isCoolingOff(await getContactMemory(entity.contact_id, orgId));
          } catch (_) {}
          if (cooling) { out.skipped += plan.length; continue; }

          for (const item of plan) {
            if (queuedThisOrg >= MAX_CALLS_PER_ORG_PER_RUN) break;
            if (calledContacts.has(entity.contact_id)) { out.skipped++; continue; }

            // Dedupe en BD: una llamada por (entidad, campo, ciclo), para siempre.
            const { data: existing } = await db.client.from('nf_campaign_calls')
              .select('id')
              .eq('org_id', orgId)
              .eq('campaign_type', 'entity_date')
              .eq('payload->>dedupeKey', item.dedupeKey)
              .limit(1).maybeSingle();
            if (existing) { out.skipped++; continue; }

            await enqueueCampaignCall({
              orgId,
              campaignType: 'entity_date',
              phone:        contact.phone,
              contactId:    entity.contact_id,
              payload: {
                dedupeKey: item.dedupeKey,
                entityId:  entity.id,
                fieldKey:  item.fieldKey,
                dueDate:   item.dueDate,
                promptBlock: buildEntityCallBlock(bizName, {
                  clientName:    contact.name,
                  entityName:    item.displayName,
                  fieldLabel:    item.fieldLabel,
                  dueDatePretty: item.dueDatePretty,
                  serviceHint:   item.serviceHint,
                }),
              },
            });
            calledContacts.add(entity.contact_id);
            queuedThisOrg++;
            out.queued++;
          }
        }
      }
    } catch (e) {
      log.warn(`entity calls org ${orgId}: ${e.message}`);
    }
  }

  if (out.queued) {
    log.info(`La entidad llama: ${out.queued} llamadas encoladas (${out.orgs} orgs, ${out.scanned} fichas, ${out.skipped} saltadas)`);
  }
  return out;
}

/**
 * Post-call: si la llamada de entidad terminó en RESERVA, la cita queda
 * enlazada a la ficha (nf_appointments.entity_id) — el timeline de la
 * entidad la pinta solo. NO-OPea si el job no es entity_date o si la
 * columna entity_id aún no existe (migración pendiente).
 */
async function linkBookedAppointmentsToEntity(jobId, aptIds = []) {
  const db = getDatabase();
  if (!db.enabled || !jobId || !aptIds.length) return 0;
  try {
    const { data: job } = await db.client.from('nf_campaign_calls')
      .select('campaign_type, payload').eq('id', jobId).maybeSingle();
    const entityId = job?.payload?.entityId;
    if (job?.campaign_type !== 'entity_date' || !entityId) return 0;

    const ids = aptIds.map(String).filter(Boolean);
    const { error } = await db.client.from('nf_appointments')
      .update({ entity_id: entityId })
      .in('id', ids);
    if (error) throw new Error(error.message);
    log.info(`Cita(s) ${ids.join(', ')} enlazadas a la entidad ${entityId} (job ${jobId})`);
    return ids.length;
  } catch (e) {
    log.warn(`linkBookedAppointmentsToEntity(${jobId}): ${e.message}`);
    return 0;
  }
}

module.exports = {
  isServiceOpportunity,
  entityCallDedupeKey,
  isEntityCallEnqueueWindow,
  buildEntityCallPlan,
  buildEntityCallBlock,
  enqueueEntityDateCalls,
  linkBookedAppointmentsToEntity,
  NON_CALLABLE_KINDS,
  MAX_CALLS_PER_ORG_PER_RUN,
};
