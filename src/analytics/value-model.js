'use strict';
// ============================================================
// NodeFlow — De dónde sale cada número de valor que se le enseña al cliente.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo F9):
// La primera pantalla del portal mostraba dos cifras inventadas:
//
//   · Ticket medio: `avgTicket || 35` en CINCO sitios. Un taller cuyo ticket
//     real son 300€ veía su valor dividido por 9; una peluquería de 15€ lo veía
//     multiplicado por 2,3. Y ese es el caso que quema: el dueño hace la cuenta,
//     no le cuadra, y deja de creerse TODAS las demás cifras — incluidas las
//     honestas (el ROI con atribución fuerte, el informe cita a cita).
//
//   · "Horas ahorradas": `llamadas × 4 min`, un número escrito a mano en un
//     comentario en inglés, sin ninguna medición detrás. Absurdo comprobable:
//     una llamada de 20 segundos que acaba en cuelgue contaba 4 minutos
//     ahorrados — teniendo la duración real en la misma consulta.
//
// La regla de este módulo: **preferir el dato medido; si no lo hay, decir que
// no lo hay.** Nunca devolver un número inventado con pinta de medición. Cada
// resultado viaja con su `source` para que la UI pueda ser explícita.
// ============================================================

/**
 * Ticket medio del negocio, por orden de fiabilidad.
 *   1. `configured`  — lo que el dueño declaró. Manda siempre.
 *   2. `observed`    — MEDIANA de los precios reales de sus citas
 *                      (nf_appointments.price). Mediana y no media: cuatro
 *                      limpiezas de 40€ y un implante de 1.200€ no pueden
 *                      inflar el "ticket típico".
 *   3. null          — no se sabe. La UI debe pedir el dato, no inventarlo.
 *
 * @param {{configured?: number, prices?: number[]}} input
 * @returns {{value: number|null, source: 'configured'|'observed'|null, n: number}}
 */
function resolveAvgTicket({ configured, prices } = {}) {
  const cfg = Number(configured);
  if (Number.isFinite(cfg) && cfg > 0) return { value: cfg, source: 'configured', n: 0 };

  const xs = (Array.isArray(prices) ? prices : [])
    .map(Number).filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (xs.length === 0) return { value: null, source: null, n: 0 };

  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { value: Math.round(median), source: 'observed', n: xs.length };
}

/**
 * Valor estimado de N reservas. Devuelve null —no 0— cuando no hay ticket:
 * un 0 se lee como "no has ganado nada", que es una afirmación distinta de
 * "no sé cuánto vale una cita tuya".
 */
function estimateBookingValue(bookings, ticket) {
  const n = Number(bookings) || 0;
  if (!ticket || !ticket.value) return { value: null, source: null, bookings: n };
  return { value: Math.round(n * ticket.value), source: ticket.source, bookings: n };
}

/**
 * Tiempo que el negocio NO ha pasado al teléfono, medido de verdad.
 * Suma la duración real de cada llamada atendida por la IA en vez de asumir
 * 4 minutos por llamada.
 *
 * @param {Array<{startTime?:any, endTime?:any, duration_ms?:number, durationMs?:number}>} calls
 * @returns {{hours: number, minutes: number, source: 'measured'|null, n: number, unmeasured: number}}
 */
function timeSavedFromCalls(calls) {
  const list = Array.isArray(calls) ? calls : [];
  let ms = 0, n = 0, unmeasured = 0;
  for (const c of list) {
    const direct = Number(c?.duration_ms ?? c?.durationMs);
    let d = Number.isFinite(direct) && direct > 0 ? direct : NaN;
    if (!Number.isFinite(d)) {
      const s = c?.startTime ? new Date(c.startTime).getTime() : NaN;
      const e = c?.endTime   ? new Date(c.endTime).getTime()   : NaN;
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) d = e - s;
    }
    if (Number.isFinite(d) && d > 0) { ms += d; n++; } else { unmeasured++; }
  }
  if (n === 0) return { hours: 0, minutes: 0, source: null, n: 0, unmeasured };
  const minutes = ms / 60000;
  return {
    hours: Math.round((minutes / 60) * 10) / 10,
    minutes: Math.round(minutes),
    source: 'measured',
    n,
    unmeasured,   // llamadas sin duración utilizable: se excluyen, no se rellenan
  };
}

module.exports = { resolveAvgTicket, estimateBookingValue, timeSavedFromCalls };
