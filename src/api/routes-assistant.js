// src/api/routes-assistant.js
// Admin endpoints for reading/writing per-org assistant config and demo bots.
// All routes protected by adminAuth.
'use strict';

const { Logger }          = require('../utils/logger');
const { getDatabase }     = require('../db/database');
const { generatePrompt }  = require('../assistants/prompt-generator');
const { adminAuth }       = require('./routes-admin');

const log = new Logger('ROUTES-ASSISTANT');

function setupAssistantRoutes(app) {

  // ── GET /api/admin/assistant/:orgId ───────────────────────────
  app.get('/api/admin/assistant/:orgId', adminAuth, async (req, res) => {
    const { orgId } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.json({ config: {} });
    try {
      const { data, error } = await db.client
        .from('organizations')
        .select('id, name, assistant_config')
        .eq('id', orgId)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Org no encontrada' });
      res.json({ config: data.assistant_config || {}, orgName: data.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PUT /api/admin/assistant/:orgId ───────────────────────────
  // Saves config and returns the regenerated system prompt.
  app.put('/api/admin/assistant/:orgId', adminAuth, async (req, res) => {
    const { orgId } = req.params;
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'body debe ser el objeto config' });
    }
    const db = getDatabase();
    try {
      // Fetch org name for prompt generation
      const { data: org } = await db.client
        .from('organizations').select('name').eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Org no encontrada' });

      const prompt = generatePrompt(config, org.name);

      await db.client
        .from('organizations')
        .update({ assistant_config: config })
        .eq('id', orgId);

      log.info(`Assistant config saved for org ${orgId}`);
      res.json({ ok: true, prompt });
    } catch (e) {
      log.error(`PUT assistant config error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/assistant/generate-prompt ─────────────────
  // Dry-run: returns generated prompt without saving.
  app.post('/api/admin/assistant/generate-prompt', adminAuth, async (req, res) => {
    const { config, orgName } = req.body;
    if (!config || !orgName) {
      return res.status(400).json({ error: 'config y orgName requeridos' });
    }
    try {
      const prompt = generatePrompt(config, orgName);
      res.json({ prompt });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/demo-bots ──────────────────────────────────
  app.get('/api/admin/demo-bots', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ bots: [] });
    try {
      const { data } = await db.client
        .from('demo_bots').select('*').order('created_at', { ascending: false });
      res.json({ bots: data || [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/demo-bots ─────────────────────────────────
  app.post('/api/admin/demo-bots', adminAuth, async (req, res) => {
    const { name, sector = 'generico', config = {} } = req.body;
    if (!name) return res.status(400).json({ error: 'name requerido' });
    const db = getDatabase();
    try {
      const { data, error } = await db.client
        .from('demo_bots').insert({ name, sector, config }).select().single();
      if (error) throw new Error(error.message);
      log.info(`Demo bot created: ${data.id} (${name})`);
      res.json({ bot: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/admin/demo-bots/:id ───────────────────────────
  // Update demo bot config
  app.patch('/api/admin/demo-bots/:id', adminAuth, async (req, res) => {
    const { config, name, sector } = req.body;
    const db = getDatabase();
    const patch = {};
    if (config  !== undefined) patch.config  = config;
    if (name    !== undefined) patch.name    = name;
    if (sector  !== undefined) patch.sector  = sector;
    try {
      await db.client.from('demo_bots').update(patch).eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/admin/demo-bots/:id ──────────────────────────
  app.delete('/api/admin/demo-bots/:id', adminAuth, async (req, res) => {
    const db = getDatabase();
    try {
      await db.client.from('demo_bots').delete().eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { setupAssistantRoutes };
