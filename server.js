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
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Redirect www → apex (SEO canonical)
app.use((req, res, next) => {
  if (req.headers.host?.startsWith('www.')) {
    const apex = req.headers.host.slice(4);
    return res.redirect(301, `https://${apex}${req.url}`);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Landing page — served from GitHub raw so deploys are instant without Docker rebuild
const GITHUB_RAW_INDEX = 'https://raw.githubusercontent.com/74doktorr-boop/voicecore/master/public/index.html';
let landingCache = { html: null, fetchedAt: 0 };
const LANDING_TTL = 60 * 1000; // refresh every 60s

async function getLanding() {
  const now = Date.now();
  if (landingCache.html && now - landingCache.fetchedAt < LANDING_TTL) return landingCache.html;
  try {
    const resp = await fetch(GITHUB_RAW_INDEX);
    if (resp.ok) {
      landingCache = { html: await resp.text(), fetchedAt: now };
    }
  } catch (e) { /* network error — use cache or fallback */ }
  return landingCache.html; // may be null on very first boot if GitHub unreachable
}

// Warm cache on boot
getLanding().catch(() => {});

app.get('/', async (req, res) => {
  const html = await getLanding();
  if (html) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  // fallback to bundled file if GitHub unreachable
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
  cartesiaApiKey: process.env.CARTESIA_API_KEY,
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_TTS_API_KEY,
  localTtsUrl: process.env.LOCAL_TTS_URL,
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

// ─── Simple TTS Preview (direct OpenAI) ───
app.get('/api/tts/preview', async (req, res) => {
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
