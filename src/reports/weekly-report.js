// ============================================================
// NodeFlow — Informe Semanal al Cliente
// Cada lunes 08:00 Madrid envía a cada negocio activo un email
// con el valor que su asistente generó la semana anterior:
// llamadas atendidas, citas agendadas, valor estimado y minutos.
//
// Es la pieza de retención más importante: el cliente VE cada
// lunes lo que NodeFlow le ahorra/genera.
//
// Manual: POST /api/admin/weekly-report  (body: { orgId?, dryRun? })
// ============================================================

'use strict';

const { getDatabase } = require('../db/database');
const { sendEmail } = require('../notifications/email');
const { Logger } = require('../utils/logger');

const log = new Logger('WEEKLY-REPORT');

// ── Helpers de fechas (semana pasada: lunes anterior → domingo) ──────────────

function madridToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}
// Instante UTC de las 00:00 en Madrid de una fecha civil (offset por fecha → DST-safe).
function madridMidnightUtc(dateStr) {
  const asUtc = new Date(`${dateStr}T00:00:00Z`);
  const offH  = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(asUtc));
  return new Date(asUtc.getTime() - offH * 3600000);
}

/** Devuelve { from, to } ISO (YYYY-MM-DD) de los últimos 7 días completos. */
function lastWeekRange() {
  const today = new Date(madridToday() + 'T12:00:00');
  const to = new Date(today); to.setDate(to.getDate() - 1);          // ayer
  const from = new Date(today); from.setDate(from.getDate() - 7);    // hace 7 días
  const iso = d => d.toLocaleDateString('sv-SE');
  return { from: iso(from), to: iso(to) };
}

function fmtDate(iso, lang = 'es') {
  const [y, m, d] = iso.split('-').map(Number);
  const locale = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES';
  return new Date(y, m - 1, d).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}

// ── Recogida de métricas por organización ────────────────────────────────────

async function collectOrgStats(db, org, range) {
  // Límites del rango en el DÍA CIVIL de Madrid (no UTC): fin exclusivo = 00:00
  // Madrid del día siguiente al último día del rango.
  const dayAfter = new Date(`${range.to}T12:00:00Z`); dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const fromTs = madridMidnightUtc(range.from).toISOString();
  const toTs   = madridMidnightUtc(dayAfter.toISOString().slice(0, 10)).toISOString();

  // Llamadas de la semana
  const { data: calls } = await db.client
    .from('nf_calls')
    .select('duration_ms, outcome, started_at')
    .eq('org_id', org.id)
    .gte('started_at', fromTs)
    .lt('started_at', toTs)
    .limit(2000);

  // Citas creadas durante la semana (las agendó el asistente)
  const { data: apts } = await db.client
    .from('nf_appointments')
    .select('price, status, service, date, created_at')
    .eq('organization_id', org.id)
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .limit(2000);

  const callList = calls || [];
  const aptList  = (apts || []).filter(a => a.status !== 'cancelled');

  const totalCalls   = callList.length;
  const totalMinutes = Math.round(callList.reduce((s, c) => s + (c.duration_ms || 0), 0) / 60000);
  const bookedCalls  = callList.filter(c => c.outcome === 'booked').length;

  // Valor estimado: precio real de cada cita; si 0, usar avgTicket del config
  const cfg = org.automation_config?.config || {};
  const avgTicket = parseFloat(cfg.avgTicket) || 0;
  const estValue = aptList.reduce((s, a) => {
    const p = parseFloat(a.price) || 0;
    return s + (p > 0 ? p : avgTicket);
  }, 0);

  // Servicio más pedido
  const svcCount = {};
  for (const a of aptList) svcCount[a.service] = (svcCount[a.service] || 0) + 1;
  const topService = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // ── Motor de SEGUIMIENTOS (2026-07-07): el valor que el cliente no ve ──
  // Mensajes enviados por el motor esta semana + cuántos "pendientes de
  // atender" tiene (respuestas de clientes que esperan al dueño) + fichas
  // sin teléfono (avisos que se pierden). Todo tolerante a fallos: si una
  // consulta peta, ese dato va a null y el resto del informe sale igual.
  let remindersSent = null, missingPhone = null;
  try {
    const { count: rem } = await db.client.from('scheduled_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id).eq('status', 'sent')
      .gte('sent_at', fromTs).lt('sent_at', toTs);
    remindersSent = rem || 0;
  } catch (_) {}
  try {
    const { count: noPhone } = await db.client.from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id).is('deleted_at', null)
      .or('phone.is.null,phone.eq.unknown');
    missingPhone = noPhone || 0;
  } catch (_) {}

  return {
    totalCalls,
    totalMinutes,
    bookedCalls,
    totalApts: aptList.length,
    estValue: Math.round(estValue),
    topService,
    remindersSent,
    missingPhone,
  };
}

// ── Email HTML ───────────────────────────────────────────────────────────────

function buildEmailHtml({ bizName, range, stats, lang, suggestions = [], roi = null }) {
  const t = {
    es: {
      subject: `📊 Tu semana con NodeFlow — ${stats.totalApts} citas, ${stats.totalCalls} llamadas atendidas`,
      title: 'Tu informe semanal',
      intro: `Esto es lo que tu asistente hizo por <strong>${bizName}</strong> del ${fmtDate(range.from)} al ${fmtDate(range.to)}:`,
      calls: 'Llamadas atendidas', minutes: 'Minutos al teléfono que te has ahorrado',
      apts: 'Citas agendadas', value: 'Valor estimado generado',
      topSvc: 'Servicio más solicitado',
      roiLine: (n, v) => `🔄 Tus seguimientos trajeron <strong style="color:#21c08a;">${n} cita${n !== 1 ? 's' : ''}${v > 0 ? ` (~${v}€)` : ''}</strong> esta semana`,
      engineLine: (n) => `📩 Tu motor envió <strong style="color:#e8e8f0;">${n} aviso${n !== 1 ? 's' : ''}</strong> a tus clientes esta semana`,
      missingLine: (n) => `📵 <strong style="color:#e0a030;">${n} cliente${n !== 1 ? 's' : ''} sin teléfono</strong> en su ficha — no reciben avisos. Complétalos para no perderlos.`,
      learnedTitle: '🧠 Lo que aprendí de tus citas esta semana',
      learnedCta: 'Revisar y ajustar',
      footer: 'Tu asistente sigue atendiendo 24/7. Nos vemos el lunes que viene.',
      cta: 'Ver mi portal',
    },
    gl: {
      subject: `📊 A túa semana con NodeFlow — ${stats.totalApts} citas, ${stats.totalCalls} chamadas atendidas`,
      title: 'O teu informe semanal',
      intro: `Isto é o que o teu asistente fixo por <strong>${bizName}</strong> do ${fmtDate(range.from, 'gl')} ao ${fmtDate(range.to, 'gl')}:`,
      calls: 'Chamadas atendidas', minutes: 'Minutos ao teléfono que aforraches',
      apts: 'Citas axendadas', value: 'Valor estimado xerado',
      topSvc: 'Servizo máis solicitado',
      roiLine: (n, v) => `🔄 Os teus seguimentos trouxeron <strong style="color:#21c08a;">${n} cita${n !== 1 ? 's' : ''}${v > 0 ? ` (~${v}€)` : ''}</strong> esta semana`,
      engineLine: (n) => `📩 O teu motor enviou <strong style="color:#e8e8f0;">${n} aviso${n !== 1 ? 's' : ''}</strong> aos teus clientes esta semana`,
      missingLine: (n) => `📵 <strong style="color:#e0a030;">${n} cliente${n !== 1 ? 's' : ''} sen teléfono</strong> na súa ficha — non reciben avisos. Complétaos para non perdelos.`,
      learnedTitle: '🧠 O que aprendín das túas citas esta semana',
      learnedCta: 'Revisar e axustar',
      footer: 'O teu asistente segue atendendo 24/7. Vémonos o vindeiro luns.',
      cta: 'Ver o meu portal',
    },
    eu: {
      subject: `📊 Zure astea NodeFlow-ekin — ${stats.totalApts} hitzordu, ${stats.totalCalls} dei erantzunda`,
      title: 'Zure asteko txostena',
      intro: `Hau da zure laguntzaileak <strong>${bizName}</strong>-rentzat egin duena ${fmtDate(range.from, 'eu')}-tik ${fmtDate(range.to, 'eu')}-ra:`,
      calls: 'Dei erantzundak', minutes: 'Telefonoan aurreztutako minutuak',
      apts: 'Hitzordu antolatuak', value: 'Sortutako balio estimatua',
      topSvc: 'Eskatuena izan den zerbitzua',
      roiLine: (n, v) => `🔄 Zure jarraipenek <strong style="color:#21c08a;">${n} hitzordu${v > 0 ? ` (~${v}€)` : ''}</strong> ekarri dituzte aste honetan`,
      engineLine: (n) => `📩 Zure motorrak <strong style="color:#e8e8f0;">${n} abisu</strong> bidali dizkie zure bezeroei aste honetan`,
      missingLine: (n) => `📵 <strong style="color:#e0a030;">${n} bezero telefonorik gabe</strong> beren fitxan — ez dute abisurik jasotzen. Osatu itzazu ez galtzeko.`,
      learnedTitle: '🧠 Aste honetan zure hitzorduetatik ikasi dudana',
      learnedCta: 'Berrikusi eta doitu',
      footer: 'Zure laguntzaileak 24/7 jarraitzen du. Datorren astelehenera arte.',
      cta: 'Nire ataria ikusi',
    },
  }[lang] || null;
  const x = t || {};

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const learnedBlock = (suggestions && suggestions.length) ? `
      <div style="background:rgba(196,245,70,0.06);border:1px solid rgba(196,245,70,0.28);border-radius:12px;padding:18px 20px;margin:28px 0 8px;">
        <div style="font-size:14px;font-weight:800;color:#c4f546;margin-bottom:12px;">${x.learnedTitle}</div>
        ${suggestions.map(s => `
          <div style="padding:10px 0;border-top:1px solid rgba(196,245,70,0.15);">
            <div style="font-size:14px;font-weight:700;color:#fff;">${esc(s.title)}</div>
            <div style="font-size:13px;color:#a0a0b8;line-height:1.6;margin-top:3px;">${esc(s.detail)}</div>
          </div>`).join('')}
        <div style="text-align:center;margin-top:14px;">
          <a href="https://nodeflow.es/portal/?go=reglas" style="display:inline-block;background:#c4f546;color:#0a0b0d;padding:10px 24px;border-radius:9px;text-decoration:none;font-weight:800;font-size:13px;">${x.learnedCta} →</a>
        </div>
      </div>` : '';

  const metric = (value, label, accent = '#a29bfe') => `
    <td style="padding:8px;text-align:center;">
      <div style="background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.25);border-radius:12px;padding:18px 8px;">
        <div style="font-size:28px;font-weight:900;color:${accent};">${value}</div>
        <div style="font-size:11px;color:#8888a8;margin-top:6px;line-height:1.4;">${label}</div>
      </div>
    </td>`;

  return {
    subject: x.subject,
    html: `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0c0c16;border-radius:16px;padding:36px 28px;color:#e8e8f0;">
      <div style="font-size:18px;font-weight:800;color:#8888a8;margin-bottom:24px;">⚡ Node<span style="color:#a29bfe;">Flow</span></div>
      <h1 style="font-size:24px;font-weight:900;margin:0 0 8px;color:#fff;">${x.title}</h1>
      <p style="font-size:14px;color:#8888a8;line-height:1.7;margin:0 0 28px;">${x.intro}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;"><tr>
        ${metric(stats.totalCalls, x.calls)}
        ${metric(stats.totalApts, x.apts, '#00cec9')}
      </tr><tr>
        ${metric(stats.totalMinutes + ' min', x.minutes)}
        ${metric(stats.estValue > 0 ? stats.estValue + '€' : '—', x.value, '#00b894')}
      </tr></table>

      ${stats.topService ? `<p style="font-size:13px;color:#8888a8;text-align:center;margin:16px 0 0;">⭐ ${x.topSvc}: <strong style="color:#e8e8f0;">${stats.topService}</strong></p>` : ''}
      ${roi && x.roiLine ? `<p style="font-size:13px;color:#8888a8;text-align:center;margin:10px 0 0;">${x.roiLine(roi.count, roi.value)}</p>` : ''}
      ${stats.remindersSent > 0 && x.engineLine ? `<p style="font-size:13px;color:#8888a8;text-align:center;margin:10px 0 0;">${x.engineLine(stats.remindersSent)}</p>` : ''}
      ${stats.missingPhone > 0 && x.missingLine ? `<p style="font-size:13px;color:#8888a8;text-align:center;margin:10px 0 0;">${x.missingLine(stats.missingPhone)}</p>` : ''}

      ${learnedBlock}

      <div style="text-align:center;margin:32px 0 8px;">
        <a href="https://nodeflow.es/portal/" style="display:inline-block;background:#6c5ce7;color:#fff;padding:13px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">${x.cta} →</a>
      </div>

      <p style="font-size:12px;color:#55556a;text-align:center;margin-top:28px;line-height:1.6;">${x.footer}</p>
    </div>`,
    text: `${x.title} — ${bizName}\n${x.calls}: ${stats.totalCalls}\n${x.apts}: ${stats.totalApts}\n${x.minutes}: ${stats.totalMinutes}\n${x.value}: ${stats.estValue}€`
      + (roi ? `\nSeguimientos → citas: ${roi.count}${roi.value > 0 ? ` (~${roi.value}€)` : ''}` : '')
      + (stats.remindersSent > 0 ? `\nAvisos enviados por el motor: ${stats.remindersSent}` : '')
      + (stats.missingPhone > 0 ? `\nClientes sin teléfono (sin avisos): ${stats.missingPhone}` : '')
      + ((suggestions && suggestions.length) ? `\n\n${x.learnedTitle}\n${suggestions.map(s => '- ' + s.title + ': ' + s.detail).join('\n')}\n${x.learnedCta}: https://nodeflow.es/portal/?go=reglas` : '')
      + `\n\nhttps://nodeflow.es/portal/`,
  };
}

// ── Envío ────────────────────────────────────────────────────────────────────

/**
 * Genera y envía el informe semanal a todas las orgs activas (o a una sola).
 * @param {{ orgId?: string, dryRun?: boolean }} opts
 */
async function sendWeeklyReports({ orgId = null, dryRun = false } = {}) {
  const db = getDatabase();
  if (!db.enabled) return { ok: false, error: 'DB no configurada' };

  const range = lastWeekRange();

  let q = db.client
    .from('organizations')
    .select('id, name, owner_email, automation_config, assistant_config, is_active')
    .eq('is_active', true);
  if (orgId) q = q.eq('id', orgId);
  const { data: orgs, error } = await q;
  if (error) return { ok: false, error: error.message };

  const results = [];
  for (const org of orgs || []) {
    try {
      const stats = await collectOrgStats(db, org, range);

      // Sin actividad → no enviar (no molestar con un email vacío)
      if (stats.totalCalls === 0 && stats.totalApts === 0) {
        results.push({ org: org.id, sent: false, reason: 'sin actividad' });
        continue;
      }

      const cfg       = org.automation_config?.config || {};
      const bizName   = cfg.name || org.name || 'tu negocio';
      const lang      = cfg.language || 'es';
      const avgTicket = parseFloat(cfg.avgTicket) || 0;
      const to        = cfg.notifyEmail || org.owner_email;
      if (!to) { results.push({ org: org.id, sent: false, reason: 'sin email' }); continue; }

      // Lo que NodeFlow aprendió de sus citas: hasta 2 sugerencias de seguimiento.
      let suggestions = [];
      try {
        const rawSector = (org.assistant_config && org.assistant_config.sector) || '';
        const sector = require('../sectors/sector-registry').resolveSector(rawSector).slug;
        const { getSuggestions } = require('../lifecycle/followup-suggestions');
        suggestions = (await getSuggestions(org.id, sector, { db })).slice(0, 2);
      } catch (e) { log.warn(`Sugerencias informe (${org.id}): ${e.message}`); }

      // ROI del motor esta semana: citas atribuidas a seguimientos.
      let roi = null;
      try {
        const { getAttribution } = require('../lifecycle/followup-attribution');
        const r = await getAttribution(org.id, { db, sinceDays: 7, avgTicket });
        if (r.totals.count > 0) roi = r.totals;
      } catch (e) { log.warn(`ROI informe (${org.id}): ${e.message}`); }

      const email = buildEmailHtml({ bizName, range, stats, lang, suggestions, roi });

      if (dryRun) {
        results.push({ org: org.id, sent: false, dryRun: true, to, subject: email.subject, stats });
        continue;
      }

      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
      results.push({ org: org.id, sent: true, to, stats });
      log.info(`Informe semanal enviado → ${to} (${bizName}: ${stats.totalCalls} llamadas, ${stats.totalApts} citas)`);
    } catch (e) {
      results.push({ org: org.id, sent: false, error: e.message });
      log.warn(`Informe semanal falló para ${org.id}: ${e.message}`);
    }
  }

  const sent = results.filter(r => r.sent).length;
  log.info(`Informes semanales: ${sent}/${results.length} enviados (rango ${range.from} → ${range.to})`);
  return { ok: true, range, sent, total: results.length, results };
}

// ── Cron: lunes 08:00 Madrid ─────────────────────────────────────────────────

let _interval = null;
let _lastRunDate = null;

function startWeeklyReportCron() {
  if (_interval) return;
  _interval = setInterval(() => {
    if (!require('../utils/leader').isLeader()) return; // multi-réplica: solo el líder
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date()).map(p => [p.type, p.value])
    );
    const today = madridToday();
    if (parts.weekday === 'Mon' && `${parts.hour}:${parts.minute}` === '08:00' && _lastRunDate !== today) {
      _lastRunDate = today;
      sendWeeklyReports().catch(e => log.error(`Weekly report cron error: ${e.message}`));
    }
  }, 60 * 1000);
  _interval.unref();
  log.info('Weekly report cron iniciado — lunes 08:00 Madrid');
}

function stopWeeklyReportCron() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { sendWeeklyReports, startWeeklyReportCron, stopWeeklyReportCron, lastWeekRange, buildEmailHtml };
