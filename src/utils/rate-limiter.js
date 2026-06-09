// ============================================================
// NodeFlow — Rate Limiter (in-memory, sin dependencias externas)
// Ventana deslizante por IP. Se reinicia al reiniciar el proceso.
// Para producción con múltiples instancias, usar Redis — pero para
// el demo (una sola instancia en EasyPanel) esto es suficiente.
//
// Uso:
//   const { rateLimit } = require('../utils/rate-limiter');
//   app.post('/api/demo/stt', rateLimit({ max: 20, windowMs: 60*60*1000 }), handler);
// ============================================================

'use strict';

const { Logger } = require('./logger');
const log = new Logger('RATE-LIMITER');

// Map<ip, { count, resetAt }>
const store = new Map();

// Limpiar entradas expiradas cada 10 minutos para no acumular memoria
setInterval(() => {
  const now = Date.now();
  let pruned = 0;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) { store.delete(key); pruned++; }
  }
  if (pruned > 0) log.info(`Rate limiter: purgadas ${pruned} entradas expiradas`);
}, 10 * 60 * 1000).unref(); // .unref() para no bloquear el proceso al cerrar

/**
 * Middleware de rate limiting por IP.
 *
 * @param {object} options
 * @param {number} options.max          - Peticiones máximas en la ventana (default: 30)
 * @param {number} options.windowMs     - Tamaño de la ventana en ms (default: 1h)
 * @param {string} [options.keyPrefix]  - Prefijo para separar límites por ruta
 * @param {string} [options.message]    - Mensaje de error personalizado
 */
function rateLimit({ max = 30, windowMs = 60 * 60 * 1000, keyPrefix = '', message } = {}) {
  return (req, res, next) => {
    // No limitar a admin
    if (req.isAdmin) return next();

    const ip  = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      // Primera petición o ventana expirada — resetear
      entry = { count: 1, resetAt: now + windowMs };
      store.set(key, entry);
      return next();
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      log.warn(`Rate limit exceeded: ${ip} on ${keyPrefix || 'default'} (${entry.count}/${max})`);
      res.set('Retry-After', retryAfterSec);
      res.set('X-RateLimit-Limit', max);
      res.set('X-RateLimit-Remaining', 0);
      res.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
      return res.status(429).json({
        error: message || `Demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(retryAfterSec / 60)} minutos.`,
        retryAfter: retryAfterSec,
      });
    }

    res.set('X-RateLimit-Limit', max);
    res.set('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    res.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));
    next();
  };
}

/**
 * Rate limiter combinado para el demo completo.
 * Aplica límite global por IP además del límite por endpoint.
 * Evita que alguien use STT + chat + TTS para saltarse los límites individuales.
 */
const demoGlobalLimiter = rateLimit({
  max:       60,
  windowMs:  60 * 60 * 1000, // 1 hora
  keyPrefix: 'demo:global',
  message:   'Has superado el límite del demo (60 peticiones/hora). Vuelve más tarde o contacta con NodeFlow.',
});

const demoSttLimiter = rateLimit({
  max:       15,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:stt',
  message:   'Límite de transcripciones alcanzado (15/hora). Vuelve más tarde.',
});

const demoChatLimiter = rateLimit({
  max:       30,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:chat',
  message:   'Límite de mensajes de chat alcanzado (30/hora). Vuelve más tarde.',
});

const demoTtsLimiter = rateLimit({
  max:       30,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:tts',
  message:   'Límite de síntesis de voz alcanzado (30/hora). Vuelve más tarde.',
});

module.exports = { rateLimit, demoGlobalLimiter, demoSttLimiter, demoChatLimiter, demoTtsLimiter };
