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
// KV en memoria para put/get (tokens, etc.): Map<key, {value, resetAt}>
const kv = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, e] of mem) if (now > e.resetAt) mem.delete(key);
  for (const [key, e] of kv)  if (now > e.resetAt) kv.delete(key);
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

// ── KV con TTL (put/get/del): para sesiones/tokens, compartido multi-réplica.
// Redis SET key value PX ttl → GET. Fallback a un Map en memoria con expiración.
async function put(key, value, ttlMs) {
  if (redis && redisReady) {
    try { await redis.set(key, String(value), 'PX', Math.max(1, ttlMs | 0)); return; }
    catch (e) { log.warn(`put Redis falló (${e.message}) — fallback memoria`); }
  }
  kv.set(key, { value: String(value), resetAt: Date.now() + ttlMs });
}
async function get(key) {
  if (redis && redisReady) {
    try { return await redis.get(key); }
    catch (e) { log.warn(`get Redis falló (${e.message}) — fallback memoria`); }
  }
  const e = kv.get(key);
  if (!e || Date.now() > e.resetAt) { kv.delete(key); return null; }
  return e.value;
}
async function del(key) {
  if (redis && redisReady) {
    try { await redis.del(key); } catch (e) { log.warn(`del Redis falló (${e.message})`); }
  }
  kv.delete(key);
}

function isRedisEnabled() { return !!(redis && redisReady); }

module.exports = { hit, peek, reset, put, get, del, isRedisEnabled };
