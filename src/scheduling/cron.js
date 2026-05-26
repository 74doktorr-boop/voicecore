// ============================================
// NodeFlow — Automation Cron Runner
// Cada 30 min: reminders + review requests
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('CRON');

let _interval  = null;
let _running   = false;
let _lastRun   = null;
let _stats     = { reminders: 0, reviews: 0, runs: 0 };

async function runAutomations() {
  if (_running) return;
  _running = true;
  const start = Date.now();

  try {
    // Lazy require to avoid circular deps at startup
    const { scheduler }              = require('./scheduler');
    const { flowManager }            = require('../automations/flow-manager');
    const { checkAndSendReminders,
            checkAndSendReviews }    = require('../notifications/reminders');

    log.info(`Running automations for ${flowManager.list().length} flows…`);
    const reminders = await checkAndSendReminders(scheduler, flowManager);
    const reviews   = await checkAndSendReviews(scheduler, flowManager);

    _stats.reminders += reminders;
    _stats.reviews   += reviews;
    _stats.runs      += 1;
    _lastRun          = new Date().toISOString();

    const elapsed = Date.now() - start;
    log.info(`Automations done in ${elapsed}ms — reminders: ${reminders}, reviews: ${reviews}`);
  } catch (e) {
    log.error('Automation run error', { error: e.message });
  } finally {
    _running = false;
  }
}

function startCron(intervalMinutes = 30) {
  if (_interval) {
    log.warn('Cron already running');
    return;
  }

  log.info(`Cron started — interval: ${intervalMinutes} min`);

  // First run after 1 minute (let server finish booting)
  setTimeout(runAutomations, 60 * 1000);

  _interval = setInterval(runAutomations, intervalMinutes * 60 * 1000);
}

function stopCron() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    log.info('Cron stopped');
  }
}

function getCronStats() {
  return {
    running:  _running,
    lastRun:  _lastRun,
    uptime:   _interval ? 'active' : 'stopped',
    totals:   { ..._stats },
  };
}

module.exports = { startCron, stopCron, runAutomations, getCronStats };
