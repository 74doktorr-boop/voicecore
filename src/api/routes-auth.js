// src/api/routes-auth.js
// ─────────────────────────────────────────────
// NodeFlow — Magic Link Auth (no external deps)
// ─────────────────────────────────────────────
const crypto = require('crypto');
const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const rateStore = require('../utils/rate-store');

const log = new Logger('AUTH');

// ── In-memory token store (fallback when Supabase is unavailable) ──────────
const _tokens = new Map(); // token → { email, registroId, expiresAt, usedCount }

const TOKEN_TTL_MS   = 7   * 24 * 60 * 60 * 1000; // 7 días — coincide con lo que dice el email; 30d era demasiado para un enlace de acceso (auditoría 20/07)
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 año — la sesión no se cae; reentrada = un email

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

// ── Password auth (opcional; complementa el enlace mágico) ──────────────────
// Hash scrypt salteado (crypto nativo, sin dependencias). Se guarda en
// organizations.automation_config.auth = { salt, hash } (NO se expone en GET config).
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const h = Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex'));
  const stored = Buffer.from(hash);
  return h.length === stored.length && crypto.timingSafeEqual(h, stored);
}
async function findActiveOrgByEmail(email) {
  const db = getDatabase();
  if (!db.enabled) return null;
  try {
    const { data } = await db.client.from('organizations')
      .select('id, owner_email, automation_config')
      .eq('owner_email', String(email).trim().toLowerCase()).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).single();
    return data || null;
  } catch (_) { return null; }
}

// ── Rate limiter: 5 magic link requests per IP per 10 minutes ───────────────
// Vía rate-store compartido (Redis si REDIS_URL → multi-réplica; si no, memoria).
async function requestLinkRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  let count;
  try {
    ({ count } = await rateStore.hit(`authlink:${ip}`, 10 * 60 * 1000));
  } catch (e) {
    return next(); // fail-open
  }
  if (count > 5) {
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

  // POST /api/auth/login  { email, password } — login con contraseña (opcional)
  app.post('/api/auth/login', requestLinkRateLimit, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    try {
      const org  = await findActiveOrgByEmail(email);
      const auth = org && org.automation_config && org.automation_config.auth;
      if (!org || !auth || !auth.hash) {
        return res.status(401).json({ error: 'No hay contraseña para esta cuenta. Entra con el enlace de acceso y créala.' });
      }
      if (!verifyPassword(password, auth.salt, auth.hash)) {
        return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
      }
      const sessionToken = createSessionToken({ email: org.owner_email });
      log.info(`Sesión (password) creada para ${org.owner_email}`);
      res.json({ session_token: sessionToken, email: org.owner_email });
    } catch (e) {
      log.error(`Auth login error: ${e.message}`);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // POST /api/auth/set-password  { password } — requiere sesión válida (Bearer)
  app.post('/api/auth/set-password', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const tk = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    let session;
    try { session = verifySessionToken(tk); } catch (_) { return res.status(401).json({ error: 'No autorizado' }); }
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
      const org = await findActiveOrgByEmail(session.email);
      if (!org) return res.status(404).json({ error: 'Negocio no encontrado' });
      const { salt, hash } = hashPassword(password);
      const merged = { ...(org.automation_config || {}), auth: { salt, hash, updatedAt: new Date().toISOString() } };
      const { error } = await db.client.from('organizations').update({ automation_config: merged }).eq('id', org.id);
      if (error) throw new Error(error.message);
      log.info(`Password establecida para ${session.email}`);
      res.json({ ok: true });
    } catch (e) {
      log.error(`set-password error: ${e.message}`);
      res.status(500).json({ error: 'No se pudo guardar la contraseña' });
    }
  });
}

module.exports = { setupAuthRoutes, generateMagicToken, verifySessionToken };
