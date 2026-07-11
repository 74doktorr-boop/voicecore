'use strict';
// ============================================================
// NodeFlow — Motor del "plan por sesiones" (bono / tratamiento)
// ------------------------------------------------------------
// Fase 1 del rediseño de fichas (petición Unai): en vez de que el dueño
// teclee a mano "próxima revisión" y "caducidad", captura el RITMO —
// cada cuántos días hay sesión (30, 40, 65… lo que el cliente decida)—
// y el sistema calcula solo:
//   · la PRÓXIMA sesión   (inicio + sesiones_hechas × cadencia)
//   · las sesiones RESTANTES
//   · la CADUCIDAD del bono (ventana de validez fija, ej. "3 meses", o,
//     si no se da, tras la última sesión + margen de gracia)
// Todo PURO y determinista → 100% testeable. La fecha de "hoy" se toma en
// hora de Madrid (o se inyecta para tests).
// ============================================================

const MS_DAY = 86400000;

function _parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d.getTime())) return null;
  // Rechaza fechas imposibles (2026-02-30 → rueda a marzo)
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}
function _fmt(d) { return d.toISOString().slice(0, 10); }
function _addDays(d, n) { return new Date(d.getTime() + n * MS_DAY); }
function _today(today) {
  const inj = _parseDate(today);
  if (inj) return inj;
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  return _parseDate(s) || new Date(Date.UTC(1970, 0, 1));
}
function _int(v, def = 0) { const n = parseInt(v, 10); return isFinite(n) ? n : def; }

/**
 * Calcula el estado de un plan por sesiones. PURO.
 * @param {object} input
 *   totalSessions {number}  sesiones del bono (ej. 10)
 *   cadenceDays   {number}  días entre sesión y sesión (ej. 30)
 *   startDate     {string}  "YYYY-MM-DD" — primera sesión / compra del bono
 *   sessionsUsed  {number}  sesiones ya hechas (def 0)
 *   validityDays  {number?} días de validez del bono (ej. 90 = 3 meses). Si se
 *                            da, la caducidad = inicio + validityDays. Si no, se
 *                            calcula tras la última sesión + graceDays.
 *   graceDays     {number}  margen tras la última sesión (def 0)
 *   today         {string?} "YYYY-MM-DD" para calcular caducado (def hoy Madrid)
 * @returns {{ totalSessions, cadenceDays, sessionsUsed, sessionsRemaining,
 *             done, nextSessionDate, expiryDate, expired }}
 */
function computePlan(input = {}) {
  const total   = Math.max(0, _int(input.totalSessions));
  const cadence = Math.max(0, _int(input.cadenceDays));
  const used    = Math.min(total, Math.max(0, _int(input.sessionsUsed)));
  const start   = _parseDate(input.startDate);
  const validity = input.validityDays != null && input.validityDays !== ''
    ? Math.max(0, _int(input.validityDays)) : null;
  const grace   = Math.max(0, _int(input.graceDays));

  const sessionsRemaining = Math.max(0, total - used);
  const done = total > 0 && sessionsRemaining === 0;

  // Próxima sesión = inicio + (sesiones hechas) × cadencia. La sesión 1 cae el
  // día de inicio, la 2 a +cadencia, etc. Si el bono está agotado o falta el
  // inicio, no hay próxima.
  let nextSessionDate = null;
  if (start && !done && total > 0) {
    nextSessionDate = _fmt(_addDays(start, used * cadence));
  }

  // Caducidad: ventana de validez fija si se da; si no, tras la última sesión.
  let expiryDate = null;
  if (start) {
    if (validity != null) {
      expiryDate = _fmt(_addDays(start, validity));
    } else if (total > 0 && cadence > 0) {
      expiryDate = _fmt(_addDays(start, (total - 1) * cadence + grace));
    }
  }

  const expired = expiryDate ? _today(input.today) > _parseDate(expiryDate) : false;

  return { totalSessions: total, cadenceDays: cadence, sessionsUsed: used, sessionsRemaining, done, nextSessionDate, expiryDate, expired };
}

/** Estado del plan tras marcar UNA sesión como hecha. PURO. */
function markSessionDone(input = {}) {
  const before = computePlan(input);
  return computePlan({ ...input, sessionsUsed: before.sessionsUsed + 1 });
}

/**
 * Traduce el plan a los "campos-fecha con aviso" que ya entiende el motor de
 * avisos (materializador → scheduled_reminders). Devuelve los valores derivados
 * listos para guardar como attrs de la entidad, sin que el dueño los teclee.
 */
function derivedAttrs(input = {}) {
  const p = computePlan(input);
  return {
    sessions_remaining: p.sessionsRemaining,
    next_session:       p.nextSessionDate,   // "YYYY-MM-DD" o null
    expiry:             p.expiryDate,        // "YYYY-MM-DD" o null
    plan_done:          p.done,
    plan_expired:       p.expired,
  };
}

// ── Puente con la ficha de entidad (plan_tratamiento / programa) ────────────
// Claves de attrs del plan por sesiones. Si el dueño rellena la CADENCIA + la
// primera sesión + el total, se CALCULAN solos próxima sesión, restantes y
// caducidad (ritmo). Si NO usa la cadencia, no tocamos sus fechas manuales
// (retrocompatible con las fichas que ya rellenan a mano). PURO/determinista.
const PLAN_KEYS = {
  total: 'sesiones_totales',
  cadence: 'cadencia_dias',
  start: 'primera_sesion',
  used: 'sesiones_hechas',
  remaining: 'sesiones_restantes',
  next: 'proxima_sesion',
  expiry: 'caducidad_bono',
};

function reconcilePlanAttrs(attrs = {}, opts = {}) {
  const k = { ...PLAN_KEYS, ...(opts.keys || {}) };
  const usesCadence = attrs[k.cadence] && attrs[k.start] && attrs[k.total];
  const out = { ...attrs };
  if (!usesCadence) return out;   // ritmo no configurado → respetar lo manual

  const plan = computePlan({
    totalSessions: attrs[k.total],
    cadenceDays:   attrs[k.cadence],
    startDate:     attrs[k.start],
    sessionsUsed:  attrs[k.used],
    graceDays:     opts.graceDays != null ? opts.graceDays : 15, // margen tras la última sesión
    today:         opts.today,
  });
  out[k.remaining] = plan.sessionsRemaining;
  if (plan.nextSessionDate) out[k.next] = plan.nextSessionDate; else delete out[k.next];
  if (plan.expiryDate) out[k.expiry] = plan.expiryDate;
  return out;
}

module.exports = { computePlan, markSessionDone, derivedAttrs, reconcilePlanAttrs, PLAN_KEYS };
