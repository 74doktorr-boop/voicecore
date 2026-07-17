'use strict';
// ============================================================
// NodeFlow — Busy desde calendarios iCal/ICS (2026-07-17)
// LA integración universal de lectura: Fresha, Booksy, Treatwell, Doctoralia,
// Mews, Cloudbeds… casi todo software vertical EXPORTA un feed iCal. El dueño
// pega esa URL y sus citas reales BLOQUEAN huecos en NodeFlow → se acabó la
// doble agenda y el overbooking (66% del churn en la simulación de embudo),
// sin esperar APIs ni partnerships.
//
// v1 consciente: eventos con hora (las citas). Se OMITEN los de día completo
// (suelen ser notas/festivos y matarían la agenda entera) y los recurrentes
// RRULE (se cuentan para observabilidad). Zonas: UTC (Z), Europe/Madrid o
// flotante (= hora local española); TZID exóticos se tratan como flotantes.
// FAIL-OPEN total: cualquier problema → {} (como hoy, nunca rompe la reserva).
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('ICAL');

const FETCH_TIMEOUT_MS = Number(process.env.ICAL_FETCH_TIMEOUT_MS) || 8000;
const MAX_BYTES = 2 * 1024 * 1024;   // 2MB por feed
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 min por feed

// ── Parser puro (testeable, sin dependencias) ────────────────────────────────

/** Despliega las líneas plegadas del RFC 5545 (continuación = espacio/tab). PURA. */
function unfoldIcs(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Parsea un valor DT ics → {utc:boolean, allDay:boolean, y,mo,d,h,mi} | null. PURA. */
function parseIcsDate(value, params = '') {
  const v = String(value || '').trim();
  if (/VALUE=DATE(;|$)/.test(params) || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    return { allDay: true, utc: false, y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0 };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  return { allDay: false, utc: !!m[7], y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

/** Fecha/minutos en pared de Madrid para un instante UTC. */
function utcToMadrid(y, mo, d, h, mi) {
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt).reduce((o, p) => (o[p.type] = p.value, o), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Un extremo del evento → {date:'YYYY-MM-DD', min} en pared Madrid. PURA. */
function icsPointToMadrid(p) {
  if (p.utc) return utcToMadrid(p.y, p.mo, p.d, p.h, p.mi);
  // Flotante / TZID Madrid / TZID exótico: se toma como hora de pared española.
  const pad = n => String(n).padStart(2, '0');
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, min: p.h * 60 + p.mi };
}

/**
 * Parsea el ICS y devuelve bloques ocupados por fecha (pared Madrid),
 * recortados al rango [fromDate, toDate] (strings YYYY-MM-DD). PURA.
 * @returns {{busy: Object<string,{startMin:number,endMin:number}[]>, skipped:{allDay:number,rrule:number,bad:number}, events:number}}
 */
function busyFromIcs(text, fromDate, toDate) {
  const busy = {};
  const skipped = { allDay: 0, rrule: 0, bad: 0 };
  let events = 0;

  // Reparte un bloque {date,min}→{date,min} por días, recortado a la ventana.
  const pushRange = (s, e) => {
    for (let day = s.date; day <= e.date; day = _nextDay(day)) {
      if (day < fromDate || day > toDate) { if (day > toDate) break; continue; }
      const startMin = day === s.date ? s.min : 0;
      const endMin = day === e.date ? e.min : 1440;
      if (endMin > startMin) (busy[day] = busy[day] || []).push({ startMin, endMin });
      if (day === e.date) break;
    }
  };

  const blocks = unfoldIcs(text).split('BEGIN:VEVENT').slice(1);
  for (const raw of blocks) {
    const body = raw.split('END:VEVENT')[0];
    const ds = body.match(/^DTSTART([^:\n]*):([^\n]+)$/m);
    const de = body.match(/^DTEND([^:\n]*):([^\n]+)$/m);
    if (!ds) { skipped.bad++; continue; }
    const start = parseIcsDate(ds[2], ds[1]);
    const end = de ? parseIcsDate(de[2], de[1]) : null;
    if (!start) { skipped.bad++; continue; }
    if (start.allDay) { skipped.allDay++; continue; }

    // Duración en minutos sobre el reloj de pared original (fallback 30 min).
    const durMin = end && !end.allDay
      ? Math.max(1, Math.round((Date.UTC(end.y, end.mo - 1, end.d, end.h, end.mi) - Date.UTC(start.y, start.mo - 1, start.d, start.h, start.mi)) / 60000))
      : 30;

    const rr = body.match(/^RRULE[:;]([^\n]+)$/m);
    if (rr) {
      // v2: clases recurrentes (DAILY/WEEKLY). Cada ocurrencia hereda la hora
      // de pared del DTSTART; EXDATE elimina excepciones (vacaciones).
      const occs = expandRrule(parseRrule(rr[1]), start, fromDate, toDate);
      if (occs === null) { skipped.rrule++; continue; }   // MONTHLY/YEARLY: aún no
      const ex = exdateKeys(body);
      for (const o of occs) {
        if (ex.has(`${o.y}-${o.mo}-${o.d}-${start.h * 60 + start.mi}`)) continue;
        const endDt = new Date(Date.UTC(o.y, o.mo - 1, o.d, start.h, start.mi + durMin));
        const endComp = { utc: start.utc, y: endDt.getUTCFullYear(), mo: endDt.getUTCMonth() + 1, d: endDt.getUTCDate(), h: endDt.getUTCHours(), mi: endDt.getUTCMinutes() };
        events++;
        pushRange(icsPointToMadrid({ ...start, y: o.y, mo: o.mo, d: o.d }), icsPointToMadrid(endComp));
      }
      continue;
    }

    const s = icsPointToMadrid(start);
    const e = end && !end.allDay ? icsPointToMadrid(end) : { date: s.date, min: Math.min(s.min + 30, 1440) };
    events++;
    pushRange(s, e);
  }
  return { busy, skipped, events };
}

function _nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ── RRULE v2: clases recurrentes (gimnasio/yoga/pilates viven de esto) ──────
// Soporta FREQ=DAILY|WEEKLY con INTERVAL, BYDAY, UNTIL, COUNT y EXDATE — lo que
// emiten los feeds reales. MONTHLY/YEARLY se siguen omitiendo (contados).

const _DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2" → objeto en mayúsculas. PURA. */
function parseRrule(line) {
  const out = {};
  for (const part of String(line || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  return out;
}

const MAX_EXPANSION_DAYS = 4000; // tope duro anti feeds patológicos

/**
 * Expande una recurrencia en ocurrencias {y,mo,d} dentro de [fromDate,toDate].
 * `start` = componentes del DTSTART. COUNT cuenta también las anteriores a la
 * ventana (correcto según RFC). PURA.
 */
function expandRrule(rule, start, fromDate, toDate) {
  const freq = String(rule.FREQ || '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return null;   // no soportada (v2)
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count = rule.COUNT ? Math.max(1, parseInt(rule.COUNT, 10) || 1) : null;
  let untilDate = null;
  if (rule.UNTIL) {
    const u = parseIcsDate(rule.UNTIL.replace(/Z$/, ''), '');
    if (u) untilDate = `${u.y}-${String(u.mo).padStart(2, '0')}-${String(u.d).padStart(2, '0')}`;
  }
  const byday = rule.BYDAY
    ? String(rule.BYDAY).split(',').map(s => _DOW[s.trim().slice(-2).toUpperCase()]).filter(n => n !== undefined)
    : null;

  const base = new Date(start.y, start.mo - 1, start.d);
  const baseDow = base.getDay();
  const days = byday && byday.length ? byday : [baseDow];
  // Semana base (lunes) para el INTERVAL semanal
  const baseMonday = new Date(base); baseMonday.setDate(base.getDate() - ((baseDow + 6) % 7));

  const out = [];
  let made = 0;
  for (let i = 0; i < MAX_EXPANSION_DAYS; i++) {
    const cur = new Date(base); cur.setDate(base.getDate() + i);
    const curStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    if (curStr > toDate) break;
    if (untilDate && curStr > untilDate) break;
    let match = false;
    if (freq === 'DAILY') match = i % interval === 0;
    else {
      if (days.includes(cur.getDay())) {
        const weeks = Math.floor((cur - baseMonday) / (7 * 864e5));
        match = weeks % interval === 0;
      }
    }
    if (!match) continue;
    made++;
    if (count && made > count) break;
    if (curStr >= fromDate) out.push({ y: cur.getFullYear(), mo: cur.getMonth() + 1, d: cur.getDate() });
  }
  return out;
}

/** EXDATE(s) del evento → Set de claves "YYYY-M-D-min". PURA. */
function exdateKeys(body) {
  const keys = new Set();
  const lines = String(body || '').match(/^EXDATE[^:\n]*:[^\n]+$/gm) || [];
  for (const line of lines) {
    for (const v of line.slice(line.indexOf(':') + 1).split(',')) {
      const p = parseIcsDate(v.trim().replace(/Z$/, ''), '');
      if (p) keys.add(`${p.y}-${p.mo}-${p.d}-${p.allDay ? 'all' : p.h * 60 + p.mi}`);
    }
  }
  return keys;
}

/** Solo https hacia hosts públicos (anti-SSRF, mismo criterio que webhooks). PURA. */
function isSafeFeedUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return false;
  if (/\.(local|internal)$/.test(h)) return false;
  if (/^127\.|^10\.|^169\.254\.|^192\.168\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return false;
  if (/^(fc|fd|fe80)/i.test(h)) return false;
  return true;
}

// ── Fetch con caché por feed ─────────────────────────────────────────────────
const _feedCache = new Map(); // url -> { at, text }

async function _fetchFeed(url, fetchImpl) {
  const hit = _feedCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('feed demasiado grande');
    _feedCache.set(url, { at: Date.now(), text });
    return text;
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Busy combinado de los feeds iCal de un negocio para [fromDate, toDate].
 * FAIL-OPEN: un feed caído aporta {} y se loguea; jamás lanza.
 * @returns {Promise<Object<string,{startMin:number,endMin:number}[]>>}
 */
async function icalBusyByDate(orgId, feeds, fromDate, toDate, opts = {}) {
  const out = {};
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl || !Array.isArray(feeds)) return out;
  for (const url of feeds.slice(0, 3)) {
    if (!isSafeFeedUrl(url)) { log.warn(`[${orgId}] feed iCal rechazado (URL no segura)`); continue; }
    try {
      const text = await _fetchFeed(url, fetchImpl);
      const { busy, skipped, events } = busyFromIcs(text, fromDate, toDate);
      for (const [day, blocks] of Object.entries(busy)) (out[day] = out[day] || []).push(...blocks);
      if (skipped.rrule) log.info(`[${orgId}] iCal: ${events} eventos, ${skipped.rrule} recurrentes omitidos (v1)`);
    } catch (e) { log.warn(`[${orgId}] feed iCal falló (${String(url).slice(0, 60)}…): ${e.message}`); }
  }
  return out;
}

function _clearCache() { _feedCache.clear(); }

module.exports = { unfoldIcs, parseIcsDate, icsPointToMadrid, busyFromIcs, isSafeFeedUrl, icalBusyByDate, parseRrule, expandRrule, exdateKeys, _clearCache };
