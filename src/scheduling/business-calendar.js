'use strict';
// ============================================================
// NodeFlow — Días cerrados, excepciones de horario y tiempo entre citas.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo A6):
// El horario era un patrón semanal fijo (días 0-6) SIN NINGUNA capa de
// excepciones por fecha. Un grep de festivo|holiday|vacacion|buffer|exception en
// todo src/scheduling devolvía UNA coincidencia, y era un comentario.
//
// Consecuencia real: el 15 de agosto es viernes, el horario semanal dice
// abierto, y el bot reserva ocho citas en una clínica cerrada. La única
// mitigación posible era que el dueño bloqueara el día entero en su Google
// Calendar — y eso solo funciona si tiene Google conectado y NO es multi-sede
// (con centros configurados, executor.js ni siquiera consulta el calendario).
//
// Tampoco había tiempo entre citas: ni limpieza de box, ni desinfección, ni el
// minuto de respirar entre pacientes. Una cita de 30 min terminaba a y media y
// la siguiente empezaba a y media.
//
// TODO ESTE MÓDULO ES PURO: sin BD, sin red, sin reloj salvo el que se le pase.
// Se puede probar entero, que es lo que hace que esto sea fiable y no otra capa
// de reglas escondidas.
//
// Configuración (en la config del negocio, todo OPCIONAL — sin nada, el
// comportamiento es exactamente el de antes):
//   nationalHolidays: true            → cierra los festivos nacionales de España
//   closedDates: ['2026-08-15',
//                 { from:'2026-08-01', to:'2026-08-15', reason:'Vacaciones' }]
//   scheduleExceptions: {
//     '2026-12-24': { open:'09:00', close:'14:00' },   // jornada especial
//     '2026-12-25': null                               // cerrado
//   }
//   bufferMin: 10                     → minutos de margen DESPUÉS de cada cita
// ============================================================

// ── Festivos nacionales de España ────────────────────────────────────────────
// Solo los NACIONALES: los autonómicos y locales varían tanto que inventarlos
// sería peor que no ponerlos. Para esos está closedDates.
const FIJOS = [
  ['01-01', 'Año Nuevo'],
  ['01-06', 'Reyes'],
  ['05-01', 'Día del Trabajo'],
  ['08-15', 'Asunción'],
  ['10-12', 'Fiesta Nacional'],
  ['11-01', 'Todos los Santos'],
  ['12-06', 'Constitución'],
  ['12-08', 'Inmaculada'],
  ['12-25', 'Navidad'],
];

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). Puro. */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const _iso = (d) => d.toISOString().slice(0, 10);

/** Festivos nacionales de un año: { 'YYYY-MM-DD': 'nombre' }. Puro. */
function nationalHolidays(year) {
  const out = {};
  for (const [md, nombre] of FIJOS) out[`${year}-${md}`] = nombre;
  // Viernes Santo es festivo nacional y se mueve cada año.
  const pascua = easterSunday(year);
  const viernesSanto = new Date(pascua.getTime() - 2 * 86400000);
  out[_iso(viernesSanto)] = 'Viernes Santo';
  // Jueves Santo lo es en casi toda España menos Cataluña y Valencia; se deja
  // fuera a propósito: cerrar de más es tan malo como cerrar de menos.
  return out;
}

/** Normaliza closedDates a una lista de rangos {from,to,reason}. Puro. */
function _rangos(closedDates) {
  const out = [];
  for (const c of (Array.isArray(closedDates) ? closedDates : [])) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) { out.push({ from: c, to: c, reason: 'Cerrado' }); continue; }
    if (c && typeof c === 'object' && c.from) {
      out.push({ from: c.from, to: c.to || c.from, reason: c.reason || 'Cerrado' });
    }
  }
  return out;
}

/**
 * ¿El negocio está cerrado ese día, y por qué?
 * Orden de precedencia, de más específico a más general:
 *   1. scheduleExceptions[fecha] === null  → cerrado ese día concreto
 *   2. scheduleExceptions[fecha] = {...}   → ABIERTO con horario especial
 *      (una excepción explícita gana a un festivo: si el dueño dice que el 6 de
 *       enero abre de 10 a 14, abre)
 *   3. closedDates                          → vacaciones/cierres del negocio
 *   4. festivos nacionales (si nationalHolidays)
 * @returns {{closed: boolean, reason: string|null}}
 */
function closedOn(dateStr, config = {}) {
  const exc = config.scheduleExceptions || {};
  if (Object.prototype.hasOwnProperty.call(exc, dateStr)) {
    return exc[dateStr] === null || exc[dateStr] === false
      ? { closed: true, reason: 'Cerrado (excepción)' }
      : { closed: false, reason: null };
  }
  for (const r of _rangos(config.closedDates)) {
    if (dateStr >= r.from && dateStr <= r.to) return { closed: true, reason: r.reason };
  }
  if (config.nationalHolidays) {
    const year = Number(String(dateStr).slice(0, 4));
    const nombre = nationalHolidays(year)[dateStr];
    if (nombre) return { closed: true, reason: nombre };
  }
  return { closed: false, reason: null };
}

/**
 * Horario efectivo de un día concreto: el semanal, con la excepción de esa
 * fecha si la hay, o null si está cerrado.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} dayOfWeek 0-6
 * @param {object} config config del negocio (schedule, closedDates, …)
 * @returns {{open?:string, close?:string, afternoon_open?:string, afternoon_close?:string}|null}
 */
function scheduleForDate(dateStr, dayOfWeek, config = {}) {
  const cerrado = closedOn(dateStr, config);
  if (cerrado.closed) return null;
  const exc = (config.scheduleExceptions || {})[dateStr];
  if (exc && typeof exc === 'object') return exc;      // jornada especial
  return (config.schedule || {})[dayOfWeek] || null;
}

/**
 * Minutos de margen DESPUÉS de cada cita (limpieza, desinfección, respirar).
 * 0 = comportamiento de antes. Se acota a 120 para que un dedazo no deje la
 * agenda sin huecos.
 */
function bufferMin(config = {}) {
  const v = Number(config.bufferMin);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(120, Math.round(v));
}

module.exports = { nationalHolidays, easterSunday, closedOn, scheduleForDate, bufferMin };
