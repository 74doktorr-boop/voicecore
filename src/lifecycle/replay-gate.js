// ============================================================
// NodeFlow — Replay gate (#5, último eslabón del bucle de mejora)
// Cuando el fundador aprueba una regla candidata del informe
// semanal, la regla se convierte en un cambio de prompt — y ANTES
// de desplegarla, este gate re-juega llamadas reales contra el
// prompt candidato: reconstruye la conversación turno a turno
// (los turnos del cliente son los reales; los del asistente los
// genera el prompt nuevo) y el auditor puntúa el resultado.
// La regla solo pasa si la media no cae más que la tolerancia.
//
// Limitación asumida (v1): el replay corre SIN herramientas — las
// reglas que valida son de comportamiento textual (informar antes
// de capturar, no repetir preguntas, tono). Las conversaciones
// cuyo valor dependa de tools (disponibilidad real) puntúan igual
// para candidato y para el original, así que el delta sigue
// siendo informativo.
//
// Uso manual:  node scripts/run-replay-gate.js [n=10] [tol=5] [sector]
// (últimas n llamadas de prod contra el prompt ACTUAL; si se da un
// sector, valida SOLO contra llamadas de ese vertical)
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('REPLAY-GATE');

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

/**
 * Reconstruye una conversación: turnos de cliente reales + respuestas del
 * asistente generadas con el prompt candidato.
 * @returns {Promise<Array<{role,content}>>} transcript sintético
 */
async function replayConversation(candidatePrompt, transcript, deps = {}) {
  const openai = deps.openai !== undefined ? deps.openai : getOpenAI();
  const userTurns = (transcript || []).filter(t => t && t.role === 'user' && String(t.content || '').trim());
  const out = [];
  if (!openai || !userTurns.length) return out;

  const messages = [{
    role: 'system',
    content: candidatePrompt +
      '\n\n[SIMULACIÓN DE AUDITORÍA: las herramientas no están disponibles; si necesitarías una, responde como recepcionista honesta sin inventar datos.]',
  }];

  for (const turn of userTurns) {
    messages.push({ role: 'user', content: turn.content });
    out.push({ role: 'user', content: turn.content });
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0,
      max_tokens: 220,
    });
    const reply = (resp.choices[0].message.content || '').trim();
    messages.push({ role: 'assistant', content: reply });
    out.push({ role: 'assistant', content: reply });
  }
  return out;
}

/** Veredicto determinista: honesto ante la falta de datos. */
function gateVerdict(originalAvg, replayAvg, tolerance = 5) {
  if (typeof originalAvg !== 'number' || typeof replayAvg !== 'number') {
    return { pass: false, reason: 'Datos insuficientes para comparar — el gate no aprueba a ciegas.' };
  }
  const pass = replayAvg >= originalAvg - tolerance;
  return {
    pass,
    reason: pass
      ? `Replay ${replayAvg} vs original ${originalAvg} (tolerancia ${tolerance}): la regla no empeora.`
      : `Replay ${replayAvg} vs original ${originalAvg}: cae más que la tolerancia (${tolerance}). NO desplegar.`,
  };
}

/**
 * Gate completo: re-juega cada llamada con el prompt candidato, audita las
 * conversaciones sintéticas y compara medias.
 * @param {object} opts  - { candidatePrompt, calls, tolerance, sector }
 *   calls: filas con { id, transcript, assistantMode?, serviceList?, metrics.audit.{score,sector} }
 *   sector (opcional): valida SOLO contra llamadas de ese vertical — una regla
 *     aprobada para restaurantes se prueba con llamadas de restaurantes, no con
 *     una mezcla (2026-07-04). El re-audit usa la rúbrica del sector.
 * @returns {Promise<{pass, reason, replayed, originalAvg, replayAvg, sector, details}>}
 */
async function runReplayGate({ candidatePrompt, calls, tolerance = 5, sector = null }, deps = {}) {
  const audit = deps.audit || (async (callData) => {
    const { auditCall } = require('./call-auditor');
    return auditCall(callData, deps.openai !== undefined ? { openai: deps.openai } : {});
  });

  // Filtro por sector: solo llamadas de ESE vertical (por el sector que el
  // auditor estampó en metrics.audit.sector). Sin sector → todas (global).
  const { resolveSector } = require('../sectors/sector-registry');
  const wantSector = sector ? resolveSector(sector).slug : null;
  const pool = wantSector
    ? (calls || []).filter(c => (c?.metrics?.audit?.sector || 'generico') === wantSector)
    : (calls || []);

  const details = [];
  let origSum = 0, replaySum = 0, n = 0;

  for (const call of pool) {
    const origScore = call && call.metrics && call.metrics.audit && call.metrics.audit.score;
    if (!Array.isArray(call?.transcript) || call.transcript.length < 2 || typeof origScore !== 'number') continue;

    try {
      const synthetic = await replayConversation(candidatePrompt, call.transcript, deps);
      if (synthetic.length < 2) continue;
      const verdict = await audit({
        id: `replay-${call.id}`,
        outcome: 'replay',
        transcript: synthetic,
        assistantMode: call.assistantMode || null,
        serviceList: call.serviceList || null,
        // Re-auditar con la rúbrica del sector de la propia llamada (o el pedido).
        sector: call.metrics?.audit?.sector || wantSector || null,
      });
      if (!verdict || typeof verdict.score !== 'number') continue;
      origSum += origScore;
      replaySum += verdict.score;
      n++;
      details.push({ id: call.id, original: origScore, replay: verdict.score });
    } catch (e) {
      log.warn(`replay de ${call?.id} falló: ${e.message}`);
    }
  }

  const originalAvg = n ? Math.round(origSum / n) : null;
  const replayAvg = n ? Math.round(replaySum / n) : null;
  const verdict = gateVerdict(originalAvg, replayAvg, tolerance);
  log.info(`Replay gate${wantSector ? ` [${wantSector}]` : ''}: ${n} llamadas — ${verdict.reason}`);
  return { ...verdict, replayed: n, originalAvg, replayAvg, sector: wantSector, details };
}

module.exports = { replayConversation, gateVerdict, runReplayGate };
