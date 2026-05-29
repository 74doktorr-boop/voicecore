// ============================================
// NodeFlow — Re-booking Cron (System B)
// Runs daily at 10:00 Madrid
// Scans past appointments, sends re-booking emails
// to clients past sector threshold with no upcoming apt
// ============================================

const { flowManager }          = require('../automations/flow-manager');
const { scheduler }            = require('./scheduler');
const { sendRebookingEmail, sendRebookingFollowUp } = require('../notifications/rebooking-notifications');
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
  optica:       365,
  psicologia:   21,
  coaching:     21,
  nutricion:    30,
  dietetica:    30,
  podologia:    90,
  autoescuela:  14,
  estetica_avanzada: 45,
  laser:        45,
  yoga:         21,
  pilates:      21,
  guarderia_canina: 60,
  residencia_mascotas: 60,
  abogados:     60,
  notaria:      60,
  agencia_viajes: 180,
  reformas:     90,
  arquitectura: 90,
};

// Anti-spam log: Map<`${businessId}:${phone}`, lastSentAt (ms)>
// Loaded from memory only — acceptable loss on restart
const _sentLog = new Map();
// Second-touch log: Map<secondKey, lastSentAt (ms)>
const _secondTouchLog = new Map();

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
      const key = _sentKey(businessId, client.phone || client.email);

      if (client.email && client.upcomingCount === 0 && client.lastVisitDate) {
        const daysSince = _daysSince(client.lastVisitDate);

        // ── First touch ────────────────────────────────────────────────────
        if (daysSince >= threshold) {
          const lastSent = _sentLog.get(key);
          const alreadySent = lastSent && Math.floor((Date.now() - lastSent) / 86400000) < threshold;
          if (!alreadySent) {
            const yearKey = `${key}:${new Date().getFullYear()}`;
            const sentThisYear = _sentLog.get(yearKey) || 0;
            if (sentThisYear < maxPerYear) {
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
        }

        // ── Second touch: 3 days after first, if no appointment yet ────────
        const firstSent = _sentLog.get(key);
        if (firstSent) {
          const daysSinceFirst = Math.floor((Date.now() - firstSent) / 86400000);
          if (daysSinceFirst >= 3) {
            const secondKey = `2nd:${key}`;
            const lastSecond = _secondTouchLog.get(secondKey);
            const secondAlreadySent = lastSecond && Math.floor((Date.now() - lastSecond) / 86400000) < threshold;
            if (!secondAlreadySent) {
              const config2 = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId) || {});
              config2.sector = sector;
              try {
                await sendRebookingFollowUp(client, config2);
                _secondTouchLog.set(secondKey, Date.now());
                sent++;
                log.info(`Second-touch sent: ${client.email} (${businessId}/${sector})`);
              } catch (e) {
                log.warn(`Second-touch failed: ${client.email}`, { err: e.message });
              }
            }
          }
        }
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
