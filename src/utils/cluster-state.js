// ============================================================
// VoiceCore — Estado de CLÚSTER (DORMANTE por defecto).
// ------------------------------------------------------------
// Primitivas Redis para correr VARIAS réplicas del nodo de voz sin que
// cada una lleve su propia cuenta de concurrentes en memoria (el cap
// global se volvería N×cap con N réplicas). Cuenta las llamadas activas
// de TODO el clúster con una clave Redis por llamada + TTL de auto-cura
// (si una réplica muere, sus llamadas caducan y no dejan cuentas fantasma).
//
// ⚠️ DORMANTE: nada de esto tiene efecto en producción hoy.
//   · CLUSTER_MODE !== '1'  → todas las operaciones son NO-OP y las
//     lecturas devuelven el conteo LOCAL que pase el llamante. El camino
//     de código del pipeline queda BYTE-A-BYTE igual que hoy.
//   · CLUSTER_MODE === '1' pero sin Redis → igual: fallback al local.
//   · CLUSTER_MODE === '1' + Redis → contador de clúster real.
//
// Diseñado con costuras puras (se puede inyectar un cliente Redis y leer
// la env en tiempo de llamada) para poder testear sin Redis ni process.env.
// ============================================================
'use strict';

const { Logger } = require('./logger');
const log = new Logger('CLUSTER-STATE');

// Prefijo de clave por llamada. Cada llamada activa = una clave con TTL.
const KEY_PREFIX = 'nf:call:';
// Patrón para contar (SCAN/keys). Aislado del resto del namespace Redis.
const KEY_PATTERN = `${KEY_PREFIX}*`;
// TTL de auto-cura: si la réplica que abrió la llamada muere sin hacer
// decrCall, la clave caduca sola y deja de contar. Se refresca en cada
// heartbeat (renewCall) mientras la llamada siga viva. Una llamada normal
// dura minutos; 30 min cubre la más larga con margen y purga zombies.
const CALL_TTL_MS = 30 * 60 * 1000;

/**
 * ¿Está activado el modo clúster? Se lee EN TIEMPO DE LLAMADA (no al
 * cargar el módulo) para que los tests puedan alternar la env y para que
 * el flag defecto-OFF sea la única fuente de verdad. Default: OFF.
 */
function isClusterMode(env = process.env) {
  return env.CLUSTER_MODE === '1';
}

// ── Cliente Redis (lazy, opcional, inyectable) ──
let _redis = null;      // null = sin resolver · false = sin Redis · objeto = cliente
let _redisReady = false;
let _injected = false;  // true si un test inyectó el cliente (no autogestionar)

/**
 * Inyecta un cliente Redis (para tests) o resetea a null. Cuando se
 * inyecta, se considera "listo" salvo que el test diga lo contrario.
 * @param {object|null|false} client
 * @param {{ready?: boolean}} [opts]
 */
function _setRedis(client, opts = {}) {
  _redis = client;
  _redisReady = client ? (opts.ready !== false) : false;
  _injected = client != null && client !== false;
}

function _getRedis() {
  if (_injected) return _redis; // gestionado por el test
  if (_redis !== null) return _redis;
  if (!process.env.REDIS_URL) { _redis = false; return false; }
  try {
    const Redis = require('ioredis');
    _redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    _redis.on('ready', () => { _redisReady = true; log.info('Redis conectado — contador de clúster activo'); });
    _redis.on('error', (e) => { if (_redisReady) log.warn(`Redis error: ${e.message}`); _redisReady = false; });
    _redis.on('end', () => { _redisReady = false; });
    return _redis;
  } catch (e) {
    log.warn(`ioredis no disponible (${e.message}) — contador local`);
    _redis = false;
    return false;
  }
}

function _usable() {
  const r = _getRedis();
  if (!r) return null;
  // Con cliente inyectado respetamos el flag ready pasado; con cliente
  // real solo usamos Redis si el evento 'ready' llegó.
  if (_injected) return _redisReady ? r : null;
  return _redisReady ? r : null;
}

/**
 * Registra una llamada activa en el contador del clúster.
 * NO-OP si CLUSTER_MODE off o Redis no disponible.
 * @returns {Promise<boolean>} true si se escribió en Redis.
 */
async function incrCall(callId, env = process.env) {
  if (!isClusterMode(env) || !callId) return false;
  const r = _usable();
  if (!r) return false;
  try {
    // SET con PX = crea/renueva la clave de esta llamada con TTL de auto-cura.
    await r.set(`${KEY_PREFIX}${callId}`, '1', 'PX', CALL_TTL_MS);
    return true;
  } catch (e) {
    log.warn(`incrCall Redis falló (${e.message}) — se ignora (fallback local)`);
    return false;
  }
}

/**
 * Refresca el TTL de una llamada viva (heartbeat), para que no caduque
 * mientras siga en curso. NO-OP fuera de modo clúster.
 * @returns {Promise<boolean>}
 */
async function renewCall(callId, env = process.env) {
  if (!isClusterMode(env) || !callId) return false;
  const r = _usable();
  if (!r) return false;
  try {
    await r.set(`${KEY_PREFIX}${callId}`, '1', 'PX', CALL_TTL_MS);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Da de baja una llamada del contador del clúster.
 * NO-OP si CLUSTER_MODE off o Redis no disponible.
 * @returns {Promise<boolean>}
 */
async function decrCall(callId, env = process.env) {
  if (!isClusterMode(env) || !callId) return false;
  const r = _usable();
  if (!r) return false;
  try {
    await r.del(`${KEY_PREFIX}${callId}`);
    return true;
  } catch (e) {
    log.warn(`decrCall Redis falló (${e.message}) — se ignora (caducará por TTL)`);
    return false;
  }
}

/**
 * Cuenta las llamadas activas en TODO el clúster.
 *   · CLUSTER_MODE off o sin Redis → devuelve `localCount` (= hoy).
 *   · CLUSTER_MODE on + Redis → cuenta las claves de llamada vivas.
 * Si el conteo Redis falla, cae a `localCount` (fail-safe: nunca peor
 * que el comportamiento de una sola réplica).
 * @param {number} localCount conteo local del nodo (this.activeCalls.size)
 * @returns {Promise<number>}
 */
async function getClusterCallCount(localCount = 0, env = process.env) {
  if (!isClusterMode(env)) return localCount;
  const r = _usable();
  if (!r) return localCount;
  try {
    // SCAN (no KEYS) para no bloquear Redis con muchos clientes.
    let cursor = '0';
    let total = 0;
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', KEY_PATTERN, 'COUNT', 500);
      cursor = next;
      total += keys.length;
    } while (cursor !== '0');
    // Nunca por debajo del local: si Redis va por detrás (baja recién
    // hecha aún sin propagar), el nodo al menos se ve a sí mismo.
    return Math.max(total, localCount);
  } catch (e) {
    log.warn(`getClusterCallCount Redis falló (${e.message}) — usando conteo local`);
    return localCount;
  }
}

module.exports = {
  isClusterMode,
  incrCall,
  decrCall,
  renewCall,
  getClusterCallCount,
  // Constantes y costuras (para tests / runbook):
  CALL_TTL_MS,
  KEY_PREFIX,
  _setRedis,
};
