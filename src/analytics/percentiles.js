'use strict';
// ============================================================
// NodeFlow — Percentiles.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo F2): en TODO el repo no había
// ni un p50, ni un p95, ni una mediana. Solo medias. En voz la media miente de
// forma sistemática: una llamada de 9 turnos a 400 ms y uno a 6 s da una media
// de 960 ms → "verde" en el panel, y el cliente ya ha colgado. Y el umbral de
// alerta (LAT_WARN_MS = 1500) se aplicaba precisamente sobre esa media, así que
// solo saltaba cuando la degradación era masiva.
//
// La cola es lo que el cliente nota. Los datos crudos ya estaban en
// nf_calls.metrics.turns[] desde hace semanas: solo faltaba calcular esto.
// ============================================================

/**
 * Percentil por interpolación lineal (el mismo método que numpy/pandas por
 * defecto, para que los números cuadren si algún día se analiza fuera).
 * @param {number[]} values  sin ordenar; se ignoran los no numéricos
 * @param {number} p  0-100
 * @returns {number|null} null si no hay datos utilizables
 */
function percentile(values, p) {
  const xs = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const q = Math.min(100, Math.max(0, Number(p) || 0)) / 100;
  const idx = q * (xs.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

/**
 * Resumen de latencia listo para persistir y para pintar.
 * Se incluye `n` a propósito: un p95 con 3 muestras no significa nada, y quien
 * lo lea tiene que poder saberlo.
 * @returns {{n:number, p50:number|null, p90:number|null, p95:number|null, p99:number|null, avg:number|null, max:number|null}}
 */
function latencySummary(values) {
  const xs = (Array.isArray(values) ? values : []).filter(v => Number.isFinite(v));
  const r = (v) => (v === null ? null : Math.round(v));
  return {
    n:   xs.length,
    p50: r(percentile(xs, 50)),
    p90: r(percentile(xs, 90)),
    p95: r(percentile(xs, 95)),
    p99: r(percentile(xs, 99)),
    avg: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null,
    max: xs.length ? Math.max(...xs) : null,
  };
}

module.exports = { percentile, latencySummary };
