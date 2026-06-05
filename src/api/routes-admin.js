// ============================================
// NodeFlow — Admin API Routes
// Protegido con DASHBOARD_PASSWORD
// Solo para uso interno de Unai
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const { verifySessionToken, generateMagicToken } = require('./routes-auth');
const { getAnalytics } = require('../analytics/engine');
const { sendMagicLinkEmail, sendActivacion } = require('../notifications/email');

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
      if (!db.enabled) return res.json({ totalLeads: 0, totalOrgs: 0, mrr: 0, totalMinutes: 0, leadsThisMonth: 0, callsToday: 0 });

      const [regRes, orgsRes] = await Promise.all([
        db.client.from('registros').select('id, status, plan, created_at', { count: 'exact' }),
        db.client.from('organizations').select('id, plan, monthly_minutes_used, is_active', { count: 'exact' }),
      ]);

      const orgs       = orgsRes.data || [];
      const regs       = regRes.data  || [];
      const activeOrgs = orgs.filter(o => o.is_active);
      const mrr = activeOrgs.reduce((sum, o) => {
        return sum + (o.plan === 'negocio' ? 49 : o.plan === 'pro' ? 99 : 0);
      }, 0);
      // Only count minutes from active orgs
      const totalMinutes = activeOrgs.reduce((sum, o) => sum + parseFloat(o.monthly_minutes_used || 0), 0);

      // Leads this month
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0);
      const leadsThisMonth = regs.filter(r => new Date(r.created_at) >= firstOfMonth).length;

      // Calls today from analytics engine (in-memory)
      const analytics  = getAnalytics();
      const dashboard  = analytics.getDashboard();
      const callsToday = dashboard.today.calls;

      res.json({
        totalLeads:   regRes.count  || 0,
        activeLeads:  regs.filter(r => r.status === 'active').length,
        totalOrgs:    orgsRes.count || 0,
        activeOrgs:   activeOrgs.length,
        mrr,
        totalMinutes: totalMinutes.toFixed(1),
        leadsThisMonth,
        callsToday,
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

  // ─── Create org manually (without Stripe) ───────────────────────────────────
  app.post('/api/admin/orgs', adminAuth, async (req, res) => {
    const { name, ownerEmail, plan, sector, phone } = req.body;
    if (!name || !ownerEmail || !plan) {
      return res.status(400).json({ error: 'name, ownerEmail y plan son requeridos' });
    }
    if (!['starter', 'negocio', 'pro'].includes(plan)) {
      return res.status(400).json({ error: "plan debe ser 'starter', 'negocio' o 'pro'" });
    }
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data, error } = await db.client
        .from('organizations')
        .insert({
          name,
          slug: `${slug}-${Date.now().toString(36)}`,
          owner_email: ownerEmail.trim().toLowerCase(),
          owner_name:  name,
          phone:       phone || null,
          plan,
          sector:      sector || 'generico',
          is_active:   true,
          status:      'active',
          assistant_config: {},
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      log.info(`Org created manually: ${data.id} (${name})`);
      res.json({ org: data });
    } catch (e) {
      log.error(`POST /api/admin/orgs error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Delete org ──────────────────────────────────────────────────────────────
  app.delete('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    const db = getDatabase();
    try {
      // Soft-delete: set is_active=false, status='deleted'
      await db.client
        .from('organizations')
        .update({ is_active: false, status: 'deleted' })
        .eq('id', req.params.id);
      log.info(`Org soft-deleted: ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PATCH org fields ──────────────────────────────────────────────────────────
  app.patch('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    const { name, plan, sector, phone, status, outboundNumber } = req.body;
    const db = getDatabase();
    const patch = {};
    if (name   !== undefined) patch.name   = name;
    if (plan   !== undefined) {
      if (!['starter','negocio','pro'].includes(plan)) return res.status(400).json({ error: 'plan inválido' });
      patch.plan = plan;
      // Keep monthly_minutes_limit in sync with plan when admin changes plan manually
      patch.monthly_minutes_limit = plan === 'negocio' ? 500 : plan === 'pro' ? 2000 : 50;
    }
    if (sector !== undefined) patch.sector = sector;
    if (phone  !== undefined) patch.phone  = phone;
    if (status !== undefined) patch.status = status;
    // outboundNumber: the Twilio/Vonage number assigned to this org for outbound calls
    // Stored inside automation_config.outboundNumber (JSONB merge)
    if (outboundNumber !== undefined) {
      try {
        const { data: existing } = await db.client
          .from('organizations').select('automation_config').eq('id', req.params.id).single();
        const merged = { ...(existing?.automation_config || {}), config: { ...((existing?.automation_config || {}).config || {}), outboundNumber: outboundNumber || null } };
        patch.automation_config = merged;
      } catch (_) { /* non-fatal — fall through */ }
    }
    try {
      await db.client.from('organizations').update(patch).eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Send magic link to org owner ────────────────────────────────────────────
  app.post('/api/admin/send-magic-link', adminAuth, async (req, res) => {
    try {
      const { orgId } = req.body;
      if (!orgId) return res.status(400).json({ error: 'orgId requerido' });

      const db = getDatabase();
      const { data: org } = await db.client
        .from('organizations').select('id, owner_email, name').eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

      const token = await generateMagicToken(org.owner_email, orgId);
      await sendMagicLinkEmail(org.owner_email, token);

      log.info(`Magic link enviado a ${org.owner_email} para org ${orgId}`);
      res.json({ ok: true, sentTo: org.owner_email });
    } catch (e) {
      log.error('send-magic-link error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Activar cliente: asignar número + enviar email con guía de desvío ────────
  app.post('/api/admin/activar-cliente', adminAuth, async (req, res) => {
    try {
      const { orgId, numeroNodeflow } = req.body;
      if (!orgId)          return res.status(400).json({ error: 'orgId requerido' });
      if (!numeroNodeflow) return res.status(400).json({ error: 'numeroNodeflow requerido' });

      const db = getDatabase();
      const { data: org } = await db.client
        .from('organizations')
        .select('id, owner_email, owner_name, name, plan, sector, phone, automation_config')
        .eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

      // 1. Guardar el número NodeFlow en la org
      const merged = {
        ...(org.automation_config || {}),
        config: { ...((org.automation_config || {}).config || {}), nodeflowNumber: numeroNodeflow },
      };
      await db.client.from('organizations')
        .update({ automation_config: merged, is_active: true })
        .eq('id', orgId);

      // 2. Enviar email de activación con guía de desvío
      const registro = {
        email:    org.owner_email,
        contacto: org.owner_name || org.name,
        negocio:  org.name,
        plan:     org.plan,
        sector:   org.sector,
      };
      await sendActivacion(registro, numeroNodeflow);

      log.info(`Cliente activado: ${org.name} → ${numeroNodeflow}`);
      res.json({ ok: true, org: org.name, numero: numeroNodeflow, emailSentTo: org.owner_email });
    } catch (e) {
      log.error('activar-cliente error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Calls analytics dashboard ───────────────────────────────────────────────
  app.get('/api/admin/calls', adminAuth, (req, res) => {
    try {
      const analytics = getAnalytics();
      res.json(analytics.getDashboard());
    } catch (e) {
      log.error('Admin calls error', { error: e.message });
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
    const legacyKey = config.apiKey || process.env.API_KEY;
    if (!legacyKey) return res.status(500).json({ error: 'API_KEY no configurada en el servidor' });

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
      // Sin BD activa: solo permite la API key de producción, nunca un fallback hardcodeado
      const prodKey = config.apiKey || process.env.API_KEY;
      if (prodKey && token === prodKey) {
        return res.json({ id: 'dev-org', name: 'Dev Org', plan: 'starter', owner_email: 'unai@nodeflow.es' });
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
          .eq('is_active', true)
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
function isAdminToken(token) {
  return !!(token && _validTokens.has(token));
}

module.exports = { setupAdminRoutes, adminAuth, isAdminToken };
