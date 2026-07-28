'use strict';
// ============================================================
// NodeFlow — Integridad del historial de mensajes del LLM.
//
// POR QUÉ EXISTE (auditoría 2026-07-29, hallazgo V2):
// El contrato de OpenAI/Groq es estricto: TODO mensaje `assistant` con
// `tool_calls` debe ir seguido de un mensaje `role:'tool'` por CADA id. Si
// falta uno, la API devuelve 400 — y no solo en esa petición: como el historial
// vive en la sesión, **todas las peticiones restantes de la llamada fallan**.
// El router prueba el siguiente proveedor, que rechaza igual, y la llamada
// termina en "le devolveremos la llamada".
//
// Cómo se producía: el cliente interrumpía durante la frase-puente ("Un momento,
// por favor…"), `interrupted` se ponía a true, se insertaba el mensaje con
// `tool_calls` y el bucle salía por `break` ANTES de insertar ningún resultado.
// Es decir: el fallo se disparaba justo cuando el cliente habla mientras la IA
// va a consultar la agenda — el momento más frecuente de toda la llamada.
//
// Estas funciones son puras y no dependen de la sesión: sirven tanto para
// arreglar el historial como para AFIRMAR la invariante en los tests.
// ============================================================

/**
 * Ids de tool_call que se quedaron sin su mensaje `role:'tool'`.
 * @param {Array<object>} messages historial estilo OpenAI
 * @returns {string[]} ids huérfanos, en orden de aparición
 */
function findOrphanToolCalls(messages) {
  if (!Array.isArray(messages)) return [];
  const answered = new Set();
  for (const m of messages) {
    if (m && m.role === 'tool' && m.tool_call_id) answered.add(m.tool_call_id);
  }
  const orphans = [];
  for (const m of messages) {
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (tc && tc.id && !answered.has(tc.id)) orphans.push(tc.id);
    }
  }
  return orphans;
}

/**
 * Resultado sintético para un tool_call que nunca llegó a ejecutarse.
 * Se guarda como resultado real en el historial: es honesto (dice que se
 * canceló) y satisface el contrato de la API.
 */
function cancelledToolResult(reason = 'interrupted_by_customer') {
  return JSON.stringify({ success: false, error: 'cancelled', reason });
}

/**
 * Devuelve una copia del historial con la invariante restaurada: cada
 * `tool_call` sin respuesta recibe un resultado sintético justo detrás del
 * mensaje `assistant` que lo pidió (el orden importa para la API).
 * No muta la entrada. Si no hay huérfanos, devuelve el mismo array.
 */
function repairToolCallPairing(messages, reason = 'interrupted_by_customer') {
  const orphans = findOrphanToolCalls(messages);
  if (orphans.length === 0) return messages;
  const pending = new Set(orphans);
  const out = [];
  for (const m of messages) {
    out.push(m);
    if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (tc && tc.id && pending.has(tc.id)) {
        out.push({ role: 'tool', tool_call_id: tc.id, content: cancelledToolResult(reason) });
        pending.delete(tc.id);
      }
    }
  }
  return out;
}

module.exports = { findOrphanToolCalls, repairToolCallPairing, cancelledToolResult };
