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
const { recordAudit, ipOf } = require('../audit/audit-log');

const log = new Logger('ADMIN');

// Token simple en memoria (se reinicia con el servidor — suficiente para admin privado)
const _validTokens = new Set();

// Brute-force protection: max 10 intentos fallidos por IP / 15 min.
// Vía rate-store (Redis si REDIS_URL → seguro multi-réplica; si no, memoria).
const rateStore = require('../utils/rate-store');
const ADMIN_FAIL_WINDOW = 15 * 60 * 1000;
const ADMIN_FAIL_MAX = 10;
const _failKey = (ip) => `adminfail:${ip}`;
async function isLoginBlocked(ip) {
  const p = await rateStore.peek(_failKey(ip));
  return !!p && p.count >= ADMIN_FAIL_MAX;
}
function recordFailedLogin(ip) {
  return rateStore.hit(_failKey(ip), ADMIN_FAIL_WINDOW);
}
function resetLoginAttempts(ip) {
  return rateStore.reset(_failKey(ip));
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
  app.post('/api/admin/auth', async (req, res) => {
    // BUG-25: Reject all logins if password not configured
    if (!PASS) {
      return res.status(503).json({ error: 'Panel de admin no disponible — configura DASHBOARD_PASSWORD en el servidor' });
    }
    const ip = req.ip;
    if (await isLoginBlocked(ip)) {
      log.warn(`Admin login bloqueado por brute-force: ${ip}`);
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
    }
    const { password } = req.body;
    // Comparación en tiempo constante (timingSafeEqual sobre hashes de longitud
    // fija) — el `!==` filtraba el password por timing. Auditoría 20/07.
    const _crypto = require('crypto');
    const _hash = (s) => _crypto.createHash('sha256').update(String(s || '')).digest();
    const passOk = !!password && _crypto.timingSafeEqual(_hash(password), _hash(PASS));
    if (!passOk) {
      const { count } = await recordFailedLogin(ip);
      log.warn(`Admin login fallido desde ${ip} (intento ${count})`);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    await resetLoginAttempts(ip); // Reset on success
    const token = require('crypto').randomBytes(32).toString('hex');
    _validTokens.add(token);
    // Token expira en 24h
    setTimeout(() => _validTokens.delete(token), 24 * 60 * 60 * 1000);
    log.info(`Admin login OK desde ${ip}`);
    recordAudit({ action: 'admin_login', targetType: 'admin', ip });
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
        .select('id, name, slug, plan, owner_email, owner_name, phone, monthly_minutes_limit, monthly_minutes_used, stripe_customer_id, is_active, created_at, assistant_config')
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
    if (!['negocio', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: "plan debe ser 'negocio' o 'enterprise'" });
    }
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
      // Reusar la creación canónica: genera api_key (NOT NULL) y usa solo columnas válidas.
      const org = await db.createOrg({
        name,
        slug,
        ownerEmail: ownerEmail.trim().toLowerCase(),
        ownerName:  name,
        plan,
        phone:      phone || null,
      });
      log.info(`Org created manually: ${org.id} (${name})`);
      recordAudit({ action: 'org_create', targetType: 'org', targetId: org.id, ip: ipOf(req), details: { name, plan, sector } });
      res.json({ org });
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
      recordAudit({ action: 'org_delete', targetType: 'org', targetId: req.params.id, ip: ipOf(req) });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── PATCH org fields ──────────────────────────────────────────────────────────
  app.patch('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    const { name, plan, sector, phone, status, outboundNumber, model } = req.body;
    const db = getDatabase();
    const patch = {};
    if (name   !== undefined) patch.name   = name;
    if (plan   !== undefined) {
      if (!['negocio','enterprise'].includes(plan)) return res.status(400).json({ error: 'plan inválido' });
      patch.plan = plan;
      // Keep monthly_minutes_limit in sync with plan when admin changes plan manually
      patch.monthly_minutes_limit = plan === 'enterprise' ? 99999 : 500;
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
    // Brazo del A/B de cerebro: assistant_config.model ('proveedor/modelo').
    // '' / null → Auto (el router elige el más rápido). Merge JSONB + invalida
    // la caché del asistente → el modelo nuevo aplica en la siguiente llamada.
    if (model !== undefined) {
      try {
        const { data: existing } = await db.client
          .from('organizations').select('assistant_config').eq('id', req.params.id).single();
        const ac = { ...(existing?.assistant_config || {}) };
        if (model) ac.model = model; else delete ac.model;
        patch.assistant_config = ac;
      } catch (_) { /* non-fatal */ }
    }
    try {
      await db.client.from('organizations').update(patch).eq('id', req.params.id);
      if (model !== undefined) { try { require('../assistants/org-assistant').invalidateOrgAssistant(req.params.id); } catch (_) {} }
      recordAudit({ action: model !== undefined ? 'ab_model_assign' : plan !== undefined ? 'plan_change' : 'org_update', targetType: 'org', targetId: req.params.id, ip: ipOf(req), details: patch });
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

  // ─── Resetear contraseña del portal de una org ───────────────────────────────
  // Borra automation_config.auth y envía un enlace de acceso: el cliente entra
  // con el enlace y el portal le fuerza a crear contraseña nueva (has_password=false).
  app.post('/api/admin/orgs/:id/reset-password', adminAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data: org } = await db.client
        .from('organizations').select('id, owner_email, name, automation_config').eq('id', req.params.id).single();
      if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

      const merged = { ...(org.automation_config || {}) };
      delete merged.auth;
      const { error } = await db.client.from('organizations')
        .update({ automation_config: merged }).eq('id', org.id);
      if (error) throw new Error(error.message);

      const token = await generateMagicToken(org.owner_email, org.id);
      await sendMagicLinkEmail(org.owner_email, token);

      recordAudit({ action: 'password_reset', targetType: 'org', targetId: org.id, ip: ipOf(req), details: { email: org.owner_email } });
      log.info(`Password reseteada + enlace enviado a ${org.owner_email} (org ${org.id})`);
      res.json({ ok: true, sentTo: org.owner_email });
    } catch (e) {
      log.error('reset-password error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Activar cliente: asignar número + enviar email con guía de desvío ────────
  app.post('/api/admin/activar-cliente', adminAuth, async (req, res) => {
    try {
      const { orgId } = req.body;
      // Formato canónico E.164 sin espacios/guiones — el pool se consulta por
      // match exacto con el To que envía el proveedor (+34843700849).
      const numeroNodeflow = String(req.body.numeroNodeflow || '').replace(/[^\d+]/g, '');
      if (!orgId)          return res.status(400).json({ error: 'orgId requerido' });
      if (!numeroNodeflow) return res.status(400).json({ error: 'numeroNodeflow requerido' });

      const db = getDatabase();
      const { data: org } = await db.client
        .from('organizations')
        .select('id, owner_email, owner_name, name, plan, phone, automation_config, assistant_config')
        .eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

      // 1. Guardar el número NodeFlow en la org
      const merged = {
        ...(org.automation_config || {}),
        config: { ...((org.automation_config || {}).config || {}), nodeflowNumber: numeroNodeflow, outboundNumber: numeroNodeflow },
      };
      await db.client.from('organizations')
        .update({ automation_config: merged, is_active: true })
        .eq('id', orgId);

      // 1b. Registrar número → org en nf_phone_pool (fuente de verdad para resolver
      //     llamada entrante → org; lo usa, p.ej., el RAG en voice-pipeline). Fail-soft.
      try {
        await db.client.from('nf_phone_pool').upsert(
          { phone_number: numeroNodeflow, org_id: orgId, provider: 'manual', status: 'assigned', assigned_at: new Date().toISOString() },
          { onConflict: 'phone_number' }
        );
      } catch (e) {
        log.warn(`activar-cliente: no se pudo registrar el número en nf_phone_pool: ${e.message}`);
      }

      // 1c. Conectar el número al asistente de la org — es lo que enruta la
      //     PERSONA (prompt/voz) en llamadas entrantes vía getByPhoneNumber.
      try {
        const a = assistantManager && assistantManager.get(orgId);
        if (a) assistantManager.upsert(orgId, { ...a, phoneNumber: numeroNodeflow });
        else log.warn(`activar-cliente: org ${orgId} sin asistente propio — la entrante usará el default`);
      } catch (e) {
        log.warn(`activar-cliente: no se pudo fijar phoneNumber en el asistente: ${e.message}`);
      }

      // 2. Enviar email de activación con guía de desvío
      const registro = {
        email:    org.owner_email,
        contacto: org.owner_name || org.name,
        negocio:  org.name,
        plan:     org.plan,
        sector:   (org.assistant_config && org.assistant_config.sector) || '',
      };
      await sendActivacion(registro, numeroNodeflow);

      log.info(`Cliente activado: ${org.name} → ${numeroNodeflow}`);
      recordAudit({ action: 'client_activate', targetType: 'org', targetId: org.id, ip: ipOf(req), details: { org: org.name, numero: numeroNodeflow } });
      res.json({ ok: true, org: org.name, numero: numeroNodeflow, emailSentTo: org.owner_email });
    } catch (e) {
      log.error('activar-cliente error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Depuración STT: audio entrante capturado (requiere STT_DEBUG=1) ─────────
  app.get('/api/admin/stt-debug', adminAuth, (req, res) => {
    const sttDebug = require('../utils/stt-debug');
    res.json({ enabled: sttDebug.enabled(), captures: sttDebug.list() });
  });

  app.post('/api/admin/stt-debug', adminAuth, (req, res) => {
    const sttDebug = require('../utils/stt-debug');
    const enabled = sttDebug.setEnabled(req.body && req.body.enabled);
    res.json({ enabled });
  });

  app.get('/api/admin/stt-debug/:callId', adminAuth, (req, res) => {
    const sttDebug = require('../utils/stt-debug');
    const file = sttDebug.getPath(req.params.callId);
    if (!file) return res.status(404).json({ error: 'Captura no encontrada' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.callId}.ulaw"`);
    require('fs').createReadStream(file).pipe(res);
  });

  // ─── Ciclo de mejora continua bajo demanda (el cron lo corre los lunes) ─────
  app.post('/api/admin/improvement-cycle', adminAuth, async (req, res) => {
    try {
      const { runImprovementCycle } = require('../lifecycle/improvement-aggregator');
      const summary = await runImprovementCycle();
      res.json({ ok: true, ...summary });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Salud por cliente: qué negocios necesitan atención AHORA (roto/silencio).
  // GET = ver el estado (dashboard); ?send=1 fuerza el email de aviso.
  app.get('/api/admin/client-health', adminAuth, async (req, res) => {
    try {
      const { runClientHealthCheck } = require('../monitoring/client-health');
      const summary = await runClientHealthCheck({ dryRun: req.query.send !== '1' });
      res.json({ ok: true, ...summary });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Reglas aprendidas: APROBAR → APLICAR (cierra el bucle de mejora) ────────
  // El bucle detecta patrones y los persiste como candidatas; el fundador las
  // revisa aquí, puede PROBARLAS (replay de llamadas reales) y aprobar/rechazar.
  // Solo las 'active' se inyectan en el prompt del sector. Nunca auto-mutación.
  app.get('/api/admin/learned-rules', adminAuth, async (req, res) => {
    try {
      const { listRules } = require('../lifecycle/learned-rules');
      const rules = await listRules({ status: req.query.status || null, sector: req.query.sector || null });
      res.json({ ok: true, rules });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // action: approve (→ se aplica) | reject | replay (prueba, no cambia estado).
  app.post('/api/admin/learned-rules/:id/:action', adminAuth, async (req, res) => {
    const { id, action } = req.params;
    try {
      const LR = require('../lifecycle/learned-rules');
      if (action === 'approve') {
        const r = await LR.setStatus(id, 'active');
        return res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, applied: true } : r);
      }
      if (action === 'reject') {
        const r = await LR.setStatus(id, 'rejected');
        return res.status(r.ok ? 200 : 400).json(r);
      }
      if (action === 'replay') {
        const rule = await LR.getRule(id);
        if (!rule) return res.status(404).json({ error: 'Regla no encontrada' });
        if (!process.env.OPENAI_API_KEY) return res.json({ ok: false, error: 'Replay no disponible: falta OPENAI_API_KEY' });
        const db = getDatabase();
        if (!db.enabled) return res.json({ ok: false, error: 'Sin BD' });
        const secArg = rule.sector === 'global' ? null : rule.sector;
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const { data: calls } = await db.client.from('nf_calls')
          .select('id, transcript, metrics, started_at').gte('started_at', since).not('metrics', 'is', null).limit(60);
        const { generatePrompt } = require('../assistants/prompt-generator');
        const base = generatePrompt({ sector: secArg, language: 'es' }, 'tu negocio');
        const candidatePrompt = base + '\n\nMEJORA A PROBAR:\n- ' + rule.text;
        const { runReplayGate } = require('../lifecycle/replay-gate');
        const verdict = await runReplayGate({ candidatePrompt, calls: calls || [], sector: secArg });
        return res.json({ ok: true, ...verdict });
      }
      return res.status(400).json({ error: 'Acción inválida (approve|reject|replay)' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Sectores: auto-borrador + aprobación (escalar sin deploy) ──────────────
  // 1) Pide al LLM un borrador de sector desde una descripción (NO guarda).
  app.post('/api/admin/sectors/draft', adminAuth, async (req, res) => {
    try {
      const { draftSector } = require('../sectors/sector-drafter');
      const def = await draftSector({ label: req.body?.label, description: req.body?.description });
      if (!def) return res.status(422).json({ error: 'No se pudo generar un borrador válido. Da más contexto del negocio.' });
      res.json({ ok: true, draft: def });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // 2) Aprueba un sector (revisado/editado por el fundador) → caché + BD.
  app.post('/api/admin/sectors', adminAuth, async (req, res) => {
    try {
      const { saveSector } = require('../sectors/sector-store');
      const out = await saveSector(getDatabase(), req.body);
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // 3) Cola de revisión: borradores pendientes (los que generó el onboarding).
  app.get('/api/admin/sectors/pending', adminAuth, async (req, res) => {
    try {
      const { listPending } = require('../sectors/sector-store');
      res.json({ ok: true, pending: await listPending(getDatabase()) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // 4) Aprobar / descartar un borrador pendiente por slug.
  app.post('/api/admin/sectors/:slug/approve', adminAuth, async (req, res) => {
    try {
      const { approveSector } = require('../sectors/sector-store');
      const out = await approveSector(getDatabase(), req.params.slug);
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  app.post('/api/admin/sectors/:slug/discard', adminAuth, async (req, res) => {
    try {
      const { discardSector } = require('../sectors/sector-store');
      const out = await discardSector(getDatabase(), req.params.slug);
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
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

  // ─── Explorador GLOBAL de llamadas (nf_calls, persistente) ───────────────────
  // La pestaña Llamadas del admin dejaba de ver nada tras cada deploy (datos en
  // memoria). Esto consulta el registro persistente con filtros: fundamental
  // para auditar transcripciones y QA de llamadas reales sin tocar la BD a mano.
  // GET /api/admin/calls-db?org=&outcome=&direction=&days=7&limit=50&q=aparcamiento
  // `q` busca DENTRO de las transcripciones — la herramienta de QA: encontrar en
  // segundos todas las llamadas donde se habló de X (precios, seguros, lo que sea).
  app.get('/api/admin/calls-db', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ calls: [], total: 0 });
    try {
      const days   = Math.min(parseInt(req.query.days || '7', 10) || 7, 90);
      const limit  = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
      const search = String(req.query.q || '').trim().toLowerCase();
      const since  = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const fields = 'id, org_id, direction, caller_number, status, outcome, started_at, duration_ms, turn_count, metrics, cost, booked_appointment';
      let q = db.client.from('nf_calls')
        // Con búsqueda hace falta el transcript para filtrar; sin ella, ahorramos payload.
        .select(search ? fields + ', transcript' : fields, { count: 'exact' })
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        // PostgREST no filtra substring dentro de jsonb: con búsqueda traemos una
        // ventana amplia y filtramos aquí. Con el volumen actual (<500/rango) va
        // sobrado; si algún día duele, se pasa a una RPC con índice GIN.
        .limit(search ? 500 : limit);
      if (req.query.org)       q = q.eq('org_id', req.query.org);
      if (req.query.outcome)   q = q.eq('outcome', req.query.outcome);
      if (req.query.direction) q = q.eq('direction', req.query.direction);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      let rows = data || [];
      if (search) {
        rows = rows.filter(r => JSON.stringify(r.transcript || []).toLowerCase().includes(search)).slice(0, limit);
        // El transcript completo no viaja en el listado (pesa); el visor lo pide aparte.
        rows = rows.map(({ transcript, ...rest }) => rest);
        return res.json({ calls: rows, total: rows.length, searched: true });
      }
      res.json({ calls: rows, total: count || 0 });
    } catch (e) {
      log.error('Admin calls-db error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Economía por cliente: ingreso vs coste de proveedor → margen ───────────
  // La pregunta de fundador: qué cliente me gana dinero y cuál me lo quema.
  // Ingreso = plan + overage estimado (0,10€/min sobre el límite mensual).
  // Coste = suma de nf_calls.cost.total del periodo (estimación por tarifas
  // por minuto de telefonía+STT+LLM+TTS que graba cada llamada al colgar).
  // GET /api/admin/economics?days=30
  app.get('/api/admin/economics', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ clients: [], totals: {} });
    try {
      const days  = Math.min(parseInt(req.query.days || '30', 10) || 30, 90);
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const { PLAN_PRICES } = require('../analytics/kpis');
      const OVERAGE_EUR_MIN = 0.10;

      const [{ data: orgs }, { data: calls }] = await Promise.all([
        db.client.from('organizations')
          .select('id, name, plan, monthly_minutes_used, monthly_minutes_limit, is_active')
          .eq('is_active', true),
        db.client.from('nf_calls')
          .select('org_id, duration_ms, cost')
          .gte('started_at', since),
      ]);

      const byOrg = {};
      for (const c of (calls || [])) {
        if (!c.org_id) continue;
        const o = (byOrg[c.org_id] = byOrg[c.org_id] || { calls: 0, minutes: 0, providerCost: 0 });
        o.calls++;
        o.minutes += (c.duration_ms || 0) / 60000;
        const t = c.cost && typeof c.cost.total === 'number' ? c.cost.total : 0;
        o.providerCost += t;
      }

      const clients = (orgs || []).map(org => {
        const u = byOrg[org.id] || { calls: 0, minutes: 0, providerCost: 0 };
        const planEur    = PLAN_PRICES[org.plan] || 0;
        const used       = parseFloat(org.monthly_minutes_used || 0);
        const limit      = parseFloat(org.monthly_minutes_limit || 500);
        const overageEur = Math.max(0, used - limit) * OVERAGE_EUR_MIN;
        const revenue    = planEur + overageEur;
        const margin     = revenue - u.providerCost;
        return {
          orgId: org.id, name: org.name, plan: org.plan,
          planEur, overageEur: +overageEur.toFixed(2),
          calls: u.calls, minutes: +u.minutes.toFixed(1),
          providerCost: +u.providerCost.toFixed(2),
          revenue: +revenue.toFixed(2),
          margin: +margin.toFixed(2),
          marginPct: revenue > 0 ? Math.round((margin / revenue) * 100) : (u.providerCost > 0 ? -100 : 0),
        };
      }).sort((a, b) => a.margin - b.margin); // los que queman dinero, primero

      const totals = clients.reduce((t, c) => ({
        revenue: t.revenue + c.revenue, providerCost: t.providerCost + c.providerCost,
        margin: t.margin + c.margin, calls: t.calls + c.calls, minutes: t.minutes + c.minutes,
      }), { revenue: 0, providerCost: 0, margin: 0, calls: 0, minutes: 0 });
      totals.marginPct = totals.revenue > 0 ? Math.round((totals.margin / totals.revenue) * 100) : 0;
      for (const k of ['revenue', 'providerCost', 'margin', 'minutes']) totals[k] = +totals[k].toFixed(2);

      res.json({ clients, totals, days });
    } catch (e) {
      log.error('Admin economics error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // Llamada completa (con transcripción) para el visor del admin.
  app.get('/api/admin/calls-db/:id', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
    try {
      const { data, error } = await db.client.from('nf_calls')
        .select('*').eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ error: 'Llamada no encontrada' });
      res.json({ call: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── KPIs de negocio + analíticas + gestión (derivado de la BD) ──────────────
  app.get('/api/admin/analytics', adminAuth, async (req, res) => {
    try {
      const { computeKpis, timeSeries, hourlyVolume, weekdayHourHeatmap, byOrg, bySector, periodDeltas, mrrTrend } = require('../analytics/kpis');
      const { resolveSector } = require('../sectors/sector-registry');
      const db = getDatabase();
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const DAY = 86400000;
      const midMs = Date.now() - days * DAY;                      // corte actual/anterior
      const prevSinceISO = new Date(Date.now() - 2 * days * DAY).toISOString();

      let allCalls = [], allAppts = [], orgs = [];
      if (db.enabled) {
        const [callsRes, apptRes, orgRes] = await Promise.all([
          db.client.from('nf_calls').select('org_id, outcome, duration_ms, turn_count, started_at, created_at').gte('created_at', prevSinceISO).limit(10000),
          db.client.from('nf_appointments').select('organization_id, status, no_show_notified, reminder_sent, review_requested, date').gte('date', prevSinceISO.slice(0, 10)).limit(10000),
          db.client.from('organizations').select('id, name, plan, is_active, monthly_minutes_used, registered_at, created_at, assistant_config').limit(1000),
        ]);
        allCalls = callsRes.data || [];
        allAppts = apptRes.data || [];
        orgs = orgRes.data || [];
      }

      // Partir en periodo ACTUAL vs ANTERIOR (mismo tamaño) para la comparativa.
      const inCur = (t) => { const x = t ? new Date(t).getTime() : NaN; return !Number.isNaN(x) && x >= midMs; };
      const curCalls  = allCalls.filter(c => inCur(c.created_at || c.started_at));
      const prevCalls = allCalls.filter(c => !inCur(c.created_at || c.started_at));
      const curAppts  = allAppts.filter(a => inCur(a.date));
      const prevAppts = allAppts.filter(a => !inCur(a.date));

      const kpis     = computeKpis({ calls: curCalls, appointments: curAppts, orgs, includedMinutes: 500 });
      const kpisPrev = computeKpis({ calls: prevCalls, appointments: prevAppts, orgs, includedMinutes: 500 });
      const deltas   = periodDeltas(kpis, kpisPrev);
      const series   = timeSeries(curCalls, Math.min(days, 30));
      const hours    = hourlyVolume(curCalls);
      const heatmap  = weekdayHourHeatmap(curCalls);
      const clientes = byOrg({ calls: curCalls, orgs, includedMinutes: 500 });
      // Salud por SECTOR (2026-07-04): cada llamada hereda el sector de su org.
      const orgSector = {};
      for (const o of orgs) orgSector[o.id] = resolveSector(o.assistant_config && o.assistant_config.sector).slug;
      const sectores = bySector({ calls: curCalls, orgSector });
      const funnel   = getAnalytics().getFunnel(days); // en memoria (complementa)
      const trend    = mrrTrend({ orgs, months: 12 }); // crecimiento reconstruido (12 meses)

      res.json({ periodDays: days, kpis, kpisPrev, deltas, series, hours, heatmap, funnel, clientes, sectores, trend });
    } catch (e) {
      log.error('Admin analytics error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── A/B de cerebro (LLM): comparación por modelo/brazo ──────────────────────
  // Deriva el brazo de cada llamada del proveedor de sus turnos (metrics.turns)
  // y compara reservas/calidad/latencia. Veredicto honesto: 'insufficient' hasta
  // que ambos brazos superan el umbral (default 20). La agregación es DETERMINISTA.
  app.get('/api/admin/ab-models', adminAuth, async (req, res) => {
    try {
      const { compareModelArms } = require('../analytics/ab-models');
      const db = getDatabase();
      const days = Math.min(parseInt(req.query.days) || 90, 365);
      const threshold = Math.min(Math.max(parseInt(req.query.threshold) || 20, 1), 500);
      const sinceISO = new Date(Date.now() - days * 86400000).toISOString();
      let calls = [];
      if (db.enabled) {
        const { data } = await db.client.from('nf_calls')
          .select('outcome, metrics, started_at')
          .gte('started_at', sinceISO)
          .limit(20000);
        calls = data || [];
      }
      res.json({ periodDays: days, ...compareModelArms(calls, { threshold }) });
    } catch (e) {
      log.error('Admin ab-models error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Registro de auditoría ───────────────────────────────────────────────────
  app.get('/api/admin/audit', adminAuth, async (req, res) => {
    try {
      const { listAudit } = require('../audit/audit-log');
      const events = await listAudit({ limit: parseInt(req.query.limit) || 150, action: req.query.action || null });
      res.json({ events });
    } catch (e) {
      log.error('Admin audit error', { error: e.message });
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

  // ─── Helper: resolve org from Bearer token (JWT session or API key) ─────────
  // Returns { org, db } on success; calls res.status(401).json and returns null on failure.
  async function resolvePortalOrg(req, res, { selectAll = false } = {}) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) { res.status(401).json({ error: 'Autenticación requerida' }); return null; }

    const db = getDatabase();

    if (!db.enabled) {
      const prodKey = config.apiKey || process.env.API_KEY;
      if (prodKey && token === prodKey) {
        const fakeOrg = { id: 'dev-org', name: 'Dev Org', plan: 'negocio', owner_email: 'unai@nodeflow.es' };
        return { org: fakeOrg, db, token };
      }
      res.status(401).json({ error: 'No autorizado' });
      return null;
    }

    let org = null;
    try {
      const payload = verifySessionToken(token);
      const fields  = selectAll ? '*' : 'id';
      const { data } = await db.client
        .from('organizations')
        .select(fields)
        .eq('owner_email', payload.email.trim().toLowerCase())
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      org = data;
    } catch (_) {
      // Not a valid JWT — try API key
      org = await db.getOrgByApiKey(token);
    }

    if (!org) { res.status(401).json({ error: 'No autorizado' }); return null; }
    return { org, db, token };
  }

  // ─── Portal: GET /api/portal/me (auth by API key or session JWT) ─────────────
  app.get('/api/portal/me', async (req, res) => {
    try {
      const result = await resolvePortalOrg(req, res, { selectAll: true });
      if (!result) return; // already responded with 401

      const { org } = result;
      const automConfig  = org.automation_config || {};
      const customConfig = automConfig.config    || {};
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
        // Número NodeFlow asignado (null = aún pendiente de asignación)
        nodeflow_number: customConfig.nodeflowNumber || customConfig.outboundNumber || null,
        onboarding_complete: !!(customConfig.nodeflowNumber || customConfig.outboundNumber),
        // Si false, el portal fuerza la creación de contraseña en el primer acceso
        has_password: !!(automConfig.auth && automConfig.auth.hash),
      });
    } catch (e) {
      log.error('Portal /me error', { error: e.message });
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ─── Portal: GET /api/portal/calls — lista de llamadas del cliente ──────────
  app.get('/api/portal/calls', async (req, res) => {
    const result = await resolvePortalOrg(req, res);
    if (!result) return;
    const { org, db } = result;
    if (!db.enabled) return res.json({ calls: [], total: 0 });

    try {
      const limit  = Math.min(parseInt(req.query.limit  || '50'), 100);
      const offset = parseInt(req.query.offset || '0');

      const calls = await db.getCalls(org.id, { limit, offset });

      // Devolver sólo los campos que el portal necesita (no exponer métricas internas)
      // BUG FIX: la tabla calls usa columnas directas (outcome, booked_appointment, client_email),
      // no un objeto metrics anidado — c.metrics siempre era undefined.
      const safe = calls.map(c => {
        const durSec = c.duration_ms ? Math.round(c.duration_ms / 1000) : 0;
        const apt    = c.booked_appointment || null;
        return {
          callId:       c.id,
          callSid:      c.call_sid || c.id,
          startedAt:    c.started_at,
          endedAt:      c.ended_at,
          duration:     durSec,
          callerNumber: c.caller_number ? c.caller_number.replace(/(\+\d{2})\d{3,}(\d{3})$/, '$1***$2') : 'Desconocido',
          outcome:      c.outcome || 'unknown',
          booked:       !!(apt || c.outcome === 'booked'),
          turnCount:    c.turn_count || 0,
          transcript:   c.transcript || [],
          appointment:  apt,
          clientEmail:  c.client_email || apt?.email || null,
        };
      });

      res.json({ calls: safe, count: safe.length, total: safe.length, offset });
    } catch (e) {
      log.error('Portal /calls error', { error: e.message });
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ─── Portal: GET /api/portal/calls/:id/transcript ───────────────────────────
  app.get('/api/portal/calls/:id/transcript', async (req, res) => {
    const result = await resolvePortalOrg(req, res);
    if (!result) return;
    const { org, db } = result;
    if (!db.enabled) return res.json({ transcript: [], duration: 0 });

    try {
      // nf_calls: el id del pipeline es la clave única (la tabla legacy
      // "calls" estaba vacía → este endpoint devolvía 404 SIEMPRE)
      const { data: call } = await db.client
        .from('nf_calls').select('id, transcript, duration_ms, turn_count, outcome, booked_appointment, started_at')
        .eq('org_id', org.id)
        .eq('id', req.params.id)
        .single();

      if (!call) return res.status(404).json({ error: 'Llamada no encontrada' });

      res.json({
        callId:     call.id,
        transcript: call.transcript || [],
        duration:   call.duration_ms ? Math.round(call.duration_ms / 1000) : 0,
        turnCount:  call.turn_count || 0,
        outcome:    call.outcome || 'unknown',
        startedAt:  call.started_at,
        appointment: call.booked_appointment || null,
      });
    } catch (e) {
      log.error('Portal /calls/:id/transcript error', { error: e.message });
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ─── WhatsApp — conexión por Meta Cloud API DIRECTO (sin 360dialog) ───────────
  // 360dialog se canceló por coste; el envío ya soporta Meta directo (apiBase=null).
  // Este endpoint permite dar de alta el número (el de la SIM, registrado en Meta
  // Cloud API) pegando las credenciales que da Meta, sin tocar la BD a mano.
  // Body: { businessId, phoneNumberId, accessToken, phoneNumber, wabaId?, displayName? }
  app.post('/api/admin/whatsapp/connect-meta', adminAuth, async (req, res) => {
    const { businessId, phoneNumberId, accessToken, phoneNumber, wabaId, displayName } = req.body || {};
    const missing = ['businessId', 'phoneNumberId', 'accessToken', 'phoneNumber']
      .filter(k => !req.body?.[k]?.toString().trim());
    if (missing.length) {
      return res.status(400).json({ error: `Faltan campos: ${missing.join(', ')}` });
    }
    try {
      const { saveWaCredentials } = require('../whatsapp/accounts');
      await saveWaCredentials(businessId, {
        phoneNumberId: phoneNumberId.toString().trim(),
        accessToken:   accessToken.toString().trim(),
        phoneNumber:   phoneNumber.toString().trim(),
        wabaId:        wabaId ? wabaId.toString().trim() : null,
        displayName:   displayName || null,
        apiBase:       null, // null = Meta Cloud API directo (no 360dialog)
      });
      res.json({ ok: true, businessId, phoneNumber: phoneNumber.toString().trim(), provider: 'meta-cloud-api' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/admin/whatsapp/connect-meta/:businessId — revoca el número
  app.delete('/api/admin/whatsapp/connect-meta/:businessId', adminAuth, async (req, res) => {
    try {
      const { revokeWaCredentials } = require('../whatsapp/accounts');
      await revokeWaCredentials(req.params.businessId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Phone Number Pool ────────────────────────────────────────────────────────
  const { claimNumber, releaseNumber, getPoolStats, addNumber, listNumbers, updateNumber } = require('../telephony/phone-pool');

  // GET /api/admin/phone-pool — lista todos los números con estado
  app.get('/api/admin/phone-pool', adminAuth, async (req, res) => {
    try {
      const [numbers, stats] = await Promise.all([listNumbers(), getPoolStats()]);
      res.json({ stats, numbers });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/phone-pool — añadir número al pool
  // Body: { phoneNumber, provider?, prefix?, notes? }
  app.post('/api/admin/phone-pool', adminAuth, async (req, res) => {
    const { phoneNumber, provider, prefix, notes } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber requerido (E.164, ej: +34943123456)' });
    try {
      const num = await addNumber({ phoneNumber, provider, prefix, notes });
      const stats = await getPoolStats();
      log.info(`Número añadido al pool: ${phoneNumber}`);
      res.status(201).json({ number: num, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/phone-pool/topup — AUTO-COMPRA por Telnyx hasta `target`
  // números disponibles (tope de seguridad interno). Body: { target?: number }.
  app.post('/api/admin/phone-pool/topup', adminAuth, async (req, res) => {
    try {
      const { isConfigured, topUpPool } = require('../telephony/telnyx-provision');
      if (!isConfigured()) {
        return res.status(400).json({ error: 'Auto-provisión no configurada: faltan TELNYX_API_KEY y/o TELNYX_APP_ID en el servidor.' });
      }
      const target = Math.max(1, Math.min(20, Number(req.body?.target) || 3));
      const added = await topUpPool(target);
      const stats = await getPoolStats();
      res.json({ ok: true, added, target, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/admin/phone-pool/:id — cambiar status (available/retired) o notas
  app.patch('/api/admin/phone-pool/:id', adminAuth, async (req, res) => {
    const allowed = ['status', 'notes', 'prefix', 'provider'];
    const patch = {};
    for (const k of allowed) { if (req.body[k] !== undefined) patch[k] = req.body[k]; }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Sin campos a actualizar' });
    if (patch.status && !['available', 'reserved', 'retired'].includes(patch.status)) {
      return res.status(400).json({ error: 'status debe ser available|reserved|retired' });
    }
    try {
      const num = await updateNumber(req.params.id, patch);
      res.json({ number: num });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/phone-pool/:id/release — devolver número asignado al pool
  app.post('/api/admin/phone-pool/:id/release', adminAuth, async (req, res) => {
    const db = getDatabase();
    try {
      const { data: row } = await db.client
        .from('nf_phone_pool').select('org_id').eq('id', req.params.id).single();
      if (!row?.org_id) return res.status(400).json({ error: 'Número no está asignado' });
      await releaseNumber(row.org_id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/phone-pool/assign — asignar número manualmente a una org
  // Body: { orgId, phoneNumber? } — si phoneNumber se omite, auto-asigna del pool
  app.post('/api/admin/phone-pool/assign', adminAuth, async (req, res) => {
    const { orgId, phoneNumber } = req.body;
    if (!orgId) return res.status(400).json({ error: 'orgId requerido' });
    const db = getDatabase();
    try {
      // Formato canónico E.164 sin espacios/guiones (match exacto con el To del proveedor)
      let assigned = phoneNumber ? String(phoneNumber).replace(/[^\d+]/g, '') : null;

      if (!assigned) {
        // Auto-asignar del pool
        assigned = await claimNumber(orgId);
        if (!assigned) return res.status(409).json({ error: 'Pool vacío — añade números antes' });
      } else {
        // Asignar número específico (puede estar en pool o ser nuevo)
        await db.client.from('nf_phone_pool')
          .upsert({ phone_number: assigned, provider: 'manual', status: 'assigned', org_id: orgId, assigned_at: new Date().toISOString() },
            { onConflict: 'phone_number' });
      }

      // Guardar en automation_config de la org
      const { data: org } = await db.client
        .from('organizations').select('automation_config, owner_email, name').eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Org no encontrada' });

      const existingConfig = org.automation_config || {};
      await db.client.from('organizations').update({
        automation_config: {
          ...existingConfig,
          config: { ...(existingConfig.config || {}), nodeflowNumber: assigned, outboundNumber: assigned },
        },
      }).eq('id', orgId);

      // Conectar el número al asistente de la org — es lo que enruta la
      // PERSONA (prompt/voz) en llamadas entrantes vía getByPhoneNumber.
      try {
        const a = assistantManager && assistantManager.get(orgId);
        if (a) assistantManager.upsert(orgId, { ...a, phoneNumber: assigned });
        else log.warn(`phone-pool/assign: org ${orgId} sin asistente propio — la entrante usará el default`);
      } catch (e) {
        log.warn(`phone-pool/assign: no se pudo fijar phoneNumber en el asistente: ${e.message}`);
      }

      log.info(`Número ${assigned} asignado manualmente a org ${orgId}`);
      res.json({ ok: true, phoneNumber: assigned, orgId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Onboarding dashboard ─────────────────────────────────────────────────────
  // GET /api/admin/onboarding — estado de onboarding de todos los registros activos
  app.get('/api/admin/onboarding', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ clients: [] });
    try {
      // Get all active registros
      const { data: registros } = await db.client
        .from('registros')
        .select('id, negocio, email, contacto, plan, sector, telefono, created_at, paid_at, status')
        .eq('status', 'active')
        .order('paid_at', { ascending: false })
        .limit(100);

      if (!registros?.length) return res.json({ clients: [] });

      // Get corresponding orgs (join by owner_email)
      const emails = registros.map(r => r.email);
      const { data: orgs } = await db.client
        .from('organizations')
        .select('id, owner_email, automation_config, is_active, created_at')
        .in('owner_email', emails)
        .eq('is_active', true);

      const orgByEmail = {};
      for (const o of (orgs || [])) orgByEmail[o.owner_email] = o;

      const clients = registros.map(r => {
        const org    = orgByEmail[r.email] || null;
        const config = org?.automation_config?.config || {};
        const hasNumber = !!(config.nodeflowNumber);
        const steps = {
          paid:            !!r.paid_at,
          org_created:     !!org,
          number_assigned: hasNumber,
          activation_sent: hasNumber, // si tiene número, el email se envió automáticamente
        };
        const complete = Object.values(steps).every(Boolean);
        return {
          registroId:  r.id,
          orgId:       org?.id || null,
          negocio:     r.negocio,
          email:       r.email,
          contacto:    r.contacto,
          plan:        r.plan,
          sector:      r.sector,
          paidAt:      r.paid_at,
          phoneNumber: config.nodeflowNumber || null,
          steps,
          complete,
        };
      });

      const pending  = clients.filter(c => !c.complete).length;
      const complete = clients.filter(c => c.complete).length;

      res.json({ clients, summary: { total: clients.length, pending, complete } });
    } catch (e) {
      log.error('Onboarding dashboard error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/test-whatsapp ───────────────────────────────────────────
  // Envía un mensaje WA de prueba al número indicado usando el número de NodeFlow.
  // Body: { phone: "34612345678", message?: "Texto de prueba" }
  app.post('/api/admin/test-whatsapp', adminAuth, async (req, res) => {
    const { sendText, isConfigured } = require('../notifications/client-whatsapp');
    if (!isConfigured()) {
      return res.status(503).json({ error: 'WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN no configurados' });
    }
    const phone = req.body?.phone;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });
    const text = req.body?.message || '✅ Test NodeFlow WhatsApp OK — el número está configurado correctamente.';
    try {
      const result = await sendText(phone, text);
      if (result.ok) {
        log.info(`WA test sent to ${phone} by admin`);
        return res.json({ ok: true, messageId: result.messageId });
      }
      return res.status(502).json({ ok: false, error: result.error });
    } catch (e) {
      log.error(`WA test error: ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/backup ──────────────────────────────────────────────────
  // Lanza un backup manual de Supabase → Storage bucket "backups".
  app.post('/api/admin/backup', adminAuth, async (req, res) => {
    try {
      const { runBackup } = require('../db/backup');
      const result = await runBackup();
      if (!result.ok) return res.status(502).json(result);
      return res.json(result);
    } catch (e) {
      log.error(`Backup manual error: ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/weekly-report ───────────────────────────────────────────
  // Lanza el informe semanal manualmente. Body: { orgId?, dryRun? }
  // dryRun: true → calcula y devuelve los datos sin enviar emails.
  app.post('/api/admin/weekly-report', adminAuth, async (req, res) => {
    try {
      const { sendWeeklyReports } = require('../reports/weekly-report');
      const result = await sendWeeklyReports({
        orgId:  req.body?.orgId  || null,
        dryRun: req.body?.dryRun !== false, // por defecto dryRun=true — envío real requiere {dryRun:false}
      });
      return res.status(result.ok ? 200 : 502).json(result);
    } catch (e) {
      log.error(`Weekly report manual error: ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/attribution ──────────────────────────────────────────────
  // Agrupa los registros por 'source' (de qué landing vinieron) con conteo de
  // altas (leads) y conversiones (pagaron). Para saber qué landing convierte.
  app.get('/api/admin/attribution', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ sources: [] });
    try {
      const { data } = await db.client
        .from('registros')
        .select('source, status, paid_at, plan')
        .order('created_at', { ascending: false })
        .limit(5000);

      const map = {};
      for (const r of (data || [])) {
        const key = r.source || '(directo)';
        if (!map[key]) map[key] = { source: key, leads: 0, paid: 0, mrr: 0 };
        map[key].leads++;
        if (r.paid_at || r.status === 'active') {
          map[key].paid++;
          map[key].mrr += r.plan === 'pro' ? 99 : r.plan === 'negocio' ? 49 : 0;
        }
      }
      const sources = Object.values(map)
        .map(s => ({ ...s, convRate: s.leads > 0 ? Math.round((s.paid / s.leads) * 100) : 0 }))
        .sort((a, b) => b.leads - a.leads);

      res.json({
        sources,
        totals: {
          leads: sources.reduce((s, x) => s + x.leads, 0),
          paid:  sources.reduce((s, x) => s + x.paid, 0),
          mrr:   sources.reduce((s, x) => s + x.mrr, 0),
        },
      });
    } catch (e) {
      log.error(`attribution error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/diagnostics ──────────────────────────────────────────────
  // Vista de "qué está configurado" sin exponer NINGÚN secreto (solo true/false).
  // Útil para saber al instante si el setup (p.ej. WhatsApp) está completo.
  app.get('/api/admin/diagnostics', adminAuth, async (req, res) => {
    const has = (k) => !!(process.env[k] && String(process.env[k]).trim());
    const db = getDatabase();

    const whatsapp = {
      phoneNumberId: has('WA_PHONE_NUMBER_ID'),
      accessToken:   has('WA_ACCESS_TOKEN'),
      webhookVerify: has('WA_WEBHOOK_VERIFY_TOKEN'),
      appSecret:     has('WA_APP_SECRET'),
    };
    whatsapp.ready = whatsapp.phoneNumberId && whatsapp.accessToken;
    whatsapp.secure = whatsapp.ready && whatsapp.appSecret;
    // Salud de ENTREGABILIDAD (auditoría/oportunidades 2026-07-07): Meta
    // puntúa la calidad del número y limita el volumen por tramos — hay que
    // ver la señal ANTES de que un ban nos la enseñe. Check real, no de envs.
    if (whatsapp.ready) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}?fields=quality_rating,messaging_limit_tier,name_status,code_verification_status`, {
          headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(4000),
        });
        const d = await r.json();
        whatsapp.quality = d.quality_rating || null;           // GREEN / YELLOW / RED
        whatsapp.messagingTier = d.messaging_limit_tier || null; // TIER_250, TIER_1K…
        whatsapp.nameStatus = d.name_status || null;
      } catch (_) { whatsapp.quality = 'unreachable'; }
    }

    const groups = {
      database: { enabled: db.enabled, url: has('SUPABASE_URL'), serviceKey: has('SUPABASE_SERVICE_KEY') },
      whatsapp,
      stripe:   { secretKey: has('STRIPE_SECRET_KEY'), webhookSecret: has('STRIPE_WEBHOOK_SECRET'),
                  businessPrice: has('STRIPE_BUSINESS_PRICE_ID'), proPrice: has('STRIPE_PRO_PRICE_ID') },
      email:    { resendKey: has('RESEND_API_KEY'), notifyEmail: has('NOTIFY_EMAIL') },
      auth:     { jwtSecret: has('JWT_SECRET'), dashboardPassword: has('DASHBOARD_PASSWORD'),
                  apiKeyIsDefault: process.env.API_KEY === 'voicecore-dev' },
      voice:    { deepgram: has('DEEPGRAM_API_KEY'), openai: has('OPENAI_API_KEY'),
                  telnyx: has('TELNYX_API_KEY'), twilio: has('TWILIO_ACCOUNT_SID') },
      telephony:{ telnyxApiKey: has('TELNYX_API_KEY'), telnyxAppId: has('TELNYX_APP_ID'),
                  // Auto-provisión de números lista si están las DOS (usa las mismas
                  // que el outbound). regulatoryGroup solo hace falta si Telnyx exige
                  // bundle regulatorio ES; areaCode es opcional (prefiere ese prefijo).
                  numberAutoProvision: has('TELNYX_API_KEY') && has('TELNYX_APP_ID'),
                  regulatoryGroup: has('TELNYX_REQUIREMENT_GROUP_ID'),
                  areaCode: process.env.TELNYX_NUMBER_AREACODE || null,
                  // Check de VERDAD, no de presencia: búsqueda real (solo lectura)
                  // contra Telnyx — una clave caducada daba "todo verde" hasta el
                  // día que un cliente pagaba y la compra fallaba en silencio.
                  apiLive: await (async () => {
                    if (!has('TELNYX_API_KEY')) return false;
                    try {
                      const { findAvailableNumber } = require('../telephony/telnyx-provision');
                      return !!(await findAvailableNumber({}));
                    } catch (_) { return false; }
                  })() },
      redis:    { url: has('REDIS_URL') },
      calendar: { clientId: has('GOOGLE_CLIENT_ID'), clientSecret: has('GOOGLE_CLIENT_SECRET') },
      crypto:   { encryptionKey: has('ENCRYPTION_KEY') },
      ownerAlerts: { callmebot: has('CALLMEBOT_API_KEY'), ownerPhone: has('OWNER_PHONE') },
    };

    // Avisos accionables
    const warnings = [];
    if (groups.auth.apiKeyIsDefault) warnings.push('API_KEY es el valor por defecto "voicecore-dev" — cámbialo (da acceso enterprise).');
    if (whatsapp.ready && !whatsapp.appSecret) warnings.push('WhatsApp activo pero sin WA_APP_SECRET — el webhook no verifica la firma de Meta.');
    if (!groups.stripe.webhookSecret && groups.stripe.secretKey) warnings.push('Stripe sin STRIPE_WEBHOOK_SECRET — los webhooks de pago no se validan.');
    if (!groups.email.resendKey) warnings.push('Sin RESEND_API_KEY — no se envían emails (bienvenida, recordatorios, alertas).');
    if (whatsapp.quality === 'YELLOW' || whatsapp.quality === 'RED') warnings.push(`⚠️ Calidad del número de WhatsApp: ${whatsapp.quality} — Meta puede limitar o bloquear los envíos. Revisa quejas/bajas antes de enviar más volumen.`);
    if (!groups.database.enabled) warnings.push('Base de datos no conectada — funcionando en modo memoria.');
    if (groups.telephony.telnyxApiKey !== groups.telephony.telnyxAppId) warnings.push('Telnyx incompleto: falta TELNYX_API_KEY o TELNYX_APP_ID — sin las DOS no hay salientes ni auto-provisión de números.');
    if (groups.telephony.telnyxApiKey && !groups.telephony.apiLive) warnings.push('La clave de Telnyx NO responde (¿caducada/rotada?) — la auto-provisión de números fallará cuando entre un cliente.');
    if (groups.telephony.apiLive && !groups.telephony.regulatoryGroup) warnings.push('Telnyx sin TELNYX_REQUIREMENT_GROUP_ID: España exige bundle regulatorio (dirección + CIF) — crea el bundle en el portal de Telnyx y pon su ID, o las COMPRAS de números fallarán.');

    res.json({
      env: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      publicUrl: process.env.PUBLIC_URL || null,
      groups,
      warnings,
      ok: warnings.length === 0,
    });
  });

  // ── POST /api/admin/daily-briefing — resumen del día (dryRun por defecto) ────
  app.post('/api/admin/daily-briefing', adminAuth, async (req, res) => {
    try {
      const { sendDailyBriefings } = require('../reports/daily-briefing');
      const result = await sendDailyBriefings({
        orgId:  req.body?.orgId  || null,
        dryRun: req.body?.dryRun !== false,
      });
      return res.status(result.ok ? 200 : 502).json(result);
    } catch (e) {
      log.error(`Daily briefing manual error: ${e.message}`);
      return res.status(500).json({ error: e.message });
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
