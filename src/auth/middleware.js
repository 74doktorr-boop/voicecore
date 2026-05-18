// ============================================
// VoiceCore — Multi-Tenant Auth Middleware
// API key validation, org resolution, rate limiting
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');

const log = new Logger('AUTH');

// In-memory rate limit store
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute

const PLAN_LIMITS = {
  starter:    { minutesPerMonth: 50,   assistants: 1,  callsPerMinute: 5,  concurrentCalls: 1 },
  pro:        { minutesPerMonth: 500,  assistants: 5,  callsPerMinute: 20, concurrentCalls: 5 },
  business:   { minutesPerMonth: 2000, assistants: 20, callsPerMinute: 50, concurrentCalls: 20 },
  enterprise: { minutesPerMonth: 99999, assistants: 999, callsPerMinute: 200, concurrentCalls: 100 },
};

/**
 * Resolve organization from API key
 * Supports: x-api-key header, Authorization Bearer, query param
 */
function resolveApiKey(req) {
  // Header: x-api-key
  if (req.headers['x-api-key']) return req.headers['x-api-key'];
  // Header: Authorization Bearer
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  // Query param
  if (req.query.apiKey) return req.query.apiKey;
  return null;
}

/**
 * Multi-tenant auth middleware
 * Resolves org from API key and attaches to req.org
 */
function requireAuth(config = {}) {
  const db = getDatabase();
  const legacyApiKey = config.apiKey || process.env.API_KEY || 'voicecore-dev';

  return async (req, res, next) => {
    const apiKey = resolveApiKey(req);

    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key. Use x-api-key header or Authorization Bearer.' });
    }

    // Check legacy single-tenant key first (backward compat)
    if (apiKey === legacyApiKey) {
      req.org = {
        id: 'legacy',
        name: 'VoiceCore Dev',
        plan: 'enterprise',
        api_key: legacyApiKey,
        is_active: true,
        monthly_minutes_limit: 99999,
        monthly_minutes_used: 0,
      };
      return next();
    }

    // Multi-tenant: resolve from DB
    if (db.enabled) {
      try {
        const org = await db.getOrgByApiKey(apiKey);
        if (!org) {
          return res.status(401).json({ error: 'Invalid API key' });
        }
        if (!org.is_active) {
          return res.status(403).json({ error: 'Organization is suspended' });
        }
        req.org = org;
        return next();
      } catch (e) {
        log.error('Auth DB error', { error: e.message });
        return res.status(500).json({ error: 'Authentication service error' });
      }
    }

    // No DB — reject unknown keys
    return res.status(401).json({ error: 'Invalid API key' });
  };
}

/**
 * Rate limiting middleware
 */
function rateLimit(config = {}) {
  return (req, res, next) => {
    const org = req.org;
    if (!org) return next();

    const limits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.starter;
    const key = `rate:${org.id}`;
    const now = Date.now();

    let bucket = rateLimits.get(key);
    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
      bucket = { windowStart: now, count: 0 };
      rateLimits.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > limits.callsPerMinute) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: limits.callsPerMinute,
        plan: org.plan,
        retryAfter: Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW - now) / 1000),
      });
    }

    // Add rate limit headers
    res.set('X-RateLimit-Limit', String(limits.callsPerMinute));
    res.set('X-RateLimit-Remaining', String(limits.callsPerMinute - bucket.count));
    res.set('X-RateLimit-Reset', String(Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW) / 1000)));

    next();
  };
}

/**
 * Check usage limits middleware
 */
function checkUsageLimits() {
  return (req, res, next) => {
    const org = req.org;
    if (!org) return next();

    const limits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.starter;

    if (org.monthly_minutes_used >= limits.minutesPerMonth) {
      return res.status(402).json({
        error: 'Monthly usage limit reached',
        used: org.monthly_minutes_used,
        limit: limits.minutesPerMonth,
        plan: org.plan,
        upgrade: 'Contact us to upgrade your plan',
      });
    }

    next();
  };
}

/**
 * Optional auth — attaches org if key present but doesn't reject
 */
function optionalAuth(config = {}) {
  const authMiddleware = requireAuth(config);
  return (req, res, next) => {
    const apiKey = resolveApiKey(req);
    if (!apiKey) return next();
    authMiddleware(req, res, next);
  };
}

module.exports = { requireAuth, rateLimit, checkUsageLimits, optionalAuth, PLAN_LIMITS, resolveApiKey };
