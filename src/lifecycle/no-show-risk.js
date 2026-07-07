// ============================================================
// NodeFlow — Riesgo de plantón (no-show) por cliente
// (2026-07-07, oportunidad 5). Regla DETERMINISTA (fuera del LLM,
// charter): el riesgo sale del historial real de faltas del cliente,
// no de una corazonada. El plantón es el problema nº1 declarado de
// clínicas y peluquerías; con esto el dueño ve a quién reforzar.
//
// Señal: nº de faltas (status 'no_show') sobre citas pasadas con
// desenlace conocido (completadas + faltas). Se pondera la RECENCIA:
// una falta reciente pesa más que una de hace un año.
// ============================================================
'use strict';

const RISK = { NONE: 'none', LOW: 'low', HIGH: 'high' };

/**
 * Calcula el riesgo de plantón de un cliente a partir de su historial.
 * PURA — recibe la lista de citas (cualquier orden) y la fecha de hoy.
 * @param {Array<{status:string, date:string}>} appointments
 * @param {Date} [now]
 * @returns {{ level:string, noShows:number, decided:number, rate:number, recentNoShow:boolean, note:string }}
 */
function computeNoShowRisk(appointments = [], now = new Date()) {
  const list = Array.isArray(appointments) ? appointments : [];
  // Solo citas con desenlace CONOCIDO (una cita futura o pendiente no informa).
  const decidedList = list.filter(a => a && (a.status === 'no_show' || a.status === 'completed'));
  const decided = decidedList.length;
  const noShows = decidedList.filter(a => a.status === 'no_show').length;

  const out = { level: RISK.NONE, noShows, decided, rate: 0, recentNoShow: false, note: '' };
  if (!noShows) {
    out.note = decided ? 'Sin faltas registradas.' : 'Aún no hay historial de asistencia.';
    return out;
  }

  out.rate = decided ? Math.round((noShows / decided) * 100) : 0;

  // ¿Falta en los últimos 90 días? (recencia). Fechas AAAA-MM-DD.
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  out.recentNoShow = decidedList.some(a => {
    if (a.status !== 'no_show' || !a.date) return false;
    const d = new Date(String(a.date).slice(0, 10) + 'T12:00:00');
    return !isNaN(d.getTime()) && d >= cutoff;
  });

  // Umbral de ALTO riesgo: ≥2 faltas, o 1 falta reciente con tasa alta.
  // Es deliberadamente conservador — marcar de más quema la confianza.
  if (noShows >= 2 || (out.recentNoShow && out.rate >= 34)) {
    out.level = RISK.HIGH;
  } else {
    out.level = RISK.LOW;
  }

  const veces = noShows === 1 ? 'una vez' : `${noShows} veces`;
  out.note = out.level === RISK.HIGH
    ? `Ha faltado ${veces}${out.recentNoShow ? ' (reciente)' : ''} — conviene confirmar antes.`
    : `Ha faltado ${veces}, pero suele venir.`;
  return out;
}

module.exports = { computeNoShowRisk, RISK };
