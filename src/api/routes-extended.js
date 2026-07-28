// ============================================
// VoiceCore — Analytics & Squads API Routes
// Extended endpoints for Phase 4 features
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth, rateLimit } = require('../auth/middleware');
const { adminAuth } = require('./routes-admin');
const { getAnalytics } = require('../analytics/engine');
const { getKnowledgeBase } = require('../knowledge/base');

const log = new Logger('API:EXT');

function setupExtendedRoutes(app, config, squadManager) {
  const auth = requireAuth(config);
  const limit = rateLimit();
  const analytics = getAnalytics();
  const kb = getKnowledgeBase();

  // ─── Analytics (TELEMETRÍA INTERNA — adminAuth, no auth de cliente) ───
  // Hallazgo S2 (auditoría 2026-07-29): el motor de analítica es un singleton de
  // proceso SIN dimensión de tenant — getDashboard/getAssistantPerformance agregan
  // TODA la flota. Con `auth` (que acepta el JWT del portal), cualquier cliente
  // recibía llamadas, coste y conversión de todos los demás negocios, con sus
  // UUID de org — que además son la munición del secuestro de OAuth (S1).
  // Ningún frontend los consume (solo aparecen en public/docs.html), así que
  // moverlos a adminAuth no rompe producto. Si algún día se quieren exponer al
  // cliente, hay que añadir orgId al engine y filtrar, no relajar esto.
  app.get('/api/analytics/dashboard', adminAuth, (req, res) => {
    res.json(analytics.getDashboard());
  });

  app.get('/api/analytics/heatmap', adminAuth, (req, res) => {
    // Cap days at 365 to prevent runaway in-memory scans
    const days = Math.min(Math.max(1, parseInt(req.query.days) || 7), 365);
    res.json(analytics.getHeatmap(days));
  });

  app.get('/api/analytics/funnel', adminAuth, (req, res) => {
    const days = Math.min(Math.max(1, parseInt(req.query.days) || 30), 365);
    res.json(analytics.getFunnel(days));
  });

  app.get('/api/analytics/assistants', adminAuth, (req, res) => {
    res.json(analytics.getAssistantPerformance());
  });

  app.get('/api/analytics/providers', adminAuth, (req, res) => {
    res.json(analytics.getProviderPerformance());
  });

  // ─── Squads (también sin filtro de org → adminAuth) ───
  app.get('/api/squads', adminAuth, (req, res) => {
    res.json({ squads: squadManager.listSquads() });
  });

  app.get('/api/squads/:id', adminAuth, (req, res) => {
    const squad = squadManager.getSquad(req.params.id);
    if (!squad) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad });
  });

  app.post('/api/squads', adminAuth, limit, (req, res) => {
    try {
      const squad = squadManager.registerSquad(req.body);
      res.status(201).json({ squad });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Knowledge Base ───
  app.post('/api/knowledge/:assistantId/ingest', auth, limit, async (req, res) => {
    try {
      const { documents } = req.body;
      if (!documents?.length) return res.status(400).json({ error: 'No documents provided' });

      const result = await kb.ingest(req.org.id, req.params.assistantId, documents);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/knowledge/:assistantId/query', auth, async (req, res) => {
    try {
      const { question, topK } = req.body;
      if (!question) return res.status(400).json({ error: 'No question provided' });

      const results = await kb.query(req.org.id, question, topK);
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/knowledge/:assistantId/stats', auth, async (req, res) => {
    res.json(await kb.getStats(req.org.id, req.params.assistantId));
  });

  app.delete('/api/knowledge/:assistantId', auth, async (req, res) => {
    await kb.deleteStore(req.org.id, req.params.assistantId);
    res.json({ success: true });
  });

  log.info('Extended routes configured (analytics, squads, knowledge)');
}

module.exports = { setupExtendedRoutes };
