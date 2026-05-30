// ============================================
// NodeFlow — Automation Cron Runner
// Cada 30 min: reminders + review requests
// 09:00 Madrid: critical date reminders
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('CRON');

let _interval    = null;
let _warmupTimer = null;
let _running     = false;
let _lastRun     = null;
let _stats       = { reminders: 0, reviews: 0, criticalDates: 0, noShows: 0, runs: 0 };
let _history     = [];
let _lastMonthlyResetDay = null; // 'YYYY-MM-01' — prevents duplicate resets in same day

async function checkAndSendCriticalDateReminders() {
  const { criticalDatesStore } = require('../scheduling/critical-dates');
  const { sendCriticalDateReminder } = require('../notifications/critical-date-notifications');
  const { flowManager } = require('../automations/flow-manager');
  const { scheduler }   = require('../scheduling/scheduler');

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  const allDates = criticalDatesStore.getAll();
  let sent = 0;

  for (const entry of allDates) {
    for (const advanceDay of (entry.advanceDays || [30, 15, 7])) {
      if (entry.sentReminders.includes(String(advanceDay))) continue;

      const targetDate = new Date(entry.dueDate + 'T12:00:00');
      targetDate.setDate(targetDate.getDate() - advanceDay);
      const targetStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(targetDate);

      if (targetStr !== today) continue;

      const config = flowManager.mergeConfig(entry.businessId, scheduler.getBusinessConfig(entry.businessId) || {});

      try {
        await sendCriticalDateReminder(entry, advanceDay, config);
        criticalDatesStore.markSent(entry.id, advanceDay);
        sent++;
        log.info(`Critical date reminder sent: ${entry.clientName} — ${entry.type} in ${advanceDay}d`);
      } catch (e) {
        log.warn(`Critical date reminder failed for ${entry.id}`, { err: e.message });
      }
    }
  }

  return sent;
}

function aptToMs(date, time) {
  // Parse a Madrid local datetime (e.g. '2026-05-29', '10:00') as UTC milliseconds.
  // Treats the date+time as Europe/Madrid local time and returns the corresponding UTC ms.
  const isoStr = `${date}T${time}:00`;
  const guessUtc = new Date(isoStr + 'Z').getTime(); // treat as UTC first
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  // Format guessUtc back to Madrid local time
  const madridStr = formatter.format(guessUtc).replace(' ', 'T'); // "2026-05-29T10:00:00"
  // Offset = how far ahead Madrid is from UTC at this instant (positive when Madrid > UTC)
  const offsetMs = new Date(madridStr + 'Z').getTime() - guessUtc;
  // Return the UTC ms that corresponds to the Madrid local time
  return guessUtc - offsetMs;
}

async function checkAndHandleNoShows(scheduler, flowManager) {
  const { sendNoShowEmail } = require('../notifications/noshow-notifications');
  const GRACE_MS = 30 * 60 * 1000; // 30 minutes grace period after appointment time
  const now  = Date.now();
  let handled = 0;

  for (const apt of scheduler.appointments.values()) {
    if (apt.status !== 'confirmed') continue;   // only process confirmed (pending/completed/cancelled = skip)
    if (apt.noShowNotified) continue;           // already sent a no-show email
    if (!apt.email) continue;                   // no email to send to

    let aptMs;
    try {
      aptMs = aptToMs(apt.date, apt.time);
    } catch(_) { aptMs = NaN; }
    if (isNaN(aptMs)) continue;                 // invalid date — skip
    if (now < aptMs + GRACE_MS) continue;       // not yet past grace period

    // No-show confirmed: appointment passed, still confirmed, not notified
    const config = scheduler.getBusinessConfig(apt.businessId) || {};

    try {
      const ok = await sendNoShowEmail(apt, config);
      if (ok) {
        apt.noShowNotified = true;
        handled++;
        log.info(`No-show handled: apt ${apt.id} — ${apt.patientName}`);
      }
    } catch (e) {
      log.warn(`No-show email error for apt ${apt.id}`, { err: e.message });
    }
  }

  return handled;
}

async function runAutomations() {
  if (_running) return;
  _running = true;
  const start = Date.now();

  try {
    const { scheduler }              = require('./scheduler');
    const { flowManager }            = require('../automations/flow-manager');
    const { checkAndSendReminders,
            checkAndSendReviews }    = require('../notifications/reminders');

    // ── Monthly usage reset (1st of month, free/Starter orgs only) ──
    // Stripe-subscribed orgs are reset via invoice.paid webhook; only reset orgs without
    // a Stripe subscription so we don't interfere with mid-month billing periods.
    const todayMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (todayMadrid.endsWith('-01') && _lastMonthlyResetDay !== todayMadrid) {
      _lastMonthlyResetDay = todayMadrid;
      try {
        const { getDatabase } = require('../db/database');
        const db = getDatabase();
        if (db.enabled) {
          await db.client
            .from('organizations')
            .update({ monthly_minutes_used: 0 })
            .is('stripe_subscription_id', null)
            .gt('monthly_minutes_used', 0);
          log.info('Monthly usage reset applied to Starter (no-subscription) orgs');
        }
      } catch (e) {
        log.warn('Monthly usage reset failed', { err: e.message });
      }
    }

    log.info(`Running automations for ${flowManager.list().length} flows…`);
    const reminders     = await checkAndSendReminders(scheduler, flowManager);
    const reviews       = await checkAndSendReviews(scheduler, flowManager);
    const criticalDates = await checkAndSendCriticalDateReminders();
    const noShows        = await checkAndHandleNoShows(scheduler, flowManager);

    _stats.reminders     += reminders;
    _stats.reviews       += reviews;
    _stats.criticalDates += criticalDates;
    _stats.noShows       = (_stats.noShows || 0) + noShows;
    _stats.runs          += 1;
    _lastRun              = new Date().toISOString();
    _history.unshift({ runAt: _lastRun, reminders, reviews, criticalDates, noShows });
    if (_history.length > 10) _history.pop();

    const elapsed = Date.now() - start;
    log.info(`Automations done in ${elapsed}ms — reminders:${reminders} reviews:${reviews} criticalDates:${criticalDates} noShows:${noShows}`);
  } catch (e) {
    log.error('Automation run error', { error: e.message });
  } finally {
    _running = false;
  }
}

function startCron(intervalMinutes = 30) {
  if (_interval) { log.warn('Cron already running'); return; }
  log.info(`Cron started — interval: ${intervalMinutes} min`);
  _warmupTimer = setTimeout(runAutomations, 60 * 1000);
  _interval = setInterval(runAutomations, intervalMinutes * 60 * 1000);
}

function stopCron() {
  if (_warmupTimer) { clearTimeout(_warmupTimer); _warmupTimer = null; }
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Cron stopped'); }
}

function getCronStats() {
  return {
    running:  _running,
    lastRun:  _lastRun,
    uptime:   _interval ? 'active' : 'stopped',
    totals:   { ..._stats },
    lastRuns: _history.slice(),
  };
}

module.exports = { startCron, stopCron, runAutomations, getCronStats };
