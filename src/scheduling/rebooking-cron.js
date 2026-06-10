// ============================================
// NodeFlow — Re-booking Cron (System B)
// Runs daily at 10:00 Madrid
// Scans past appointments, sends re-booking emails
// to clients past sector threshold with no upcoming apt
// ============================================

const { flowManager }          = require('../automations/flow-manager');
const { scheduler }            = require('./scheduler');
const { sendRebookingEmail, sendRebookingFollowUp } = require('../notifications/rebooking-notifications');
const { getDatabase }          = require('../db/database');
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
// Populated from nf_rebooking_log on startup via _loadSentLog()
const _sentLog = new Map();
// Second-touch log: Map<secondKey, lastSentAt (ms)>
const _secondTouchLog = new Map();

// ── DB persistence helpers ─────────────────────────────────────────────────────

/**
 * Load sent log entries for the current year from nf_rebooking_log into memory.
 * Called once at cron startup to survive restarts.
 */
async function _loadSentLog() {
  const db = getDatabase();
  if (!db.enabled) return;
  try {
    const year = new Date().getFullYear();
    const { data } = await db.client
      .from('nf_rebooking_log')
      .select('business_id, client_key, touch, sent_at_ms, send_count')
      .eq('year', year);
    if (!data || data.length === 0) return;
    for (const row of data) {
      if (row.touch === 1) {
        _sentLog.set(row.client_key, row.sent_at_ms);
        _sentLog.set(`${row.client_key}:${year}`, row.send_count);
      } else if (row.touch === 2) {
        _secondTouchLog.set(`2nd:${row.client_key}`, row.sent_at_ms);
      }
    }
    log.info(`Rebooking sent log loaded — ${data.length} entries (year ${year})`);
  } catch (e) {
    log.warn(`Failed to load rebooking sent log from DB: ${e.message}`);
  }
}

/**
 * Persist a send event to nf_rebooking_log (upsert — updates sent_at_ms + send_count).
 */
async function _persistSent(businessId, clientKey, touch, sendCount) {
  const db = getDatabase();
  if (!db.enabled) return;
  try {
    await db.client.from('nf_rebooking_log').upsert({
      business_id: businessId,
      client_key:  clientKey,
      touch,
      year:        new Date().getFullYear(),
      sent_at_ms:  Date.now(),
      send_count:  sendCount,
    }, { onConflict: 'business_id,client_key,touch,year' });
  } catch (e) {
    log.warn(`Failed to persist rebooking sent log: ${e.message}`);
  }
}

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
                const yearCount = sentThisYear + 1;
                _sentLog.set(key, Date.now());
                _sentLog.set(yearKey, yearCount);
                _persistSent(businessId, key, 1, yearCount).catch(() => {});
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
                _persistSent(businessId, key, 2, 1).catch(() => {});
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
  // Restore anti-spam state from DB so restarts don't cause duplicate sends
  _loadSentLog().catch(e => log.warn(`Sent log load failed on startup: ${e.message}`));

  // Schedule daily at 10:00 Madrid — check every minute if time has come.
  // Use sv-SE locale (ISO-style "HH:mm:ss") to avoid locale-dependent suffixes
  // like the " h" that es-ES appends in some ICU versions.
  _interval = setInterval(() => {
    const madridHHMM = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Madrid',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    if (madridHHMM === '10:00') {
      checkAndSendRebookings().catch(e => log.error('Rebooking cron error', { err: e.message }));
    }
  }, 60 * 1000);

  log.info('Rebooking cron started — fires daily at 10:00 Madrid');
}

function stopRebookingCron() {
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Rebooking cron stopped'); }
}

module.exports = { startRebookingCron, stopRebookingCron, checkAndSendRebookings };
