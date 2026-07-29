'use strict';
// ============================================================
// NodeFlow — Estado del ciclo de vida del proceso (PILOT-001/L4)
// ------------------------------------------------------------
// Un proceso que se está apagando seguía diciendo "estoy sano" en /health y
// aceptando conexiones nuevas: el balanceador y el proveedor de telefonía le
// mandaban llamadas que morirían segundos después, con su alta a medio escribir.
//
// Aquí vive la única señal de "me estoy apagando", que /health consulta para
// dejar de anunciarse como disponible. Marcarlo es irreversible a propósito:
// un proceso que empezó a apagarse no vuelve a estar listo.
// ============================================================

let _shuttingDown = false;
let _since = null;

/** Marca el proceso como en apagado (irreversible). */
function markShuttingDown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  _since = Date.now();
}

function isShuttingDown() { return _shuttingDown; }
function shuttingDownSince() { return _since; }

/** Solo para tests. */
function _reset() { _shuttingDown = false; _since = null; }

module.exports = { markShuttingDown, isShuttingDown, shuttingDownSince, _reset };
