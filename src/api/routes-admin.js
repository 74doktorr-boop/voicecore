// ============================================
// NodeFlow — Admin API Routes
// Protegido con DASHBOARD_PASSWORD
// Solo para uso interno de Unai
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');

const log = new Logger('ADMIN');

// Token simple en memoria (se reinicia con el servidor — suficiente para admin privado)
const _validTokens = new Set();

function adminAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '').trim();
  if (!token || !_validTokens.has(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

function setupAdminRoutes(app, config) {
  const PASS = config.dashboardPassword || process.env.DASHBOARD_PASSWORD || 'admin';

  // ─── Auth ───
  app.post('/api/admin/auth', (req, res) => {
    const { password } = req.body;
    if (!password || password !== PASS) {
      log.warn(`Admin login fallido desde ${req.ip}`);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    const token = require('crypto').randomBytes(32).toString('hex');
    _validTokens.add(token);
    // Token expira en 24h
    setTimeout(() => _validTokens.delete(token), 24 * 60 * 60 * 1000);
    log.info(`Admin login OK desde ${req.ip}`);
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

      const { data, error } = await db.client
        .from('organizations')
        .select('id, name, slug, plan, owner_email, owner_name, phone, monthly_minutes_limit, monthly_minutes_used, api_key, stripe_customer_id, is_active, created_at')
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

  log.info('Admin routes configured → /api/admin/*');
}

module.exports = { setupAdminRoutes };
