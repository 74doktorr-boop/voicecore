// ============================================
// NodeFlow — Post-Call Handler (System A)
// Fire-and-forget after endCall()
// ============================================

const { flowManager }    = require('./flow-manager');
const { scheduler }      = require('../scheduling/scheduler');
const { sendWhatsApp }   = require('../notifications/whatsapp');
const {
  sendBookingConfirmationEmail,
  sendCallSummaryToOwner,
  sendCallFollowUpEmail,
} = require('../notifications/call-notifications');
const { getDatabase }    = require('../db/database');
const { webhookDispatcher, EVENTS } = require('../webhooks/dispatcher');
const { Logger } = require('../utils/logger');
const { processCallAsync } = require('../lifecycle/transcript-analyzer');

const log = new Logger('POST-CALL');

const FOLLOWUP_DELAY_MS = 30 * 60 * 1000; // 30 min

/**
 * Handle post-call automations.
 * MUST be called fire-and-forget: postCallHandler.handle(callData).catch(() => {})
 *
 * @param {object} callData  - session.toJSON() result (includes outcome, bookedAppointment, etc.)
 */
async function handle(callData) {
  const businessId = callData.businessId || callData.assistantId;
  if (!businessId) {
    log.warn('post-call: no businessId in callData — skipping');
    return;
  }

  const schedulerConfig = scheduler.getBusinessConfig(businessId) || {};
  const config = flowManager.mergeConfig(businessId, schedulerConfig);
  const db = getDatabase(); // BUG FIX: declarado al principio — antes se usaba en el paso 4 antes de declararse (ReferenceError en llamadas 'info')

  log.info(`Post-call [${callData.id}] — outcome:${callData.outcome} biz:${businessId}`);

  // ── 0. Campaign Core: cerrar el job que originó esta saliente ───────────────
  if (callData.campaignRef) {
    try {
      const { completeCampaignCall } = require('../campaigns/dispatcher');
      completeCampaignCall(callData.campaignRef, { outcome: callData.outcome, callSid: callData.id })
        .catch(e => log.warn(`campaign complete failed: ${e.message}`));
    } catch (e) { log.warn(`campaign complete: ${e.message}`); }
  }

  // ── 1. Email summary to owner (always) ──────────────────────────────────────
  if (config.ownerEmail) {
    await sendCallSummaryToOwner(callData, config).catch(e => log.warn('owner summary email failed', { err: e.message }));
  }

  // ── 2+3. Avisos de reserva — para TODAS las citas de la llamada ─────────────
  // Bug real (Pablo, 2026-07-03): 2 reservas en una llamada, solo se notificó
  // la última (el campo singular machacaba la primera).
  const bookedList = (callData.bookedAppointments && callData.bookedAppointments.length)
    ? callData.bookedAppointments
    : (callData.bookedAppointment ? [callData.bookedAppointment] : []);

  // ── 0b. LA ENTIDAD LLAMA: cita reservada en una llamada de entidad →
  // enlazarla a la ficha (nf_appointments.entity_id) para que el timeline
  // de la entidad la pinte. NO-OPea si el job no es entity_date.
  if (callData.campaignRef && callData.outcome === 'booked' && bookedList.length) {
    try {
      const { linkBookedAppointmentsToEntity } = require('../entities/entity-calls');
      linkBookedAppointmentsToEntity(callData.campaignRef, bookedList.map(a => a && a.id).filter(Boolean))
        .catch(e => log.warn(`entity link failed: ${e.message}`));
    } catch (e) { log.warn(`entity link: ${e.message}`); }
  }
  if (callData.outcome === 'booked') {
    const { sendWaConfirmation, sendWaOwnerNewBooking } = require('../notifications/reminders');
    for (const apt of bookedList) {
      // El businessId de la cita puede no venir sellado en el apt suelto —
      // lo necesita sendWaConfirmation para resolver el WABA del negocio.
      const aptWithBiz = { ...apt, businessId: apt.businessId || businessId };

      // 1a) Monitor de NodeFlow (Callmebot → Unai): firehose de TODAS las
      //     reservas de la flota. Es el canal de Unai, NO el del dueño real.
      const msg = `📞 *Nueva reserva — ${config.name}*\n` +
                  `━━━━━━━━━━━━\n` +
                  `👤 ${apt.patientName}\n` +
                  `📋 ${apt.service}\n` +
                  `📅 ${apt.date} · ${apt.time}h\n` +
                  (apt.phone ? `📞 ${apt.phone}` : '') +
                  `\n━━━━━━━━━━━━\nGestionado por NodeFlow IA`;
      sendWhatsApp(msg).catch(() => {});

      // 1b) Aviso al DUEÑO REAL del negocio en SU WhatsApp (alertPhone), vía
      //     plantilla Meta nodeflow_nueva_reserva. Fail-open: si la plantilla no
      //     está aprobada aún o no hay alertPhone, no pasa nada (el dueño sigue
      //     con el email). Antes el "Nueva reserva" solo llegaba a Unai (1a).
      sendWaOwnerNewBooking(aptWithBiz, config)
        .catch(e => log.warn('WA nueva-reserva al dueño falló', { err: e.message }));

      // 2) Confirmación al CLIENTE por WhatsApp desde el número del NEGOCIO,
      //    al instante de colgar (petición Unai 2026-07-04). Respeta el toggle
      //    'waConfirm' del portal; fail-open si no hay plantilla/credenciales.
      if (flowManager.isEnabled(businessId, 'waConfirm')) {
        sendWaConfirmation(aptWithBiz, config)
          .catch(e => log.warn('WA confirmation to client failed', { err: e.message }));
      }

      // 3) Confirmación por email (complementaria, si hay email)
      if (apt.email) {
        await sendBookingConfirmationEmail(apt, config)
          .catch(e => log.warn('booking confirmation email failed', { err: e.message }));
      }
    }
  }

  // ── 4. Follow-up to client for info calls (30 min delay) ────────────────────
  // Schedule in-process timer AND persist followup_at so the cron can recover
  // it if the process restarts before the timer fires.
  if (callData.outcome === 'info' && callData.clientEmail) {
    // Persist scheduled time so cron.js can recover on restart
    if (db.enabled && callData.id) {
      const followupAt = new Date(Date.now() + FOLLOWUP_DELAY_MS).toISOString();
      db.client.from('nf_calls')
        .update({ followup_at: followupAt })
        .eq('id', callData.id)
        .then(undefined, e => log.warn('followup_at persist failed', { err: e.message }));
    }
    setTimeout(async () => {
      try {
        await sendCallFollowUpEmail(callData, config);
        // Mark sent so cron doesn't re-send on next run
        if (db.enabled && callData.id) {
          db.client.from('nf_calls')
            .update({ followup_sent: true })
            .eq('id', callData.id)
            .then(undefined, () => {});
        }
      } catch (e) {
        log.warn('followup email failed', { err: e.message });
      }
    }, FOLLOWUP_DELAY_MS);
  }

  // ── 5. (eliminado 2026-07-03) La persistencia vive en nf_calls (call-store,
  // cableado en endCall). El upsert legacy a "calls" con onConflict call_sid
  // FALLABA en cada llamada desde el lanzamiento: la tabla real de producción
  // no tiene columna call_sid (schema de otro diseño). Por eso estuvo vacía.

  // ── 6. Track call usage — increments monthly_minutes_used and usage table ────
  if (db.enabled && callData.duration > 0) {
    const deltaMinutes = callData.duration / 60000;
    db.incrementMinutesUsed(businessId, deltaMinutes, {
      llmTokens: callData.metrics?.llmTokens  || 0,
      toolCalls: callData.metrics?.toolCalls  || 0,
      cost:      callData.cost?.total         || 0,
    }).catch(e => log.warn('usage increment failed', { err: e.message }));
  }

  // ── 7. Fire webhooks (call.completed / call.missed) — non-blocking ──────────
  const missedOutcomes = ['missed', 'abandoned', 'no-answer', 'unknown'];
  const webhookEvent = (!callData.outcome || missedOutcomes.includes(callData.outcome))
    ? EVENTS.CALL_MISSED
    : EVENTS.CALL_COMPLETED;
  webhookDispatcher.fire(businessId, webhookEvent, {
    callId:       callData.id,
    outcome:      callData.outcome      || 'unknown',
    duration:     callData.duration     || 0,
    callerNumber: callData.callerNumber || null,
    transcript:   callData.transcript   || [],
    bookedAppointment: callData.bookedAppointment || null,
  }).catch(() => {});

  // ── 7b. Auditor IA + alerta al fundador (self-diagnosing product) ───────────
  // Cada llamada se audita sola; el veredicto se persiste junto al score
  // determinista (re-upsert idempotente de nf_calls) y si la llamada fue
  // mala, NodeFlow avisa al fundador ANTES de que el negocio se queje.
  try {
    const { auditCall } = require('../lifecycle/call-auditor');
    const { sendFounderAlert, shouldAlert } = require('../notifications/founder-alert');
    auditCall(callData).then(async (audit) => {
      if (audit) {
        callData.metrics = callData.metrics || {};
        callData.metrics.audit = audit;
        const { saveCallEnd } = require('../db/call-store');
        await saveCallEnd(callData);
      }
      if (shouldAlert(callData, audit)) {
        await sendFounderAlert(callData, audit, config).catch(() => {});
      }
    }).catch(e => log.warn(`auditor: ${e.message}`));
  } catch (e) { log.warn(`auditor init: ${e.message}`); }

  // ── 8+9. Upsert contact → then async transcript analysis ────────────────────
  if (db.enabled && callData.callerNumber) {
    // El contacto es QUIEN LLAMA. Con varias reservas de nombres distintos
    // ("una para mí y otra para mi novia") no se puede saber cuál es el del
    // llamante → no adivinar (el CRM progresivo lo preguntará). Bug real:
    // el teléfono de Pablo quedó fichado como "Nerea" (la última cita).
    // Y los nombres GENÉRICOS que a veces cuela el LLM ("cliente") jamás
    // fichan a nadie (bug real: contacto guardado como "cliente").
    const GENERIC_NAME = /^(el\s+|la\s+)?(cliente|clienta|desconocid[oa]|usuario|se[ñn]or(a)?|customer|unknown)$/i;
    const apt    = bookedList.length === 1 ? bookedList[0] : null;
    const rawName = apt?.patientName?.trim() || '';
    const pName  = rawName && !GENERIC_NAME.test(rawName) ? rawName : null;
    const pEmail = apt?.email || callData.clientEmail || null;
    db.client.rpc('upsert_contact', {
      p_org_id:       businessId,
      p_phone:        callData.callerNumber,
      p_name:         pName,
      p_email:        pEmail,
      p_last_call_at: callData.endTime || new Date().toISOString(),
    }).then(() => {
      // El RPC conserva el primer nombre no-nulo: si el contacto quedó
      // fichado con un genérico antiguo ("cliente"), un nombre REAL nuevo
      // debe ganarle (bug real: Unai dio su nombre y siguió como "cliente").
      if (pName) {
        db.client.from('contacts')
          .update({ name: pName })
          .eq('org_id', businessId)
          .eq('phone', callData.callerNumber)
          .or('name.is.null,name.ilike.cliente,name.ilike.clienta,name.ilike.usuario,name.ilike.desconocido,name.ilike.desconocida,name.ilike.customer,name.ilike.unknown')
          .then(({ error }) => { if (error) log.warn(`contact name upgrade: ${error.message}`); },
                (e) => log.warn(`contact name upgrade: ${e.message}`));
      }
      // ── 9. Tras cada llamada con contacto resuelto: (a) reprogramar sus
      // seguimientos de sector, (b) analizar el transcript. El lookup del id se
      // hace UNA vez, fuera del guard de transcript, para que (a) corra SIEMPRE.
      db.client.from('contacts')
        .select('id')
        .eq('org_id', businessId)
        .eq('phone', callData.callerNumber)
        .maybeSingle()
        .then(({ data: contact }) => {
          if (!contact?.id) return;
          // (a) Reprogramar los seguimientos de fidelización de este cliente.
          // ANTES esto SOLO ocurría al editar la ficha en el portal → un negocio
          // que solo recibía llamadas jamás generaba un aviso automático ("vuelve
          // a por tu corte a los 24 días", pre-ITV, "¿qué tal fue?"). Ahora se
          // dispara solo tras cada llamada. Idempotente (cancela pendientes dup
          // por contacto+servicio, solo programa a futuro) y fail-open.
          try {
            require('../lifecycle/reminder-engine').recalculate(contact.id, businessId)
              .catch(e => log.warn(`recalculate follow-ups failed: ${e.message}`));
          } catch (e) { log.warn(`recalculate init: ${e.message}`); }

          // (b) Análisis async del transcript (solo si hubo conversación).
          if (callData.transcript?.length > 0) {
            // ¿Se ejecutó register_lead DE VERDAD durante la llamada? La red
            // de seguridad solo actúa si el tool jamás corrió (caso real
            // 2026-07-04: el asistente lo verbalizó sin invocarlo).
            const leadRegistered = (callData.metrics?.turns || []).some(t =>
              (t.tools || []).some(x => x && (x.name === 'register_lead' || x.name === 'register_prospect')));
            processCallAsync({
              callSessionId: callData.id         || null,
              contactId:     contact.id,
              orgId:         businessId,
              transcript:    callData.transcript || [],
              callerNumber:  callData.callerNumber || null,
              leadRegistered,
            }).catch(e => log.warn('transcript async processing failed', { err: e.message }));
          }
        })
        .catch(e => log.warn('contact lookup failed', { err: e.message }));
    }).catch(e => log.warn('contact upsert failed', { err: e.message }));
  }
}

module.exports = { postCallHandler: { handle } };
