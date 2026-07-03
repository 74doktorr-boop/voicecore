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

  // ── 2. WhatsApp alert to owner for bookings ──────────────────────────────────
  if (callData.outcome === 'booked' && callData.bookedAppointment) {
    const apt = callData.bookedAppointment;
    const msg = `📞 *Nueva reserva — ${config.name}*\n` +
                `━━━━━━━━━━━━\n` +
                `👤 ${apt.patientName}\n` +
                `📋 ${apt.service}\n` +
                `📅 ${apt.date} · ${apt.time}h\n` +
                (apt.phone ? `📞 ${apt.phone}` : '') +
                `\n━━━━━━━━━━━━\nGestionado por NodeFlow IA`;
    sendWhatsApp(msg).catch(() => {});
  }

  // ── 3. Booking confirmation to client ───────────────────────────────────────
  if (callData.outcome === 'booked' && callData.bookedAppointment?.email) {
    await sendBookingConfirmationEmail(callData.bookedAppointment, config)
      .catch(e => log.warn('booking confirmation email failed', { err: e.message }));
  }

  // ── 4. Follow-up to client for info calls (30 min delay) ────────────────────
  // Schedule in-process timer AND persist followup_at so the cron can recover
  // it if the process restarts before the timer fires.
  if (callData.outcome === 'info' && callData.clientEmail) {
    // Persist scheduled time so cron.js can recover on restart
    if (db.enabled && callData.id) {
      const followupAt = new Date(Date.now() + FOLLOWUP_DELAY_MS).toISOString();
      db.client.from('calls')
        .update({ followup_at: followupAt })
        .eq('call_sid', callData.id)
        .then(undefined, e => log.warn('followup_at persist failed', { err: e.message }));
    }
    setTimeout(async () => {
      try {
        await sendCallFollowUpEmail(callData, config);
        // Mark sent so cron doesn't re-send on next run
        if (db.enabled && callData.id) {
          db.client.from('calls')
            .update({ followup_sent: true })
            .eq('call_sid', callData.id)
            .then(undefined, () => {});
        }
      } catch (e) {
        log.warn('followup email failed', { err: e.message });
      }
    }, FOLLOWUP_DELAY_MS);
  }

  // ── 5. Persist call to Supabase (transcript + outcome) ──────────────────────
  if (db.enabled && callData.id) {
    db.client.from('calls').upsert({
      call_sid:           callData.id,
      org_id:             businessId,
      outcome:            callData.outcome            || null,
      caller_number:      callData.callerNumber       || null,
      client_email:       callData.clientEmail        || null,
      booked_appointment: callData.bookedAppointment  || null,
      transcript:         callData.transcript         || [],
      duration_ms:        callData.duration           || 0,
      turn_count:         callData.turnCount          || 0,
      started_at:         callData.startTime          || null,
      ended_at:           callData.endTime            || null,
      status:             'ended',
    }, { onConflict: 'call_sid' })
      // El builder de Supabase es thenable pero NO tiene .catch — llamarlo
      // reventaba síncronamente y se saltaba TODO el resto del post-call
      // (uso, webhooks, contacto, memoria). then(ok, err) cubre ambos casos.
      .then(({ error }) => { if (error) log.warn('call DB persist failed', { err: error.message }); },
            (e) => log.warn('call DB persist failed', { err: e.message }));
  }

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

  // ── 8+9. Upsert contact → then async transcript analysis ────────────────────
  if (db.enabled && callData.callerNumber) {
    const apt    = callData.bookedAppointment;
    const pName  = apt?.patientName || null;
    const pEmail = apt?.email || callData.clientEmail || null;
    db.client.rpc('upsert_contact', {
      p_org_id:       businessId,
      p_phone:        callData.callerNumber,
      p_name:         pName,
      p_email:        pEmail,
      p_last_call_at: callData.endTime || new Date().toISOString(),
    }).then(() => {
      // ── 9. Async transcript analysis (fires after upsert committed) ──────────
      if (callData.transcript?.length > 0) {
        db.client.from('contacts')
          .select('id')
          .eq('org_id', businessId)
          .eq('phone', callData.callerNumber)
          .maybeSingle()
          .then(({ data: contact }) => {
            if (contact?.id) {
              processCallAsync({
                callSessionId: callData.id         || null,
                contactId:     contact.id,
                orgId:         businessId,
                transcript:    callData.transcript || [],
              }).catch(e => log.warn('transcript async processing failed', { err: e.message }));
            }
          })
          .catch(e => log.warn('contact lookup for transcript analysis failed', { err: e.message }));
      }
    }).catch(e => log.warn('contact upsert failed', { err: e.message }));
  }
}

module.exports = { postCallHandler: { handle } };
