// ============================================================
// NodeFlow — Rate Limiter por IP (ventana fija).
// Usa el contador compartido src/utils/rate-store: Redis si REDIS_URL
// está definido (seguro con múltiples réplicas en Docker Swarm), si no
// cae a memoria por proceso (válido para una sola instancia).
//
// Uso:
//   const { rateLimit } = require('../utils/rate-limiter');
//   app.post('/api/demo/stt', rateLimit({ max: 20, windowMs: 60*60*1000 }), handler);
// ============================================================

'use strict';

const { Logger } = require('./logger');
const log = new Logger('RATE-LIMITER');

// Contador compartido: Redis si REDIS_URL (multi-réplica), si no memoria.
const rateStore = require('./rate-store');

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
  return async (req, res, next) => {
    // No limitar a admin
    if (req.isAdmin) return next();

    const ip  = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `rl:${keyPrefix ? keyPrefix + ':' : ''}${ip}`;

    let count, resetAt;
    try {
      ({ count, resetAt } = await rateStore.hit(key, windowMs));
    } catch (e) {
      return next(); // fail-open: si el store falla, no bloqueamos
    }

    res.set('X-RateLimit-Limit', max);
    res.set('X-RateLimit-Remaining', Math.max(0, max - count));
    res.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (count > max) {
      const retryAfterSec = Math.ceil((resetAt - Date.now()) / 1000);
      log.warn(`Rate limit exceeded: ${ip} on ${keyPrefix || 'default'} (${count}/${max})`);
      res.set('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: message || `Demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(retryAfterSec / 60)} minutos.`,
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}

/**
 * Rate limiter combinado para el demo completo.
 * Aplica límite global por IP además del límite por endpoint.
 * Evita que alguien use STT + chat + TTS para saltarse los límites individuales.
 */
// Límites GENEROSOS: el demo se usa en reuniones de venta en directo (muchos
// clics seguidos). Solo cortan ante abuso real (un bot martilleando), no el uso
// comercial normal.
const demoGlobalLimiter = rateLimit({
  max:       600,
  windowMs:  60 * 60 * 1000, // 1 hora
  keyPrefix: 'demo:global',
  message:   'Has superado el límite del demo. Vuelve en un rato o contacta con NodeFlow.',
});

const demoSttLimiter = rateLimit({
  max:       200,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:stt',
  message:   'Límite de transcripciones alcanzado. Vuelve más tarde.',
});

const demoChatLimiter = rateLimit({
  max:       300,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:chat',
  message:   'Límite de mensajes alcanzado. Vuelve más tarde.',
});

const demoTtsLimiter = rateLimit({
  max:       300,
  windowMs:  60 * 60 * 1000,
  keyPrefix: 'demo:tts',
  message:   'Límite de síntesis de voz alcanzado. Vuelve más tarde.',
});

module.exports = { rateLimit, demoGlobalLimiter, demoSttLimiter, demoChatLimiter, demoTtsLimiter };
