// ============================================================
// NodeFlow — Normalizador de dicción para TTS (2026-07-04)
// La pronunciación correcta NO puede depender de que el LLM escriba
// "euros" o "una hora" (charter: reglas deterministas fuera del LLM).
// Este paso corrige el texto ANTES de sintetizar. Reportado por Unai:
// el asistente "no sabe pronunciar euros" (leía el símbolo €) y decía
// "un horas" en vez de "una hora".
// ============================================================
'use strict';

/**
 * Convierte texto a su forma "hablable" por el TTS.
 * @param {string} text
 * @returns {string} (o el valor original si no es string)
 */
function toSpeakable(text) {
  if (typeof text !== 'string' || !text) return text;
  let t = text;

  // ── Euros ─────────────────────────────────────────────────────
  // "49€/mes" | "49 €/mes" | "49€ al mes"  → "49 euros al mes"
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*€\s*(?:\/\s*mes|al\s*mes)/gi, '$1 euros al mes');
  // "10€ al mes" (sin símbolo pegado a mes) ya cubierto; ahora € normal:
  // "180€" | "15 €" | "12,50€"  → "180 euros"
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*€/g, '$1 euros');
  // "€20" → "20 euros"
  t = t.replace(/€\s*(\d+(?:[.,]\d+)?)/g, '$1 euros');
  // "€" suelto → "euros"
  t = t.replace(/€/g, 'euros');

  // ── Horas: concordancia femenina del 1 ────────────────────────
  // "1 hora", "1 horas" (mal), "un horas" (mal) → "una hora"
  t = t.replace(/\b1\s+horas?\b/gi, 'una hora');
  t = t.replace(/\bun\s+horas\b/gi, 'una hora');

  // ── Limpieza ──────────────────────────────────────────────────
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t;
}

module.exports = { toSpeakable };
