'use strict';
// ============================================================
// NodeFlow — WhatsApp Webhook (Meta Cloud API)
// Recibe mensajes entrantes y respuestas de botones del cliente.
// GET  /whatsapp/webhook  — verificación Meta (hub challenge)
// POST /whatsapp/webhook  — mensajes entrantes + button replies
// ============================================================

const crypto            = require('crypto');
const { Logger }        = require('../utils/logger');
const { handleReply, isOptOut, handleOptOut, isCourtesy, notifyOwnerFreeText, handleCheckinFeedback, handleCheckinButton, handleWaitlistResponse } = require('../whatsapp/reply-handler');
const { handleTemplateStatusUpdate } = require('../whatsapp/template-alerts');
const { getBusinessIdByPhoneNumberId, resolveInboundBusiness } = require('../whatsapp/accounts');

const log = new Logger('WA-WEBHOOK');

// Verifica la firma X-Hub-Signature-256 que Meta añade a cada webhook.
// Devuelve true si la firma es válida (o si no hay App Secret configurado aún,
// para permitir el setup inicial — con aviso). false sólo si hay secret y NO casa.
function verifyMetaSignature(req) {
  const appSecret = process.env.WA_APP_SECRET;
  if (!appSecret) {
    // Auditoría 2026-07-08: en producción FALLA CERRADO — sin secret, un POST
    // falso podría inyectar opt-outs/respuestas. El fail-open queda solo para
    // desarrollo (setup inicial sin credenciales).
    if (process.env.NODE_ENV === 'production') {
      log.error('WA_APP_SECRET no configurado en PRODUCCIÓN — webhook rechazado (fail-closed)');
      return false;
    }
    log.warn('WA_APP_SECRET no configurado — webhook SIN verificar firma (solo desarrollo)');
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
          // ── Aprobación/rechazo de PLANTILLAS (2026-07-07): Meta lo empuja
          // por webhook — avisar a Unai al instante en vez de que pregunte.
          if (change.field === 'message_template_status_update') {
            handleTemplateStatusUpdate(change.value || {}).catch(e =>
              log.warn(`template status update: ${e.message}`));
            continue;
          }
          if (change.field !== 'messages') continue;
          const value = change.value || {};
          const messages = value.messages || [];

          const phoneNumberId = value?.metadata?.phone_number_id;

          for (const msg of messages) {
            const from = msg.from; // phone number sin +: "34612345678"
            // Negocio de ESTE mensaje. Se resuelve por el teléfono del cliente
            // (quien le escribió por WhatsApp) + su número propio/contacto — no
            // solo por el número que recibe (el global compartido no distingue).
            const businessId = await resolveInboundBusiness(phoneNumberId, from).catch(() => null);

            // ── Opt-out / BAJA (prioritario, cumplimiento WhatsApp) ──────────
            const _optText = msg.type === 'text' ? (msg.text?.body || '')
                           : msg.type === 'button' ? (msg.button?.payload || msg.button?.text || '')
                           : msg.type === 'interactive' ? (msg.interactive?.button_reply?.title || msg.interactive?.button_reply?.id || '')
                           : '';
            // Transcript: registra el mensaje ENTRANTE del cliente.
            if (_optText && businessId) {
              try { require('../whatsapp/wa-log').logWaMessage({ orgId: businessId, phone: from, direction: 'in', body: _optText, kind: msg.type }); } catch (_) {}
            }
            if (isOptOut(_optText)) {
              log.info(`Opt-out from ${from}: "${_optText.slice(0, 40)}"`);
              await handleOptOut({ from, businessId }).catch(e =>
                log.error(`opt-out error: ${e.message}`)
              );
              continue;
            }

            // ── Respuesta de botón (CONFIRMAR / CANCELAR / check-in 👍👎) ────
            if (msg.type === 'button') {
              const payload = msg.button?.payload || msg.button?.text || '';
              log.info(`Button reply from ${from}: "${payload}"`);
              // Prioridad: oferta de hueco libre → check-in 👍👎 → confirmar/cancelar.
              let handled = await handleWaitlistResponse({ from, businessId, payload })
                .catch(e => { log.error(`waitlist response error: ${e.message}`); return false; });
              if (!handled) {
                handled = await handleCheckinButton({ from, businessId, payload })
                  .catch(e => { log.error(`checkin button error: ${e.message}`); return false; });
              }
              if (!handled) {
                await handleReply({ from, type: 'button', payload }).catch(e =>
                  log.error(`reply-handler error: ${e.message}`)
                );
              }
              continue;
            }

            // ── Respuesta interactiva (quick_reply en template) ──────────────
            if (msg.type === 'interactive') {
              const btnReply = msg.interactive?.button_reply;
              if (btnReply) {
                const payload = btnReply.id || btnReply.title || '';
                log.info(`Interactive button from ${from}: "${payload}"`);
                let handled = await handleWaitlistResponse({ from, businessId, payload }).catch(() => false);
                if (!handled) handled = await handleCheckinButton({ from, businessId, payload }).catch(() => false);
                if (!handled) {
                  await handleReply({ from, type: 'button', payload }).catch(e =>
                    log.error(`reply-handler error: ${e.message}`)
                  );
                }
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
              } else if (text && !isCourtesy(text)) {
                // ¿Responde por texto a una oferta de hueco libre? ("sí, lo quiero")
                let handledText = await handleWaitlistResponse({ from, businessId, payload: text })
                  .catch(e => { log.error(`waitlist text error: ${e.message}`); return false; });
                // Fase B: si suena NEGATIVO tras un check-in "¿qué tal fue?"
                // reciente → alerta URGENTE al dueño (cazar al insatisfecho
                // antes de la mala reseña). Si no, el aviso genérico de siempre.
                if (!handledText) {
                  handledText = await handleCheckinFeedback({ from, businessId, text })
                    .catch(e => { log.error(`checkin feedback error: ${e.message}`); return false; });
                }
                // Agente de reserva por WhatsApp: el asistente entiende la
                // petición, consulta disponibilidad y RESERVA (misma maquinaria
                // que la voz). Si no produce respuesta útil → cae al humano.
                if (!handledText) {
                  try {
                    const { handleWaBooking } = require('../whatsapp/wa-agent');
                    const r = await handleWaBooking({ from, businessId, text }).catch(() => ({ handled: false }));
                    handledText = r && r.handled;
                  } catch (e) { log.error(`wa-agent error: ${e.message}`); }
                }
                if (!handledText) {
                  await notifyOwnerFreeText({ from, businessId, text }).catch(e =>
                    log.error(`freeText handler error: ${e.message}`)
                  );
                }
              }
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
