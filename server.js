// ============================================
// VoiceCore v2.0 — Main Server
// Multi-Provider Voice AI Platform by NodeFlow
// ============================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { Logger } = require('./src/utils/logger');
const { VoicePipeline } = require('./src/core/voice-pipeline');
const { AssistantManager } = require('./src/assistants/manager');
const { setupTwilioStreams } = require('./src/telephony/twilio-streams');
const { setupVonageStreams } = require('./src/telephony/vonage-handler');
const { setupRoutes } = require('./src/api/routes');
const { TTSRouter } = require('./src/tts/router');
const { LLMRouter } = require('./src/llm/router');
const { STTRouter } = require('./src/stt/router');
const { getDatabase } = require('./src/db/database');
const { SquadManager } = require('./src/squads/manager');
const { getAnalytics } = require('./src/analytics/engine');
const { getKnowledgeBase } = require('./src/knowledge/base');
const { setupExtendedRoutes } = require('./src/api/routes-extended');
const { setupBillingRoutes } = require('./src/api/routes-billing');
const { setupRegistroRoutes } = require('./src/api/routes-registro');
const { setupAdminRoutes }        = require('./src/api/routes-admin');
const { setupAutomationRoutes }   = require('./src/api/routes-automations');
const { setupFlowRoutes }         = require('./src/api/routes-flows');
const { setupCalendarRoutes }     = require('./src/api/routes-calendar');
const { startCron }               = require('./src/scheduling/cron');
const { flowManager }             = require('./src/automations/flow-manager');
const { getBilling } = require('./src/billing/stripe');
const BrowserCallHandler = require('./src/browser/browser-call');
const { startMonitor } = require('./src/monitoring/health-check');

const log = new Logger('SERVER');
const PORT = process.env.PORT || 3001;

// ─── Validate Config ───
const requiredEnvVars = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    log.warn(`Missing ${envVar} — some features will be unavailable`);
  }
}

// ─── Express App ───
const app = express();

// CORS — permitir llamadas desde cualquier origen (la API key es la seguridad)
// ─── Security headers (helmet-lite, no extra dep) ───
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Simple in-memory rate limiter factory (no external dep) ───
function makeRateLimit({ windowMs = 60000, max = 20, keyFn = (req) => req.ip } = {}) {
  const store = new Map();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      store.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((bucket.start + windowMs - now) / 1000) });
    }
    next();
  };
}

// Redirect www → apex (SEO canonical)
app.use((req, res, next) => {
  if (req.headers.host?.startsWith('www.')) {
    const apex = req.headers.host.slice(4);
    return res.redirect(301, `https://${apex}${req.url}`);
  }
  next();
});

// ⚠️  Stripe webhook MUST receive the raw body (Buffer) for HMAC verification.
// express.raw() here runs BEFORE express.json() so body-parser skips the
// already-consumed stream for this path when the route handler runs.
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── GitHub Raw Page Server ───────────────────────────────────────────────────
// Todas las páginas HTML se sirven desde GitHub raw con TTL 60s.
// Esto significa que un git push pone cualquier página en vivo en <60s,
// sin necesidad de rebuilding Docker ni redeploy manual.
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/74doktorr-boop/voicecore/master/public';
const PAGE_TTL = 60 * 1000;
const _pageCache = new Map(); // publicPath → { html, fetchedAt }

async function getPage(publicPath) {
  const now = Date.now();
  const cached = _pageCache.get(publicPath);
  if (cached?.html && now - cached.fetchedAt < PAGE_TTL) return cached.html;
  try {
    const resp = await fetch(`${GITHUB_RAW_BASE}${publicPath}`);
    if (resp.ok) {
      const html = await resp.text();
      _pageCache.set(publicPath, { html, fetchedAt: now });
      return html;
    }
  } catch (_) { /* red caída — usar caché antiguo */ }
  return cached?.html || null;
}

function serveGitHubPage(publicPath, fallbackFile) {
  return async (req, res) => {
    const html = await getPage(publicPath);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');
    if (html) return res.send(html);
    // Fallback al archivo bundled en el contenedor (siempre existe index.html)
    const fb = fallbackFile || path.join(__dirname, 'public', publicPath);
    res.sendFile(fb);
  };
}

// Warm-up de las páginas más visitadas al arrancar
[
  '/index.html',
  '/hementxe/index.html', '/hementxe/anuncio.html',
  '/gracias/index.html', '/portal/index.html',
  '/galiza/index.html',
  '/andoain/index.html', '/donostia/index.html',
].forEach(p => getPage(p).catch(() => {}));

// ─── Landing principal ───
app.get('/', serveGitHubPage('/index.html', path.join(__dirname, 'public', 'index.html')));

// ─── Hementxe (campaign) ───
app.get(['/hementxe', '/hementxe/'],        serveGitHubPage('/hementxe/index.html',   path.join(__dirname, 'public', 'hementxe', 'index.html')));
app.get('/hementxe/anuncio.html',           serveGitHubPage('/hementxe/anuncio.html', path.join(__dirname, 'public', 'hementxe', 'anuncio.html')));

// ─── Sector SEO landing pages ───
const SECTOR_PAGES = [
  'peluquerias', 'clinicas', 'restaurantes', 'talleres',
  'veterinarias', 'estetica', 'gimnasios', 'inmobiliarias',
  'academias', 'asesorias', 'farmacias', 'hoteles',
];
SECTOR_PAGES.forEach(sector => {
  const file = path.join(__dirname, 'public', sector, 'index.html');
  app.get([`/${sector}`, `/${sector}/`], serveGitHubPage(`/${sector}/index.html`, file));
});

// ─── Páginas legales ───
['privacidad', 'terminos', 'aviso-legal'].forEach(page => {
  const file = path.join(__dirname, 'public', page, 'index.html');
  app.get([`/${page}`, `/${page}/`], serveGitHubPage(`/${page}/index.html`, file));
});

// ─── Post-pago ───
app.get(['/gracias', '/gracias/'], serveGitHubPage('/gracias/index.html', path.join(__dirname, 'public', 'gracias', 'index.html')));

// ─── Portal del cliente ───
app.get(['/portal', '/portal/'], serveGitHubPage('/portal/index.html', path.join(__dirname, 'public', 'portal', 'index.html')));

// ─── NodeFlow Galicia ───
app.get(['/galiza', '/galiza/'], serveGitHubPage('/galiza/index.html', path.join(__dirname, 'public', 'galiza', 'index.html')));

// ─── City SEO pages ───
app.get(['/andoain', '/andoain/'], serveGitHubPage('/andoain/index.html', path.join(__dirname, 'public', 'andoain', 'index.html')));
app.get(['/donostia', '/donostia/'], serveGitHubPage('/donostia/index.html', path.join(__dirname, 'public', 'donostia', 'index.html')));

// Other static assets (CSS, JS, images, robots.txt, etc.)
app.use(express.static(path.join(__dirname, 'public'), {
  index: false, // root handled above
  setHeaders(res, filePath) {
    res.set('Cache-Control', filePath.endsWith('.html')
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=3600');
  }
}));
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard'), {
  setHeaders(res, filePath) {
    res.set('Cache-Control', filePath.endsWith('.html')
      ? 'no-cache, no-store, must-revalidate'
      : 'public, max-age=3600');
  }
}));

// ─── HTTP Server + WebSocket ───
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });        // Twilio
const wssVonage = new WebSocketServer({ noServer: true });   // Vonage
const wssBrowser = new WebSocketServer({ noServer: true });  // Browser demo

// Manual upgrade to support query params in paths
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => { wss.emit('connection', ws, request); });
  } else if (pathname === '/vonage-stream') {
    wssVonage.handleUpgrade(request, socket, head, (ws) => { wssVonage.emit('connection', ws, request); });
  } else if (pathname === '/ws/talk') {
    wssBrowser.handleUpgrade(request, socket, head, (ws) => { wssBrowser.emit('connection', ws, request); });
  } else {
    socket.destroy();
  }
});

// ─── Initialize Multi-Provider Routers ───
const sttRouter = new STTRouter({
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY,
  googleSttApiKey: process.env.GOOGLE_STT_API_KEY || process.env.GOOGLE_TTS_API_KEY,
});

const ttsRouter = new TTSRouter({
  cartesiaApiKey:  process.env.CARTESIA_API_KEY,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  openaiApiKey:    process.env.OPENAI_API_KEY,
  googleApiKey:    process.env.GOOGLE_TTS_API_KEY,
  localTtsUrl:     process.env.LOCAL_TTS_URL,      // Basque TTS (eu)
  localTtsUrlGl:   process.env.LOCAL_TTS_URL_GL,   // Galician TTS (gl)
});

const llmRouter = new LLMRouter({
  groqApiKey: process.env.GROQ_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── Initialize Components ───
const config = {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}`,
  apiKey: process.env.API_KEY || 'voicecore-dev',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
  webhookUrl: process.env.WEBHOOK_URL || null,
  // Pass routers
  sttRouter,
  ttsRouter,
  llmRouter,
};

// ─── Initialize Database ───
const db = getDatabase({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
});

const pipeline = new VoicePipeline(config);
const assistantManager = new AssistantManager();

// Load assistants and enable hot-reload
assistantManager.loadAll();
assistantManager.enableHotReload();

// Setup Twilio WebSocket handler
setupTwilioStreams(wss, pipeline, assistantManager);

// Setup Vonage Voice API WebSocket handler
setupVonageStreams(wssVonage, pipeline, assistantManager);

// Setup Browser Talk handler
const browserHandler = new BrowserCallHandler(assistantManager);
wssBrowser.on('connection', (ws, req) => browserHandler.handleConnection(ws, req));

// ─── Initialize Phase 4 components ───
const squadManager = new SquadManager(assistantManager);
const analytics = getAnalytics();
const kb = getKnowledgeBase({ openaiApiKey: process.env.OPENAI_API_KEY });

// Setup REST API routes
setupRoutes(app, pipeline, assistantManager, config);

// Setup Extended routes (analytics, squads, knowledge)
setupExtendedRoutes(app, config, squadManager);

// Setup Billing routes (Stripe)
const billing = getBilling({ stripeSecretKey: process.env.STRIPE_SECRET_KEY });
setupBillingRoutes(app, config);

// Setup Registro routes (formulario landing → Stripe)
setupRegistroRoutes(app);

// Setup Admin routes (panel privado de Unai)
setupAdminRoutes(app, config, assistantManager);

// Setup Automation routes + start cron (reminders, reviews, WA confirmations)
setupAutomationRoutes(app);
setupFlowRoutes(app);
setupCalendarRoutes(app, config);

// Load per-business flows from DB, then start cron
flowManager.loadFromDB()
  .then(n => { if (n > 0) log.info(`${n} flows cargados desde DB`); })
  .catch(() => {})
  .finally(() => startCron(30));

// ─── Voice Catalog API ───
app.get('/api/voices', (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'config', 'voices.json');
    if (fs.existsSync(catalogPath)) {
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      res.json(catalog);
    } else {
      res.json({ voices: [], defaults: {}, recommended: {} });
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to load voice catalog' });
  }
});

app.get('/api/voices/:id/preview', async (req, res) => {
  try {
    const catalogPath = path.join(__dirname, 'config', 'voices.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const voice = catalog.voices.find(v => v.id === req.params.id);
    if (!voice) return res.status(404).json({ error: 'Voice not found' });

    const audio = await ttsRouter.synthesize({
      callId: 'preview',
      text: 'Hola, soy tu asistente virtual. ¿En qué puedo ayudarte hoy?',
      provider: voice.provider,
      voice: voice.providerVoiceId,
    });

    res.set('Content-Type', 'audio/basic');
    res.send(audio);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Simple TTS Preview (direct OpenAI) — rate limited ───
const _ttsPreviewLimit = makeRateLimit({ windowMs: 60000, max: 10 });
app.get('/api/tts/preview', _ttsPreviewLimit, async (req, res) => {
  try {
    const voice = req.query.voice || 'nova';
    const text = req.query.text || 'Hola, soy tu asistente virtual de NodeFlow. ¿En qué puedo ayudarte hoy?';
    const provider = req.query.provider || 'openai';

    // Use OpenAI TTS directly for previews
    if (provider === 'openai' && process.env.OPENAI_API_KEY) {
      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: voice,
        input: text,
        response_format: 'mp3',
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    }

    // Fallback to TTS router
    const audio = await ttsRouter.synthesize({
      callId: 'preview',
      text,
      provider,
      voice,
    });
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (e) {
    log.error('TTS Preview error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ─── Provider Metrics API ───
app.get('/api/providers', (req, res) => {
  res.json({
    tts: ttsRouter.getMetrics(),
    llm: llmRouter.getMetrics(),
    stt: sttRouter.getMetrics(),
  });
});

// ─── 404 handler ───
app.use((req, res) => {
  // API routes → JSON
  if (req.path.startsWith('/api/') || req.path.startsWith('/voice/') || req.path.startsWith('/vonage/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ─── Start Server ───
const ttsProviders = ttsRouter.listAvailableVoices().map(v => v.provider).join(', ') || 'none';
const llmProviders = Object.keys(llmRouter.getMetrics()).join(', ') || 'none';

server.listen(PORT, () => {
  log.info(`
╔══════════════════════════════════════════════════╗
║         🎙️  VoiceCore v2.0.0                    ║
║     Multi-Provider Voice AI Platform             ║
║          by NodeFlow Agency                      ║
╠══════════════════════════════════════════════════╣
║  Server:     http://localhost:${PORT}                ║
║  Dashboard:  http://localhost:${PORT}/dashboard      ║
║  WebSocket:  ws://localhost:${PORT}/media-stream     ║
║  Health:     http://localhost:${PORT}/health          ║
║                                                  ║
║  Assistants: ${String(assistantManager.list().length).padEnd(34)}║
║  STT:        Deepgram Nova-3                     ║
║  LLM:        ${llmProviders.padEnd(34)}║
║  TTS:        ${ttsProviders.padEnd(34)}║
║  Voices:     ${String((() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'voices.json'), 'utf8')).voices.length; } catch(e) { return 0; } })()).padEnd(34)}║
╚══════════════════════════════════════════════════╝
  `);
});

// ─── Health Monitor (alertas por email si el servidor cae) ───
if (process.env.NODE_ENV === 'production') {
  startMonitor(config.publicUrl);
}

// ─── Graceful Shutdown ───
process.on('SIGTERM', () => {
  log.info('Shutting down...');
  assistantManager.destroy();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('Shutting down...');
  assistantManager.destroy();
  server.close();
  process.exit(0);
});
