// ============================================
// NodeFlow — Re-booking Cron (System B)
// Runs daily at 10:00 Madrid
// Scans past appointments, sends re-booking emails
// to clients past sector threshold with no upcoming apt
// ============================================

const { flowManager }          = require('../automations/flow-manager');
const { scheduler }            = require('./scheduler');
const { sendRebookingEmail }   = require('../notifications/rebooking-notifications');
const { Logger }               = require('../utils/logger');

const log = new Logger('REBOOKING-CRON');

// Default thresholds in days per sector
const REBOOKING_DEFAULTS = {
  restaurante:  21,
  peluqueria:   42,
  estetica:     42,
  barberia:     28,
  clinica:      180,
  dental:       180,
  veterinaria:  365,
  taller:       365,
  gimnasio:     21,
  academia:     30,
  farmacia:     30,
  asesoria:     90,
  hotel:        90,
  inmobiliaria: null, // disabled
};

// Anti-spam log: Map<`${businessId}:${phone}`, lastSentAt (ms)>
// Loaded from memory only — acceptable loss on restart
const _sentLog = new Map();

function _sentKey(businessId, phone) {
  return `${businessId}:${(phone || '').replace(/\D/g, '')}`;
}

function _daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr + 'T12:00:00');
  const now  = new Date();
  return Math.floor((now - then) / 86400000);
}

function _todayStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}

/**
 * Run the rebooking check for all registered businesses.
 * Returns number of emails sent.
 */
async function checkAndSendRebookings() {
  const flows   = flowManager.list();
  const today   = _todayStr();
  let   sent    = 0;
  let   checked = 0;

  for (const flow of flows) {
    const { businessId, sector, automations } = flow;
    const rebooking = automations?.rebooking;

    if (!rebooking?.enabled) continue;

    const threshold = rebooking.daysThreshold ?? REBOOKING_DEFAULTS[sector] ?? null;
    if (threshold == null) continue; // sector disabled (e.g. inmobiliaria)

    const maxPerYear = rebooking.maxPerYear ?? 4;

    // Get all appointments for this business
    const allApts = scheduler.getAppointments(businessId);
    if (!allApts || allApts.length === 0) continue;

    // Group past appointments by client (keyed by normalised phone)
    const clientMap = new Map(); // phone → { name, email, phone, lastVisitDate, upcomingCount }
    for (const apt of allApts) {
      const phone  = (apt.phone || '').replace(/\D/g, '');
      const isPast = apt.date < today;
      if (!phone && !apt.email) continue; // can't contact

      const key = phone || apt.email;
      const existing = clientMap.get(key) || { name: apt.patientName, email: apt.email || null, phone: phone || null, lastVisitDate: null, upcomingCount: 0 };

      if (isPast) {
        if (!existing.lastVisitDate || apt.date > existing.lastVisitDate) {
          existing.lastVisitDate = apt.date;
        }
      } else {
        existing.upcomingCount++;
      }
      clientMap.set(key, existing);
    }

    // Evaluate each client
    for (const [, client] of clientMap) {
      checked++;
      if (!client.email) continue;                             // need email to send
      if (client.upcomingCount > 0) continue;                 // already has upcoming apt
      if (!client.lastVisitDate) continue;                     // never visited

      const daysSince = _daysSince(client.lastVisitDate);
      if (daysSince < threshold) continue;                     // not yet past threshold

      // Anti-spam: check if already sent within threshold days
      const key = _sentKey(businessId, client.phone || client.email);
      const lastSent = _sentLog.get(key);
      if (lastSent) {
        const daysSinceSent = Math.floor((Date.now() - lastSent) / 86400000);
        if (daysSinceSent < threshold) continue;
      }

      // Check annual cap: count how many times sent this year
      // (simplified: use _sentLog — production should persist to DB)
      const yearKey = `${key}:${new Date().getFullYear()}`;
      const sentThisYear = _sentLog.get(yearKey) || 0;
      if (sentThisYear >= maxPerYear) continue;

      // Send
      const config = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId) || {});
      config.sector = sector;

      try {
        await sendRebookingEmail(client, config, client.lastVisitDate);
        _sentLog.set(key, Date.now());
        _sentLog.set(yearKey, sentThisYear + 1);
        sent++;
        log.info(`Rebooking sent: ${client.email} (${businessId}/${sector}, last:${client.lastVisitDate})`);
      } catch (e) {
        log.warn(`Rebooking send failed: ${client.email}`, { err: e.message });
      }
    }
  }

  log.info(`Rebooking cron done — checked:${checked} sent:${sent}`);
  return sent;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _interval = null;

function startRebookingCron() {
  if (_interval) { log.warn('Rebooking cron already running'); return; }

  // Schedule daily at 10:00 Madrid — check every minute if time has come
  // Simple approach: use setInterval every 60s, check current Madrid hour+minute
  _interval = setInterval(() => {
    const now = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
    if (now === '10:00') {
      checkAndSendRebookings().catch(e => log.error('Rebooking cron error', { err: e.message }));
    }
  }, 60 * 1000);

  log.info('Rebooking cron started — fires daily at 10:00 Madrid');
}

function stopRebookingCron() {
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Rebooking cron stopped'); }
}

module.exports = { startRebookingCron, stopRebookingCron, checkAndSendRebookings };
