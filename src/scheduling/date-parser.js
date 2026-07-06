// ============================================================
// NodeFlow — Parser determinista de FECHAS en español hablado
// ------------------------------------------------------------
// Compañero de time-parser.js. La hora ya se normalizaba de forma
// determinista, pero la FECHA se pasaba tal cual la calculaba el LLM
// (`args.date`) — y los modelos fallan en aritmética de calendario
// ("el martes" → fecha equivocada = cita el DÍA equivocado, peor que
// una hora mal). Además aceptaba fechas imposibles (2026-02-30).
//
// Reglas (charter: negocio determinista, fuera del LLM):
//  - ISO YYYY-MM-DD válido → passthrough (rechaza fechas imposibles).
//  - "hoy" / "mañana" / "pasado mañana" → relativo a la referencia.
//  - Día de la semana → próxima ocurrencia; si coincide con HOY, la de
//    la semana que viene (para "hoy" ya se dice "hoy"). "próximo/que
//    viene" no cambia el resultado (ya es la próxima).
//  - "el 15" / "el día 15" / "15 de agosto" → día del mes (este mes si
//    aún no pasó, si no el siguiente; con mes explícito, ese mes/año).
//  - Cualquier otra cosa → null (el tool pedirá aclarar, no reserva a
//    ciegas). La referencia `todayISO` la calcula el caller en Madrid.
// ============================================================
'use strict';

// Días/meses en español Y gallego (claves sin acentos — el input se normaliza).
// Sin colisiones: el gallego solo AÑADE formas nuevas (luns, mercores, xoves…).
const WEEKDAYS = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  // galego
  luns: 1, mercores: 3, xoves: 4, venres: 5,
};
const MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  // galego
  xaneiro: 0, febreiro: 1, maio: 4, xuno: 5, xullo: 6, setembro: 8, outubro: 9, novembro: 10, decembro: 11,
};

function _iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function _isRealISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d;
}

function parseSpanishDate(input, todayISO) {
  if (input == null) return null;
  const s = String(input).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // fuera acentos
  if (!s) return null;

  // ── Ya es ISO YYYY-MM-DD → validar que es una fecha real y pasar ──
  const isoM = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) {
    const y = +isoM[1], mo = +isoM[2] - 1, d = +isoM[3];
    return _isRealISO(y, mo, d) ? _iso(y, mo, d) : null;
  }

  // Relativos y días de la semana necesitan la referencia de HOY (Madrid).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO || ''))) return null;
  const [by, bmo, bd] = todayISO.split('-').map(Number);
  const today = new Date(Date.UTC(by, bmo - 1, bd));
  const addDays = (n) => {
    const t = new Date(today);
    t.setUTCDate(t.getUTCDate() + n);
    return _iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  };

  // ── Relativos (pasado mañana ANTES que mañana). es "mañana"→"manana",
  //    gl "mañá"→"mana"; gl hoxe = hoy ──
  if (/\bpasado\s+man(ana|a)\b/.test(s)) return addDays(2);
  if (/\bman(ana|a)\b/.test(s))          return addDays(1);
  if (/\b(hoy|hoxe)\b/.test(s))          return addDays(0);

  // ── Día de la semana ──
  for (const [w, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${w}\\b`).test(s)) {
      let delta = (dow - today.getUTCDay() + 7) % 7;
      if (delta === 0) delta = 7; // "el domingo" en domingo = el que viene (si es hoy, se dice "hoy")
      return addDays(delta);
    }
  }

  // Fecha numérica con separadores (08/07, 8.7.2026): DD/MM vs MM/DD es
  // ambiguo y peligroso adivinar → que el tool pida aclarar (null), no reservar
  // a ciegas. El LLM ya recibe la orden de pasar ISO; esto es red de seguridad.
  if (/\d{1,2}[/.]\d{1,2}/.test(s)) return null;

  // ── Día del mes: "el 15", "el día 15", "15 de agosto" ──
  const domM = s.match(/\b(?:el\s+(?:dia\s+)?)?(\d{1,2})(?:\s+de\s+([a-z]+))?\b/);
  if (domM) {
    const dom = +domM[1];
    if (dom >= 1 && dom <= 31) {
      let month = today.getUTCMonth(), year = today.getUTCFullYear();
      const monName = domM[2];
      if (monName && MONTHS[monName] != null) {
        month = MONTHS[monName];
        if (month < today.getUTCMonth() || (month === today.getUTCMonth() && dom < today.getUTCDate())) year++;
      } else if (dom < today.getUTCDate()) {
        month++;
        if (month > 11) { month = 0; year++; }
      }
      return _isRealISO(year, month, dom) ? _iso(year, month, dom) : null;
    }
  }

  return null;
}

module.exports = { parseSpanishDate };
