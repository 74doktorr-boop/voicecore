// ============================================
// VoiceCore v2.0 — REST API Routes
// Multi-tenant CRUD for orgs, assistants, calls
// ============================================

const { Logger } = require('../utils/logger');
const { generateTwiML } = require('../telephony/twilio-streams');
const { generateNCCO } = require('../telephony/vonage-handler');
const { generateTeXML } = require('../telephony/telnyx-handler');
const { requireAuth, rateLimit, checkUsageLimits, PLAN_LIMITS } = require('../auth/middleware');
const { getDatabase } = require('../db/database');
const { verifyTelnyxRequest } = require('../utils/telnyx-signature');

const log = new Logger('API');

// Identifica ESTE arranque del proceso (ver /health): cambia con cada
// deploy y el portal lo usa para auto-actualizarse en los clientes.
const BOOT_ID = String(Date.now());

// BUG-21 FIX: Twilio webhook signature validation middleware.
// Validates X-Twilio-Signature header when TWILIO_AUTH_TOKEN is configured.
// Without this, anyone who discovers the webhook URL can POST fake call events.
function twilioValidate(config) {
  return (req, res, next) => {
    const authToken = config.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      log.warn('[Twilio] TWILIO_AUTH_TOKEN no configurado — webhook sin validación de firma');
      return next();
    }
    try {
      const twilio = require('twilio');
      const sig = req.headers['x-twilio-signature'] || '';
      // Build full URL including query string (Twilio signs the complete URL)
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host  = req.headers['x-forwarded-host'] || req.headers.host;
      const url   = `${proto}://${host}${req.originalUrl}`;
      const valid = twilio.validateRequest(authToken, sig, url, req.body || {});
      if (!valid) {
        log.error(`[Twilio] Firma inválida — webhook rechazado desde ${req.ip}`);
        return res.status(403).type('text/xml').send('<Response></Response>');
      }
    } catch (e) {
      log.warn(`[Twilio] Error validando firma: ${e.message}`);
    }
    next();
  };
}

function setupRoutes(app, pipeline, assistantManager, config) {
  const auth = requireAuth(config);
  const limit = rateLimit();
  const db = getDatabase();
  const twilioSig = twilioValidate(config);

  // ── GET /api/voices — catálogo de voces para el selector ──────────────
  // Catálogo estático curado (tiers Estándar/Premium) + las voces CLONADAS de
  // la cuenta ElevenLabs añadidas en vivo (W1: tu propia voz). SOLO ofrece
  // voces cuyo proveedor está activo (ver renderableVoices).
  app.get('/api/voices', async (req, res) => {
    try {
      const { listVoices, getTiers, renderableVoices } = require('../tts/voice-catalog');
      // Proveedores REALMENTE activos = los que el router registró (tienen
      // key/URL). Fuente de verdad el propio router, no el config (que no
      // arrastra todas las keys). Así una voz solo se ofrece si su proveedor
      // existe, sin colapsar voces a un fallback ("sonar igual", 2026-07-04).
      const rt = config.ttsRouter || (pipeline && pipeline.ttsRouter);
      const available = new Set(rt && rt.providers ? Array.from(rt.providers.keys()) : []);
      const voices = renderableVoices(await listVoices(), available);
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ voices, tiers: getTiers(), count: voices.length });
    } catch (e) {
      res.status(500).json({ error: 'No se pudo cargar el catálogo de voces' });
    }
  });

  // ── GET /api/sectors — lista de sectores (semilla + custom) ────────────────
  // Fuente ÚNICA para el desplegable del onboarding/portal: se acabaron las
  // listas hardcodeadas en el front (2026-07-04). Añadir/aprobar un sector nuevo
  // aparece aquí sin tocar el front.
  app.get('/api/sectors', (req, res) => {
    try {
      const { allSectors } = require('../sectors/sector-registry');
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ sectors: allSectors() });
    } catch (e) {
      res.status(500).json({ error: 'No se pudo cargar la lista de sectores' });
    }
  });

  // ── POST /api/onboarding/profile — alta self-serve ─────────────────────────
  // El cliente describe su negocio → deducimos sector + modo (sin desplegables
  // ni configuración manual). Público (pre-alta), rate-limit por IP.
  const onbLimiter = require('../utils/rate-limiter').rateLimit({ max: 30, windowMs: 60 * 60 * 1000, keyPrefix: 'onb:profile', message: 'Demasiadas peticiones. Inténtalo en un momento.' });
  app.post('/api/onboarding/profile', onbLimiter, async (req, res) => {
    try {
      const { profileBusiness } = require('../sectors/onboarding-profiler');
      const p = await profileBusiness({ name: req.body?.name, description: req.body?.description });
      // Vertical nuevo: guardamos el borrador en la cola de revisión del fundador
      // (best-effort) para que se cure — así el auto-borrador no se pierde.
      if (p.suggested && p.suggested.draft) {
        try { require('../sectors/sector-store').saveDraft(getDatabase(), p.suggested.draft, req.body?.name); } catch (_) {}
      }
      res.json({ ok: true, ...p });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/widget/callback — solicitudes del widget "¿Te llamamos?" ──────
  // Público (lo llama el widget desde la web del cliente). Guarda en nf_callbacks
  // y avisa al negocio por email — best-effort: si una vía falla, la otra salva
  // el lead. Rate-limit por IP para evitar spam.
  const widgetLimiter = require('../utils/rate-limiter').rateLimit({ max: 20, windowMs: 60 * 60 * 1000, keyPrefix: 'widget:cb', message: 'Demasiadas solicitudes. Inténtalo más tarde.' });
  app.post('/api/widget/callback', widgetLimiter, async (req, res) => {
    try {
      const { orgId, name, phone, message } = req.body || {};
      const cleanPhone = String(phone || '').trim();
      if (!orgId || cleanPhone.replace(/\D/g, '').length < 7) {
        return res.status(400).json({ error: 'orgId y un teléfono válido son obligatorios' });
      }
      const cleanName = String(name || '').slice(0, 120);
      const cleanMsg  = String(message || '').slice(0, 1000);

      let org = null;
      if (db.enabled) {
        try {
          const { data } = await db.client.from('organizations').select('id, name, owner_email').eq('id', orgId).single();
          org = data || null;
        } catch (_) {}
      }

      let persisted = false, notified = false;
      if (db.enabled) {
        try {
          const { error } = await db.client.from('nf_callbacks').insert({ organization_id: orgId, name: cleanName, phone: cleanPhone, message: cleanMsg, status: 'pending' });
          persisted = !error;
        } catch (_) {}
      }
      if (org && org.owner_email) {
        try {
          const { sendEmail } = require('../notifications/email');
          const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
          const html = `<h2 style="margin:0 0 10px">📞 Nueva solicitud de llamada</h2>
            <p>Alguien ha pedido que le llaméis desde vuestra web:</p>
            <ul style="font-size:15px;line-height:1.7">
              <li><b>Nombre:</b> ${esc(cleanName) || '—'}</li>
              <li><b>Teléfono:</b> <a href="tel:${esc(cleanPhone)}">${esc(cleanPhone)}</a></li>
              <li><b>Mensaje:</b> ${esc(cleanMsg) || '—'}</li>
            </ul>
            <p style="color:#888;font-size:12px">Widget "¿Te llamamos?" · NodeFlow</p>`;
          await sendEmail({ to: org.owner_email, subject: `📞 Te piden llamada: ${cleanName || cleanPhone}`, html });
          notified = true;
        } catch (_) {}
      }

      if (!persisted && !notified) return res.status(500).json({ error: 'No se pudo registrar la solicitud' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Error interno' });
    }
  });

  // ─── Twilio Webhooks — validated with X-Twilio-Signature ───
  app.post('/voice/inbound', twilioSig, (req, res) => {
    const assistantId = req.query.assistantId || null;
    const wsUrl = `wss://${req.headers.host}/media-stream`;
    log.call(`[Twilio] Inbound call → assistant: ${assistantId || 'default'}`);
    res.type('text/xml').send(generateTwiML(wsUrl, assistantId));
  });

  app.post('/voice/inbound/:assistantId', twilioSig, (req, res) => {
    const wsUrl = `wss://${req.headers.host}/media-stream`;
    log.call(`[Twilio] Inbound call → assistant: ${req.params.assistantId}`);
    res.type('text/xml').send(generateTwiML(wsUrl, req.params.assistantId));
  });

  // BUG-22 FIX: Vonage webhook token validation.
  // Set VONAGE_WEBHOOK_TOKEN env var (any random string), then append ?wt=<token>
  // to your Vonage Answer URL in the dashboard — e.g. https://nodeflow.es/vonage/answer?wt=TOKEN
  // Without a token configured, webhooks are unauthenticated (warning logged at startup).
  const vonageToken = config.vonageWebhookToken || process.env.VONAGE_WEBHOOK_TOKEN || null;
  if (!vonageToken) {
    log.warn('VONAGE_WEBHOOK_TOKEN no configurado — webhooks Vonage sin autenticación de token');
  }
  function vonageValidate(req, res, next) {
    if (!vonageToken) return next();
    const provided = req.query.wt || req.body?.wt;
    if (provided !== vonageToken) {
      log.error(`[Vonage] Token inválido desde ${req.ip}`);
      return res.status(403).json([]);
    }
    next();
  }

  // ─── Vonage Webhooks (token-validated) ───
  app.get('/vonage/answer', vonageValidate, (req, res) => {
    const assistantId = req.query.assistantId || null;
    const callerNumber = req.query.from || null;
    const wsUrl = `wss://${req.headers.host}/vonage-stream`;
    log.call(`[Vonage] Inbound call from ${callerNumber} → assistant: ${assistantId || 'default'}`);
    res.type('application/json').send(generateNCCO(wsUrl, assistantId, callerNumber));
  });

  app.get('/vonage/answer/:assistantId', vonageValidate, (req, res) => {
    const callerNumber = req.query.from || null;
    const wsUrl = `wss://${req.headers.host}/vonage-stream`;
    log.call(`[Vonage] Inbound call → assistant: ${req.params.assistantId}`);
    res.type('application/json').send(generateNCCO(wsUrl, req.params.assistantId, callerNumber));
  });

  // Event URL: Vonage posts call state changes here (ringing, answered, completed...)
  app.post('/vonage/event', vonageValidate, (req, res) => {
    log.call(`[Vonage] Event: ${req.body?.status || 'unknown'}`, {
      uuid: req.body?.uuid,
      duration: req.body?.duration,
    });
    res.status(200).end();
  });

  // ─── Telnyx Webhooks (TeXML — same as TwiML) ───
  // Configure in Telnyx dashboard:
  //   Voice → Connection → Webhook URL: https://xmehd4.easypanel.host/voice/telnyx
  //   Webhook HTTP Method: POST
  //
  // Optional: set TELNYX_API_KEY in .env to enable outbound calls via API
  app.post('/voice/telnyx', async (req, res) => {
    // Firma Telnyx (opt-in: solo si TELNYX_PUBLIC_KEY está puesta). Sin la clave
    // no verifica → no cambia nada. Con ella, rechaza webhooks no firmados.
    if (!verifyTelnyxRequest(req)) { log.warn('[Telnyx] /voice/telnyx firma inválida — 403'); return res.sendStatus(403); }
    const wsUrl = `wss://${req.headers.host}/telnyx-stream`;
    const callerNumber = req.body?.From || req.body?.from || 'unknown';
    const calledNumber = req.body?.To   || req.body?.to   || 'unknown';
    // Multi-tenant: todos los números comparten esta TeXML App, así que el
    // asistente se resuelve AQUÍ por el número llamado y viaja como parámetro
    // explícito del stream. Prioridad: pool (org del cliente → su asistente
    // del portal) → asistentes de archivo → default.
    let assistantId = req.query.assistantId || null;
    if (!assistantId && calledNumber !== 'unknown') {
      try {
        const orgId = await pipeline._resolveOrgId(calledNumber);
        if (orgId) assistantId = orgId;
      } catch (e) { log.warn(`[Telnyx] pool resolve fallo: ${e.message}`); }
      if (!assistantId) {
        const byNumber = assistantManager.getByPhoneNumber(calledNumber);
        if (byNumber) assistantId = byNumber.id;
      }
    }
    log.call(`[Telnyx] Inbound call from ${callerNumber} → ${calledNumber} | assistant: ${assistantId || 'default'}`);
    res.type('text/xml').send(generateTeXML(wsUrl, assistantId));
  });

  app.post('/voice/telnyx/:assistantId', (req, res) => {
    if (!verifyTelnyxRequest(req)) { log.warn('[Telnyx] /voice/telnyx/:id firma inválida — 403'); return res.sendStatus(403); }
    const wsUrl = `wss://${req.headers.host}/telnyx-stream`;
    const callerNumber = req.body?.From || req.body?.from || 'unknown';
    log.call(`[Telnyx] Inbound call from ${callerNumber} → assistant: ${req.params.assistantId}`);
    res.type('text/xml').send(generateTeXML(wsUrl, req.params.assistantId));
  });

  // Telnyx status webhook (call state changes)
  app.post('/telnyx/status', (req, res) => {
    if (!verifyTelnyxRequest(req)) { log.warn('[Telnyx] /telnyx/status firma inválida — 403'); return res.sendStatus(403); }
    const payload = req.body?.data || req.body;
    log.call(`[Telnyx] Status: ${payload?.event_type || 'unknown'}`, {
      call_control_id: payload?.payload?.call_control_id,
      call_duration: payload?.payload?.call_duration,
    });
    res.status(200).end();
  });

  // ─── Organization ───
  app.get('/api/org', auth, (req, res) => {
    const org = req.org;
    const limits = PLAN_LIMITS[org.plan] || PLAN_LIMITS.negocio;
    res.json({
      id: org.id,
      name: org.name,
      plan: org.plan,
      limits,
      usage: {
        minutesUsed: org.monthly_minutes_used || 0,
        minutesLimit: limits.minutesPerMonth,
      },
    });
  });

  // ─── Assistants CRUD ───
  app.get('/api/assistants', auth, async (req, res) => {
    try {
      // Try DB first
      if (db.enabled && req.org.id !== 'legacy') {
        const assistants = await db.getAssistants(req.org.id);
        return res.json({ assistants });
      }
      // Fallback to file-based
      res.json({ assistants: assistantManager.list() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const assistant = await db.getAssistant(req.org.id, req.params.id);
        if (!assistant) return res.status(404).json({ error: 'Assistant not found' });
        return res.json({ assistant });
      }
      const assistant = assistantManager.get(req.params.id);
      if (!assistant) return res.status(404).json({ error: 'Assistant not found' });
      res.json({ assistant });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/assistants', auth, limit, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const limits = PLAN_LIMITS[req.org.plan] || PLAN_LIMITS.negocio;
        const existing = await db.getAssistants(req.org.id);
        if (existing.length >= limits.assistants) {
          return res.status(402).json({
            error: `Assistant limit reached (${limits.assistants} on ${req.org.plan} plan)`,
          });
        }
        const assistant = await db.createAssistant(req.org.id, req.body);
        return res.status(201).json({ assistant });
      }
      const { id, ...cfg } = req.body;
      const assistantId = id || `assistant-${Date.now()}`;
      const assistant = assistantManager.upsert(assistantId, cfg);
      res.status(201).json({ assistant });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const updated = await db.updateAssistant(req.org.id, req.params.id, req.body);
        return res.json({ assistant: updated });
      }
      const existing = assistantManager.get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Assistant not found' });
      const updated = assistantManager.upsert(req.params.id, { ...existing, ...req.body });
      res.json({ assistant: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/assistants/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        await db.deleteAssistant(req.org.id, req.params.id);
        return res.json({ success: true });
      }
      assistantManager.delete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Calls ───
  app.get('/api/calls/active', auth, (req, res) => {
    res.json({ calls: pipeline.getActiveCalls() });
  });

  app.get('/api/calls/history', auth, async (req, res) => {
    try {
      // BUG-24 FIX: Cap the limit to prevent fetching millions of rows
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      if (db.enabled && req.org.id !== 'legacy') {
        const calls = await db.getCalls(req.org.id, { limit });
        return res.json({ calls });
      }
      res.json({ calls: pipeline.getCallHistory(limit) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/calls/:id', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const call = await db.getCall(req.org.id, req.params.id);
        if (!call) return res.status(404).json({ error: 'Call not found' });
        return res.json({ call });
      }
      res.status(404).json({ error: 'Call not found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/calls/outbound', auth, limit, checkUsageLimits(), async (req, res) => {
    const { to, assistantId, from, provider = 'auto' } = req.body;
    if (!to || !assistantId) return res.status(400).json({ error: 'Missing to or assistantId' });

    const publicUrl = config.publicUrl;

    try {
      // Auto-detect provider: use Vonage if configured, else Twilio
      const useVonage = (provider === 'vonage') ||
        (provider === 'auto' && config.vonageApiKey && config.vonageApplicationId);

      if (useVonage) {
        const { Vonage } = require('@vonage/server-sdk');
        const vonage = new Vonage({
          apiKey: config.vonageApiKey,
          apiSecret: config.vonageApiSecret,
          applicationId: config.vonageApplicationId,
          privateKey: config.vonagePrivateKeyPath || './vonage_private.key',
        });
        const result = await vonage.voice.createOutboundCall({
          to: [{ type: 'phone', number: to }],
          from: { type: 'phone', number: from || config.vonagePhoneNumber },
          answer_url: [`${publicUrl}/vonage/answer/${assistantId}`],
          event_url: [`${publicUrl}/vonage/event`],
        });
        log.call(`[Vonage] Outbound call started → ${to}`);
        res.json({ success: true, callUUID: result.uuid, provider: 'vonage' });
      } else {
        const twilio = require('twilio')(config.twilioAccountSid, config.twilioAuthToken);
        const call = await twilio.calls.create({
          to,
          from: from || config.twilioPhoneNumber,
          url: `${publicUrl}/voice/inbound/${assistantId}`,
        });
        log.call(`[Twilio] Outbound call started → ${to}`);
        res.json({ success: true, callSid: call.sid, provider: 'twilio' });
      }
    } catch (error) {
      log.error('Outbound call failed', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Usage ───
  app.get('/api/usage', auth, async (req, res) => {
    try {
      if (db.enabled && req.org.id !== 'legacy') {
        const current = await db.getUsage(req.org.id);
        const history = await db.getUsageHistory(req.org.id, 6);
        return res.json({ current, history });
      }
      res.json({ current: null, history: [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Metrics ───
  app.get('/api/metrics', auth, (req, res) => {
    res.json({ metrics: pipeline.getMetrics() });
  });

  // ─── Health (no auth) ───
  // bootId: identifica ESTE arranque del servidor. El portal lo compara al
  // abrir y, si cambió (hubo deploy), purga su caché y se recarga solo —
  // fin de los clientes con HTML/JS viejos tras cada deploy (caso real
  // 2026-07-03: el dueño no veía features ya desplegadas).
  app.get('/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Readiness real: antes devolvía SIEMPRE status:'ok' y database:'connected'
    // (derivado de db.enabled, fijado al arrancar) → si la BD caía en runtime el
    // monitor no se enteraba jamás. Ahora hace un ping ligero con timeout.
    let database = db.enabled ? 'connected' : 'memory';
    let status = 'ok';
    if (db.enabled) {
      try {
        await Promise.race([
          db.client.from('organizations').select('id').limit(1),
          new Promise((_, rej) => setTimeout(() => rej(new Error('db ping timeout')), 2500)),
        ]);
      } catch (_) {
        database = 'unreachable';
        status = 'degraded'; // el monitor alerta por status!=='ok'; mantenemos HTTP 200
      }                       // para NO provocar reinicios en bucle si la BD está caída
    }
    // Redis: 'connected' si REDIS_URL está y responde (rate-limit multi-réplica);
    // 'memory' si no (una sola instancia). Sirve para verificar el alta de Redis.
    let redis = 'memory';
    try { if (require('../utils/rate-store').isRedisEnabled()) redis = 'connected'; } catch (_) {}
    // leader: ¿esta réplica ejecuta los crons? (con multi-réplica, solo una).
    let leader = true;
    try { leader = require('../utils/leader').isLeader(); } catch (_) {}
    res.json({
      status,
      version: '2.0.0',
      bootId: BOOT_ID,
      uptime: process.uptime(),
      activeCalls: pipeline.getActiveCalls().length,
      assistants: assistantManager.list().length,
      database,
      redis,
      leader,
    });
  });

  log.info('API routes configured');
}

module.exports = { setupRoutes };
