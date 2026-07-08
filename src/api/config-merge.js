// ============================================================
// NodeFlow — Merge de configuración del portal (2026-07-08)
// ------------------------------------------------------------
// Dos invariantes de integridad de datos, PUROS y testeables, extraídos de
// las rutas GET/PATCH /api/portal/config tras un incidente real: al dueño de
// una fisioterapia le "desaparecieron" sus servicios y precios. La data estaba
// SALVA en BD (automation_config.config.serviceList); el fallo era de código:
//
//   · LECTURA: el GET leía serviceList/avgTicket/… de la copia EN MEMORIA del
//     flow (que tras redeploys + escrituras perdió serviceList) en vez de la
//     fila FRESCA de BD que sí los conservaba.
//   · ESCRITURA (latente): el PATCH mergeaba el flow en memoria COMPLETO sobre
//     la BD; un campo ausente en el body (p.ej. serviceList al guardar solo el
//     horario) arrastraba un valor obsoleto/vacío y pisaba el de BD.
//
// Regla de oro: la BD manda en lectura; en escritura solo se toca lo que el
// request trae de verdad.
// ============================================================
'use strict';

/**
 * Fuente de verdad para servir la config: la config FRESCA de BD por encima de
 * la copia en memoria (que puede estar obsoleta). Merge campo a campo — BD gana.
 * @param {object|null} memConfig  flow.automations.config (en memoria, posible stale)
 * @param {object|null} dbConfig   automation_config.config (fresco de BD)
 * @returns {object} config efectiva para leer
 */
function effectiveConfigSource(memConfig, dbConfig) {
  return { ...(memConfig || {}), ...(dbConfig || {}) };
}

/**
 * Config a PERSISTIR: la config fresca de BD con SOLO el parche de este request
 * aplicado encima. Un campo ausente en `patch` conserva su valor de BD (no se
 * clona el estado en memoria completo → no se pisa nada por omisión).
 * @param {object|null} dbConfig  automation_config.config actual en BD (fresco)
 * @param {object|null} patch     solo los campos que el request quiere cambiar
 * @returns {object} config resultante para escribir en BD
 */
function mergeConfigForWrite(dbConfig, patch) {
  return { ...(dbConfig || {}), ...(patch || {}) };
}

module.exports = { effectiveConfigSource, mergeConfigForWrite };
