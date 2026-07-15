// ============================================
// NodeFlow — Automation Cron Runner
// Cada 30 min: reminders + review requests
// 09:00 Madrid: critical date reminders
// ============================================

const { Logger } = require('../utils/logger');
const { appointmentsStore } = require('../db/appointments-store');

const log = new Logger('CRON');

let _interval    = null;
let _warmupTimer = null;
let _running     = false;
let _lastRun     = null;
let _stats       = { reminders: 0, reviews: 0, criticalDates: 0, noShows: 0, runs: 0 };
let _history     = [];
let _lastMonthlyResetDay = null; // 'YYYY-MM-01' — prevents duplicate resets in same day
let _lastWeeklyReportDay = null; // 'YYYY-MM-DD' (Monday) — prevents duplicate weekly reports
let _lastImprovementDay  = null; // 'YYYY-MM-DD' (Monday) — dedupe del ciclo de mejora
let _lastEntityRemindersDay = null; // 'YYYY-MM-DD' — dedupe del materializador de entidades

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
    if (!flowManager.isEnabled(apt.businessId, 'noshow')) continue; // respetar el toggle del negocio

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
        appointmentsStore.patch(apt.id, { noShowNotified: true, updatedAt: new Date().toISOString() });
        handled++;
        log.info(`No-show handled: apt ${apt.id} — ${apt.patientName}`);
      }
    } catch (e) {
      log.warn(`No-show email error for apt ${apt.id}`, { err: e.message });
    }
  }

  return handled;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly report — every Monday at 09:00 Madrid, one send per business
// ─────────────────────────────────────────────────────────────────────────────
async function sendWeeklyReports(scheduler, flowManager) {
  const now       = new Date();
  const madridFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' });
  const madridTime= new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
  const todayStr  = madridFmt.format(now);                   // 'YYYY-MM-DD'
  const dayOfWeek = new Date(todayStr + 'T12:00:00').getDay(); // 0=Sun, 1=Mon
  const hourMadrid= parseInt(madridTime.format(now).split(':')[0], 10);

  // Only on Mondays, between 09:00 and 10:00, once per week
  if (dayOfWeek !== 1) return 0;
  if (hourMadrid < 9 || hourMadrid >= 10) return 0;
  if (_lastWeeklyReportDay === todayStr) return 0; // already sent today
  _lastWeeklyReportDay = todayStr;

  // Calculate last week's date range (Mon–Sun)
  const monday    = new Date(todayStr + 'T00:00:00');
  const lastMon   = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastSun   = new Date(monday); lastSun.setDate(monday.getDate() - 1);
  const fromStr   = madridFmt.format(lastMon);
  const toStr     = madridFmt.format(lastSun);

  const businesses = flowManager.list();
  let sent = 0;

  for (const biz of businesses) {
    // BUG FIX: flow objects use 'businessId', not 'id' — biz.id was always undefined
    const bizId = biz.businessId;
    try {
      const config     = flowManager.mergeConfig(bizId, scheduler.getBusinessConfig(bizId) || {});
      const ownerPhone = config.ownerPhone;
      if (!ownerPhone) continue;

      // Count appointments this week
      const allApts = [...scheduler.appointments.values()].filter(a => a.businessId === bizId);
      const weekApts = allApts.filter(a => a.date >= fromStr && a.date <= toStr);
      const booked   = weekApts.filter(a => ['confirmed', 'completed'].includes(a.status)).length;
      const cancelled = weekApts.filter(a => a.status === 'cancelled').length;
      const completed = weekApts.filter(a => a.status === 'completed').length;

      // Services breakdown
      const serviceMap = {};
      weekApts.filter(a => a.status !== 'cancelled').forEach(a => {
        const svc = a.service || 'Sin servicio';
        serviceMap[svc] = (serviceMap[svc] || 0) + 1;
      });
      const topServices = Object.entries(serviceMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([svc, n]) => `• ${svc}: ${n}`)
        .join('\n');

      // Upcoming this week
      const upcomingApts = allApts.filter(a => a.date >= todayStr && a.status === 'confirmed');
      const upcomingCount = upcomingApts.length;

      // Build message
      const weekLabel = `${lastMon.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} – ${lastSun.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;
      let msg =
        `📊 *Informe semanal — ${config.name || biz.id}*\n` +
        `━━━━━━━━━━━━\n` +
        `📅 Semana del ${weekLabel}\n\n` +
        `✅ Citas gestionadas: *${booked}*\n` +
        (cancelled > 0 ? `❌ Cancelaciones: ${cancelled}\n` : '') +
        (completed > 0 ? `🎯 Completadas: ${completed}\n` : '');

      if (topServices) {
        msg += `\n📋 *Por servicio:*\n${topServices}\n`;
      }

      msg +=
        `\n📆 *Esta semana pendientes:* ${upcomingCount} citas\n` +
        `━━━━━━━━━━━━\n` +
        `🤖 NodeFlow IA — su asistente está activo 24h`;

      // Send via Meta WhatsApp (client-facing, can send to any number)
      const clientWA = require('../notifications/client-whatsapp');
      if (clientWA.isConfigured()) {
        const result = await clientWA.sendText(ownerPhone, msg);
        if (result.ok) { sent++; continue; }
      }

      // Fallback: owner Callmebot (single phone env var)
      const { sendWhatsApp } = require('../notifications/whatsapp');
      await sendWhatsApp(msg).catch(() => {});
      sent++;

      log.info(`Weekly report sent for ${bizId} (${booked} apts last week)`);
    } catch (e) {
      log.warn(`Weekly report error for ${bizId}: ${e.message}`);
    }
  }

  return sent;
}

/**
 * Recover follow-up emails that were scheduled but not sent (e.g. process restarted
 * before the 30-min setTimeout fired). Queries calls where followup_at <= now
 * and followup_sent = false, sends them, marks as sent.
 */
async function recoverMissedFollowups() {
  const { getDatabase } = require('../db/database');
  const db = getDatabase();
  if (!db.enabled) return 0;

  const { data: rows, error } = await db.client
    .from('nf_calls')
    .select('id, org_id, transcript, outcome, started_at, ended_at, caller_number, client_email, booked_appointment')
    .lte('followup_at', new Date().toISOString())
    .eq('followup_sent', false)
    .not('followup_at', 'is', null)
    .limit(20);

  if (error || !rows?.length) return 0;

  const { sendCallFollowUpEmail } = require('../notifications/call-notifications');
  const { flowManager }           = require('../automations/flow-manager');
  const { scheduler }             = require('./scheduler');
  let recovered = 0;

  for (const row of rows) {
    try {
      // Mark followup_sent = true BEFORE sending to avoid double-send on concurrent cron runs
      const { error: claimErr } = await db.client.from('nf_calls')
        .update({ followup_sent: true })
        .eq('id', row.id)
        .eq('followup_sent', false); // atomic: only update if still false
      if (claimErr) continue; // another process already claimed it

      const bizId = row.org_id;
      const schedulerConfig = scheduler.getBusinessConfig(bizId) || {};
      const config = flowManager.mergeConfig(bizId, schedulerConfig);

      await sendCallFollowUpEmail({
        id:           row.id,
        outcome:      row.outcome,
        clientEmail:  row.client_email,
        callerNumber: row.caller_number,
        transcript:   row.transcript || [],
        startTime:    row.started_at,
        endTime:      row.ended_at,
      }, config);

      recovered++;
      log.info(`Recovered follow-up for call ${row.id} (org ${bizId})`);
    } catch (e) {
      log.warn(`Follow-up recovery failed for ${row.id}`, { err: e.message });
    }
  }

  return recovered;
}

async function runAutomations() {
  if (_running) return;
  // Multi-réplica: solo el LÍDER corre las tareas programadas. Sin Redis o en
  // single-réplica, isLeader()=true → comportamiento de siempre.
  if (!require('../utils/leader').isLeader()) return;
  _running = true;
  const start = Date.now();

  try {
    const { scheduler }              = require('./scheduler');
    const { flowManager }            = require('../automations/flow-manager');
    const { checkAndSendReminders,
            checkAndSendReviews }    = require('../notifications/reminders');

    // ── Anti no-show por VOZ: la tarde anterior (16-19h), el asistente llama
    // a confirmar las citas de mañana pendientes. Dedupe por cita en BD.
    try {
      const { enqueueNoShowConfirmations } = require('../campaigns/enqueuers');
      await enqueueNoShowConfirmations({ scheduler, flowManager });
    } catch (e) { log.warn(`anti no-show por voz: ${e.message}`); }

    // ── LA ENTIDAD LLAMA (opt-in, defecto OFF): campos-fecha de fichas con
    // recordatorio (ITV, vacuna, renovación…) → el asistente llama por la
    // mañana (franja 10-14h dentro del propio enqueuer), ofrece el servicio
    // del negocio y reserva en la misma llamada. Dedupe por (entidad, campo,
    // fecha) en BD → reejecutar cada tick es no-op. Leader-gated arriba.
    try {
      const { enqueueEntityDateCalls } = require('../entities/entity-calls');
      await enqueueEntityDateCalls();
    } catch (e) { log.warn(`la entidad llama: ${e.message}`); }

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
          // Packs de voz persisten hasta gastarse (2026-07-04): antes de poner
          // el contador a cero, descontar del pack lo que se usó este mes en las
          // orgs que tienen saldo comprado. El cupo base sí se renueva.
          try {
            const { settleMonthlyPack } = require('../billing/voice-packs');
            const { data: usedOrgs } = await db.client
              .from('organizations')
              .select('id, monthly_minutes_used, automation_config')
              .is('stripe_subscription_id', null)
              .gt('monthly_minutes_used', 0);
            for (const o of (usedOrgs || [])) {
              if (Number(o.automation_config?.config?.premiumExtraMinutes) > 0) {
                await settleMonthlyPack(o, { db });
              }
            }
          } catch (e) {
            log.warn('Pack settlement on monthly reset failed', { err: e.message });
          }
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
    // HORAS DE SILENCIO (bug real 2026-07-15: recordatorio de cita por WhatsApp
    // a las 6:35 AM). El motor de seguimientos ya respetaba la ventana 9-21
    // Madrid (_isQuietHours) pero este cron de citas NO. Mismo criterio: de
    // noche no se despacha nada al cliente; la ventana ±4h de los recordatorios
    // absorbe el retraso y salen en el primer tick diurno.
    const { _isQuietHours } = require('../lifecycle/scheduler');
    const quiet = _isQuietHours();
    if (quiet) log.info('Horas de silencio (21-9 Madrid): recordatorios/reseñas/fechas clave esperan al primer tick diurno');
    const reminders        = quiet ? 0 : await checkAndSendReminders(scheduler, flowManager);
    const reviews          = quiet ? 0 : await checkAndSendReviews(scheduler, flowManager);
    const criticalDates    = quiet ? 0 : await checkAndSendCriticalDateReminders();
    const noShows          = await checkAndHandleNoShows(scheduler, flowManager);
    const weeklyReports    = await sendWeeklyReports(scheduler, flowManager);
    const recoveredFollowups = await recoverMissedFollowups();

    // Rescate de altas atascadas (auditoría 2026-07-16): si el aprovisionamiento
    // murió entre el claim y 'active' (OOM/redeploy), el fundador pagó y se quedó
    // a medias en silencio. Se completa si ya hay org, o se reabre si no (seguro:
    // sin org = sin número comprado). NO depende de horas de silencio (rescatar
    // cuanto antes). No-op hasta aplicar la migración de provisioning_at.
    try {
      const { reconcileStuckProvisioning } = require('../api/routes-registro');
      await reconcileStuckProvisioning({ thresholdMinutes: 15 });
    } catch (e) { log.warn(`reconcile altas atascadas: ${e.message}`); }

    // ── ENTIDADES v0 — materializador nocturno (02-05h Madrid, 1×/día) ──
    // Campos-fecha con recordatorio (ITV, vacuna, renovación de póliza…) →
    // scheduled_reminders. NO-OPea si las tablas de entidades no existen aún
    // (migración pendiente) o con ENTITIES_DISABLED=1. Leader-gated arriba.
    try {
      const hourMadridNow = parseInt(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()), 10);
      if (hourMadridNow >= 2 && hourMadridNow < 5 && _lastEntityRemindersDay !== todayMadrid) {
        _lastEntityRemindersDay = todayMadrid;
        const { materializeEntityReminders } = require('../entities/entity-reminders');
        const ent = await materializeEntityReminders();
        if (ent.created || ent.cancelled) {
          _stats.entityReminders = (_stats.entityReminders || 0) + ent.created;
        }
      }
    } catch (e) { log.warn(`materializador de entidades: ${e.message}`); }

    // ── Ciclo de mejora continua — lunes 09-10h Madrid, una vez por semana
    // (opción A, 2026-07-04): huecos de datos → aviso a cada dueño; reglas
    // candidatas globales → informe al fundador para su aprobación.
    try {
      const nowMadrid  = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
      const dowMadrid  = new Date(nowMadrid + 'T12:00:00').getDay();
      const hourMadrid = parseInt(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date()), 10);
      if (dowMadrid === 1 && hourMadrid >= 9 && hourMadrid < 10 && _lastImprovementDay !== nowMadrid) {
        _lastImprovementDay = nowMadrid;
        const { runImprovementCycle } = require('../lifecycle/improvement-aggregator');
        const cycle = await runImprovementCycle();
        _stats.improvementCycles = (_stats.improvementCycles || 0) + 1;
        log.info(`Ciclo de mejora semanal: ${JSON.stringify(cycle)}`);
      }
    } catch (e) { log.warn(`ciclo de mejora: ${e.message}`); }

    _stats.reminders          += reminders;
    _stats.reviews            += reviews;
    _stats.criticalDates      += criticalDates;
    _stats.noShows             = (_stats.noShows || 0) + noShows;
    _stats.weeklyReports       = (_stats.weeklyReports || 0) + weeklyReports;
    _stats.recoveredFollowups  = (_stats.recoveredFollowups || 0) + recoveredFollowups;
    _stats.runs                += 1;
    _lastRun                   = new Date().toISOString();
    _history.unshift({ runAt: _lastRun, reminders, reviews, criticalDates, noShows, weeklyReports, recoveredFollowups });
    if (_history.length > 10) _history.pop();

    const elapsed = Date.now() - start;
    log.info(`Automations done in ${elapsed}ms — reminders:${reminders} reviews:${reviews} criticalDates:${criticalDates} noShows:${noShows} weeklyReports:${weeklyReports} recoveredFollowups:${recoveredFollowups}`);
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
  // Campaign Core: tick propio de 60s (ventana horaria y ritmo los gestiona él)
  try {
    require('../campaigns/dispatcher').startCampaignDispatcher();
  } catch (e) { log.warn(`campaign dispatcher no arrancó: ${e.message}`); }
}

function stopCron() {
  if (_warmupTimer) { clearTimeout(_warmupTimer); _warmupTimer = null; }
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Cron stopped'); }
  try { require('../campaigns/dispatcher').stopCampaignDispatcher(); } catch (_) {}
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
