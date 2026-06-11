// ============================================================
// NodeFlow — Widget de captura "¿Te llamamos?"
// Endpoint público que el negocio embebe en su web. El visitante
// deja su número y el dueño recibe el aviso al instante para
// llamarle (o el asistente IA en el futuro, con outbound).
//
// Público + rate-limited + CORS abierto. Valida que el negocio
// exista y esté activo antes de notificar.
//
// POST /api/widget/callback  { orgId, name?, phone, message? }
// ============================================================

'use strict';

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const { rateLimit } = require('../utils/rate-limiter');

const log = new Logger('WIDGET');

function setupWidgetRoutes(app) {
  // Rate limit: máx 8 solicitudes por IP cada 10 min (evita spam del formulario)
  const widgetLimit = rateLimit({ max: 8, windowMs: 10 * 60 * 1000, keyPrefix: 'widget',
    message: 'Has enviado demasiadas solicitudes. Inténtalo de nuevo en unos minutos.' });

  // CORS abierto SOLO para este endpoint (la web del cliente lo llama desde su dominio)
  app.options('/api/widget/callback', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  app.post('/api/widget/callback', widgetLimit, async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');

    const orgId   = String(req.body?.orgId   || '').trim();
    const name    = String(req.body?.name    || '').trim().slice(0, 80);
    const phoneRaw= String(req.body?.phone   || '').trim();
    const message = String(req.body?.message || '').trim().slice(0, 300);

    // Validación de teléfono
    const phone = phoneRaw.replace(/[\s\-().+]/g, '');
    if (!orgId)               return res.status(400).json({ error: 'orgId requerido' });
    if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Teléfono inválido' });

    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'Servicio no disponible' });

      // El negocio debe existir y estar activo
      const org = await db.getOrg(orgId);
      if (!org || org.is_active === false) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const bizName    = org.name || 'tu negocio';
      const ownerEmail = org.owner_email || process.env.NOTIFY_EMAIL;
      const cfg        = org.automation_config?.config || {};
      const alertPhone = cfg.alertPhone || org.phone || null;

      // 1. Guardar como lead/callback (tabla nf_callbacks; si no existe, se ignora)
      db.client.from('nf_callbacks').insert({
        organization_id: orgId,
        name:    name || null,
        phone,
        message: message || null,
        status:  'pending',
        created_at: new Date().toISOString(),
      }).then(({ error }) => { if (error && error.code !== '42P01') log.warn(`callback insert: ${error.message}`); })
        .catch(() => {});

      // 2. Email al dueño (canal fiable — Resend ya configurado)
      try {
        const { sendEmail } = require('../notifications/email');
        if (ownerEmail) {
          sendEmail({
            to: ownerEmail,
            subject: `📞 Te piden que llames — ${name || phone}`,
            html: `<div style="font-family:sans-serif;max-width:480px;padding:24px;background:#0c0c16;border-radius:12px;color:#e8e8f0;">
              <h2 style="color:#a29bfe;margin:0 0 12px;">📞 Solicitud de llamada</h2>
              <p style="color:#9090b0;margin:0 0 16px;">Un visitante de la web de <strong>${esc(bizName)}</strong> quiere que le llames:</p>
              <table style="font-size:14px;">
                <tr><td style="color:#888;padding:3px 10px 3px 0;">Nombre</td><td>${esc(name || '—')}</td></tr>
                <tr><td style="color:#888;padding:3px 10px 3px 0;">Teléfono</td><td><strong>${esc(phone)}</strong></td></tr>
                ${message ? `<tr><td style="color:#888;padding:3px 10px 3px 0;vertical-align:top;">Mensaje</td><td>${esc(message)}</td></tr>` : ''}
              </table>
              <a href="tel:${esc(phone)}" style="display:inline-block;margin-top:18px;background:#6c5ce7;color:#fff;padding:11px 24px;border-radius:10px;text-decoration:none;font-weight:700;">📞 Llamar ahora</a>
            </div>`,
            text: `Solicitud de llamada en ${bizName}: ${name || '—'} · ${phone} · ${message || ''}`,
          }).catch(() => {});
        }
      } catch (_) {}

      // 3. Aviso WhatsApp al dueño (funciona cuando WA esté configurado)
      if (alertPhone) {
        try {
          const { sendText, isConfigured } = require('../notifications/client-whatsapp');
          if (isConfigured()) {
            sendText(alertPhone,
              `📞 *Te piden que llames* (web de ${bizName})\n👤 ${name || '—'}\n📞 ${phone}${message ? `\n💬 ${message}` : ''}`
            ).catch(() => {});
          }
        } catch (_) {}
      }

      log.info(`Callback widget: ${bizName} ← ${name || '?'} ${phone}`);
      res.json({ ok: true, message: '¡Gracias! Te llamaremos en breve.' });
    } catch (e) {
      log.error(`widget callback error: ${e.message}`);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  log.info('Widget routes configured → POST /api/widget/callback');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { setupWidgetRoutes };
