'use strict';
// ============================================================
// NodeFlow — Presupuesto de tiempo para las llamadas de red del turno de voz.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo V4):
// Ni el LLM ni el TTS tenían timeout. Un `fetch` desnudo contra Groq, Anthropic,
// ElevenLabs, Cartesia u OpenAI-TTS puede quedarse COLGADO (que no es lo mismo
// que fallar: fallar dispara el failover, colgarse no). El turno se bloqueaba
// indefinidamente y el único límite real era el salvavidas a los 75 s: el
// cliente se comía más de un minuto de silencio al teléfono. El charter fija
// <700 ms por turno.
//
// La diferencia entre "el proveedor tuvo un hipo y saltamos al siguiente en
// 1,5 s" y "la llamada se quedó muda un minuto" es exactamente este fichero.
//
// Dos usos distintos, a propósito:
//   · STREAMING (LLM): el presupuesto cubre hasta las CABECERAS. Una vez que la
//     respuesta empieza a fluir hay que llamar a clear() — si no, se abortaría
//     una generación larga pero sana.
//   · CUERPO COMPLETO (TTS): el presupuesto cubre cabeceras + descarga. Se
//     limpia en un `finally` una vez leído el buffer.
// ============================================================

const DEFAULTS = {
  // Hasta el primer byte del LLM. Generoso frente al p95 real (~1,5 s) pero muy
  // por debajo de lo que un humano tolera al teléfono.
  llm: 8000,
  // Síntesis completa de una frase. ElevenLabs Flash ronda 150-400 ms.
  tts: 10000,
};

const _ms = (envName, fallback) => {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const llmTimeoutMs = () => _ms('LLM_TIMEOUT_MS', DEFAULTS.llm);
const ttsTimeoutMs = () => _ms('TTS_TIMEOUT_MS', DEFAULTS.tts);

/**
 * Señal de aborto con vencimiento.
 *
 * SIN `.unref()` — lo tenía y estaba mal. La idea era que un timeout pendiente
 * no impidiera terminar el proceso, pero eso ya lo garantiza el `clear()` que
 * todos los llamantes hacen en un `finally`. Con unref, Node puede dar el
 * temporizador por prescindible: si lo único pendiente es este plazo, la cola
 * de eventos se drena y el aborto NO LLEGA A DISPARARSE — es decir, el timeout
 * deja de existir justo en el caso para el que se creó. Lo destapó la puerta de
 * calidad de CI, que corre Node 22; en local (Node 24) quedaba tapado.
 *
 * @param {number} timeoutMs
 * @param {object} [deps] inyección para tests: { setTimeout, clearTimeout, AbortController }
 * @returns {{signal: AbortSignal, clear: () => void, timedOut: () => boolean}}
 */
function newTimeoutSignal(timeoutMs, deps = {}) {
  const AC = deps.AbortController || AbortController;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;

  const controller = new AC();
  let fired = false;
  const timer = setT(() => { fired = true; controller.abort(); }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearT(timer),
    timedOut: () => fired,
  };
}

/**
 * ¿Este error viene de nuestro timeout (y no de un fallo del proveedor)?
 * Sirve para que los logs digan la verdad: "Groq no respondió en 8s" es un
 * diagnóstico distinto de "Groq devolvió 500".
 */
function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

/**
 * Mensaje de error uniforme para un vencimiento. Nunca silencioso.
 */
function timeoutMessage(label, timeoutMs) {
  return `${label} no respondió en ${timeoutMs}ms (timeout de NodeFlow, no del proveedor)`;
}

module.exports = { newTimeoutSignal, isAbortError, timeoutMessage, llmTimeoutMs, ttsTimeoutMs, DEFAULTS };
