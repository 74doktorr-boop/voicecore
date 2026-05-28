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
const { Logger } = require('../utils/logger');

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
}

module.exports = { postCallHandler: { handle } };
