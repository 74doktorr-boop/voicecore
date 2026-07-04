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
const { setupVonageStreams } = require('./src/telephony/vonage-handler');
const { setupTelnyxStreams } = require('./src/telephony/telnyx-handler');
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
const { setupAssistantRoutes }    = require('./src/api/routes-assistant');
const { setupDemoRoutes }         = require('./src/api/routes-demo');
const { setupAutomationRoutes }   = require('./src/api/routes-automations');
const { setupFlowRoutes }         = require('./src/api/routes-flows');
const { setupCalendarRoutes }     = require('./src/api/routes-calendar');
const { setupAuthRoutes }         = require('./src/api/routes-auth');
const { setupWebhookRoutes }      = require('./src/api/routes-webhooks');
const { webhookDispatcher }       = require('./src/webhooks/dispatcher');
const { startCron }               = require('./src/scheduling/cron');
const { flowManager }             = require('./src/automations/flow-manager');
const { getBilling } = require('./src/billing/stripe');
const BrowserCallHandler = require('./src/browser/browser-call');
const { startMonitor } = require('./src/monitoring/health-check');
const { installProcessHandlers, expressErrorHandler } = require('./src/monitoring/error-tracker');

const log = new Logger('SERVER');
const PORT = process.env.PORT || 3001;

// Capturar errores no manejados a nivel de proceso (alertan por email)
installProcessHandlers({ onFatal: () => { try { server.close(); } catch (_) {} } });

// ─── Validate Config ───
const requiredEnvVars = ['DEEPGRAM_API_KEY', 'OPENAI_API_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    log.warn(`Missing ${envVar} — some features will be unavailable`);
  }
}

// ─── Express App ───
const app = express();

// Ocultar fingerprint del servidor
app.disable('x-powered-by');

// ─── Security headers (helmet-lite, no extra dep) ───
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// ─── CORS ──────────────────────────────────────────────────────────────────
// Rutas de admin: solo desde nodeflow.es (no CORS externo)
// Rutas de API: abierto porque la API key es el mecanismo de auth (clientes externos)
const ALLOWED_ORIGINS = [
  'https://nodeflow.es',
  'https://www.nodeflow.es',
  'http://localhost:3001',
  'http://localhost:3000',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Admin y portal: solo orígenes conocidos
  if (req.path.startsWith('/api/admin') || req.path.startsWith('/admin')) {
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    if (origin) res.header('Access-Control-Allow-Origin', origin);
  } else {
    // API pública: abierta (la API key es la seguridad)
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Simple in-memory rate limiter factory (no external dep) ───
function makeRateLimit({ windowMs = 60000, max = 20, keyFn = (req) => req.ip } = {}) {
  const store = new Map();
  // Prevent memory leak: purge expired buckets every 10 minutes
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, bucket] of store) {
      if (bucket.start < cutoff) store.delete(key);
    }
  }, 10 * 60 * 1000).unref(); // .unref() so the interval doesn't prevent process exit

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

// Limit JSON and URL-encoded body size to 512 KB — prevents DoS via massive POST bodies.
// verify: guarda el body crudo en req.rawBody para verificar firmas HMAC (webhook de Meta/WA).
app.use(express.json({
  limit: '512kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

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
  '/index.html', '/onboarding.html',
  '/hementxe/index.html', '/hementxe/anuncio.html',
  '/gracias/index.html', '/portal/index.html',
  '/galiza/index.html',
  '/andoain/index.html', '/donostia/index.html',
  '/bilbao/index.html', '/vitoria/index.html',
].forEach(p => getPage(p).catch(() => {}));

// ─── Landing principal ───
app.get('/', serveGitHubPage('/index.html', path.join(__dirname, 'public', 'index.html')));

// ─── Hementxe (campaign) ───
app.get(['/hementxe', '/hementxe/'],        serveGitHubPage('/hementxe/index.html',   path.join(__dirname, 'public', 'hementxe', 'index.html')));
app.get('/hementxe/anuncio.html',           serveGitHubPage('/hementxe/anuncio.html', path.join(__dirname, 'public', 'hementxe', 'anuncio.html')));

// ─── Sector SEO landing pages ───
const SECTOR_PAGES = [
  // Original 13
  'peluquerias', 'clinicas', 'restaurantes', 'talleres',
  'veterinarias', 'estetica', 'gimnasios', 'inmobiliarias',
  'academias', 'asesorias', 'farmacias', 'hoteles', 'fisioterapia',
  // Additional 14 (pages exist in public/ but were missing routes)
  'abogados', 'agencia-viajes', 'autoescuela', 'coaching',
  'estetica-avanzada', 'guarderia-canina', 'notaria', 'nutricion',
  'optica', 'pilates', 'podologia', 'psicologia', 'reformas', 'yoga',
];
SECTOR_PAGES.forEach(sector => {
  const file = path.join(__dirname, 'public', sector, 'index.html');
  app.get([`/${sector}`, `/${sector}/`], serveGitHubPage(`/${sector}/index.html`, file));
});

// ─── Legacy: contestador-ia-*.html → 301 a la página de sector canónica ───
// Páginas antiguas (marca naranja) que duplicaban el contenido sectorial.
// Eliminadas del sitemap; redirigen para conservar link-juice histórico.
const LEGACY_REDIRECTS = {
  '/contestador-ia-clinica.html':      '/clinicas',
  '/contestador-ia-estetica.html':     '/estetica',
  '/contestador-ia-fisioterapia.html': '/fisioterapia',
  '/contestador-ia-gimnasio.html':     '/gimnasios',
  '/contestador-ia-taller.html':       '/talleres',
  '/contestador-ia-veterinaria.html':  '/veterinarias',
};
Object.entries(LEGACY_REDIRECTS).forEach(([from, to]) => {
  app.get(from, (req, res) => res.redirect(301, to));
});

// ─── Páginas legales ───
['privacidad', 'terminos', 'aviso-legal'].forEach(page => {
  const file = path.join(__dirname, 'public', page, 'index.html');
  app.get([`/${page}`, `/${page}/`], serveGitHubPage(`/${page}/index.html`, file));
});

// ─── Guías sectoriales ───
app.get(['/guias', '/guias/'], serveGitHubPage('/guias/index.html', path.join(__dirname, 'public', 'guias', 'index.html')));
['belleza-estetica', 'restaurantes-hosteleria', 'salud-fisioterapia', 'servicios-profesionales', 'talleres-veterinarias'].forEach(slug => {
  const file = path.join(__dirname, 'public', 'guias', slug, 'index.html');
  app.get([`/guias/${slug}`, `/guias/${slug}/`], serveGitHubPage(`/guias/${slug}/index.html`, file));
});

// ─── Demo interactiva ───
app.get(['/demo.html', '/demo', '/demo/'],
  serveGitHubPage('/demo.html', path.join(__dirname, 'public', 'demo.html')));

// ─── Onboarding (conversión) ───
app.get(['/onboarding.html', '/onboarding', '/onboarding/'],
  serveGitHubPage('/onboarding.html', path.join(__dirname, 'public', 'onboarding.html')));

// ─── Post-pago ───
app.get(['/gracias', '/gracias/'], serveGitHubPage('/gracias/index.html', path.join(__dirname, 'public', 'gracias', 'index.html')));

// ─── Estado del servicio (página pública) ───
app.get(['/status', '/status/'], serveGitHubPage('/status/index.html', path.join(__dirname, 'public', 'status', 'index.html')));

// ─── Panel de administración ───
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.get('/admin/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'playground.html'));
});

// ─── Portal del cliente ───
// Sirve index.html para /portal, /portal/ y cualquier subruta (ej: /portal/whatsapp-callback)
// El JS del portal lee los query params y gestiona el estado internamente (SPA)
const _portalIndexPath = path.join(__dirname, 'public', 'portal', 'index.html');
app.get(['/portal', '/portal/', '/portal/*'], (req, res, next) => {
  // Los assets reales (portal.js, css, imágenes) deben servirse como archivos:
  // dejarlos pasar a express.static (registrado más abajo). Solo las rutas SPA
  // sin extensión (o el propio index.html) reciben el index.html del portal.
  if (/\.[a-z0-9]+$/i.test(req.path) && !req.path.endsWith('.html')) return next();
  serveGitHubPage('/portal/index.html', _portalIndexPath)(req, res);
});

// ─── NodeFlow Galicia ───
app.get(['/galiza', '/galiza/'], serveGitHubPage('/galiza/index.html', path.join(__dirname, 'public', 'galiza', 'index.html')));

// ─── Blog ───
app.get(['/blog', '/blog/'], (req, res) => {
  const f = path.join(__dirname, 'public', 'blog', 'index.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.redirect('/');
});
app.get('/blog/:slug', (req, res) => {
  // Sanitize slug to prevent path traversal (e.g. '../../../etc/passwd')
  const slug = req.params.slug.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!slug) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  const f = path.join(__dirname, 'public', 'blog', slug, 'index.html');
  // Extra guard: confirm resolved path is inside public/blog/
  if (!f.startsWith(path.join(__dirname, 'public', 'blog', ''))) {
    return res.status(403).end();
  }
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ─── City SEO pages ───
app.get(['/andoain', '/andoain/'],     serveGitHubPage('/andoain/index.html',   path.join(__dirname, 'public', 'andoain',   'index.html')));
app.get(['/donostia', '/donostia/'],   serveGitHubPage('/donostia/index.html',  path.join(__dirname, 'public', 'donostia',  'index.html')));
app.get(['/bilbao', '/bilbao/'],       serveGitHubPage('/bilbao/index.html',    path.join(__dirname, 'public', 'bilbao',    'index.html')));
app.get(['/vitoria', '/vitoria/'],     serveGitHubPage('/vitoria/index.html',   path.join(__dirname, 'public', 'vitoria',   'index.html')));
app.get(['/madrid', '/madrid/'],       serveGitHubPage('/madrid/index.html',    path.join(__dirname, 'public', 'madrid',    'index.html')));
app.get(['/barcelona', '/barcelona/'], serveGitHubPage('/barcelona/index.html', path.join(__dirname, 'public', 'barcelona', 'index.html')));
app.get(['/pamplona', '/pamplona/'],   serveGitHubPage('/pamplona/index.html',  path.join(__dirname, 'public', 'pamplona',  'index.html')));

// Also warm up new city pages at startup
['/madrid/index.html', '/barcelona/index.html', '/pamplona/index.html'].forEach(p => getPage(p).catch(() => {}));

// ─── Sector + Ciudad landing pages (/peluquerias/bilbao, /dental/vitoria, etc.) ───
// express.static has index:false so we need explicit routes for directory index.html files.
// Only serve combinations that have a real file — unknown paths fall through to 404.
app.get('/:sector/:ciudad', (req, res, next) => {
  // Sanitize both params to prevent path traversal
  const sector = req.params.sector.replace(/[^a-z0-9-]/gi, '');
  const ciudad = req.params.ciudad.replace(/[^a-z0-9-]/gi, '');
  if (!sector || !ciudad) return next();
  const f = path.join(__dirname, 'public', sector, ciudad, 'index.html');
  // Guard: must be inside public/
  if (!f.startsWith(path.join(__dirname, 'public', ''))) return res.status(403).end();
  if (fs.existsSync(f)) return res.sendFile(f);
  next(); // fall through to 404 handler
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
const wssTelnyx = new WebSocketServer({ noServer: true });   // Telnyx
const wssBrowser = new WebSocketServer({ noServer: true });  // Browser demo

// Manual upgrade to support query params in paths
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (pathname === '/media-stream') {
    wss.handleUpgrade(request, socket, head, (ws) => { wss.emit('connection', ws, request); });
  } else if (pathname === '/vonage-stream') {
    wssVonage.handleUpgrade(request, socket, head, (ws) => { wssVonage.emit('connection', ws, request); });
  } else if (pathname === '/telnyx-stream') {
    wssTelnyx.handleUpgrade(request, socket, head, (ws) => { wssTelnyx.emit('connection', ws, request); });
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
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}`,
  apiKey: process.env.API_KEY || 'voicecore-dev',
  // BUG-25 FOLLOW-UP: Do NOT default to 'admin' — routes-admin.js will reject
  // all login attempts if this is null/undefined, forcing explicit configuration.
  dashboardPassword: process.env.DASHBOARD_PASSWORD || null,
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

// ─── Hidratar sectores custom aprobados (escalar sin deploy) ───
// Fire-and-forget, fail-open: si falta la tabla nf_sectors se usa solo la semilla.
require('./src/sectors/sector-store').hydrateFromDb(db).catch(() => {});

// ─── Initialize Appointments Store (persistencia de citas) ───
const { appointmentsStore } = require('./src/db/appointments-store');
appointmentsStore.init(db.client);
// Cargar citas persistidas al Map del scheduler (fire-and-forget)
appointmentsStore.loadAll().then(apts => {
  if (!apts.length) return;
  const { scheduler } = require('./src/scheduling/scheduler');
  let loaded = 0;
  for (const apt of apts) {
    if (!scheduler.appointments.has(apt.id)) {
      scheduler.appointments.set(apt.id, apt);
      loaded++;
      // Sincronizar el nextId para evitar colisiones
      const num = parseInt(apt.id.replace('APT-', ''), 10);
      if (!isNaN(num) && num >= scheduler.nextId) scheduler.nextId = num + 1;
    }
  }
  const { Logger } = require('./src/utils/logger');
  new Logger('SERVER').info(`Appointments restored: ${loaded} citas cargadas desde Supabase`);
}).catch(e => {
  const { Logger } = require('./src/utils/logger');
  new Logger('SERVER').warn(`Appointments restore failed: ${e.message}`);
});

// ─── Initialize Webhook Dispatcher ───
webhookDispatcher.init(db);

const pipeline = new VoicePipeline(config);
const assistantManager = new AssistantManager();

// Load assistants and enable hot-reload
assistantManager.loadAll();
assistantManager.enableHotReload();

// Setup Vonage Voice API WebSocket handler
setupVonageStreams(wssVonage, pipeline, assistantManager);

// Setup Telnyx Media Streams WebSocket handler (+34 946 91 02 75)
setupTelnyxStreams(wssTelnyx, pipeline, assistantManager);

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

// Setup Auth routes (magic link portal access)
setupAuthRoutes(app);

// Setup Portal de Negocio routes (dashboard, calls, citas, informes, automations, config)
const { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline, config);

// Setup Admin routes (panel privado de Unai)
setupAdminRoutes(app, config, assistantManager);
setupAssistantRoutes(app);
setupDemoRoutes(app, ttsRouter);

// Setup Automation routes + start cron (reminders, reviews, WA confirmations)
setupAutomationRoutes(app);
setupFlowRoutes(app);
setupCalendarRoutes(app, config);
setupWebhookRoutes(app);

// Setup WhatsApp bidireccional webhook (Meta Cloud API)
const { setupWhatsAppWebhook } = require('./src/api/routes-whatsapp');
setupWhatsAppWebhook(app);

// (2026-07-04) WhatsApp Connect de 360dialog retirado: la conexión de número
// propio es 100% Meta directo. Alta manual: POST /api/admin/whatsapp/connect-meta.
// Self-service (Embedded Signup): POST /api/portal/whatsapp/connect-meta.

// Widget "¿Te llamamos?" — captura de callback embebible
const { setupWidgetRoutes } = require('./src/api/routes-widget');
setupWidgetRoutes(app);

// Load per-business flows from DB, then start cron
flowManager.loadFromDB()
  .then(n => { if (n > 0) log.info(`${n} flows cargados desde DB`); })
  .catch(() => {})
  .finally(() => startCron(30));

// Rehidratar las AGENDAS del scheduler (viven en memoria): sin esto, tras
// cada deploy toda org queda "Business not configured" y la IA responde
// "no puedo ofrecerte una cita" a todo — bug real de HHR el 2026-07-03.
const { hydrateSchedulerFromDB } = require('./src/scheduling/org-config');
hydrateSchedulerFromDB()
  .then(n => log.info(`Scheduler hidratado: ${n} agendas de negocio cargadas desde DB`))
  .catch(e => log.warn(`Scheduler hydrate failed: ${e.message}`));

// Llamadas huérfanas: si un deploy mata el proceso en mitad de una llamada,
// la fila queda 'active' para siempre y el portal muestra duraciones de
// reloj corriendo (caso real: "1989 minutos"). Se cierran al arrancar y
// cada hora.
const { reapOrphanCalls } = require('./src/db/call-store');
reapOrphanCalls({ maxAgeMinutes: 90 }).catch(() => {});
setInterval(() => reapOrphanCalls({ maxAgeMinutes: 90 }).catch(() => {}), 3600000).unref();

// Drenaje elegante: al recibir SIGTERM (deploy/restart), esperar a que las
// llamadas activas terminen (máx. 45s) antes de morir. Sin esto, el deploy
// corta la conversación a mitad de frase y Telnyx reconecta contra el
// contenedor nuevo → el cliente oye OTRA VEZ el saludo inicial (caso real
// de Pablo pidiendo una cancelación, 2026-07-03 02:05).
process.on('SIGTERM', async () => {
  const active = () => pipeline.activeCalls?.size || 0;
  if (active() === 0) { log.info('SIGTERM — sin llamadas activas, cierre inmediato'); process.exit(0); }
  log.warn(`SIGTERM — drenando ${active()} llamada(s) activa(s) antes de cerrar (máx. 45s)`);
  const started = Date.now();
  while (active() > 0 && Date.now() - started < 45000) {
    await new Promise(r => setTimeout(r, 1000));
  }
  log.warn(`SIGTERM — cierre con ${active()} llamada(s) aún activas tras el drenaje`);
  process.exit(0);
});

// System B: daily re-booking cron
const { startRebookingCron }  = require('./src/scheduling/rebooking-cron');
startRebookingCron();

// System D: lifecycle reminders cron
const { startLifecycleCron } = require('./src/lifecycle/scheduler');
startLifecycleCron();

// System C: load critical dates from Supabase on startup
const { criticalDatesStore }  = require('./src/scheduling/critical-dates');
criticalDatesStore.loadFromDB().catch(e => log.warn('Critical dates DB load failed:', e.message));

// Backup semanal de Supabase (domingos 04:00 Madrid → Storage bucket "backups")
const { startBackupCron } = require('./src/db/backup');
startBackupCron();

// Informe semanal a clientes (lunes 08:00 Madrid)
const { startWeeklyReportCron } = require('./src/reports/weekly-report');
startWeeklyReportCron();

// Resumen del día a clientes (cada día 08:00 Madrid)
const { startDailyBriefingCron } = require('./src/reports/daily-briefing');
startDailyBriefingCron();

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

// ─── Voice preview rate limiter (shared by both preview endpoints) ───
const _ttsPreviewLimit = makeRateLimit({ windowMs: 60000, max: 10 });

app.get('/api/voices/:id/preview', _ttsPreviewLimit, async (req, res) => {
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
app.get('/api/tts/preview', _ttsPreviewLimit, async (req, res) => {
  try {
    const voice = req.query.voice || 'nova';
    const rawText = req.query.text || 'Hola, soy tu asistente virtual de NodeFlow. ¿En qué puedo ayudarte hoy?';
    // Guard: cap text at 300 chars to prevent cost amplification via long strings
    const text = rawText.slice(0, 300);
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

// Critical dates API (System C)
const criticalDatesRouter = require('./src/api/routes-critical-dates');
app.use('/api/critical-dates', criticalDatesRouter);

// ─── 404 handler ───
app.use((req, res) => {
  // API routes → JSON
  if (req.path.startsWith('/api/') || req.path.startsWith('/voice/') || req.path.startsWith('/vonage/') || req.path.startsWith('/telnyx/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ─── Error handler global (debe ir el último) — captura, alerta y 500 limpio ───
app.use(expressErrorHandler());

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
