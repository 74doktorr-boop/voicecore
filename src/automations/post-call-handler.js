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

  log.info(`Post-call [${callData.id}] — outcome:${callData.outcome} biz:${businessId}`);

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
  if (callData.outcome === 'info' && callData.clientEmail) {
    setTimeout(() => {
      sendCallFollowUpEmail(callData, config)
        .catch(e => log.warn('followup email failed', { err: e.message }));
    }, FOLLOWUP_DELAY_MS);
  }

  // ── 5. Persist call to Supabase (transcript + outcome) ──────────────────────
  const db = getDatabase();
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
      .catch(e => log.warn('call DB persist failed', { err: e.message }));
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
  const webhookEvent = (callData.outcome && callData.outcome !== 'unknown')
    ? EVENTS.CALL_COMPLETED
    : EVENTS.CALL_MISSED;
  webhookDispatcher.fire(businessId, webhookEvent, {
    callId:       callData.id,
    outcome:      callData.outcome      || 'unknown',
    duration:     callData.duration     || 0,
    callerNumber: callData.callerNumber || null,
    transcript:   callData.transcript   || [],
    bookedAppointment: callData.bookedAppointment || null,
  }).catch(() => {});

  // ── 8. Upsert contact (phone → contacts table) ───────────────────────────────
  if (db.enabled && callData.callerNumber) {
    const apt   = callData.bookedAppointment;
    const pName = apt?.patientName || null;
    const pEmail = apt?.email || callData.clientEmail || null;
    db.client.rpc('upsert_contact', {
      p_org_id:       businessId,
      p_phone:        callData.callerNumber,
      p_name:         pName,
      p_email:        pEmail,
      p_last_call_at: callData.endTime || new Date().toISOString(),
    }).catch(e => log.warn('contact upsert failed', { err: e.message }));
  }

  // ── 9. Async transcript analysis → call memory ──────────────────────────────
  if (db.enabled && callData.callerNumber && callData.transcript?.length > 0) {
    // Resolve contactId from the just-upserted contact
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
      .catch(() => {});
  }
}

module.exports = { postCallHandler: { handle } };
