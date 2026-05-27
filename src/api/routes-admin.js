// ============================================
// NodeFlow — Admin API Routes
// Protegido con DASHBOARD_PASSWORD
// Solo para uso interno de Unai
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const { verifySessionToken } = require('./routes-auth');

const log = new Logger('ADMIN');

// Token simple en memoria (se reinicia con el servidor — suficiente para admin privado)
const _validTokens = new Set();

// Brute-force protection: max 10 failed attempts per IP per 15 min
const _loginAttempts = new Map();
function isLoginBlocked(ip) {
  const entry = _loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.start > 15 * 60 * 1000) { _loginAttempts.delete(ip); return false; }
  return entry.count >= 10;
}
function recordFailedLogin(ip) {
  const entry = _loginAttempts.get(ip) || { start: Date.now(), count: 0 };
  entry.count++;
  _loginAttempts.set(ip, entry);
}

function adminAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token || !_validTokens.has(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function setupAdminRoutes(app, config, assistantManager) {
  const PASS = config.dashboardPassword || process.env.DASHBOARD_PASSWORD;

  // BUG-25 FIX: Fail loudly if admin password not configured — never silently fall back to 'admin'
  if (!PASS) {
    log.error('⚠️  DASHBOARD_PASSWORD no configurado — panel de admin desactivado por seguridad');
  }

  // ─── Auth (with brute-force protection) ───
  app.post('/api/admin/auth', (req, res) => {
    // BUG-25: Reject all logins if password not configured
    if (!PASS) {
      return res.status(503).json({ error: 'Panel de admin no disponible — configura DASHBOARD_PASSWORD en el servidor' });
    }
    const ip = req.ip;
    if (isLoginBlocked(ip)) {
      log.warn(`Admin login bloqueado por brute-force: ${ip}`);
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
    }
    const { password } = req.body;
    if (!password || password !== PASS) {
      recordFailedLogin(ip);
      log.warn(`Admin login fallido desde ${ip} (intento ${(_loginAttempts.get(ip)||{count:1}).count})`);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    _loginAttempts.delete(ip); // Reset on success
    const token = require('crypto').randomBytes(32).toString('hex');
    _validTokens.add(token);
    // Token expira en 24h
    setTimeout(() => _validTokens.delete(token), 24 * 60 * 60 * 1000);
    log.info(`Admin login OK desde ${ip}`);
    res.json({ token });
  });

  // ─── Stats ───
  app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.json({ totalLeads: 0, totalOrgs: 0, mrr: 0, totalMinutes: 0 });

      const [regRes, orgsRes] = await Promise.all([
        db.client.from('registros').select('id, status, plan, created_at', { count: 'exact' }),
        db.client.from('organizations').select('id, plan, monthly_minutes_used, is_active', { count: 'exact' }),
      ]);

      const orgs     = orgsRes.data || [];
      const activeOrgs = orgs.filter(o => o.is_active);
      const mrr = activeOrgs.reduce((sum, o) => {
        return sum + (o.plan === 'pro' ? 49 : o.plan === 'business' ? 99 : 0);
      }, 0);
      const totalMinutes = orgs.reduce((sum, o) => sum + parseFloat(o.monthly_minutes_used || 0), 0);

      res.json({
        totalLeads:   regRes.count  || 0,
        activeLeads:  (regRes.data||[]).filter(r => r.status === 'active').length,
        totalOrgs:    orgsRes.count || 0,
        activeOrgs:   activeOrgs.length,
        mrr,
        totalMinutes: totalMinutes.toFixed(1),
      });
    } catch (e) {
      log.error('Admin stats error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Registros (leads) ───
  app.get('/api/admin/registros', adminAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.json({ registros: [] });

      const { data, error } = await db.client
        .from('registros')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw new Error(error.message);
      res.json({ registros: data || [] });
    } catch (e) {
      log.error('Admin registros error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Orgs (clientes pagados) ───
  app.get('/api/admin/orgs', adminAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.json({ orgs: [] });

      // BUG-28 FIX: Don't expose api_key in the listing — it's a secret credential.
      // Use the individual /api/admin/orgs/:id endpoint to view a specific org's key.
      const { data, error } = await db.client
        .from('organizations')
        .select('id, name, slug, plan, owner_email, owner_name, phone, monthly_minutes_limit, monthly_minutes_used, stripe_customer_id, is_active, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw new Error(error.message);
      res.json({ orgs: data || [] });
    } catch (e) {
      log.error('Admin orgs error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Detalle de un org ───
  app.get('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data } = await db.client
        .from('organizations').select('*').eq('id', req.params.id).single();
      if (!data) return res.status(404).json({ error: 'No encontrado' });
      res.json({ org: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Reload assistants en caliente (sin redeploy) ───
  // Acepta: token de admin (dashboard) o x-api-key legacy
  app.post('/api/admin/reload', async (req, res) => {
    // Auth: admin token o API key legacy
    const header   = req.headers['authorization'] || '';
    const token    = header.replace('Bearer ', '').trim();
    const apiKey   = req.headers['x-api-key'] || req.query.apiKey || '';
    const legacyKey = config.apiKey || process.env.API_KEY || 'voicecore-dev';

    const isAdminToken = token && _validTokens.has(token);
    const isLegacyKey  = apiKey && apiKey === legacyKey;

    if (!isAdminToken && !isLegacyKey) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (!assistantManager) {
      return res.status(500).json({ error: 'AssistantManager no disponible' });
    }

    try {
      const before = assistantManager.list().length;
      assistantManager.loadAll();
      const after  = assistantManager.list().length;
      const list   = assistantManager.list().map(a => ({ id: a.id, name: a.name }));

      log.info(`Reload: ${before} → ${after} asistentes`);
      res.json({ success: true, before, after, assistants: list });
    } catch (e) {
      log.error('Reload error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Portal: GET /api/portal/me (auth by API key or session JWT) ─────────────
  app.get('/api/portal/me', async (req, res) => {
    const header = req.headers['authorization'] || '';
    const token  = header.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Autenticación requerida' });

    const db = getDatabase();

    // Try session JWT first (magic link auth)
    let sessionEmail = null;
    try {
      const payload = verifySessionToken(token);
      sessionEmail = payload.email;
    } catch (_) {
      // Not a JWT — fall through to API key check
    }

    if (!db.enabled) {
      if (token === (config.apiKey || 'voicecore-dev') || sessionEmail === 'dev@nodeflow.es') {
        return res.json({ id: 'dev-org', name: 'Dev Org', plan: 'starter', owner_email: 'dev@nodeflow.es' });
      }
      return res.status(401).json({ error: 'No autorizado' });
    }

    try {
      let org = null;
      if (sessionEmail) {
        // Look up org by owner email (magic link session)
        const { data } = await db.client
          .from('organizations')
          .select('*')
          .eq('owner_email', sessionEmail.trim().toLowerCase())
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        org = data;
      } else {
        org = await db.getOrgByApiKey(token);
      }

      if (!org) return res.status(401).json({ error: sessionEmail ? 'Cuenta no encontrada' : 'API Key inválida' });

      res.json({
        id:              org.id,
        name:            org.name,
        slug:            org.slug,
        plan:            org.plan,
        owner_email:     org.owner_email,
        owner_name:      org.owner_name,
        phone:           org.phone,
        monthly_minutes_limit: org.monthly_minutes_limit,
        monthly_minutes_used:  org.monthly_minutes_used,
        google_calendar_id:    org.google_calendar_id,
        google_refresh_token:  !!org.google_refresh_token,
        created_at:      org.created_at,
      });
    } catch (e) {
      log.error('Portal /me error', { error: e.message });
      res.status(500).json({ error: 'Error interno' });
    }
  });

  log.info('Admin routes configured → /api/admin/*');
}

// Export adminAuth so routes-flows and routes-automations can reuse it
// (they share the same _validTokens set — admin login activates all protected routes)
module.exports = { setupAdminRoutes, adminAuth };
