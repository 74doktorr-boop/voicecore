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

// Números-hora en español Y gallego (el gallego solo añade formas nuevas:
// unha, dous/dúas, catro, sete, oito, nove, dez — sin colisión con el español).
const WORD_NUM = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  // galego
  unha: 1, dous: 2, duas: 2, catro: 4, sete: 7, oito: 8, nove: 9, dez: 10,
};

function parseSpanishTime(input) {
  if (input == null) return null;
  let s = String(input).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // fuera acentos
  if (!s) return null;

  // ── Expresiones especiales (es + gl) ──
  if (/\bmediodia\b/.test(s))                 return '12:00';
  if (/\b(medianoche|medianoite)\b/.test(s))  return '00:00';
  if (/desp(ues|ois) de comer/.test(s))       return '15:00'; // es "después" / gl "despois"
  // Rangos vagos ("por la mañana", "pola tarde", "a primera hora") → que la IA concrete
  if (/^(por|a) (la manana|la tarde|primera hora|ultima hora)/.test(s)) return null;
  if (/^(pola|na) (mana|manana|tarde|noite)\b/.test(s)) return null; // galego

  // ── Pistas de meridiano (es + gl) ──
  const pm = /(de la tarde|da tarde|de la noche|da noite|\bpm\b|p\.m\.)/.test(s);
  const am = /(de la manana|da manana|da mana|pola mana|de la madrugada|da madrugada|\bam\b|a\.m\.)/.test(s);

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

  // Minutos por palabras (solo si no vinieron por separador). Los COMPUESTOS
  // ("y treinta y cinco", "y cuarenta y cinco") se comprueban ANTES que su prefijo
  // ("y treinta", "y cuarenta") para no cortarlos a la baja.
  let minusAdj = 0;
  if (!m || !/[:.h]\d{2}\b/.test(s)) {
    // Conectivo "y" (es) o "e" (gl); números en ambas lenguas
    // (veinte/vinte, treinta/trinta, cuarenta/corenta, diez/dez).
    if      (/menos cuarto/.test(s))                          { minusAdj = 1; minute = 45; }
    else if (/menos (veinticinco|vinte e cinco)/.test(s))     { minusAdj = 1; minute = 35; }
    else if (/menos (veinte|vinte)/.test(s))                 { minusAdj = 1; minute = 40; }
    else if (/menos (diez|dez)/.test(s))                     { minusAdj = 1; minute = 50; }
    else if (/menos cinco/.test(s))                          { minusAdj = 1; minute = 55; }
    else if (/[ye] (treinta|trinta) [ye] cinco\b/.test(s))   minute = 35;
    else if (/[ye] (cuarenta|corenta) [ye] cinco\b/.test(s)) minute = 45;
    else if (/[ye] cincuenta [ye] cinco\b/.test(s))          minute = 55;
    else if (/[ye] (media|treinta|trinta)\b/.test(s))        minute = 30;
    else if (/[ye] (cuarto|quince)\b/.test(s))               minute = 15;
    else if (/[ye] (veinticinco|vinte e cinco)\b/.test(s))   minute = 25;
    else if (/[ye] (veinte|vinte)\b/.test(s))                minute = 20;
    else if (/[ye] (cuarenta|corenta)\b/.test(s))            minute = 40;
    else if (/[ye] cincuenta\b/.test(s))                     minute = 50;
    else if (/[ye] (diez|dez)\b/.test(s))                    minute = 10;
    else if (/[ye] cinco\b/.test(s))                         minute = 5;
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
