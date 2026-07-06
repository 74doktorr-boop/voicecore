// ============================================================
// NodeFlow — Elección de LÍDER para tareas programadas (2026-07-06)
// ------------------------------------------------------------
// A escala corres varias réplicas (Docker Swarm). Cada una arranca los
// mismos crons (recordatorios, briefings, campañas…) → sin coordinar,
// el cliente recibiría N recordatorios por cita y N llamadas de campaña.
//
// Este módulo elige UNA réplica líder vía un lock en Redis; solo el líder
// ejecuta las tareas programadas. Los crons llaman a isLeader() antes de
// actuar.
//
// Fail-safe:
//   · Sin REDIS_URL (single-réplica) → esta instancia SIEMPRE es líder =
//     comportamiento de siempre.
//   · Redis cae con Redis configurado → se MANTIENE el estado: el líder
//     sigue siéndolo (no deja los crons sin correr) y un seguidor NO se
//     auto-proclama (no duplica). Solo un doble fallo (líder muerto +
//     Redis caído) para los crons, hasta recuperar Redis.
// ============================================================
'use strict';

const { Logger } = require('./logger');
const log = new Logger('LEADER');

const LOCK_KEY = 'nf:leader';
const TTL_MS   = 30000;  // el lock caduca en 30s si el líder no renueva
const RENEW_MS = 10000;  // renovamos/intentamos cada 10s
const INSTANCE_ID = `${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

// Renueva el TTL SOLO si el lock sigue siendo nuestro (compare-and-set).
const RENEW_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then " +
  "return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

let _isLeader = false;
let _started  = false;
let _redis     = null;   // null = sin resolver · false = sin Redis · objeto = cliente
let _timer     = null;

function _getRedis() {
  if (_redis !== null) return _redis;
  if (!process.env.REDIS_URL) { _redis = false; return false; }
  try {
    const Redis = require('ioredis');
    _redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false });
    _redis.on('error', () => {}); // los errores se gestionan en _tick
    return _redis;
  } catch (e) {
    log.warn(`ioredis no disponible (${e.message}) — líder único`);
    _redis = false;
    return false;
  }
}

async function _tick() {
  const r = _getRedis();
  if (!r) { _isLeader = true; return; } // sin Redis = single = siempre líder
  try {
    if (_isLeader) {
      const held = await r.eval(RENEW_LUA, 1, LOCK_KEY, INSTANCE_ID, String(TTL_MS));
      if (Number(held) !== 1) { _isLeader = false; log.warn('liderazgo perdido — lo tomó otra réplica'); }
    } else {
      const ok = await r.set(LOCK_KEY, INSTANCE_ID, 'PX', TTL_MS, 'NX');
      if (ok === 'OK') { _isLeader = true; log.info('esta réplica es LÍDER de tareas programadas'); }
    }
  } catch (e) {
    // Redis inaccesible: se MANTIENE el estado (ver fail-safe arriba).
    log.warn(`leader tick: Redis error (${e.message}) — mantengo ${_isLeader ? 'LÍDER' : 'seguidor'}`);
  }
}

function startLeaderElection() {
  if (_started) return;
  _started = true;
  if (!process.env.REDIS_URL) {
    _isLeader = true;
    log.info('sin REDIS_URL — esta instancia es líder (single-réplica)');
    return;
  }
  _tick();
  _timer = setInterval(_tick, RENEW_MS);
  if (_timer.unref) _timer.unref();
  log.info('elección de líder iniciada (Redis)');
}

function stopLeaderElection() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _started = false;
}

// ¿Es esta réplica la líder? Fail-open si nunca se arrancó la elección
// (defensivo: jamás dejar los crons sin correr por olvidar iniciarla).
function isLeader() { return _started ? _isLeader : true; }

// ── Hooks de test (no forman parte de la API pública) ──
function _setRedisForTest(client) { _redis = client; _started = true; }
function _resetForTest() { if (_timer) clearInterval(_timer); _timer = null; _redis = null; _isLeader = false; _started = false; }

module.exports = {
  startLeaderElection, stopLeaderElection, isLeader, INSTANCE_ID,
  _tick, _setRedisForTest, _resetForTest,
};
