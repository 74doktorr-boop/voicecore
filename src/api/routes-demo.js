// src/api/routes-demo.js
// Shared demo pipeline: STT → chat → TTS.
// Auth: admin token OR portal session JWT.
'use strict';

const { Logger }              = require('../utils/logger');
const { getDatabase }         = require('../db/database');
const { isAdminToken }        = require('./routes-admin');
const { verifySessionToken }  = require('./routes-auth');
const { generatePrompt }      = require('../assistants/prompt-generator');
const { toFile }              = require('openai');
const OpenAI                  = require('openai').default;

const log = new Logger('ROUTES-DEMO');

// ── Auth middleware (admin OR portal session) ───────────────────
async function demoAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  if (isAdminToken(token)) {
    req.isAdmin = true;
    return next();
  }

  try {
    // Try to verify as portal JWT (custom HMAC-SHA256, no external library)
    const decoded = verifySessionToken(token);
    req.session = decoded;
    const db = getDatabase();
    if (db.enabled && decoded.email) {
      const { data } = await db.client
        .from('organizations')
        .select('id')
        .eq('owner_email', decoded.email.toLowerCase())
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data) req.businessId = data.id;
    }
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'No autorizado' });
  }
}

function setupDemoRoutes(app, ttsRouter) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ── POST /api/demo/stt ────────────────────────────────────────
  // body: { audio: <base64>, mimeType?: 'audio/webm' }
  // Returns: { transcript: string }
  app.post('/api/demo/stt', demoAuth, async (req, res) => {
    const { audio, mimeType = 'audio/webm' } = req.body;
    if (!audio) return res.status(400).json({ error: 'audio (base64) requerido' });
    try {
      const buffer = Buffer.from(audio, 'base64');
      if (buffer.length < 500) return res.json({ transcript: '' }); // skip silence
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = await toFile(buffer, `audio.${ext}`, { type: mimeType });
      const result = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'es',
      });
      res.json({ transcript: result.text || '' });
    } catch (e) {
      log.error(`STT error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/demo/chat ───────────────────────────────────────
  // body: { orgId?, botId?, messages: [{role, content}] }
  // Returns: { reply: string }
  app.post('/api/demo/chat', demoAuth, async (req, res) => {
    const { orgId, botId, messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages requerido' });
    }
    // Portal users can only chat with their own org
    const effectiveOrgId = req.isAdmin ? orgId : req.businessId;

    const db = getDatabase();
    let systemPrompt = 'Eres un asistente de prueba. Responde brevemente.';
    let model = 'gpt-4o-mini';
    let temperature = 0.5;

    try {
      if (effectiveOrgId && db.enabled) {
        const { data: org } = await db.client
          .from('organizations')
          .select('name, assistant_config')
          .eq('id', effectiveOrgId)
          .single();
        if (org && org.assistant_config) {
          systemPrompt = generatePrompt(org.assistant_config, org.name);
          model        = org.assistant_config.model       || 'gpt-4o-mini';
          temperature  = org.assistant_config.temperature ?? 0.5;
        }
      } else if (botId && db.enabled) {
        const { data: bot } = await db.client
          .from('demo_bots').select('name, config').eq('id', botId).single();
        if (bot && bot.config) {
          systemPrompt = generatePrompt(bot.config, bot.name);
          model        = bot.config.model       || 'gpt-4o-mini';
          temperature  = bot.config.temperature ?? 0.5;
        }
      }

      // BUG-47 FIX: use Madrid timezone — server runs UTC so bare toLocaleDateString() gives wrong date.
      systemPrompt = systemPrompt.replace('{{DATE}}', new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Madrid' }));

      const completion = await openai.chat.completions.create({
        model,
        temperature,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      });

      const reply = completion.choices[0]?.message?.content || '';
      res.json({ reply });
    } catch (e) {
      log.error(`Chat error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/demo/tts ────────────────────────────────────────
  // body: { text: string, voice?: string }
  // Returns: audio/mpeg stream
  app.post('/api/demo/tts', demoAuth, async (req, res) => {
    let { text, voice = 'nova' } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });
    text = text.slice(0, 500); // cost protection
    try {
      const audio = await ttsRouter.synthesize({
        callId: `demo-${Date.now()}`,
        text,
        voice,
        provider: 'openai',
        language: 'es',
      });
      res.set('Content-Type', 'audio/mpeg');
      res.send(audio);
    } catch (e) {
      log.error(`TTS error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { setupDemoRoutes };
