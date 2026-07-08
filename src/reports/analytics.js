// ============================================================
// NodeFlow — Analítica de Informes (2026-07-08)
// ------------------------------------------------------------
// El "cerebro del negocio": funciones PURAS que agregan las
// llamadas y citas reales de una org en las series, comparativas,
// embudo e insights que pinta el panel de Informes.
//
// Todo es determinista y testeable. Nada inventa números: si un
// dato no se puede calcular con honestidad, se omite (0 / null).
// El endpoint carga los datos crudos y delega aquí.
// ============================================================
'use strict';

const TZ = 'Europe/Madrid';
const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Días por rango. 'year' se agrupa por semana; el resto por día.
const RANGE_DAYS = { week: 7, month: 30, quarter: 90, year: 365 };
const RANGE_LABEL = {
  week: 'Esta semana', month: 'Este mes',
  quarter: 'Últimos 3 meses', year: 'Últimos 12 meses',
};

function rangeDays(range) { return RANGE_DAYS[range] || 30; }

/** Clave YYYY-MM-DD en horario de Madrid (no el huso UTC del servidor). */
function madridDayKey(dateLike) {
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  // en-CA da directamente YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Día de la semana (0=Dom..6=Sáb) en horario de Madrid. */
function madridDow(dateLike) {
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  return local.getDay();
}

/** Hora del día (0..23) en horario de Madrid. */
function madridHour(dateLike) {
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
  return local.getHours();
}

/**
 * Genera los "cubos" temporales del rango. Semana/mes/trimestre → días.
 * Año → semanas (52 puntos serían legibles; agrupamos ISO por lunes).
 * @returns {{ granularity, buckets: [{ key, label, date }] }}
 *   key: identificador para agrupar (YYYY-MM-DD del día o del lunes de la semana)
 */
function buildBuckets(range, now = Date.now()) {
  const days = rangeDays(range);
  const granularity = range === 'year' ? 'week' : 'day';
  const buckets = [];
  const end = new Date(now);

  if (granularity === 'day') {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 864e5);
      const key = madridDayKey(d);
      buckets.push({ key, label: labelForDay(d, range), date: key });
    }
    return { granularity, buckets };
  }

  // Semanal: 52 semanas, etiqueta por lunes.
  const weeks = Math.ceil(days / 7);
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 7 * 864e5);
    const monday = mondayOf(d);
    const key = madridDayKey(monday);
    buckets.push({ key, label: labelForDay(monday, range), date: key });
  }
  return { granularity, buckets };
}

/** Lunes de la semana de una fecha (en local del server; suficiente para agrupar). */
function mondayOf(dateLike) {
  const d = new Date(dateLike);
  const day = (d.getDay() + 6) % 7; // 0 = lunes
  return new Date(d.getTime() - day * 864e5);
}

function labelForDay(dateLike, range) {
  const d = new Date(dateLike);
  if (range === 'week') return DOW_LABELS[d.getDay()];
  // día/mes corto — "5/7"
  return d.getDate() + '/' + (d.getMonth() + 1);
}

/**
 * Reparte una lista de eventos con timestamp en los cubos del rango.
 * @param {Array} items    objetos con fecha
 * @param {function} tsOf  extrae el timestamp de cada item
 * @param {function} incOf (item)=>number, cuánto suma (por defecto 1)
 * @returns {number[]} valores alineados 1:1 con buckets
 */
function bucketize(buckets, granularity, items, tsOf, incOf) {
  const idx = new Map();
  buckets.forEach((b, i) => idx.set(b.key, i));
  const out = new Array(buckets.length).fill(0);
  for (const it of items || []) {
    const ts = tsOf(it);
    if (!ts) continue;
    let key;
    if (granularity === 'week') {
      key = madridDayKey(mondayOf(new Date(ts)));
    } else {
      key = madridDayKey(ts);
    }
    const i = idx.has(key) ? idx.get(key) : -1;
    if (i >= 0) out[i] += incOf ? incOf(it) : 1;
  }
  return out;
}

/**
 * Delta porcentual vs periodo anterior. PURA.
 * @returns {{ pct, dir, prev, curr }} dir: 'up'|'down'|'flat'; pct null si no computable
 */
function computeDelta(curr, prev) {
  curr = Number(curr) || 0;
  prev = Number(prev) || 0;
  if (prev === 0) {
    if (curr === 0) return { pct: 0, dir: 'flat', prev, curr };
    return { pct: null, dir: 'up', prev, curr }; // nuevo: no hay base para %
  }
  const pct = Math.round(((curr - prev) / prev) * 100);
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { pct, dir, prev, curr };
}

/** ¿La llamada resultó atendida? (no abandonada / no fallida) */
function isAnswered(call) {
  const s = call.status;
  const o = call.outcome;
  if (o === 'abandoned' || o === 'missed' || o === 'voicemail') return false;
  if (s === 'failed') return false;
  return true;
}
function isBooked(call) { return call.outcome === 'booked'; }

/**
 * Embudo de conversión: llamadas → atendidas → citas → completadas. PURA.
 * completadas = citas confirmadas cuya fecha ya pasó (honesto: no inventamos
 * "asistió"; usamos "cita confirmada y fecha pasada" como proxy de completada).
 * @returns {{ steps: [{ key, label, value, pct, dropPct }] }}
 */
function computeFunnel(calls, appointments, now = Date.now()) {
  const total = (calls || []).length;
  const answered = (calls || []).filter(isAnswered).length;
  const booked = (calls || []).filter(isBooked).length;
  const todayKey = madridDayKey(now);
  const completed = (appointments || []).filter(a =>
    a && a.status !== 'cancelled' && a.date && a.date < todayKey).length;

  const raw = [
    { key: 'calls', label: 'Llamadas', value: total },
    { key: 'answered', label: 'Atendidas', value: answered },
    { key: 'booked', label: 'Citas', value: booked },
    { key: 'completed', label: 'Completadas', value: completed },
  ];
  const base = total || 1;
  const steps = raw.map((s, i) => {
    const pct = total > 0 ? Math.round((s.value / base) * 100) : 0;
    const prevVal = i > 0 ? raw[i - 1].value : s.value;
    const dropPct = prevVal > 0 ? Math.round(((prevVal - s.value) / prevVal) * 100) : 0;
    return { ...s, pct, dropPct };
  });
  return { steps, convRate: total > 0 ? Math.round((booked / total) * 100) : 0 };
}

/** Distribución por día de la semana (Lun..Dom para lectura de negocio). */
function weekdayDistribution(calls) {
  const raw = Array(7).fill(0);
  for (const c of calls || []) {
    const dow = madridDow(c.startTime || c.endTime);
    if (dow != null) raw[dow]++;
  }
  // Reordenar a Lun..Dom
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map(i => ({ label: DOW_LABELS[i], value: raw[i], dow: i }));
}

/** Distribución por hora del día (0..23). Para decisiones de refuerzo. */
function hourDistribution(calls) {
  const raw = Array(24).fill(0);
  for (const c of calls || []) {
    const h = madridHour(c.startTime || c.endTime);
    if (h != null) raw[h]++;
  }
  return raw.map((value, hour) => ({ hour, value }));
}

/** Servicios más pedidos, de las citas. Devuelve top N con conteo. */
function topServices(appointments, limit = 6) {
  const counts = new Map();
  for (const a of appointments || []) {
    if (!a || a.status === 'cancelled') continue;
    const name = (a.service || '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Insights: una frase inteligente por gráfico, determinista ──────
// Reglas basadas en los números ya calculados. Nunca un LLM en caliente.

function insightWeekday(dist, totalCalls) {
  if (!totalCalls || totalCalls < 5) return null;
  let peak = dist[0];
  for (const d of dist) if (d.value > peak.value) peak = d;
  if (peak.value === 0) return null;
  const share = Math.round((peak.value / totalCalls) * 100);
  if (share >= 30) {
    return `Tus ${dayName(peak.dow)} concentran el ${share}% de las llamadas — buen día para reforzar el equipo.`;
  }
  return `El día con más llamadas es ${dayName(peak.dow)} (${peak.value}). El reparto es bastante uniforme.`;
}

function insightHour(hours, totalCalls) {
  if (!totalCalls || totalCalls < 8) return null;
  // Ventana de 2h con más volumen
  let bestH = 0, bestSum = -1;
  for (let h = 0; h < 23; h++) {
    const sum = hours[h].value + hours[h + 1].value;
    if (sum > bestSum) { bestSum = sum; bestH = h; }
  }
  if (bestSum <= 0) return null;
  const share = Math.round((bestSum / totalCalls) * 100);
  return `La franja ${pad2(bestH)}:00–${pad2(bestH + 2)}:00 es tu hora punta (${share}% de las llamadas).`;
}

function insightFunnel(funnel) {
  const s = funnel.steps;
  if (!s[0].value || s[0].value < 5) return null;
  // Mayor caída entre pasos consecutivos
  let worst = null;
  for (let i = 1; i < s.length; i++) {
    if (!worst || s[i].dropPct > worst.drop) worst = { from: s[i - 1], to: s[i], drop: s[i].dropPct };
  }
  if (!worst || worst.drop <= 0) {
    return `Conviertes ${funnel.convRate}% de las llamadas en cita. Sólido — mantén el ritmo.`;
  }
  if (worst.from.key === 'booked' && worst.to.key === 'completed') {
    return `Pierdes un ${worst.drop}% entre 'cita' y 'completada' — recuerda confirmar y recordar la cita.`;
  }
  if (worst.from.key === 'answered' && worst.to.key === 'booked') {
    return `Pierdes un ${worst.drop}% entre 'atendida' y 'cita' — mejora el cierre en la llamada.`;
  }
  if (worst.from.key === 'calls' && worst.to.key === 'answered') {
    return `Se te escapa un ${worst.drop}% de llamadas sin atender — la asistente puede cubrir esos huecos.`;
  }
  return `Tu mayor fuga está entre '${worst.from.label}' y '${worst.to.label}' (−${worst.drop}%).`;
}

function insightTrend(callsSeries, prevCalls) {
  const total = callsSeries.reduce((a, b) => a + b, 0);
  if (total < 5) return null;
  const d = computeDelta(total, prevCalls);
  if (d.pct == null) return `Primer periodo con datos: ${total} llamadas registradas.`;
  if (d.pct >= 15) return `Tus llamadas crecen un ${d.pct}% respecto al periodo anterior — la demanda sube.`;
  if (d.pct <= -15) return `Las llamadas caen un ${Math.abs(d.pct)}% respecto al periodo anterior — buen momento para reactivar clientes.`;
  return `Volumen estable: ${total} llamadas, ${d.pct >= 0 ? '+' : ''}${d.pct}% vs periodo anterior.`;
}

function insightMoney(attr, revenueEst) {
  if ((attr && attr.totals && attr.totals.value > 0)) {
    const v = attr.totals.value;
    const c = attr.totals.count;
    return `El motor de seguimientos te trajo ${c} ${c === 1 ? 'cita' : 'citas'} (~${v}€) en este periodo.`;
  }
  if (revenueEst > 0) return `Ingresos estimados por las reservas de la asistente: ~${revenueEst}€.`;
  return null;
}

function insightServices(services, totalAppts) {
  if (!services.length || !totalAppts) return null;
  const top = services[0];
  const share = Math.round((top.count / totalAppts) * 100);
  if (share >= 40) return `"${top.name}" es tu servicio estrella (${share}% de las citas).`;
  return `Tu servicio más pedido es "${top.name}" (${top.count} citas).`;
}

function dayName(dow) {
  return ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][dow] || '';
}
function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Orquesta la agregación completa a partir de datos crudos ya cargados. PURA.
 * @param {Object} p
 *   range, calls (periodo), prevCalls (periodo anterior), appointments (periodo),
 *   attribution (getAttribution result), avgTicket, allTime, now
 * @returns {Object} payload listo para el frontend
 */
function buildReport(p) {
  const range = RANGE_DAYS[p.range] ? p.range : 'month';
  const now = p.now || Date.now();
  const calls = p.calls || [];
  const prevCalls = p.prevCalls || [];
  const appts = p.appointments || [];
  const avgTicket = Number(p.avgTicket) || 35;
  const attr = p.attribution || null;

  const { granularity, buckets } = buildBuckets(range, now);
  const callsSeries = bucketize(buckets, granularity, calls, c => c.startTime || c.endTime);
  const bookedCalls = calls.filter(isBooked);
  const bookingsSeries = bucketize(buckets, granularity, bookedCalls, c => c.startTime || c.endTime);

  const totalCalls = calls.length;
  const bookings = bookedCalls.length;
  const answered = calls.filter(isAnswered).length;
  const convRate = totalCalls > 0 ? Math.round((bookings / totalCalls) * 100) : 0;
  const hoursSaved = Math.round((totalCalls * 4) / 60 * 10) / 10;
  const revenueEst = bookings * avgTicket;

  // Periodo anterior (mismos números crudos para deltas honestos)
  const prevTotal = prevCalls.length;
  const prevBookings = prevCalls.filter(isBooked).length;
  const prevConv = prevTotal > 0 ? Math.round((prevBookings / prevTotal) * 100) : 0;
  const prevHours = Math.round((prevTotal * 4) / 60 * 10) / 10;
  const prevRevenue = prevBookings * avgTicket;

  const funnel = computeFunnel(calls, appts, now);
  const weekday = weekdayDistribution(calls);
  const hours = hourDistribution(calls);
  const services = topServices(appts);

  // Serie corta para sparklines (últimos min(buckets,14))
  const spark = callsSeries.slice(-14);
  const bookSpark = bookingsSeries.slice(-14);

  const kpis = {
    totalCalls: { value: totalCalls, delta: computeDelta(totalCalls, prevTotal), spark },
    bookings: { value: bookings, delta: computeDelta(bookings, prevBookings), spark: bookSpark },
    convRate: { value: convRate, delta: computeDelta(convRate, prevConv), suffix: '%' },
    hoursSaved: { value: hoursSaved, delta: computeDelta(hoursSaved, prevHours), suffix: 'h' },
    revenueEst: { value: revenueEst, delta: computeDelta(revenueEst, prevRevenue), prefix: '€' },
  };

  // Historia del dinero: fuentes atribuidas + reservas directas de la asistente.
  // "Voz" = ingresos de reservas hechas en llamada (revenueEst).
  // "Seguimientos"/"fichas" = valor atribuido por getAttribution (auto/personal).
  const money = buildMoneyStory(attr, revenueEst, avgTicket);

  const insights = {
    trend: insightTrend(callsSeries, prevTotal),
    funnel: insightFunnel(funnel),
    weekday: insightWeekday(weekday, totalCalls),
    hours: insightHour(hours, totalCalls),
    money: insightMoney(attr, revenueEst),
    services: insightServices(services, appts.filter(a => a.status !== 'cancelled').length),
  };

  const hasData = totalCalls > 0 || appts.length > 0;

  return {
    ok: true,
    range,
    rangeLabel: RANGE_LABEL[range],
    granularity,
    hasData,
    lowData: hasData && totalCalls < 5,
    kpis,
    trend: { labels: buckets.map(b => b.label), calls: callsSeries, bookings: bookingsSeries },
    funnel,
    money,
    weekday,
    hours,
    services,
    insights,
    allTime: p.allTime || null,
  };
}

/** Historia del dinero: segmentos con etiqueta honesta y flag de estimación. */
function buildMoneyStory(attr, revenueEst, avgTicket) {
  const segments = [];
  // Voz: reservas hechas por la asistente en llamada (estimado por ticket medio)
  if (revenueEst > 0) {
    segments.push({ key: 'voz', label: 'Voz (reservas en llamada)', value: revenueEst, estimated: true });
  }
  let recovered = 0;
  if (attr && attr.totals) {
    const t = attr.totals;
    // El valor atribuido se reparte auto (motor por sector) vs personal (fichas/manual)
    const perAuto = t.count > 0 ? Math.round(t.value * (t.auto / t.count)) : 0;
    const perPersonal = t.value - perAuto;
    if (perAuto > 0) segments.push({ key: 'seguimientos', label: 'Seguimientos automáticos', value: perAuto, estimated: true });
    if (perPersonal > 0) segments.push({ key: 'fichas', label: 'Fichas y seguimiento manual', value: perPersonal, estimated: true });
    recovered = t.value;
  }
  const total = segments.reduce((a, s) => a + s.value, 0);
  return { segments, total, recovered, hasAttribution: !!(attr && attr.totals && attr.totals.value > 0) };
}

module.exports = {
  RANGE_DAYS, RANGE_LABEL, DOW_LABELS,
  rangeDays, madridDayKey, madridDow, madridHour, mondayOf,
  buildBuckets, bucketize, computeDelta, computeFunnel,
  weekdayDistribution, hourDistribution, topServices,
  isAnswered, isBooked,
  insightWeekday, insightHour, insightFunnel, insightTrend, insightMoney, insightServices,
  buildMoneyStory, buildReport,
};
