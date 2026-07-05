// ============================================================
// NodeFlow — Resumen del día
// Cada mañana (08:00 Madrid) cada negocio activo recibe un email
// con: citas de hoy, huecos libres, llamadas de ayer sin cita y
// clientes a recuperar. Convierte a NodeFlow en su secretaria.
//
// Manual: POST /api/admin/daily-briefing { orgId?, dryRun? }
// ============================================================

'use strict';

const { getDatabase } = require('../db/database');
const { sendEmail } = require('../notifications/email');
const { scheduler } = require('../scheduling/scheduler');
const { flowManager } = require('../automations/flow-manager');
const { Logger } = require('../utils/logger');

const log = new Logger('DAILY-BRIEFING');

const WINBACK_DAYS = 60; // cliente "a recuperar" si no llama desde hace > X días

function madridToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}
// Instante UTC de las 00:00 en MADRID de una fecha civil (offset calculado por
// fecha → DST-safe). Para filtrar timestamptz por el día del NEGOCIO, no el UTC.
function madridMidnightUtc(dateStr) {
  const asUtc = new Date(`${dateStr}T00:00:00Z`);
  const offH  = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(asUtc));
  return new Date(asUtc.getTime() - offH * 3600000);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Recoge los datos del briefing para un negocio. */
async function collectBriefing(db, businessId, today, yesterday) {
  // 1. Citas de hoy (en memoria del scheduler)
  const apts = scheduler.getAppointments(businessId)
    .filter(a => a.date === today && a.status !== 'cancelled')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // 2. Huecos libres hoy
  let freeSlots = [];
  try {
    const slots = scheduler.getAvailableSlots(businessId, today, today);
    const day = (slots.availableDays || [])[0];
    freeSlots = day ? day.slots.map(s => s.time) : [];
  } catch (_) {}

  // 3. Llamadas de ayer que NO acabaron en cita (oportunidades)
  let missedCalls = [];
  if (db.enabled) {
    const { data } = await db.client
      .from('nf_calls')
      .select('caller_number, outcome, started_at')
      .eq('org_id', businessId)
      .gte('started_at', madridMidnightUtc(yesterday).toISOString())
      .lt('started_at',  madridMidnightUtc(today).toISOString())
      .neq('outcome', 'booked')
      .limit(50);
    missedCalls = (data || []).filter(c => c.caller_number);
  }

  // 4. Clientes a recuperar (sin llamar desde hace > WINBACK_DAYS)
  let winback = [];
  if (db.enabled) {
    const cutoff = new Date(Date.now() - WINBACK_DAYS * 86400000).toISOString();
    const { data } = await db.client
      .from('contacts')
      .select('name, phone, last_call_at, call_count')
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .not('last_call_at', 'is', null)
      .lt('last_call_at', cutoff)
      .gte('call_count', 2) // solo clientes que YA fueron habituales
      .order('last_call_at', { ascending: true })
      .limit(5);
    winback = data || [];
  }

  return { apts, freeSlots, missedCalls, winback };
}

function buildEmail({ bizName, today, data }) {
  const { apts, freeSlots, missedCalls, winback } = data;

  const card = (inner) => `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;margin-bottom:12px">${inner}</div>`;

  // Citas de hoy
  let aptsHtml;
  if (apts.length) {
    aptsHtml = apts.map(a =>
      `<tr><td style="padding:4px 10px 4px 0;color:#a29bfe;font-weight:700;white-space:nowrap">${esc(a.time || '')}</td>` +
      `<td style="padding:4px 0;color:#e8e8f0">${esc(a.patientName || 'Cliente')}${a.service ? ` · <span style="color:#8888a8">${esc(a.service)}</span>` : ''}</td></tr>`
    ).join('');
    aptsHtml = `<table style="width:100%;font-size:14px">${aptsHtml}</table>`;
  } else {
    aptsHtml = '<div style="color:#8888a8;font-size:13px">No tienes citas hoy.</div>';
  }

  // Huecos libres
  const slotsHtml = freeSlots.length
    ? `<div style="font-size:13px;color:#e8e8f0">${freeSlots.slice(0, 12).map(s => `<span style="display:inline-block;background:rgba(0,184,148,.12);border:1px solid rgba(0,184,148,.3);border-radius:6px;padding:2px 8px;margin:2px;color:#00b894">${esc(s)}</span>`).join('')}${freeSlots.length > 12 ? ` <span style="color:#8888a8">+${freeSlots.length - 12} más</span>` : ''}</div>`
    : '<div style="color:#8888a8;font-size:13px">Agenda completa o sin horario configurado hoy.</div>';

  // Oportunidades (llamadas sin cita)
  const missedHtml = missedCalls.length
    ? `<div style="font-size:13px;color:#e8e8f0">${missedCalls.length} llamada(s) ayer no acabaron en cita. Quizá merezca la pena devolverlas:</div>` +
      `<div style="margin-top:8px">${missedCalls.slice(0, 6).map(c => `<a href="tel:${esc(c.caller_number)}" style="display:inline-block;background:rgba(253,203,110,.12);border:1px solid rgba(253,203,110,.3);border-radius:6px;padding:3px 9px;margin:2px;color:#fdcb6e;text-decoration:none">📞 ${esc(c.caller_number)}</a>`).join('')}</div>`
    : null;

  // Clientes a recuperar
  const winbackHtml = winback.length
    ? `<div style="font-size:13px;color:#e8e8f0">Estos clientes no vienen desde hace tiempo. Un mensaje puede traerlos de vuelta:</div>` +
      `<div style="margin-top:8px">${winback.map(c => {
        const days = Math.floor((Date.now() - new Date(c.last_call_at)) / 86400000);
        return `<div style="font-size:13px;padding:3px 0;color:#e8e8f0">👤 ${esc(c.name || c.phone)} <span style="color:#8888a8">· hace ${days} días</span></div>`;
      }).join('')}</div>`
    : null;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0c0c16;border-radius:16px;padding:32px 26px;color:#e8e8f0">
      <div style="font-size:18px;font-weight:800;color:#8888a8;margin-bottom:6px">⚡ Node<span style="color:#a29bfe">Flow</span></div>
      <h1 style="font-size:22px;font-weight:900;margin:0 0 4px">Buenos días, ${esc(bizName)} ☀️</h1>
      <p style="color:#8888a8;font-size:13px;margin:0 0 22px;text-transform:capitalize">${fmtDateLong(today)}</p>

      <div style="font-size:13px;font-weight:700;color:#a29bfe;margin-bottom:8px">📅 TUS CITAS DE HOY (${apts.length})</div>
      ${card(aptsHtml)}

      <div style="font-size:13px;font-weight:700;color:#00b894;margin-bottom:8px">🟢 HUECOS LIBRES HOY</div>
      ${card(slotsHtml)}

      ${missedHtml ? `<div style="font-size:13px;font-weight:700;color:#fdcb6e;margin-bottom:8px">💡 OPORTUNIDADES DE AYER</div>${card(missedHtml)}` : ''}
      ${winbackHtml ? `<div style="font-size:13px;font-weight:700;color:#e17055;margin-bottom:8px">🔄 CLIENTES A RECUPERAR</div>${card(winbackHtml)}` : ''}

      <div style="text-align:center;margin:24px 0 6px">
        <a href="https://nodeflow.es/portal/" style="display:inline-block;background:#6c5ce7;color:#fff;padding:12px 30px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Abrir mi portal →</a>
      </div>
      <p style="color:#55556a;font-size:11px;text-align:center;margin-top:18px">Tu asistente sigue atendiendo el teléfono 24/7. Que tengas un gran día.</p>
    </div>`;

  const text = `Buenos días, ${bizName}. Hoy: ${apts.length} citas. Huecos libres: ${freeSlots.length}. Oportunidades de ayer: ${missedCalls.length}. Clientes a recuperar: ${winback.length}. Portal: https://nodeflow.es/portal/`;

  return { subject: `☀️ Tu día en ${bizName}: ${apts.length} citas${missedCalls.length ? ` · ${missedCalls.length} oportunidades` : ''}`, html, text };
}

/**
 * Envía el resumen del día a todos los negocios activos (o a uno).
 * @param {{ orgId?: string, dryRun?: boolean }} opts
 */
async function sendDailyBriefings({ orgId = null, dryRun = false } = {}) {
  const db = getDatabase();
  const today = madridToday();
  const yesterday = new Date(new Date(today + 'T12:00:00').getTime() - 86400000).toLocaleDateString('sv-SE');

  let flows = flowManager.list();
  if (orgId) flows = flows.filter(f => f.businessId === orgId);

  const results = [];
  for (const flow of flows) {
    const businessId = flow.businessId;
    try {
      const cfg = flow.automations?.config || {};
      const bizName = flow.name || cfg.name || 'tu negocio';
      const to = cfg.notifyEmail || flow.ownerEmail;
      if (!to) { results.push({ org: businessId, sent: false, reason: 'sin email' }); continue; }

      const data = await collectBriefing(db, businessId, today, yesterday);

      // No molestar si no hay NADA que contar (ni citas, ni huecos, ni oportunidades)
      const hasContent = data.apts.length || data.missedCalls.length || data.winback.length;
      if (!hasContent) { results.push({ org: businessId, sent: false, reason: 'sin contenido' }); continue; }

      const email = buildEmail({ bizName, today, data });
      if (dryRun) { results.push({ org: businessId, sent: false, dryRun: true, to, subject: email.subject,
        counts: { citas: data.apts.length, huecos: data.freeSlots.length, oportunidades: data.missedCalls.length, recuperar: data.winback.length } }); continue; }

      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
      results.push({ org: businessId, sent: true, to });
      log.info(`Resumen del día → ${to} (${bizName})`);
    } catch (e) {
      results.push({ org: businessId, sent: false, error: e.message });
      log.warn(`Briefing falló para ${businessId}: ${e.message}`);
    }
  }
  const sent = results.filter(r => r.sent).length;
  log.info(`Resúmenes del día: ${sent}/${results.length} enviados`);
  return { ok: true, date: today, sent, total: results.length, results };
}

// ── Cron: cada día 08:00 Madrid ──────────────────────────────────────────────
let _interval = null, _lastRun = null;
function startDailyBriefingCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = madridToday();
    if (`${parts.hour}:${parts.minute}` === '08:00' && _lastRun !== today) {
      _lastRun = today;
      sendDailyBriefings().catch(e => log.error(`Daily briefing cron error: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Daily briefing cron iniciado — cada día 08:00 Madrid');
}
function stopDailyBriefingCron() { if (_interval) { clearInterval(_interval); _interval = null; } }

module.exports = { sendDailyBriefings, startDailyBriefingCron, stopDailyBriefingCron };
