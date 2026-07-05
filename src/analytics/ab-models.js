'use strict';

// ============================================================
// A/B de cerebro (LLM) — agregación por brazo, DETERMINISTA.
// Compara modelos (p.ej. Llama vs gpt-4o-mini) a partir de las
// llamadas reales de nf_calls. El brazo se deriva del proveedor
// dominante de los turnos (metrics.turns[].llmProvider); las
// métricas de calidad salen del auditor y del quality score.
// Sin LLM: pura, testeable, reproducible. La asignación de modelo
// es palanca admin-only (assistant_config.model 'proveedor/modelo').
// ============================================================

// Etiqueta legible por proveedor (el modelo exacto no se persiste por turno).
const MODEL_LABEL = {
  groq:      'Llama (Groq)',
  cerebras:  'Llama (Cerebras)',
  openai:    'gpt-4o-mini (OpenAI)',
  anthropic: 'Claude (Anthropic)',
};

// Brazo de una llamada = proveedor mayoritario de sus turnos; null si no atribuible.
function armKey(call) {
  const turns = (call && call.metrics && call.metrics.turns) || [];
  const counts = {};
  for (const t of turns) {
    const p = t && t.llmProvider;
    if (p) counts[p] = (counts[p] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

function _avg(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; }
function _round1(x) { return x == null ? null : Math.round(x * 10) / 10; }

// calls: filas de nf_calls con { outcome, metrics }. opts.threshold = mínimo por brazo.
function compareModelArms(calls = [], opts = {}) {
  const threshold = opts.threshold || 20;
  const arms = {};
  let attributed = 0;

  for (const c of calls) {
    const k = armKey(c);
    if (!k) continue;
    attributed++;
    const a = arms[k] || (arms[k] = {
      provider: k, label: MODEL_LABEL[k] || k,
      n: 0, booked: 0, info: 0, abandoned: 0,
      _audit: [], _qual: [], _lat: [], _turns: [],
    });
    a.n++;
    if (c.outcome === 'booked') a.booked++;
    else if (c.outcome === 'info') a.info++;
    else if (c.outcome === 'abandoned') a.abandoned++;

    const m = c.metrics || {};
    if (m.audit && typeof m.audit.score === 'number') a._audit.push(m.audit.score);
    if (m.quality && typeof m.quality.score === 'number') a._qual.push(m.quality.score);
    if (m.quality && typeof m.quality.avgLatency === 'number') a._lat.push(m.quality.avgLatency);
    const nTurns = ((m.turns) || []).length;
    if (nTurns) a._turns.push(nTurns);
  }

  const list = Object.values(arms).map((a) => ({
    provider: a.provider,
    label: a.label,
    n: a.n,
    booked: a.booked,
    info: a.info,
    abandoned: a.abandoned,
    bookingRate: a.n ? Math.round((a.booked / a.n) * 1000) / 10 : 0,
    avgAudit: _round1(_avg(a._audit)),
    avgQuality: _round1(_avg(a._qual)),
    avgLatencyMs: _avg(a._lat) == null ? null : Math.round(_avg(a._lat)),
    avgTurns: _round1(_avg(a._turns)),
    ready: a.n >= threshold,
  })).sort((x, y) => y.n - x.n);

  const ready = list.length >= 2 && list.every((a) => a.ready);
  const reason = ready ? null
    : (list.length < 2
      ? `Solo hay ${list.length} brazo con datos: el A/B necesita ≥2 modelos activos (asigna orgs a otro modelo en assistant_config.model).`
      : `Algún brazo no llega a ${threshold} llamadas: sigue acumulando volumen antes del veredicto.`);

  // Veredicto: con datos suficientes, declara ganador. Criterio: RESERVAS
  // (la métrica de negocio); empate → calidad (audit score). El margen dice
  // cuánto gana. Empate total → sin ganador claro (tie).
  let winner = null;
  if (ready) {
    const ranked = [...list].sort((a, b) => (b.bookingRate - a.bookingRate) || ((b.avgAudit || 0) - (a.avgAudit || 0)));
    const top = ranked[0], second = ranked[1];
    const byBooking = top.bookingRate !== second.bookingRate;
    const fullTie = !byBooking && (top.avgAudit || 0) === (second.avgAudit || 0);
    winner = fullTie ? { tie: true } : {
      provider: top.provider,
      label: top.label,
      metric: byBooking ? 'reservas' : 'calidad (audit)',
      margin: byBooking
        ? Math.round((top.bookingRate - second.bookingRate) * 10) / 10
        : Math.round(((top.avgAudit || 0) - (second.avgAudit || 0)) * 10) / 10,
      tie: false,
    };
  }

  return { threshold, totalCalls: calls.length, attributed, arms: list, verdict: ready ? 'ready' : 'insufficient', reason, winner };
}

module.exports = { compareModelArms, armKey, MODEL_LABEL };
