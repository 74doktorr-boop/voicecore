// ============================================
// VoiceCore — Analytics & Squads API Routes
// Extended endpoints for Phase 4 features
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth, rateLimit } = require('../auth/middleware');
const { getAnalytics } = require('../analytics/engine');
const { getKnowledgeBase } = require('../knowledge/base');

const log = new Logger('API:EXT');

function setupExtendedRoutes(app, config, squadManager) {
  const auth = requireAuth(config);
  const limit = rateLimit();
  const analytics = getAnalytics();
  const kb = getKnowledgeBase();

  // ─── Analytics ───
  app.get('/api/analytics/dashboard', auth, (req, res) => {
    res.json(analytics.getDashboard());
  });

  app.get('/api/analytics/heatmap', auth, (req, res) => {
    const days = parseInt(req.query.days) || 7;
    res.json(analytics.getHeatmap(days));
  });

  app.get('/api/analytics/funnel', auth, (req, res) => {
    const days = parseInt(req.query.days) || 30;
    res.json(analytics.getFunnel(days));
  });

  app.get('/api/analytics/assistants', auth, (req, res) => {
    res.json(analytics.getAssistantPerformance());
  });

  app.get('/api/analytics/providers', auth, (req, res) => {
    res.json(analytics.getProviderPerformance());
  });

  // ─── Squads ───
  app.get('/api/squads', auth, (req, res) => {
    res.json({ squads: squadManager.listSquads() });
  });

  app.get('/api/squads/:id', auth, (req, res) => {
    const squad = squadManager.getSquad(req.params.id);
    if (!squad) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad });
  });

  app.post('/api/squads', auth, limit, (req, res) => {
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

      const results = await kb.query(req.org.id, req.params.assistantId, question, topK);
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/knowledge/:assistantId/stats', auth, (req, res) => {
    res.json(kb.getStats(req.org.id, req.params.assistantId));
  });

  app.delete('/api/knowledge/:assistantId', auth, (req, res) => {
    kb.deleteStore(req.org.id, req.params.assistantId);
    res.json({ success: true });
  });

  log.info('Extended routes configured (analytics, squads, knowledge)');
}

module.exports = { setupExtendedRoutes };
