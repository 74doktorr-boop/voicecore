// ============================================================
// NodeFlow — Chat WEB: endpoint público del widget
// El negocio embebe el widget en su web; el visitante escribe y el asistente
// (mismo cerebro que voz/WhatsApp) responde y RESERVA. Público + rate-limited +
// CORS abierto. Valida org activa + plan Pro (voz/chat avanzado = Pro).
//
// POST /api/chat  { orgId, sessionId, text }  → { ok, reply?, booked? }
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const { rateLimit } = require('../utils/rate-limiter');

const log = new Logger('CHAT');

function setupChatRoutes(app) {
  // Un chat necesita más margen que el formulario: 30 mensajes / 5 min por IP.
  const chatLimit = rateLimit({ max: 30, windowMs: 5 * 60 * 1000, keyPrefix: 'chat',
    message: 'Demasiados mensajes seguidos. Espera un momento y sigue.' });

  app.options('/api/chat', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  // GET /api/chat/config?orgId= — la burbuja pregunta si mostrarse + nombre/saludo.
  // Público. {ok:false} si la org no existe / no es Pro / el dueño lo apagó →
  // el widget no se pinta. No revela nada sensible.
  app.get('/api/chat/config', chatLimit, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const orgId = String(req.query.orgId || '').trim();
    if (!orgId) return res.json({ ok: false });
    try {
      const db = getDatabase();
      if (!db.enabled) return res.json({ ok: false });
      const org = await db.getOrg(orgId);
      if (!org || org.is_active === false) return res.json({ ok: false });
      const { hasPro } = require('../billing/plan');
      const cfg = org.automation_config?.config || {};
      if (!hasPro(org) || cfg.webChatOff === true) return res.json({ ok: false });
      const name = org.name || 'el negocio';
      res.set('Cache-Control', 'public, max-age=120');
      res.json({ ok: true, name, greeting: cfg.webChatGreeting || `¡Hola! Soy el asistente de ${name}. ¿En qué te ayudo o qué cita necesitas?` });
    } catch (_) { res.json({ ok: false }); }
  });

  app.post('/api/chat', chatLimit, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');

    const orgId     = String(req.body?.orgId     || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim().slice(0, 80);
    const text      = String(req.body?.text      || '').trim().slice(0, 1000);
    if (!orgId || !sessionId) return res.status(400).json({ error: 'orgId y sessionId requeridos' });
    if (!text)                return res.status(400).json({ error: 'text requerido' });

    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ ok: false });

      const org = await db.getOrg(orgId);
      if (!org || org.is_active === false) return res.status(404).json({ ok: false });

      // Gating: el chat web es un canal avanzado → plan Pro. Y respeta un OFF
      // explícito del dueño (config.webChatOff). Respuesta neutra si no aplica.
      const { hasPro } = require('../billing/plan');
      const cfgRaw = org.automation_config?.config || {};
      if (!hasPro(org) || cfgRaw.webChatOff === true) {
        return res.json({ ok: false, reason: 'unavailable' });
      }

      // Config para el prompt (mismo material que voz/WhatsApp).
      const config = {
        name:        org.name || 'el negocio',
        language:    org.language || org.assistant_config?.language || 'es',
        serviceList: cfgRaw.serviceList || [],
        address:     cfgRaw.address || org.assistant_config?.address || null,
      };

      const { generateChatReply } = require('../webchat/chat-agent');
      // El widget manda su historial → stateless, multi-réplica safe. Se acota y
      // se saneará dentro (solo user/assistant). Sin él, hilo in-memory.
      const history = Array.isArray(req.body?.messages) ? req.body.messages.slice(-24) : undefined;
      const r = await generateChatReply({ businessId: orgId, sessionId, text, config, history });
      if (!r.ok) {
        // Sin respuesta útil → fallback honesto (que dejen su contacto).
        return res.json({ ok: false, reply: 'Ahora mismo no puedo con eso. ¿Me dejas tu teléfono y te llamamos?' });
      }
      return res.json({ ok: true, reply: r.reply, booked: !!r.booked });
    } catch (e) {
      log.warn(`chat ${orgId}: ${e.message}`);
      res.status(500).json({ ok: false });
    }
  });

  log.info('Chat routes configured → POST /api/chat');
}

module.exports = { setupChatRoutes };
