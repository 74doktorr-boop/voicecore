// src/api/routes-demo.js
// Shared demo pipeline: STT → chat → TTS.
// Auth: admin token OR portal session JWT.
'use strict';

const { Logger }              = require('../utils/logger');
const { getDatabase }         = require('../db/database');
const { isAdminToken }        = require('./routes-admin');
const { verifySessionToken }  = require('./routes-auth');
const { generatePrompt }      = require('../assistants/prompt-generator');
const { resolveElevenVoice }  = require('../tts/voice-map');
const { toFile }              = require('openai');
const OpenAI                  = require('openai').default;
const { demoGlobalLimiter, demoSttLimiter, demoChatLimiter, demoTtsLimiter } = require('../utils/rate-limiter');

const log = new Logger('ROUTES-DEMO');

// ── Auth middleware OPCIONAL para el demo ──────────────────────────
// El demo (nodeflow.es/demo) es PÚBLICO: un visitante sin token puede probarlo
// (protegido por los rate-limiters demoGlobalLimiter/chat/tts/stt). Si llega un
// token válido (admin o sesión de portal), se enriquece el request para las
// funciones autenticadas; pero la ausencia de token NUNCA bloquea.
async function demoAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(); // visitante anónimo del demo

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
    return next(); // token inválido → seguimos como visitante anónimo del demo
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
  //   - ElevenLabs → MP3 (castellano premium); Cartesia/local → WAV.
  //   - Fallback: el router (mulaw 8kHz) se envuelve en WAV reproducible.
  // (Antes devolvía mulaw etiquetado como audio/mpeg → el navegador no podía
  //  reproducirlo y la demo caía a la voz robótica del navegador.)
  app.post('/api/demo/tts', demoAuth, demoGlobalLimiter, demoTtsLimiter, async (req, res) => {
    let { text, voice, language = 'es' } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });
    text = text.slice(0, 500); // cost protection
    text = require('../tts/speakable').toSpeakable(text); // €→euros, "1 hora"→"una hora"
    const callId = `demo-${Date.now()}`;

    // ── Caché de síntesis: la misma frase+voz se paga UNA sola vez ──────
    // La demo repite muchísimo las mismas respuestas (saludos, muestras);
    // sin esto cada visitante quema créditos regenerándolas idénticas.
    const cacheKey = require('crypto').createHash('sha256')
      .update(`${voice || ''}|${language}|${text}`).digest('hex');
    const hit = ttsCacheGet(cacheKey);
    if (hit) {
      res.set('Content-Type', hit.type);
      res.set('X-TTS-Provider', hit.provider + '+cache');
      return res.send(hit.buf);
    }

    try {
      // 0. PREVIEW HONESTO: respeta el PROVEEDOR REAL de la voz elegida
      //    (Cartesia→Cartesia, local→local). ElevenLabs y voces sueltas siguen
      //    el atajo de abajo.
      const { resolveVoiceEntry } = require('../tts/voice-catalog');
      const entry = resolveVoiceEntry(voice);
      if (entry && (entry.provider === 'cartesia' || entry.provider === 'local')) {
        try {
          const mulaw = await ttsRouter.synthesize({ callId, text, voice: entry.providerVoiceId, provider: entry.provider, strategy: 'specific', language });
          const { mulawToPcm } = require('../utils/audio');
          const wav = wavFromPcm16(mulawToPcm(mulaw), 8000);
          ttsCachePut(cacheKey, wav, 'audio/wav', entry.provider);
          res.set('Content-Type', 'audio/wav');
          res.set('X-TTS-Provider', entry.provider);
          return res.send(wav);
        } catch (e) { log.warn(`Demo TTS: ${entry.provider} falló (${e.message}) — fallback`); }
      }

      // 1. ElevenLabs (si está) → MP3 premium. Es la voz que cierra clientes.
      //    Se usa para castellano Y para cualquier voz ElevenLabs curada (p.ej.
      //    brais-gl en galego — multilingual_v2 auto-detecta el idioma).
      //    Si falla (p.ej. 402 en plan Free, o cuota), cae al router — la demo nunca se rompe.
      const isElevenVoice = entry && entry.provider === 'elevenlabs';
      const eleven = (language === 'es' || isElevenVoice) ? ttsRouter.providers?.get?.('elevenlabs')?.instance : null;
      if (eleven) {
        try {
          // El selector guarda nombres de OpenAI (nova/shimmer…) que NO son IDs
          // válidos de ElevenLabs. Los traducimos a un voiceId real para que la
          // demo suene SIEMPRE a ElevenLabs (default seguro si es desconocido).
          const voiceId = resolveElevenVoice(voice);
          // Modelo de CALIDAD, no de latencia: la demo se pregraba una vez y se
          // sirve estática — aquí lo único que importa es que suene de 10 (Flash
          // tartamudea/repite; multilingual_v2 es el más estable y natural).
          const mp3 = await eleven.synthesize({ callId, text, voiceId, language, format: 'mp3', modelId: 'eleven_multilingual_v2' });
          ttsCachePut(cacheKey, mp3, 'audio/mpeg', 'elevenlabs');
          res.set('Content-Type', 'audio/mpeg');
          res.set('X-TTS-Provider', 'elevenlabs');
          return res.send(mp3);
        } catch (e) {
          log.warn(`Demo TTS: ElevenLabs falló (${e.message}) — fallback al router`);
        }
      }

      // 2. Fallback final: router (mulaw 8kHz) → WAV PCM 8kHz (reproducible en navegador).
      const mulaw = await ttsRouter.synthesize({ callId, text, voice, language });
      const { mulawToPcm } = require('../utils/audio');
      const pcm = mulawToPcm(mulaw);
      const wav = wavFromPcm16(pcm, 8000);
      ttsCachePut(cacheKey, wav, 'audio/wav', 'router-wav');
      res.set('Content-Type', 'audio/wav');
      res.set('X-TTS-Provider', 'router-wav');
      return res.send(wav);
    } catch (e) {
      log.error(`TTS error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}

// ── Caché LRU en memoria para /api/demo/tts ──────────────────────────────
// Clave: sha256(voz|idioma|texto). Cap por entradas y por bytes totales —
// una frase de demo pesa ~50-150KB; 25MB dan para ~300 frases calientes.
const _ttsCache = new Map(); // key → { buf, type, provider }
const TTS_CACHE_MAX_ENTRIES = 300;
const TTS_CACHE_MAX_BYTES   = 25 * 1024 * 1024;
let _ttsCacheBytes = 0;

function ttsCacheGet(key) {
  const e = _ttsCache.get(key);
  if (!e) return null;
  _ttsCache.delete(key); _ttsCache.set(key, e); // refresca posición LRU
  return e;
}

function ttsCachePut(key, buf, type, provider) {
  if (!buf || !buf.length || buf.length > 2 * 1024 * 1024) return; // nada raro
  if (_ttsCache.has(key)) return;
  _ttsCache.set(key, { buf, type, provider });
  _ttsCacheBytes += buf.length;
  while (_ttsCache.size > TTS_CACHE_MAX_ENTRIES || _ttsCacheBytes > TTS_CACHE_MAX_BYTES) {
    const oldest = _ttsCache.keys().next().value;
    if (oldest === undefined) break;
    _ttsCacheBytes -= _ttsCache.get(oldest).buf.length;
    _ttsCache.delete(oldest);
  }
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
