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

async function checkAndHandleNoShows(scheduler, flowManager) {
  const { sendNoShowEmail } = require('../notifications/noshow-notifications');
  const GRACE_MS = 30 * 60 * 1000; // 30 minutes grace period after appointment time
  const now  = Date.now();
  let handled = 0;

  for (const apt of scheduler.appointments.values()) {
    if (apt.status === 'cancelled') continue;   // cancelled — not a no-show
    if (apt.noShowNotified) continue;           // already sent a no-show email
    if (!apt.email) continue;                   // no email to send to

    const aptMs = new Date(`${apt.date}T${apt.time}:00`).getTime();
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
