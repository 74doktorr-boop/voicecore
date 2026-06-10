// src/api/routes-auth.js
// ─────────────────────────────────────────────
// NodeFlow — Magic Link Auth (no external deps)
// ─────────────────────────────────────────────
const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');

const log = new Logger('AUTH');

// ── In-memory token store (fallback when Supabase is unavailable) ──────────
const _tokens = new Map(); // token → { email, registroId, expiresAt, usedCount }

const TOKEN_TTL_MS   = 7  * 24 * 60 * 60 * 1000; // 7 days
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── JWT helpers (HMAC-SHA256, no external library) ─────────────────────────
function jwtSecret() {
  const s = process.env.JWT_SECRET || process.env.API_KEY;
  if (!s) {
    // Hardcoded fallback would allow anyone with source access to forge tokens.
    // Fail loudly so ops notices immediately.
    log.error('⚠️  JWT_SECRET (and API_KEY) not configured — session tokens cannot be issued securely. Set JWT_SECRET in environment.');
    throw new Error('JWT_SECRET not configured');
  }
  return s;
}

function createSessionToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const sig    = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') throw new Error('No token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig), expBuf = Buffer.from(expected);
  // timingSafeEqual exige longitudes iguales — un sig de otra longitud es inválido directamente
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) throw new Error('Invalid signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) throw new Error('Token expired');
  return payload;
}

// ── Magic token CRUD ────────────────────────────────────────────────────────
async function saveMagicToken({ token, email, registroId }) {
  const record = { token, email, registroId, expiresAt: Date.now() + TOKEN_TTL_MS, usedCount: 0 };
  _tokens.set(token, record);

  const db = getDatabase();
  if (db.enabled) {
    try {
      await db.client.from('magic_tokens').upsert({
        token, email, registro_id: registroId,
        expires_at: new Date(record.expiresAt).toISOString(),
        used_count: 0,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      log.warn(`Supabase magic_token save failed: ${e.message}`);
    }
  }
  return record;
}

async function getMagicToken(token) {
  // Memory first
  if (_tokens.has(token)) return _tokens.get(token);

  const db = getDatabase();
  if (db.enabled) {
    try {
      const { data } = await db.client
        .from('magic_tokens').select('*').eq('token', token).single();
      if (data) {
        const record = {
          token: data.token, email: data.email,
          registroId: data.registro_id,
          expiresAt: new Date(data.expires_at).getTime(),
          usedCount: data.used_count || 0,
        };
        _tokens.set(token, record);
        return record;
      }
    } catch (e) {
      log.warn(`Supabase magic_token get failed: ${e.message}`);
    }
  }
  return null;
}

async function incrementTokenUsage(token) {
  const record = _tokens.get(token);
  if (record) { record.usedCount += 1; _tokens.set(token, record); }
  const db = getDatabase();
  if (db.enabled) {
    try {
      await db.client.from('magic_tokens')
        .update({ used_count: (record?.usedCount || 1) })
        .eq('token', token);
    } catch (_) {}
  }
}

// ── Public export: generate a new magic token ───────────────────────────────
async function generateMagicToken(email, registroId) {
  const token = crypto.randomBytes(32).toString('hex');
  await saveMagicToken({ token, email, registroId });
  log.info(`Magic token generado para ${email}`);
  return token;
}

// ── In-memory rate limiter (no external dep) ────────────────────────────────
// Limits: 5 magic link requests per IP per 10 minutes
const _rlStore = new Map();
function requestLinkRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const window = 10 * 60 * 1000; // 10 min
  let bucket = _rlStore.get(ip);
  if (!bucket || now - bucket.start > window) { bucket = { start: now, count: 0 }; _rlStore.set(ip, bucket); }
  bucket.count++;
  if (bucket.count > 5) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.' });
  }
  next();
}

// ── Route setup ─────────────────────────────────────────────────────────────
function setupAuthRoutes(app) {
  // GET /api/auth/verify?token=xxx
  // Validates a magic link token, returns a 30-day session JWT
  app.get('/api/auth/verify', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token requerido' });

    try {
      const record = await getMagicToken(token);
      if (!record) return res.status(401).json({ error: 'Token inválido' });
      if (record.expiresAt < Date.now()) return res.status(401).json({ error: 'Token expirado. Solicita un nuevo acceso.' });
      // Magic links are single-use: reject if already consumed
      if (record.usedCount >= 1) return res.status(401).json({ error: 'Este enlace ya fue utilizado. Solicita uno nuevo desde el portal.' });

      await incrementTokenUsage(token);

      const sessionToken = createSessionToken({ email: record.email, registroId: record.registroId });
      log.info(`Sesión creada para ${record.email}`);
      res.json({ session_token: sessionToken, email: record.email });
    } catch (e) {
      log.error(`Auth verify error: ${e.message}`);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // POST /api/auth/request-link  { email }
  // Sends a new magic link to the given email (must be a known client)
  app.post('/api/auth/request-link', requestLinkRateLimit, async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const db = getDatabase();
    let registroId = null;
    let isKnownEmail = false;

    if (db.enabled) {
      // 1. Look up the most recent active registro for this email (primary path)
      try {
        const { data } = await db.client
          .from('registros')
          .select('id')
          .eq('email', email.trim().toLowerCase())
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) { registroId = data.id; isKnownEmail = true; }
      } catch (_) {}

      // 2. Fallback: check organizations table (manually onboarded customers)
      if (!isKnownEmail) {
        try {
          const { data: orgRow } = await db.client
            .from('organizations')
            .select('id')
            .eq('owner_email', email.trim().toLowerCase())
            .eq('is_active', true)
            .limit(1)
            .single();
          if (orgRow) isKnownEmail = true;
          // registroId stays null — the session JWT only needs the email
        } catch (_) {}
      }
    }

    // Even if not found, send a neutral response to avoid email enumeration
    if (isKnownEmail) {
      const token = await generateMagicToken(email.trim().toLowerCase(), registroId);
      const { sendMagicLinkEmail } = require('../notifications/email');
      sendMagicLinkEmail(email.trim().toLowerCase(), token).catch(e =>
        log.warn(`Magic link email failed: ${e.message}`)
      );
    }

    // Always respond OK (security: don't reveal if email exists)
    res.json({ ok: true, message: 'Si tu email está registrado, recibirás un enlace en breve.' });
  });

  // GET /api/auth/session  — validate an existing session JWT (used by portal JS)
  app.get('/api/auth/session', (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No session' });
    try {
      const payload = verifySessionToken(token);
      res.json({ valid: true, email: payload.email, registroId: payload.registroId });
    } catch (e) {
      res.status(401).json({ error: e.message });
    }
  });
}

module.exports = { setupAuthRoutes, generateMagicToken, verifySessionToken };
