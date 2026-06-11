'use strict';
// ============================================================
// NodeFlow — WhatsApp Webhook (Meta Cloud API)
// Recibe mensajes entrantes y respuestas de botones del cliente.
// GET  /whatsapp/webhook  — verificación Meta (hub challenge)
// POST /whatsapp/webhook  — mensajes entrantes + button replies
// ============================================================

const crypto            = require('crypto');
const { Logger }        = require('../utils/logger');
const { handleReply }   = require('../whatsapp/reply-handler');

const log = new Logger('WA-WEBHOOK');

// Verifica la firma X-Hub-Signature-256 que Meta añade a cada webhook.
// Devuelve true si la firma es válida (o si no hay App Secret configurado aún,
// para permitir el setup inicial — con aviso). false sólo si hay secret y NO casa.
function verifyMetaSignature(req) {
  const appSecret = process.env.WA_APP_SECRET;
  if (!appSecret) {
    log.warn('WA_APP_SECRET no configurado — webhook SIN verificar firma (configúralo para producción)');
    return true; // permitir durante el setup inicial
  }
  const sigHeader = req.headers['x-hub-signature-256'] || '';
  const raw = req.rawBody;
  if (!sigHeader || !raw) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(sigHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setupWhatsAppWebhook(app) {

  // ── GET: Meta webhook verification ──────────────────────────────────────────
  // Meta llama a este endpoint cuando configuras el webhook en el panel.
  // Debe responder con hub.challenge para verificar propiedad del servidor.
  app.get('/whatsapp/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'nodeflow-wa-webhook';
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      log.info('WhatsApp webhook verificado por Meta ✓');
      return res.status(200).send(challenge);
    }
    // No registramos el token recibido para no filtrarlo en logs
    log.warn(`Webhook verification failed — mode=${mode} token mismatch`);
    res.sendStatus(403);
  });

  // ── POST: Mensajes entrantes ─────────────────────────────────────────────────
  // Meta envía aquí todos los mensajes: texto libre, respuestas de botón,
  // confirmaciones de entrega, etc.
  app.post('/whatsapp/webhook', async (req, res) => {
    // Verificar que la petición viene realmente de Meta (firma HMAC).
    // Sin esto, cualquiera podría enviar un "CANCELAR" falso y anular citas.
    if (!verifyMetaSignature(req)) {
      log.warn('Webhook con firma inválida — descartado');
      return res.sendStatus(401);
    }

    // Responder 200 INMEDIATAMENTE — Meta reintenta si no recibe respuesta en <20s
    res.sendStatus(200);

    try {
      const body = req.body;
      if (body?.object !== 'whatsapp_business_account') return;

      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          if (change.field !== 'messages') continue;
          const value = change.value || {};
          const messages = value.messages || [];

          for (const msg of messages) {
            const from = msg.from; // phone number sin +: "34612345678"

            // ── Respuesta de botón (CONFIRMAR / CANCELAR) ───────────────────
            if (msg.type === 'button') {
              const payload = msg.button?.payload || msg.button?.text || '';
              log.info(`Button reply from ${from}: "${payload}"`);
              await handleReply({ from, type: 'button', payload }).catch(e =>
                log.error(`reply-handler error: ${e.message}`)
              );
              continue;
            }

            // ── Respuesta interactiva (quick_reply en template) ──────────────
            if (msg.type === 'interactive') {
              const btnReply = msg.interactive?.button_reply;
              if (btnReply) {
                const payload = btnReply.id || btnReply.title || '';
                log.info(`Interactive button from ${from}: "${payload}"`);
                await handleReply({ from, type: 'button', payload }).catch(e =>
                  log.error(`reply-handler error: ${e.message}`)
                );
              }
              continue;
            }

            // ── Texto libre ──────────────────────────────────────────────────
            if (msg.type === 'text') {
              const text = msg.text?.body?.trim() || '';
              log.info(`Text from ${from}: "${text.slice(0, 60)}"`);
              // Detectar CONFIRMAR / CANCELAR escritos a mano también
              const upper = text.toUpperCase();
              if (upper.includes('CONFIRMAR') || upper.includes('CONFIRMO') || upper === 'SI' || upper === 'SÍ' || upper === 'OK') {
                await handleReply({ from, type: 'button', payload: 'CONFIRMAR' }).catch(e =>
                  log.error(`reply-handler error: ${e.message}`)
                );
              } else if (upper.includes('CANCELAR') || upper.includes('CANCELO') || upper.includes('ANULAR') || upper.includes('NO PUEDO')) {
                await handleReply({ from, type: 'button', payload: 'CANCELAR' }).catch(e =>
                  log.error(`reply-handler error: ${e.message}`)
                );
              }
              // Texto libre que no es CONFIRMAR/CANCELAR → ignorar por ahora
              // (en el futuro: pasar al bot conversacional)
            }
          }
        }
      }
    } catch (e) {
      log.error(`Webhook processing error: ${e.message}`);
    }
  });

  log.info('WhatsApp webhook configured → GET/POST /whatsapp/webhook');
}

module.exports = { setupWhatsAppWebhook };
