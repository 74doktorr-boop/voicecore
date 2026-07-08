// ============================================================
// NodeFlow — Briefing matinal accionable (2026-07-08)
// ------------------------------------------------------------
// v0 de "el dashboard es el cerebro del negocio": la primera
// tarjeta del portal saluda al dueño, resume AYER y propone lo
// accionable de HOY, cada línea con enlace a la sección que lo
// resuelve. Reglas: máx. 4 líneas, se saltan los ceros, y si no
// hay nada accionable una sola línea serena — nunca caja vacía.
//
// buildBriefing() es PURA (testeable sin BD ni reloj): recibe los
// contadores ya agregados y la hora civil de Madrid. La agregación
// vive en GET /api/portal/briefing (routes-portal.js), que reusa
// la lógica existente de oportunidades / riesgo / reactivación.
// ============================================================
'use strict';

// Copy única para el estado "sin nada accionable" — el frontend la pinta tal cual.
const ALL_CLEAR_TEXT = 'Todo al día. Tu asistente sigue de guardia 24/7.';

// Mismo criterio que dashHero (portal.js): <14 días, <20 tardes, resto noches.
function greetingByHour(hour) {
  const h = Number.isFinite(hour) ? hour : 9;
  return h < 14 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
}

// Hora civil en Madrid (0-23) — para no saludar "buenos días" a las 22h UTC+2.
function hourInMadrid(date) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23',
  }).format(date || new Date()));
}

// Instante UTC de las 00:00 en MADRID de una fecha civil (offset por fecha →
// DST-safe). Mismo idiom que daily-briefing.js: filtra timestamptz por el día
// del NEGOCIO, no el UTC.
function madridMidnightUtc(dateStr) {
  const asUtc = new Date(`${dateStr}T00:00:00Z`);
  const offH  = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(asUtc));
  return new Date(asUtc.getTime() - offH * 3600000);
}

// Umbral de reactivación por sector — la MISMA señal "⚠ Reactivar" de la
// sección Clientes (nfReactivationDays en portal.js): REBOOKING_DEFAULTS del
// backend, 60 días por defecto (WINBACK_DAYS de daily-briefing), null = sector
// con reactivación desactivada. require perezoso: mantiene este módulo puro
// para los tests y evita cargar el cron al importar.
function reactivationThresholdDays(sector) {
  try {
    const { REBOOKING_DEFAULTS } = require('../scheduling/rebooking-cron');
    const d = REBOOKING_DEFAULTS[sector];
    return d === undefined ? 60 : d;
  } catch (_) { return 60; }
}

// 1250 → "1250", 12500 → "12.500" — formato es-ES, siempre redondeado.
function fmtEuros(n) {
  return Math.round(n).toLocaleString('es-ES');
}

/**
 * Construye el briefing. PURA: mismos datos + misma hora = mismo resultado.
 * @param {{ greetingName?, yesterdayCalls?, yesterdayBooked?, missedCount?,
 *           atRiskCount?, inactiveCount?, recoverableEuros?, followupsPending? }} data
 * @param {number} hourMadrid hora civil de Madrid (0-23)
 * @returns {{ greeting, greetingName, summary, lines, allClear, allClearText }}
 */
function buildBriefing(data, hourMadrid) {
  const d = data || {};
  const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : 0; };

  const yesterdayCalls  = n(d.yesterdayCalls);
  const yesterdayBooked = n(d.yesterdayBooked);
  const missed    = n(d.missedCount);
  const atRisk    = n(d.atRiskCount);
  const inactive  = n(d.inactiveCount);
  const followups = n(d.followupsPending);
  const euros     = Math.max(0, Number(d.recoverableEuros) || 0);

  // "Ayer: N llamadas atendidas (X citas)." — solo si hubo actividad (regla: sin ceros).
  let summary = null;
  if (yesterdayCalls > 0) {
    summary = 'Ayer: ' + yesterdayCalls + (yesterdayCalls === 1 ? ' llamada atendida' : ' llamadas atendidas') +
      (yesterdayBooked > 0 ? ' (' + yesterdayBooked + (yesterdayBooked === 1 ? ' cita' : ' citas') + ')' : '') + '.';
  }

  // Cada línea = algo accionable HOY + la sección del portal que lo resuelve.
  const lines = [];
  if (missed > 0) {
    lines.push({ icon: '📞', count: missed, section: 'oportunidades',
      text: missed === 1
        ? '1 oportunidad sin responder — llamó y se quedó sin cita'
        : missed + ' oportunidades sin responder — llamaron y se quedaron sin cita' });
  }
  if (atRisk > 0) {
    lines.push({ icon: '⚠️', count: atRisk, section: 'citas',
      text: atRisk === 1
        ? '1 cita de mañana con riesgo de plantón — confírmala hoy'
        : atRisk + ' citas de mañana con riesgo de plantón — confírmalas hoy' });
  }
  if (inactive > 0) {
    // € honesto: solo si hay ticket medio con el que estimar, y siempre con "~".
    lines.push({ icon: '💶', count: inactive, section: 'clientes',
      text: euros > 0
        ? 'Puedes recuperar ~' + fmtEuros(euros) + '€ escribiendo a ' + inactive +
          (inactive === 1 ? ' cliente inactivo' : ' clientes inactivos')
        : (inactive === 1
          ? '1 cliente inactivo que un mensaje puede traer de vuelta'
          : inactive + ' clientes inactivos que un mensaje puede traer de vuelta') });
  }
  if (followups > 0) {
    lines.push({ icon: '✉️', count: followups, section: 'seguimientos',
      text: followups === 1
        ? 'He preparado 1 mensaje de seguimiento — revisa y envía'
        : 'He preparado ' + followups + ' mensajes de seguimiento — revisa y envía' });
  }

  const top = lines.slice(0, 4); // regla de producto: máx. 4 líneas
  const allClear = top.length === 0;

  return {
    greeting: greetingByHour(hourMadrid),
    greetingName: d.greetingName || '',
    summary,
    lines: top,
    allClear,
    allClearText: allClear ? ALL_CLEAR_TEXT : null,
  };
}

module.exports = { buildBriefing, greetingByHour, hourInMadrid, madridMidnightUtc, reactivationThresholdDays, fmtEuros, ALL_CLEAR_TEXT };
