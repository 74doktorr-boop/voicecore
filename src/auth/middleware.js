// ============================================
// VoiceCore — Multi-Tenant Auth Middleware
// API key validation, org resolution, rate limiting
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
// Lazy import to avoid circular dependency at module eval time
function _verifySessionToken(token) {
  return require('../api/routes-auth').verifySessionToken(token);
}

const log = new Logger('AUTH');

// In-memory rate limit store
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute

// Poda periódica de buckets expirados — evita crecimiento indefinido del Map
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimits) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW * 2) rateLimits.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Plan limits keyed by DB `plan` column value. ÚNICO plan comercial: 'negocio'.
// (Starter y Pro retirados 2026-06-30.) `enterprise` = tier interno/custom.
// Orgs legacy con plan 'starter'/'pro' caen a 'negocio' vía `|| PLAN_LIMITS.negocio`.
//
// Modelo de minutos extra ("a cambio de un plus"):
//   - minutesPerMonth   = minutos INCLUIDOS en la cuota.
//   - overage           = true → al pasar de lo incluido NO se cortan las
//                         llamadas; los minutos extra se facturan aparte
//                         (metered billing de Stripe, overagePerMinute en
//                         src/billing/stripe.js). Un asistente que deja de
//                         atender al llegar a la cuota destruiría la propuesta
//                         de valor ("no pierdas ninguna llamada").
//   - hardCapMultiplier = tope de SEGURIDAD (× incluido) donde sí se corta,
//                         para que un bucle/abuso no dispare el coste. Avisa
//                         antes de llegar (banda de overage).
const PLAN_LIMITS = {
  negocio:    { minutesPerMonth: 500,   assistants: 999, callsPerMinute: 20,  concurrentCalls: 3,   overage: true,  hardCapMultiplier: 3 },
  enterprise: { minutesPerMonth: 99999, assistants: 999, callsPerMinute: 200, concurrentCalls: 100, overage: true,  hardCapMultiplier: 10 },
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
  // NOTA: query param eliminado deliberadamente — las keys en URL
  // acaban en access logs del proxy y en el historial del navegador.
  return null;
}

/**
 * Multi-tenant auth middleware
 * Resolves org from API key and attaches to req.org
 */
function requireAuth(config = {}) {
  const db = getDatabase();
  const legacyApiKey = config.apiKey || process.env.API_KEY;
  if (!legacyApiKey) throw new Error('API_KEY no configurada — el servidor no puede arrancar sin ella');

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

    // Multi-tenant: resolve from DB by API key
    if (db.enabled) {
      try {
        const org = await db.getOrgByApiKey(apiKey);
        if (org) {
          if (!org.is_active) {
            return res.status(403).json({ error: 'Organization is suspended' });
          }
          req.org = org;
          return next();
        }
        // API key not found — try as a portal session JWT (allows /api/billing/* from portal)
        try {
          const session = _verifySessionToken(apiKey);
          // Load org by email, including billing fields
          const { data: orgRow } = await db.client
            .from('organizations')
            .select('id, name, owner_email, phone, plan, is_active, api_key, monthly_minutes_used, stripe_customer_id, stripe_subscription_id, registered_at, created_at')
            .eq('owner_email', session.email.toLowerCase())
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (orgRow) {
            req.org = {
              id:                       orgRow.id,
              name:                     orgRow.name,
              owner_email:              orgRow.owner_email,
              phone:                    orgRow.phone,
              plan:                     orgRow.plan || 'negocio',
              is_active:                orgRow.is_active,
              api_key:                  orgRow.api_key,
              monthly_minutes_used:     parseFloat(orgRow.monthly_minutes_used) || 0,
              stripe_customer_id:       orgRow.stripe_customer_id || null,
              stripe_subscription_id:   orgRow.stripe_subscription_id || null,
            };
            return next();
          }
        } catch (_jwtErr) {
          // Not a valid session JWT — fall through to 401
        }
        return res.status(401).json({ error: 'Invalid API key' });
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

    const limits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.negocio;
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

    const limits   = PLAN_LIMITS[org.plan] || PLAN_LIMITS.negocio;
    const included = limits.minutesPerMonth;
    const used     = org.monthly_minutes_used || 0;

    // Tope de seguridad: planes con overage permiten hasta hardCapMultiplier×
    // lo incluido antes de cortar de verdad (evita fuga de coste). Sin overage
    // (trial), el tope es lo incluido → corte duro.
    const hardCap = limits.overage ? included * (limits.hardCapMultiplier || 3) : included;

    if (used >= hardCap) {
      return res.status(402).json({
        error: limits.overage ? 'Safety usage cap reached' : 'Monthly usage limit reached',
        used,
        limit: included,
        hardCap,
        plan: org.plan,
        upgrade: 'Contact us to raise your limit',
      });
    }

    // Banda de overage: por encima de lo incluido pero por debajo del tope.
    // NO se corta — se marca para facturar los minutos extra y se informa por
    // cabeceras para que el portal pueda avisar al cliente.
    if (used >= included && limits.overage) {
      req.overage = true;
      res.set('X-NodeFlow-Overage', 'true');
      res.set('X-NodeFlow-Minutes-Used', String(used));
      res.set('X-NodeFlow-Minutes-Included', String(included));
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
