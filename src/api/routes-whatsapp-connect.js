// ============================================================
// NodeFlow — WhatsApp Connect (360dialog Embedded Signup)
// Permite a cada negocio conectar su propio WABA al portal.
//
// GET    /api/portal/whatsapp/status   — estado conexión del negocio
// POST   /api/portal/whatsapp/connect  — intercambia code OAuth → token
// DELETE /api/portal/whatsapp/connect  — revoca credenciales
//
// Flujo Embedded Signup:
//   1. Frontend abre popup → hub.360dialog.com/dashboard/app/{PARTNER_ID}/permissions
//   2. Negocio autoriza → 360dialog redirige a /api/portal/whatsapp/connect?client_id=...&channels=...
//   3. Este endpoint intercambia client_id → API key + phone_number_id via 360dialog Partner API
//   4. Guarda en Supabase (cifrado) → negocio conectado
//
// Env vars: DIALOG360_PARTNER_TOKEN, DIALOG360_PARTNER_ID
// ============================================================

'use strict';

const https    = require('https');
const { Logger } = require('../utils/logger');
const { saveWaCredentials, getWaCredentials, revokeWaCredentials } = require('../whatsapp/accounts');

const log = new Logger('WA-CONNECT');

const DIALOG360_API_BASE = 'hub.360dialog.io';

// ── Helper: request 360dialog Partner API ──────────────────────────────────
function dialog360Request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const partnerToken = process.env.DIALOG360_PARTNER_TOKEN;
    if (!partnerToken) {
      return reject(new Error('DIALOG360_PARTNER_TOKEN not configured'));
    }

    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: DIALOG360_API_BASE,
      path,
      method,
      headers: {
        'D360-PARTNER-TOKEN': partnerToken,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Middleware de autenticación portal ──────────────────────────────────────
// Requiere que req.businessId esté establecido por el portalAuth middleware.
// Si no existe portalAuth en el proyecto, usa header X-Business-Id (solo dev).
function requirePortalAuth(req, res, next) {
  // Intentar obtener businessId de sesión/JWT (portalAuth middleware)
  if (req.businessId) return next();
  // Fallback: header de desarrollo (NO usar en producción)
  const devId = req.headers['x-business-id'];
  if (devId && process.env.NODE_ENV !== 'production') {
    req.businessId = devId;
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

// ── Routes ──────────────────────────────────────────────────────────────────

function setupWhatsAppConnectRoutes(app) {

  // ── GET /api/portal/whatsapp/status ────────────────────────────────────────
  // Devuelve estado de conexión del negocio actual.
  app.get('/api/portal/whatsapp/status', requirePortalAuth, async (req, res) => {
    try {
      const creds = await getWaCredentials(req.businessId);
      if (!creds) {
        return res.json({ connected: false });
      }
      return res.json({
        connected:     true,
        phoneNumber:   creds.phoneNumber,
        wabaId:        creds.wabaId,
        // No exponer accessToken ni phoneNumberId al frontend
      });
    } catch (e) {
      log.error(`status error: ${e.message}`);
      return res.status(500).json({ error: 'Error al obtener estado' });
    }
  });

  // ── POST /api/portal/whatsapp/connect ──────────────────────────────────────
  // Recibe el code/client_id de 360dialog Embedded Signup y lo intercambia
  // por las credenciales de API del WABA del negocio.
  //
  // Body (JSON): { client_id: "...", channels: [...] }  ← enviado por el frontend
  //   o bien como query params si se usa redirect_url directo.
  app.post('/api/portal/whatsapp/connect', requirePortalAuth, async (req, res) => {
    const businessId = req.businessId;

    // Acepta tanto body JSON como query params
    const clientId = req.body?.client_id || req.query?.client_id;
    const channels  = req.body?.channels  || (req.query?.channels ? JSON.parse(req.query.channels) : null);

    if (!clientId) {
      return res.status(400).json({ error: 'client_id requerido' });
    }

    try {
      // 1. Obtener API key del cliente 360dialog (el WABA del negocio)
      //    POST /v1/partners/{partnerId}/channels/whatsapp/api-keys/
      const partnerId = process.env.DIALOG360_PARTNER_ID;
      if (!partnerId) {
        return res.status(500).json({ error: 'DIALOG360_PARTNER_ID no configurado' });
      }

      log.info(`Connecting WA for business ${businessId} (client_id: ${clientId})`);

      const keyRes = await dialog360Request(
        'POST',
        `/v1/partners/${partnerId}/channels/whatsapp/api-keys/`,
        { client_id: clientId }
      );

      if (keyRes.status !== 200 || !keyRes.body?.api_key) {
        log.warn(`360dialog api-key error: ${JSON.stringify(keyRes.body)}`);
        return res.status(502).json({
          error: 'Error al obtener API key de 360dialog',
          detail: keyRes.body?.message || keyRes.body,
        });
      }

      const apiKey = keyRes.body.api_key;

      // 2. Obtener info del número (phone_number_id, waba_id, número)
      //    360dialog API usa D360-API-KEY header en lugar de Bearer
      const phoneInfo = await getPhoneNumberInfo(apiKey);
      if (!phoneInfo) {
        return res.status(502).json({ error: 'No se pudo obtener info del número WA' });
      }

      // 3. Guardar en Supabase (cifrado)
      await saveWaCredentials(businessId, {
        wabaId:        phoneInfo.wabaId,
        phoneNumberId: phoneInfo.phoneNumberId,
        accessToken:   apiKey,          // en 360dialog el "token" es la API key
        phoneNumber:   phoneInfo.phoneNumber,
        displayName:   phoneInfo.displayName,
        apiBase:       'waba.360dialog.io', // diferente al Meta base
      });

      log.info(`WA connected for ${businessId}: ${phoneInfo.phoneNumber}`);

      // 4. Auto-submit templates (fire & forget)
      setImmediate(() => submitTemplates(apiKey, phoneInfo.phoneNumberId, businessId));

      return res.json({
        ok:          true,
        phoneNumber: phoneInfo.phoneNumber,
        wabaId:      phoneInfo.wabaId,
      });

    } catch (e) {
      log.error(`connect error for ${businessId}: ${e.message}`);
      return res.status(500).json({ error: 'Error interno al conectar WhatsApp' });
    }
  });

  // ── DELETE /api/portal/whatsapp/connect ────────────────────────────────────
  // Revoca la conexión WhatsApp del negocio.
  app.delete('/api/portal/whatsapp/connect', requirePortalAuth, async (req, res) => {
    try {
      await revokeWaCredentials(req.businessId);
      return res.json({ ok: true });
    } catch (e) {
      log.error(`revoke error: ${e.message}`);
      return res.status(500).json({ error: 'Error al revocar credenciales' });
    }
  });

  // ── GET /api/portal/whatsapp/connect (redirect desde 360dialog) ────────────
  // 360dialog redirige aquí tras el Embedded Signup si redirect_url
  // apunta a este endpoint. Extrae client_id del query y cierra el popup.
  app.get('/api/portal/whatsapp/connect', async (req, res) => {
    const clientId = req.query?.client_id;
    const channels  = req.query?.channels;
    const state     = req.query?.state; // businessId pasado en la URL de signup

    if (!clientId || !state) {
      return res.status(400).send('Parámetros incompletos');
    }

    // Redirigir al portal con los parámetros para que el frontend cierre el popup
    // y llame al POST endpoint con autenticación
    const redirectUrl = new URL('/portal/whatsapp-callback', process.env.PUBLIC_URL || 'https://nodeflow.es');
    redirectUrl.searchParams.set('client_id', clientId);
    redirectUrl.searchParams.set('state', state);
    if (channels) redirectUrl.searchParams.set('channels', channels);

    return res.redirect(redirectUrl.toString());
  });

  log.info('WhatsApp Connect routes configured → /api/portal/whatsapp/*');
}

// ── Helper: obtener info del número via 360dialog ──────────────────────────
async function getPhoneNumberInfo(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'waba.360dialog.io',
      path:     '/v1/configs/phone_number',
      method:   'GET',
      headers:  { 'D360-API-KEY': apiKey },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Estructura 360dialog: { phone_number, verified_name, waba_id, id (phone_number_id) }
          if (!json.id) { log.warn(`getPhoneNumberInfo: ${data}`); return resolve(null); }
          resolve({
            phoneNumberId: json.id,
            phoneNumber:   json.phone_number || json.display_phone_number,
            displayName:   json.verified_name || json.display_name,
            wabaId:        json.waba_id,
          });
        } catch (e) {
          log.warn(`getPhoneNumberInfo parse: ${e.message}`);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => { log.warn(`getPhoneNumberInfo req: ${e.message}`); resolve(null); });
    req.end();
  });
}

// ── Helper: auto-submit templates al conectar ──────────────────────────────
async function submitTemplates(apiKey, phoneNumberId, businessId) {
  // Los 3 templates de NodeFlow
  const templates = [
    {
      name: 'nodeflow_cita_confirmada',
      category: 'UTILITY',
      language: 'es',
      components: [
        {
          type: 'BODY',
          text: 'Hola {{1}}, tu cita en {{2}} ha sido confirmada para el {{3}} a las {{4}}. Servicio: {{5}}.',
        },
        { type: 'FOOTER', text: 'NodeFlow — Sistema de citas inteligente' },
      ],
    },
    {
      name: 'nodeflow_cita_recordatorio',
      category: 'UTILITY',
      language: 'es',
      components: [
        {
          type: 'BODY',
          text: 'Hola {{1}}, te recordamos tu cita en {{2}} mañana {{3}} a las {{4}}. Servicio: {{5}}.',
        },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'CONFIRMAR' },
            { type: 'QUICK_REPLY', text: 'CANCELAR'  },
          ],
        },
      ],
    },
    {
      name: 'nodeflow_resena',
      category: 'UTILITY',
      language: 'es',
      components: [
        {
          type: 'BODY',
          text: '¡Hola {{1}}! ¿Qué tal tu experiencia en {{2}}? Tu opinión es muy importante para nosotros.',
        },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Dejar reseña', url: '{{1}}' },
          ],
        },
      ],
    },
  ];

  for (const tpl of templates) {
    try {
      await new Promise((resolve, reject) => {
        const payload = JSON.stringify(tpl);
        const options = {
          hostname: 'waba.360dialog.io',
          path:     '/v1/configs/templates',
          method:   'POST',
          headers:  {
            'D360-API-KEY':   apiKey,
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        };
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            log.info(`Template ${tpl.name} submitted for ${businessId}: HTTP ${res.statusCode}`);
            resolve();
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
    } catch (e) {
      log.warn(`Template ${tpl.name} submit failed for ${businessId}: ${e.message}`);
    }
  }
}

module.exports = { setupWhatsAppConnectRoutes };
