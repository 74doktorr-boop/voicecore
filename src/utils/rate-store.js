// ============================================================
// VoiceCore — Rate store: contador de ventana fija ATÓMICO.
// Usa Redis si REDIS_URL está definido (seguro multi-réplica en
// Docker Swarm); si no, cae a un Map en memoria (= comportamiento
// previo, válido para una sola instancia).
//
// API:
//   hit(key, windowMs)  -> Promise<{count, resetAt}>   (incrementa)
//   peek(key)           -> Promise<{count, resetAt}|null>  (no incrementa)
//   reset(key)          -> Promise<void>
//   isRedisEnabled()    -> bool
//
// El camino Redis falla ABIERTO: si Redis no responde, se usa el Map
// (mejor permitir que tirar todo el tráfico).
// ============================================================
'use strict';

const { Logger } = require('./logger');
const log = new Logger('RATE-STORE');

// ── Fallback en memoria: Map<key, {count, resetAt}> ──
const mem = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, e] of mem) if (now > e.resetAt) mem.delete(key);
}, 10 * 60 * 1000).unref();

function memHit(key, windowMs) {
  const now = Date.now();
  let e = mem.get(key);
  if (!e || now > e.resetAt) { e = { count: 1, resetAt: now + windowMs }; mem.set(key, e); return { ...e }; }
  e.count++;
  return { count: e.count, resetAt: e.resetAt };
}
function memPeek(key) {
  const e = mem.get(key);
  if (!e || Date.now() > e.resetAt) return null;
  return { count: e.count, resetAt: e.resetAt };
}

// ── Redis (lazy, opcional) ──
let redis = null;
let redisReady = false;

// INCR atómico + PEXPIRE solo en la primera petición de la ventana. Devuelve [count, pttl].
const HIT_LUA =
  "local c = redis.call('INCR', KEYS[1]) " +
  "if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end " +
  "local t = redis.call('PTTL', KEYS[1]) " +
  "return {c, t}";

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    redis.on('ready', () => { redisReady = true; log.info('Redis conectado — rate-limit multi-réplica activo'); });
    redis.on('error', (e) => { if (redisReady) log.warn(`Redis error: ${e.message}`); redisReady = false; });
    redis.on('end', () => { redisReady = false; });
  } catch (e) {
    log.warn(`ioredis no disponible (${e.message}) — rate-limit en memoria (una sola instancia)`);
    redis = null;
  }
} else {
  log.info('REDIS_URL no definido — rate-limit en memoria (válido para una sola instancia)');
}

async function hit(key, windowMs) {
  if (redis && redisReady) {
    try {
      const [count, pttl] = await redis.eval(HIT_LUA, 1, key, String(windowMs));
      const ttl = pttl >= 0 ? pttl : windowMs;
      return { count: Number(count), resetAt: Date.now() + ttl };
    } catch (e) {
      log.warn(`hit Redis falló (${e.message}) — fallback memoria`);
    }
  }
  return memHit(key, windowMs);
}

async function peek(key) {
  if (redis && redisReady) {
    try {
      const [val, pttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
      if (val === null) return null;
      const ttl = pttl >= 0 ? pttl : 0;
      return { count: Number(val), resetAt: Date.now() + ttl };
    } catch (e) {
      log.warn(`peek Redis falló (${e.message}) — fallback memoria`);
    }
  }
  return memPeek(key);
}

async function reset(key) {
  if (redis && redisReady) {
    try { await redis.del(key); return; }
    catch (e) { log.warn(`reset Redis falló (${e.message}) — fallback memoria`); }
  }
  mem.delete(key);
}

function isRedisEnabled() { return !!(redis && redisReady); }

module.exports = { hit, peek, reset, isRedisEnabled };
