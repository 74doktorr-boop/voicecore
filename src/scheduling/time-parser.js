// ============================================================
// NodeFlow — Parser determinista de horas en español hablado
// ------------------------------------------------------------
// La LLM pasa la hora tal y como la dice el cliente ("a la una",
// "una y media", "13h", "1 pm"). El scheduler exige HH:MM estricto
// → "a la una" se rechazaba y el negocio perdía la reserva.
// Este módulo traduce CUALQUIER expresión razonable a HH:MM.
//
// Regla de contexto laboral: 1-7 sin indicación de mañana/tarde
// se interpretan como TARDE (13:00-19:00) — nadie pide cita a las
// 3 de la madrugada en una peluquería. 8-12 se quedan en mañana.
// Devuelve null si no se puede interpretar (el tool pedirá aclarar).
// ============================================================
'use strict';

const WORD_NUM = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

function parseSpanishTime(input) {
  if (input == null) return null;
  let s = String(input).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // fuera acentos
  if (!s) return null;

  // ── Expresiones especiales ──
  if (/\bmediodia\b/.test(s))          return '12:00';
  if (/\bmedianoche\b/.test(s))        return '00:00';
  if (/despues de comer/.test(s))      return '15:00';
  // Rangos vagos ("por la mañana", "a primera hora") → que la IA concrete
  if (/^(por|a) (la manana|la tarde|primera hora|ultima hora)/.test(s)) return null;

  // ── Pistas de meridiano ──
  const pm = /(de la tarde|de la noche|\bpm\b|p\.m\.)/.test(s);
  const am = /(de la manana|de la madrugada|\bam\b|a\.m\.)/.test(s);

  // ── Hora + minutos ──
  let hour = null, minute = 0;

  // Formatos con separador: 13:00 / 13.30 / 13h30
  let m = s.match(/(\d{1,2})[:.h](\d{2})\b/);
  if (m) {
    hour = +m[1]; minute = +m[2];
  } else {
    // Dígito suelto: "13", "13h", "1"
    m = s.match(/\b(\d{1,2})h?\b/);
    if (m) hour = +m[1];
    else {
      // Palabra: la PRIMERA que aparezca en la frase (en "diez y cinco",
      // la hora es "diez"; "cinco" son los minutos).
      let bestIdx = Infinity;
      for (const [w, n] of Object.entries(WORD_NUM)) {
        const idx = s.search(new RegExp(`\\b${w}\\b`));
        if (idx !== -1 && idx < bestIdx) { bestIdx = idx; hour = n; }
      }
    }
  }
  if (hour == null || isNaN(hour) || hour > 23) return null;

  // Minutos por palabras (solo si no vinieron por separador)
  let minusAdj = 0;
  if (!m || !/[:.h]\d{2}\b/.test(s)) {
    if      (/menos cuarto/.test(s)) { minusAdj = 1; minute = 45; }
    else if (/menos veinte/.test(s)) { minusAdj = 1; minute = 40; }
    else if (/menos diez/.test(s))   { minusAdj = 1; minute = 50; }
    else if (/menos cinco/.test(s))  { minusAdj = 1; minute = 55; }
    else if (/y media/.test(s))       minute = 30;
    else if (/y cuarto/.test(s))      minute = 15;
    else if (/y veinticinco/.test(s)) minute = 25;
    else if (/y veinte/.test(s))      minute = 20;
    else if (/y diez/.test(s))        minute = 10;
    else if (/y cinco/.test(s))       minute = 5;
  }

  // ── Meridiano ──
  if (pm && hour < 12)      hour += 12;
  else if (am && hour === 12) hour = 0;
  else if (!am && !pm && hour >= 1 && hour <= 7) hour += 12; // contexto laboral

  // "la una menos cuarto" = 12:45 (restar DESPUÉS de resolver el meridiano)
  hour -= minusAdj;
  if (hour < 0) hour += 24;

  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

module.exports = { parseSpanishTime };
