// ============================================================
// NodeFlow — Cálculo de KPIs de negocio (puro, testeable)
// ------------------------------------------------------------
// Funciones SIN dependencias de BD: reciben filas crudas (calls,
// nf_appointments, organizations) y devuelven KPIs, series temporales
// y desglose por cliente. El endpoint hace las queries y llama aquí.
// Así se testea sin Supabase y se reutiliza en admin y portal.
// ============================================================
'use strict';

const PLAN_PRICES = { negocio: 49, pro: 99, enterprise: 0, starter: 0 };
const DAY = 86400000;

function _minutes(call) { return (Number(call.duration_ms) || 0) / 60000; }
function _ts(v) { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; }

/**
 * KPIs principales del periodo.
 * @param {object} p { calls, appointments, orgs, now, includedMinutes, planPrices }
 */
function computeKpis(p = {}) {
  const calls = p.calls || [];
  const appts = p.appointments || [];
  const orgs = p.orgs || [];
  const included = p.includedMinutes ?? 500;
  const prices = p.planPrices || PLAN_PRICES;
  const now = p.now || Date.now();

  const totalCalls = calls.length;
  const bookings = calls.filter(c => c.outcome === 'booked').length;
  const infoCalls = calls.filter(c => c.outcome === 'info').length;
  const conversionRate = totalCalls ? Math.round((bookings / totalCalls) * 100) : 0;
  const minutesUsed = Math.round(calls.reduce((s, c) => s + _minutes(c), 0) * 10) / 10;
  const avgDurationSec = totalCalls ? Math.round(calls.reduce((s, c) => s + (Number(c.duration_ms) || 0), 0) / totalCalls / 1000) : 0;

  // Citas / no-shows
  const totalAppts = appts.length;
  const noShows = appts.filter(a => a.status === 'no_show' || a.no_show_notified).length;
  const cancelled = appts.filter(a => a.status === 'cancelled').length;
  const noShowRate = totalAppts ? Math.round((noShows / totalAppts) * 100) : 0;

  // Automatizaciones (valor añadido)
  const confirmedAppts = appts.filter(a => a.status === 'confirmed').length;
  const remindersSent = appts.filter(a => a.reminder_sent).length;
  const reviewsRequested = appts.filter(a => a.review_requested).length;

  // Engagement
  const avgTurns = totalCalls ? Math.round(calls.reduce((s, c) => s + (Number(c.turn_count) || 0), 0) / totalCalls) : 0;

  // Captación FUERA de horario (antes de 9h o a partir de 20h, o fin de semana):
  // el valor diferencial de NodeFlow — llamadas que hoy se perderían.
  const afterHoursCalls = calls.filter(c => {
    const t = _ts(c.started_at || c.created_at); if (t == null) return false;
    const d = new Date(t); const h = d.getHours(); const wd = d.getDay();
    return h < 9 || h >= 20 || wd === 0 || wd === 6;
  }).length;
  const afterHoursRate = totalCalls ? Math.round((afterHoursCalls / totalCalls) * 100) : 0;

  // Clientes / ingresos
  const activeOrgs = orgs.filter(o => o.is_active);
  const churnedOrgs = orgs.filter(o => o.is_active === false).length;
  const churnRate = orgs.length ? Math.round((churnedOrgs / orgs.length) * 100) : 0;
  const mrr = activeOrgs.reduce((s, o) => s + (prices[o.plan] || 0), 0);
  const arpu = activeOrgs.length ? Math.round(mrr / activeOrgs.length) : 0;
  const overageMinutes = Math.round(activeOrgs.reduce((s, o) => s + Math.max(0, (Number(o.monthly_minutes_used) || 0) - included), 0));
  const overageRevenue = Math.round(overageMinutes * 0.15 * 100) / 100; // 0,15 €/min (decisión Unai 2026-07-04)

  // Altas/bajas del mes (registered_at / created_at)
  const monthAgo = now - 30 * DAY;
  const newOrgs = orgs.filter(o => { const t = _ts(o.registered_at || o.created_at); return t && t >= monthAgo; }).length;

  return {
    totalCalls, bookings, infoCalls, conversionRate, minutesUsed, avgDurationSec, avgTurns,
    totalAppts, confirmedAppts, noShows, cancelled, noShowRate,
    remindersSent, reviewsRequested,
    afterHoursCalls, afterHoursRate,
    activeOrgs: activeOrgs.length, totalOrgs: orgs.length, newOrgs, churnedOrgs, churnRate,
    mrr, arpu, overageMinutes, overageRevenue,
  };
}

/**
 * Serie temporal de llamadas y reservas por día (últimos `days`).
 * @returns {Array<{date, calls, bookings}>}
 */
function timeSeries(calls = [], days = 14, now = Date.now()) {
  const out = [];
  const byDay = {};
  for (const c of calls) {
    const t = _ts(c.started_at || c.created_at);
    if (t == null) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { calls: 0, bookings: 0 };
    byDay[day].calls++;
    if (c.outcome === 'booked') byDay[day].bookings++;
  }
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    out.push({ date: day, calls: byDay[day]?.calls || 0, bookings: byDay[day]?.bookings || 0 });
  }
  return out;
}

/** Volumen de llamadas por hora del día (0-23), para detectar horas pico. */
function hourlyVolume(calls = []) {
  const hours = new Array(24).fill(0);
  for (const c of calls) {
    const t = _ts(c.started_at || c.created_at);
    if (t == null) continue;
    hours[new Date(t).getHours()]++;
  }
  return hours;
}

/**
 * Mapa de calor semanal: matriz 7×24 (día de la semana × hora).
 * Fila 0 = lunes … 6 = domingo. Sirve para ver CUÁNDO llaman.
 */
function weekdayHourHeatmap(calls = []) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of calls) {
    const t = _ts(c.started_at || c.created_at);
    if (t == null) continue;
    const d = new Date(t);
    const wd = (d.getDay() + 6) % 7; // 0 = lunes
    grid[wd][d.getHours()]++;
  }
  return grid;
}

/**
 * Desglose y SALUD por cliente (para gestión).
 * health: 'activo' (llamadas recientes) | 'en_riesgo' (sin uso / cerca de baja) | 'inactivo'
 */
function byOrg(p = {}) {
  const calls = p.calls || [];
  const orgs = p.orgs || [];
  const now = p.now || Date.now();
  const included = p.includedMinutes ?? 500;
  const recentCut = now - 14 * DAY;

  const stats = {};
  for (const c of calls) {
    const id = c.org_id || c.organization_id;
    if (!id) continue;
    if (!stats[id]) stats[id] = { calls: 0, bookings: 0, minutes: 0, lastCall: 0 };
    stats[id].calls++;
    if (c.outcome === 'booked') stats[id].bookings++;
    stats[id].minutes += _minutes(c);
    const t = _ts(c.started_at || c.created_at) || 0;
    if (t > stats[id].lastCall) stats[id].lastCall = t;
  }

  return orgs.map(o => {
    const s = stats[o.id] || { calls: 0, bookings: 0, minutes: 0, lastCall: 0 };
    const used = Number(o.monthly_minutes_used) || 0;
    let health = 'inactivo';
    if (o.is_active) health = (s.lastCall >= recentCut) ? 'activo' : 'en_riesgo';
    const alerts = [];
    if (o.is_active && s.lastCall < recentCut) alerts.push('sin_uso_14d');
    if (used >= included) alerts.push('en_overage');
    else if (used >= included * 0.8) alerts.push('cerca_del_limite');
    if (!o.is_active) alerts.push('inactivo');
    return {
      id: o.id, name: o.name, plan: o.plan, isActive: !!o.is_active,
      calls: s.calls, bookings: s.bookings,
      conversionRate: s.calls ? Math.round((s.bookings / s.calls) * 100) : 0,
      minutesUsed: Math.round(s.minutes * 10) / 10,
      includedMinutes: included,
      lastCall: s.lastCall ? new Date(s.lastCall).toISOString() : null,
      health, alerts,
    };
  }).sort((a, b) => b.calls - a.calls);
}

/**
 * Tendencia de MRR y altas por mes, RECONSTRUIDA desde las fechas de alta
 * (no hay histórico guardado). Para cada mes: altas nuevas, activos acumulados
 * registrados hasta fin de mes, y MRR de esos activos. Es una estimación de
 * "cómo se construyó la base actual".
 * @param {object} p { orgs, months, now, planPrices }
 * @returns {Array<{month, newOrgs, activeOrgs, mrr}>}
 */
function mrrTrend(p = {}) {
  const orgs = p.orgs || [];
  const months = p.months || 12;
  const prices = p.planPrices || PLAN_PRICES;
  const base = new Date(p.now || Date.now());
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const mIdx = base.getMonth() - i;
    const monthStart = new Date(base.getFullYear(), mIdx, 1).getTime();
    const monthEnd = new Date(base.getFullYear(), mIdx + 1, 0, 23, 59, 59, 999).getTime();
    const dd = new Date(base.getFullYear(), mIdx, 1);
    const monthKey = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0');
    let newOrgs = 0, activeOrgs = 0, mrr = 0;
    for (const o of orgs) {
      const t = _ts(o.registered_at || o.created_at);
      if (t == null) continue;
      if (t >= monthStart && t <= monthEnd) newOrgs++;
      if (t <= monthEnd && o.is_active) { activeOrgs++; mrr += (prices[o.plan] || 0); }
    }
    out.push({ month: monthKey, newOrgs, activeOrgs, mrr });
  }
  return out;
}

/**
 * Deltas del periodo actual vs el anterior (mismo tamaño).
 * Cuentas → variación %; tasas (conversión, fuera de horario) → puntos.
 */
function periodDeltas(cur = {}, prev = {}) {
  const pct = (c, p) => { c = Number(c) || 0; p = Number(p) || 0; if (!p) return c > 0 ? 100 : 0; return Math.round(((c - p) / p) * 100); };
  const pts = (c, p) => Math.round((Number(c) || 0) - (Number(p) || 0));
  return {
    totalCalls: pct(cur.totalCalls, prev.totalCalls),
    bookings: pct(cur.bookings, prev.bookings),
    minutesUsed: pct(cur.minutesUsed, prev.minutesUsed),
    conversionRate: pts(cur.conversionRate, prev.conversionRate),
    afterHoursRate: pts(cur.afterHoursRate, prev.afterHoursRate),
  };
}

module.exports = { computeKpis, timeSeries, hourlyVolume, weekdayHourHeatmap, byOrg, periodDeltas, mrrTrend, PLAN_PRICES };
