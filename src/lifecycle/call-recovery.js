// ============================================================
// NodeFlow — Recuperación por llamada (Experimento 01: "La prueba del ROI")
// ------------------------------------------------------------
// Complementa followup-attribution.js. Aquel atribuye las citas que trajo
// el MOTOR DE SEGUIMIENTOS; este atribuye las que trajo el propio
// CONTESTAR: llamadas que NodeFlow cogió y acabaron en reserva.
//
// Solo cuenta como "atribución fuerte" (la cifra de cabecera del extracto
// "Lo que recuperé por ti") lo que el negocio habría PERDIDO sin NodeFlow:
//   · after_hours → la llamada entró fuera del horario declarado.
//   · concurrent  → entró mientras otra llamada del mismo negocio seguía
//                    activa (saturación: se habría perdido).
// Una reserva en horario y sin solape se marca 'weak' y NO entra en la
// cabecera (el negocio la habría cogido igual). Conservador a propósito:
// el número tiene que ser indiscutible ante el propio dueño.
//
// 100% derivado de datos ya persistidos en nf_calls — NO toca el flujo de
// llamada, no requiere migración y no escribe nada. Núcleo de funciones
// PURAS + un cargador de BD, igual que followup-attribution.js.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const { normalizeSchedule, DEFAULT_SCHEDULE } = require('../scheduling/org-config');
const log = new Logger('CALL-RECOVERY');

const MADRID_TZ = 'Europe/Madrid';
const NOMINAL_CALL_MS = 180000; // 3 min: duración supuesta si falta ended_at y duration_ms

const _DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const _MADRID_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: MADRID_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** ISO → { dow:0-6 (0=domingo), minutes:HH*60+MM } en hora de Madrid. null si inválida. PURA. */
function madridParts(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  let dow, hh, mm;
  for (const p of _MADRID_FMT.formatToParts(d)) {
    if (p.type === 'weekday') dow = _DOW[p.value];
    else if (p.type === 'hour') hh = parseInt(p.value, 10);
    else if (p.type === 'minute') mm = parseInt(p.value, 10);
  }
  if (dow == null || !isFinite(hh) || !isFinite(mm)) return null;
  if (hh === 24) hh = 0; // algunos entornos rinden medianoche como "24"
  return { dow, minutes: hh * 60 + mm };
}

/** "HH:MM" → minutos; "24:00" → 1440. */
function hhmmToMin(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * ¿La llamada entró FUERA del horario declarado? PURA.
 * @param {string} iso  started_at de la llamada
 * @param {object} schedule  horario normalizado {1:{open,close,afternoon_open,afternoon_close}}
 * @returns {boolean|null} true=fuera, false=dentro, null=no se puede saber
 */
function isAfterHours(iso, schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const p = madridParts(iso);
  if (!p) return null;
  const day = schedule[p.dow];
  if (!day) return true; // día cerrado → fuera de horario
  const inRange = (o, c) => {
    const om = hhmmToMin(o), cm = hhmmToMin(c);
    return om != null && cm != null && p.minutes >= om && p.minutes < cm;
  };
  if (inRange(day.open, day.close)) return false;
  if (inRange(day.afternoon_open, day.afternoon_close)) return false;
  return true;
}

/** [inicio,fin) en ms de una llamada; end estimado si falta. null si started_at inválido. PURA. */
function callInterval(call, nominalMs = NOMINAL_CALL_MS) {
  const s = new Date(call.started_at).getTime();
  if (!isFinite(s)) return null;
  let e = call.ended_at ? new Date(call.ended_at).getTime() : NaN;
  if (!isFinite(e)) e = s + (Number(call.duration_ms) || nominalMs);
  if (e <= s) e = s + nominalMs;
  return [s, e];
}

/**
 * IDs de llamadas que solaparon en el tiempo con AL MENOS otra del mismo
 * lote (mismo negocio, lo garantiza el llamante). PURA.
 * O(n²): el volumen mensual por negocio lo hace irrelevante.
 */
function detectConcurrent(calls, opts = {}) {
  const nominalMs = opts.nominalMs || NOMINAL_CALL_MS;
  const iv = [];
  for (const c of calls || []) {
    const box = callInterval(c, nominalMs);
    if (box && c.id != null) iv.push({ id: c.id, box });
  }
  const set = new Set();
  for (let i = 0; i < iv.length; i++) {
    for (let j = i + 1; j < iv.length; j++) {
      const [as, ae] = iv[i].box, [bs, be] = iv[j].box;
      if (as < be && bs < ae) { set.add(iv[i].id); set.add(iv[j].id); }
    }
  }
  return set;
}

/** Valor € de la reserva de una llamada (objeto o array). Precio real, o ticket medio si falta. PURA. */
function appointmentValue(booked, avgTicket = 0) {
  const list = Array.isArray(booked) ? booked : (booked ? [booked] : []);
  let v = 0;
  for (const a of list) {
    const p = Number(a && a.price);
    v += (isFinite(p) && p > 0) ? p : (Number(avgTicket) || 0);
  }
  return Math.round(v);
}

/**
 * Clasifica una llamada. null si no acabó en reserva. PURA.
 * @returns {{id, type, confidence, value, at}|null}
 *   type: 'after_hours' | 'concurrent' | 'in_hours_single'
 *   confidence: 'strong' (after_hours/concurrent) | 'weak' (in_hours_single)
 */
function classifyCall(call, ctx = {}) {
  const booked = call.booked_appointment || call.outcome === 'booked';
  if (!booked) return null;
  // Reserva confirmada por outcome pero sin objeto de cita: es una reserva
  // real de valor desconocido → una cita = un ticket medio (nunca 0 si lo hay).
  let value = appointmentValue(call.booked_appointment, ctx.avgTicket);
  if (!value && ctx.avgTicket) value = Math.round(Number(ctx.avgTicket) || 0);
  const after = isAfterHours(call.started_at, ctx.schedule);
  const concurrent = !!(ctx.concurrentIds && ctx.concurrentIds.has(call.id));
  let type, confidence;
  if (after === true) { type = 'after_hours'; confidence = 'strong'; }
  else if (concurrent) { type = 'concurrent'; confidence = 'strong'; }
  else { type = 'in_hours_single'; confidence = 'weak'; }
  return { id: call.id, type, confidence, value, at: call.started_at };
}

/** Totales para pintar el extracto. La cabecera usa SOLO strong*. PURA. */
function summarizeRecovery(items) {
  const t = {
    strongCount: 0, strongValue: 0,
    afterHours: 0, afterHoursValue: 0,
    concurrent: 0, concurrentValue: 0,
    weakCount: 0, weakValue: 0,
  };
  for (const it of items || []) {
    if (!it) continue;
    if (it.confidence === 'strong') {
      t.strongCount++; t.strongValue += it.value;
      if (it.type === 'after_hours') { t.afterHours++; t.afterHoursValue += it.value; }
      else if (it.type === 'concurrent') { t.concurrent++; t.concurrentValue += it.value; }
    } else {
      t.weakCount++; t.weakValue += it.value;
    }
  }
  t.strongValue = Math.round(t.strongValue);
  t.afterHoursValue = Math.round(t.afterHoursValue);
  t.concurrentValue = Math.round(t.concurrentValue);
  t.weakValue = Math.round(t.weakValue);
  return t;
}

/**
 * Orquesta el cálculo puro sobre un lote de llamadas de UN negocio. PURA.
 * @param {Array} calls  filas nf_calls (id, started_at, ended_at, duration_ms, outcome, booked_appointment)
 * @param {{schedule?, avgTicket?, nominalMs?}} opts
 * @returns {{ totals, recoveries }}
 */
function computeRecovery(calls, opts = {}) {
  const concurrentIds = detectConcurrent(calls, opts);
  const ctx = { schedule: opts.schedule, concurrentIds, avgTicket: opts.avgTicket };
  const recoveries = [];
  for (const c of calls || []) {
    const r = classifyCall(c, ctx);
    if (r) recoveries.push(r);
  }
  return { totals: summarizeRecovery(recoveries), recoveries };
}

/**
 * Carga las llamadas del negocio y su horario, y calcula la recuperación.
 * NO escribe nada. Fail-soft: ante cualquier error devuelve totales a cero.
 * @param {string} orgId
 * @param {{ sinceDays?, db?, avgTicket? }} opts
 * @returns {Promise<{ totals, recoveries }>}
 */
async function getCallRecovery(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const empty = { totals: summarizeRecovery([]), recoveries: [] };
  if (!db.enabled || !orgId) return empty;

  const sinceDays = opts.sinceDays || 30;
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();

  try {
    const [orgRes, callsRes] = await Promise.all([
      db.client.from('organizations')
        .select('assistant_config').eq('id', orgId).single(),
      db.client.from('nf_calls')
        .select('id, started_at, ended_at, duration_ms, outcome, booked_appointment')
        .eq('org_id', orgId).eq('direction', 'inbound')
        .gte('started_at', since).limit(5000),
    ]);

    const schedule = normalizeSchedule(orgRes.data?.assistant_config?.schedule) || DEFAULT_SCHEDULE;
    const { totals, recoveries } = computeRecovery(callsRes.data || [], {
      schedule, avgTicket: opts.avgTicket,
    });
    return { totals, recoveries: recoveries.slice(0, 50) };
  } catch (e) {
    log.warn(`getCallRecovery(${orgId}): ${e.message}`);
    return empty;
  }
}

module.exports = {
  // núcleo puro (testeable sin BD)
  madridParts, hhmmToMin, isAfterHours, callInterval, detectConcurrent,
  appointmentValue, classifyCall, summarizeRecovery, computeRecovery,
  // cargador
  getCallRecovery,
  NOMINAL_CALL_MS,
};
