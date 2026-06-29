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
const { demoGlobalLimiter, demoSttLimiter, demoChatLimiter, demoTtsLimiter } = require('../utils/rate-limiter');

const log = new Logger('ROUTES-DEMO');

// ── Auth middleware (admin OR demo token OR portal session) ────────
// DEMO_TOKEN: simple static passphrase from .env for the standalone demo HTML.
// Not for production calls — just gates the demo page from random internet traffic.
async function demoAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  if (isAdminToken(token)) {
    req.isAdmin = true;
    return next();
  }

  // Allow standalone demo page access via DEMO_TOKEN env var
  const demoToken = process.env.DEMO_TOKEN;
  if (demoToken && token === demoToken) {
    req.isDemo = true;
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
  app.post('/api/demo/stt', demoAuth, demoGlobalLimiter, demoSttLimiter, async (req, res) => {
    const { audio, mimeType = 'audio/webm' } = req.body;
    if (!audio) return res.status(400).json({ error: 'audio (base64) requerido' });
    try {
      const buffer = Buffer.from(audio, 'base64');
      if (buffer.length < 500) return res.json({ transcript: '' }); // skip silence
      // BUG-52 FIX: Reject oversized audio to prevent expensive Whisper API abuse.
      // 5 MB decoded ≈ ~30 s of audio at 128 kbps — more than enough for a demo turn.
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'Audio demasiado largo para el demo (máx ~30s)' });
      }
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
  // OR legacy demo format (the demo HTML sends messages[] built client-side with systemPrompt)
  // Returns: { reply: string }
  app.post('/api/demo/chat', demoAuth, demoGlobalLimiter, demoChatLimiter, async (req, res) => {
    const { orgId, botId, messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages requerido' });
    }
    // BUG-52 FIX: Cap message count and total text length to prevent input-token abuse.
    if (messages.length > 30) {
      return res.status(400).json({ error: 'Demasiados mensajes (máx 30 para el demo)' });
    }
    const totalChars = messages.reduce((s, m) => s + String(m?.content || '').length, 0);
    if (totalChars > 12000) {
      return res.status(400).json({ error: 'Conversación demasiado larga para el demo' });
    }

    // Portal users can only chat with their own org
    const effectiveOrgId = req.isAdmin ? orgId : req.businessId;

    const db = getDatabase();
    const madridDate = new Date().toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Madrid'
    });
    const madridHour = parseInt(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid' }), 10);
    const greeting   = madridHour >= 6 && madridHour < 14 ? 'Buenos días' : madridHour >= 14 && madridHour < 21 ? 'Buenas tardes' : 'Buenas noches';

    // Helper: apply standard token replacements to any string
    const applyTokens = (s) => (s || '')
      .replace(/\{\{DATE\}\}/g, madridDate)
      .replace(/\{\{GREETING\}\}/g, greeting);

    // If messages already include a system prompt (sent by demo HTML), use them directly.
    // Otherwise, resolve system prompt from DB (portal/admin flow).
    const hasSystemMsg = messages.some(m => m.role === 'system');

    let model       = 'gpt-4o';
    let temperature = 0.5;
    let resolvedMessages = messages.map(m => ({ ...m, content: applyTokens(m.content) }));

    try {
      if (!hasSystemMsg) {
        // Resolve system prompt from DB (portal or botId flow)
        let systemPrompt = null;
        if (effectiveOrgId && db.enabled) {
          const { data: org } = await db.client
            .from('organizations').select('name, assistant_config').eq('id', effectiveOrgId).single();
          if (org?.assistant_config) {
            systemPrompt = generatePrompt(org.assistant_config, org.name);
            model        = org.assistant_config.model       || 'gpt-4o-mini';
            temperature  = org.assistant_config.temperature ?? 0.5;
          }
        } else if (botId && db.enabled) {
          const { data: bot } = await db.client
            .from('demo_bots').select('name, config').eq('id', botId).single();
          if (bot?.config) {
            systemPrompt = generatePrompt(bot.config, bot.name);
            model        = bot.config.model       || 'gpt-4o-mini';
            temperature  = bot.config.temperature ?? 0.5;
          }
        }
        if (systemPrompt) {
          resolvedMessages = [
            { role: 'system', content: applyTokens(systemPrompt) },
            ...resolvedMessages,
          ];
        }
      }

      const completion = await openai.chat.completions.create({
        model,
        temperature,
        max_tokens: 500, // enough for a complete, coherent response
        messages: resolvedMessages,
      });

      const reply = completion.choices[0]?.message?.content || '';
      res.json({ reply });
    } catch (e) {
      log.error(`Chat error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/demo/tts ────────────────────────────────────────
  // body: { text: string, voice?: string, language?: string }
  // Devuelve audio REPRODUCIBLE EN NAVEGADOR con voz natural:
  //   - Azure (si está configurado) → MP3 (castellano natural, máxima calidad).
  //   - Si no, el router (mulaw 8kHz) se envuelve en WAV reproducible.
  // (Antes devolvía mulaw etiquetado como audio/mpeg → el navegador no podía
  //  reproducirlo y la demo caía a la voz robótica del navegador.)
  app.post('/api/demo/tts', demoAuth, demoGlobalLimiter, demoTtsLimiter, async (req, res) => {
    let { text, voice, language = 'es' } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });
    text = text.slice(0, 500); // cost protection
    const callId = `demo-${Date.now()}`;
    try {
      // 1. Azure directo → MP3 natural (voz castellana de calidad).
      const azure = ttsRouter.providers?.get?.('azure')?.instance;
      if (azure) {
        const mp3 = await azure.synthesize({ callId, text, voice, language, format: 'mp3' });
        res.set('Content-Type', 'audio/mpeg');
        return res.send(mp3);
      }

      // 2. Fallback: router (mulaw 8kHz) → WAV PCM 8kHz (reproducible en navegador).
      const mulaw = await ttsRouter.synthesize({ callId, text, voice, language });
      const { mulawToPcm } = require('../utils/audio');
      const pcm = mulawToPcm(mulaw);
      res.set('Content-Type', 'audio/wav');
      return res.send(wavFromPcm16(pcm, 8000));
    } catch (e) {
      log.error(`TTS error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}

/** Envuelve PCM 16-bit LE mono en una cabecera WAV (RIFF). Reproducible en navegador. */
function wavFromPcm16(pcm, sampleRate = 8000) {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // tamaño subchunk fmt
  header.writeUInt16LE(1, 20);             // PCM
  header.writeUInt16LE(1, 22);             // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32);             // block align
  header.writeUInt16LE(16, 34);            // bits por muestra
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

module.exports = { setupDemoRoutes };
