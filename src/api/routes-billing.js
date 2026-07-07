// ============================================
// VoiceCore — Billing API Routes
// Stripe checkout, portal, usage, invoices
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { getBilling } = require('../billing/stripe');
const { getDatabase } = require('../db/database');
const { getRegistro, updateRegistro, claimRegistroForProvisioning, releaseRegistroProvisioning } = require('./routes-registro');
const { sendEmail, notifyNuevoCliente, sendBienvenida, sendWelcomePortalEmail, sendActivacion } = require('../notifications/email');
const { generateMagicToken } = require('./routes-auth');

const log = new Logger('API:BILLING');

function setupBillingRoutes(app, config) {
  const auth = requireAuth(config);
  // BUG-14 FIX: Pass config so getBilling can read priceIds/keys from config if env vars differ.
  // Without this, getBilling() creates an unconfigured instance if called before server.js does it.
  const billing = getBilling(config);
  const db = getDatabase();

  // ─── Plans ───
  app.get('/api/billing/plans', (req, res) => {
    res.json({ plans: billing.getPlans() });
  });

  // ─── Helpers ────────────────────────────────────────────────
  // BUG-49 FIX: Validate redirect URLs to prevent open-redirect abuse.
  // Callers may pass successUrl/cancelUrl/returnUrl; when billing is disabled
  // the server echoes them back as the destination URL.  Restrict to HTTPS only.
  function _safeUrl(raw, fallback) {
    if (!raw) return fallback || null;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') throw new Error('not https');
      return raw;
    } catch (_) {
      return fallback || null;
    }
  }

  // ─── Create Checkout Session ───
  app.post('/api/billing/checkout', auth, async (req, res) => {
    try {
      // Único plan comercial: Negocio. Cualquier petición (incluido el legacy
      // 'pro' de enlaces antiguos) se coacciona a 'negocio'.
      const plan = 'negocio';

      let customerId = req.org.stripe_customer_id;

      // Create Stripe customer if needed
      if (!customerId && billing.enabled) {
        const customer = await billing.createCustomer({
          email: req.org.owner_email,
          name: req.org.name,
          orgId: req.org.id,
        });
        customerId = customer.id;

        // Save to DB
        if (db.enabled) {
          await db.updateOrg(req.org.id, { stripe_customer_id: customerId });
        }
      }

      const baseUrl = process.env.PUBLIC_URL || 'https://nodeflow.es';
      const session = await billing.createCheckoutSession({
        orgId: req.org.id,
        plan,
        customerId,
        successUrl: _safeUrl(req.body.successUrl, `${baseUrl}/portal?checkout=success`),
        cancelUrl:  _safeUrl(req.body.cancelUrl,  `${baseUrl}/portal?checkout=cancelled`),
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (e) {
      log.error('Checkout error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Billing Portal ───
  app.post('/api/billing/portal', auth, async (req, res) => {
    try {
      const customerId = req.org.stripe_customer_id;
      if (!customerId) return res.status(400).json({ error: 'No billing account' });

      const baseUrl = process.env.PUBLIC_URL || 'https://nodeflow.es';
      const session = await billing.createPortalSession({
        customerId,
        returnUrl: _safeUrl(req.body.returnUrl, `${baseUrl}/portal`),
      });

      res.json({ url: session.url });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Current Subscription ───
  app.get('/api/billing/subscription', auth, async (req, res) => {
    try {
      const subId = req.org.stripe_subscription_id;
      if (!subId) {
        return res.json({
          plan: req.org.plan || 'negocio',
          status: 'active',
          subscription: null,
        });
      }

      const sub = await billing.getSubscription(subId);
      res.json({
        plan: req.org.plan,
        status: sub?.status || 'active',
        currentPeriodEnd: sub?.current_period_end,
        cancelAtPeriodEnd: sub?.cancel_at_period_end,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Usage Summary ───
  app.get('/api/billing/usage', auth, async (req, res) => {
    try {
      const planConfig = billing.plans[req.org.plan] || billing.plans.negocio;
      const minutesUsed = parseFloat(req.org.monthly_minutes_used) || 0;
      const minutesLimit = planConfig.minutes;
      const overage = Math.max(0, minutesUsed - minutesLimit);
      const overageCost = overage * planConfig.overagePerMinute;

      res.json({
        plan: req.org.plan,
        minutesUsed: Math.round(minutesUsed * 100) / 100,
        minutesLimit,
        minutesRemaining: Math.max(0, minutesLimit - minutesUsed),
        // BUG-19 FIX: Guard divide-by-zero when minutesLimit is 0 (e.g. custom plans)
        percentUsed: minutesLimit > 0 ? Math.round((minutesUsed / minutesLimit) * 100) : 0,
        overage: Math.round(overage * 100) / 100,
        overageCost: Math.round(overageCost * 100) / 100,
        overageRate: planConfig.overagePerMinute,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Invoices ───
  app.get('/api/billing/invoices', auth, async (req, res) => {
    try {
      const customerId = req.org.stripe_customer_id;
      if (!customerId) return res.json({ invoices: [] });
      const invoices = await billing.getInvoices(customerId);
      res.json({
        invoices: invoices.map(inv => ({
          id: inv.id,
          number: inv.number,
          date: inv.created,
          amount: inv.amount_paid / 100,
          currency: inv.currency,
          status: inv.status,
          pdf: inv.invoice_pdf,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cost Calculator ───
  app.post('/api/billing/calculate', auth, (req, res) => {
    const { durationMs, providers } = req.body;
    if (!durationMs) return res.status(400).json({ error: 'durationMs required' });
    res.json(billing.calculateCallCost(durationMs, providers));
  });

  // ─── Stripe Webhook ───
  // express.raw() ya fue aplicado globalmente en server.js para este path
  app.post('/api/billing/webhook', async (req, res) => {
      let claimedRegistroId = null; // para liberar el claim si el aprovisionamiento falla
      try {
        const sig = req.headers['stripe-signature'];
        const result = await billing.handleWebhook(req.body, sig);

        // ── Pack de minutos de voz pagado → sumar al cupo (idempotente) ──
        if (result.action === 'voice_pack_paid' && result.orgId) {
          const { applyVoicePack } = require('../billing/voice-packs');
          await applyVoicePack(result.orgId, { sessionId: result.sessionId, minutes: result.minutes })
            .catch(e => log.warn(`voice pack apply: ${e.message}`));
          return res.json({ received: true });
        }

        // ── Payment Link completado (nuevo cliente desde la landing) ──
        if (result.action === 'payment_link_completed') {
          const { registroId, stripeCustomerId, subscriptionId, email, planKey } = result;

          log.info(`Pago confirmado — registroId: ${registroId}, cliente: ${email}`);

          // Recuperar datos del registro
          const registro = await getRegistro(registroId);

          if (registro) {
            // Idempotencia robusta: claim atómico a nivel BD (compare-and-set).
            // Bloquea entregas duplicadas de Stripe Y procesamiento concurrente
            // entre réplicas (Docker Swarm) — antes era un read-then-act con una
            // ventana enorme (status 'active' solo se marca al final).
            const claimed = await claimRegistroForProvisioning(registroId);
            if (!claimed) {
              log.warn(`Webhook duplicado ignorado — registro ${registroId} ya activo o en aprovisionamiento`);
              return res.json({ received: true, duplicate: true });
            }
            claimedRegistroId = registroId;

            // Engancha el item de minutos extra (precio medido) a la suscripción.
            // Los Payment Links de Stripe no admiten precios por consumo, así que se
            // añade aquí. Idempotente + gated por STRIPE_OVERAGE_PRICE_ID (no-op si falta).
            if (subscriptionId && process.env.STRIPE_OVERAGE_PRICE_ID) {
              await billing.addOverageItem(subscriptionId)
                .catch(e => log.warn(`No se pudo añadir item de overage: ${e.message}`));
            }
            // Ítem del paquete de MENSAJES (0,10€/extra, meter 'mensajes_extra')
            // — mismo patrón que los minutos; gateado por su env.
            if (subscriptionId && process.env.STRIPE_MSG_PRICE_ID) {
              await billing.addOverageItem(subscriptionId, process.env.STRIPE_MSG_PRICE_ID)
                .catch(e => log.warn(`No se pudo añadir item de mensajes: ${e.message}`));
            }

            // Plan del formulario coincide directamente con el valor de DB ('starter'|'negocio'|'pro')
            const orgPlan = registro.plan || 'negocio';

            // ── Crear org + asistente automáticamente ──
            let apiKey         = null;
            let assignedNumber = null; // número auto-asignado del pool (para incluir en notif a Unai)
            if (db.enabled) {
              try {
                const slug = registro.negocio.toLowerCase()
                  .normalize('NFD').replace(/[̀-ͯ]/g, '')
                  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

                const org = await db.createOrg({
                  name:     registro.negocio,
                  slug,
                  ownerEmail: registro.email,
                  ownerName:  registro.contacto,
                  plan:     orgPlan,
                  phone:    registro.telefono,
                  language: registro.idioma || 'es',
                });

                apiKey = org.api_key;

                // Actualizar org con datos de Stripe + SECTOR del registro.
                // El sector va a assistant_config.sector (lo que leen el asistente
                // y el AUDITOR). Sin esto el negocio arrancaba en 'genérico' y el
                // aprendizaje por vertical no podía agrupar (registro.sector solo
                // iba al flow en memoria, que muere al reiniciar).
                await db.updateOrg(org.id, {
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: subscriptionId,
                  ...(registro.sector ? { assistant_config: { sector: registro.sector } } : {}),
                });

                // Servicios del onboarding → serviceList desde el DÍA 0: las
                // reglas de seguimiento se auto-ajustan a lo que OFRECE (una
                // clínica sin psicotécnicos nace sin esa regla) y el asistente
                // conoce su carta. El bloque del número (más abajo) re-lee
                // automation_config y hace merge, así que esto no se pisa.
                if (Array.isArray(registro.servicios) && registro.servicios.length) {
                  try {
                    const serviceList = registro.servicios.map(name => ({ name }));
                    const { data: cur } = await db.client.from('organizations')
                      .select('automation_config').eq('id', org.id).maybeSingle();
                    const ac = (cur && cur.automation_config) || {};
                    await db.client.from('organizations').update({
                      automation_config: { ...ac, config: { ...(ac.config || {}), serviceList } },
                    }).eq('id', org.id);
                    log.info(`serviceList sembrada desde el onboarding: ${serviceList.length} servicios (${org.id})`);
                  } catch (e) { log.warn(`serviceList del onboarding falló: ${e.message}`); }
                }

                // Crear asistente por defecto. El saludo sale de la fuente única
                // (i18n.defaultFirstMessage): incluye la presentación como
                // asistente virtual (transparencia IA) y el token {{GREETING}}
                // que el pipeline resuelve por hora del día. Antes había una
                // copia local sin transparencia — split-brain.
                const lang      = registro.idioma || 'es';
                const langName  = lang === 'gl' ? 'galego' : lang === 'eu' ? 'euskera' : 'español';
                const { defaultFirstMessage } = require('../assistants/i18n');
                const defaultGreeting = defaultFirstMessage(lang, registro.negocio);

                await db.createAssistant(org.id, {
                  name:         `Asistente de ${registro.negocio}`,
                  voice:        registro.voz || 'nova',
                  language:     lang,
                  firstMessage: registro.saludo || defaultGreeting,
                  systemPrompt: `Eres el asistente virtual de ${registro.negocio}. Atiendes llamadas de clientes de forma amable y profesional. Responde siempre en ${langName}. Sé conciso y útil.`,
                  // SIN modelo horneado: el router elige el proveedor MÁS RÁPIDO
                  // disponible (groq ~80ms TTFT > openai) con auto-fallback.
                  // Hardcodear 'gpt-4o-mini' aquí clavaba a TODOS los asistentes
                  // nuevos en OpenAI (p50 1.5s/turno medido en prod) e ignoraba Groq.
                  model:        null,
                  tools:        [],
                });

                log.info(`Org creada automáticamente: ${org.id} — ${registro.negocio} (${orgPlan})`);

                // Auto-registrar flujo de automatizaciones para este negocio
                const { flowManager } = require('../automations/flow-manager');
                const { scheduler }   = require('../scheduling/scheduler');

                flowManager.register(org.id, {
                  name:       registro.negocio,
                  ownerEmail: registro.email,
                  ownerPhone: registro.telefono,
                  plan:       orgPlan,
                  sector:     registro.sector,
                  language:   registro.idioma || 'es',  // 'es' | 'eu' | 'gl'
                });

                // Registrar en el scheduler con horario por defecto
                scheduler.setBusinessConfig(org.id, {
                  name:        registro.negocio,
                  timezone:    'Europe/Madrid',
                  services:    [],
                  schedule: {
                    1: { open:'09:00', close:'14:00', afternoon_open:'15:30', afternoon_close:'19:30' },
                    2: { open:'09:00', close:'14:00', afternoon_open:'15:30', afternoon_close:'19:30' },
                    3: { open:'09:00', close:'14:00', afternoon_open:'15:30', afternoon_close:'19:30' },
                    4: { open:'09:00', close:'14:00', afternoon_open:'15:30', afternoon_close:'19:30' },
                    5: { open:'09:00', close:'14:00' },
                  },
                  slotInterval: 15,
                });

                log.info(`Flow registrado para: ${org.id} — ${registro.negocio}`);

                // ── Auto-asignar número del pool y enviar guía de desvío ──────
                try {
                  const { claimNumber, getPoolStats } = require('../telephony/phone-pool');
                  assignedNumber = await claimNumber(org.id);

                  if (assignedNumber) {
                    // Guardar número en automation_config de la org
                    const existingConfig = (await db.client
                      .from('organizations').select('automation_config').eq('id', org.id).single()
                    ).data?.automation_config || {};
                    await db.client.from('organizations').update({
                      automation_config: {
                        ...existingConfig,
                        // nodeflowNumber = número que el cliente final llama (desvío)
                        // outboundNumber = número que NodeFlow usa para llamar/recibir
                        // En el plan básico son el mismo número
                        config: { ...(existingConfig.config || {}), nodeflowNumber: assignedNumber, outboundNumber: assignedNumber },
                      },
                    }).eq('id', org.id);

                    // Enviar email de activación con guía de desvío (automático)
                    sendActivacion(registro, assignedNumber)
                      .catch(e => log.warn(`Activation email failed: ${e.message}`));

                    log.info(`Auto-asignado ${assignedNumber} a ${org.id} (${registro.negocio})`);

                    // Alerta si el pool está bajo
                    const stats = await getPoolStats();
                    if (stats.low) {
                      sendEmail({
                        to:      process.env.NOTIFY_EMAIL || 'unai@nodeflow.es',
                        subject: `⚠️ NodeFlow — Pool de números bajo: ${stats.available} disponibles`,
                        text:    `Quedan solo ${stats.available} números en el pool. Añade más en el panel admin antes del próximo cliente.`,
                        html:    `<p>⚠️ Quedan solo <strong>${stats.available}</strong> números disponibles en el pool de NodeFlow.</p><p>Añade más en el <a href="${process.env.PUBLIC_URL || 'https://nodeflow.es'}/admin">panel admin</a> antes del próximo cliente.</p>`,
                      }).catch(() => {});
                    }
                  } else {
                    // Pool vacío — alerta urgente a Unai para asignar manualmente
                    log.error(`Pool vacío — no se pudo asignar número a ${org.id} (${registro.negocio})`);
                    sendEmail({
                      to:      process.env.NOTIFY_EMAIL || 'unai@nodeflow.es',
                      subject: `🚨 URGENTE — Pool VACÍO: ${registro.negocio} sin número asignado`,
                      text:    `Nuevo cliente "${registro.negocio}" (${registro.email}) ha pagado pero el pool de números está vacío. Asigna un número manualmente desde /api/admin/phone-pool y envía el email de activación desde /api/admin/activar-cliente.`,
                      html:    `<h2>🚨 Pool de números vacío</h2><p><strong>${registro.negocio}</strong> (${registro.email}) acaba de pagar pero no hay números disponibles.</p><p>Pasos:</p><ol><li>Accede al <a href="${process.env.PUBLIC_URL || 'https://nodeflow.es'}/admin">panel admin → pestaña "Pool números"</a></li><li>Añade un número al pool</li><li>Usa la opción "Asignar" para asignarlo manualmente al cliente (Org ID: <code>${org.id}</code>)</li></ol><p>El email de activación con guía de desvío se enviará automáticamente al asignar.</p>`,
                    }).catch(() => {});
                  }
                } catch (poolErr) {
                  log.error(`Error en auto-asignación de número: ${poolErr.message}`);
                }
                // ─────────────────────────────────────────────────────────────
              } catch (e) {
                log.error(`Error creando org para ${registro.negocio}: ${e.message}`);
              }
            }

            // Marcar registro como pagado
            await updateRegistro(registroId, {
              status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: subscriptionId,
              paid_at: new Date().toISOString(),
            });

            // Si vino por referido, marcar conversión y avisar al que refirió
            if (registro.coupon_code && String(registro.coupon_code).toUpperCase().startsWith('REF-')) {
              try {
                const referrals = require('../referrals/referrals');
                const ref = await referrals.recordConversion(registro.coupon_code, registroId);
                if (ref?.referrerEmail) {
                  const { sendReferralReward } = require('../notifications/email');
                  if (typeof sendReferralReward === 'function') {
                    sendReferralReward(ref.referrerEmail, registro.negocio).catch(() => {});
                  }
                }
              } catch (e) {
                log.warn(`Referral conversion fallida: ${e.message}`);
              }
            }

            // Notificar a Unai — incluye el número asignado si el pool lo tenía disponible
            await notifyNuevoCliente({
              ...registro,
              stripe_customer_id: stripeCustomerId,
              api_key: apiKey,
              nodeflow_number: assignedNumber || null,
            });

            // Generar magic token para acceso al portal
            let portalToken = null;
            try {
              portalToken = await generateMagicToken(registro.email, registroId);
            } catch (e) {
              log.warn(`Magic token generation failed: ${e.message}`);
            }

            // Email de bienvenida con enlace al portal (magic link)
            const emailPayload = { ...registro, api_key: apiKey };
            if (portalToken) {
              sendWelcomePortalEmail(emailPayload, portalToken).catch(e =>
                log.warn(`Welcome portal email failed: ${e.message}`)
              );
            } else {
              sendBienvenida(emailPayload).catch(e =>
                log.warn(`Bienvenida fallback email failed: ${e.message}`)
              );
            }

            log.info(`Cliente activado: ${registro.negocio} (${registro.plan})`);
          } else {
            // No hay registro — notificar a Unai con datos de Stripe
            log.warn(`No se encontró registro para registroId: ${registroId} — email: ${email}`);
            await notifyNuevoCliente({
              id: registroId || 'sin-registro',
              negocio: '(sin datos de formulario)',
              sector: '—', contacto: '—', telefono: '—',
              email: email || '—', ciudad: '—', plan: planKey || '—',
              voz: '—', idioma: '—', saludo: '—', horario: {},
              stripe_customer_id: stripeCustomerId,
              created_at: new Date().toISOString(),
            });
          }
        }

        // Helper: minutes limit matching PLAN_LIMITS constants.
        // Solo Negocio (500) y enterprise (interno); cualquier otro → Negocio.
        const _minutesForPlan = (plan) =>
          plan === 'enterprise' ? 99999 : 500;

        // ── Flujo legacy (checkout sessions con orgId) ──
        if (result.action === 'subscription_created' && db.enabled && result.orgId) {
          await db.updateOrg(result.orgId, {
            plan: result.plan,
            stripe_subscription_id: result.subscriptionId,
            monthly_minutes_limit: _minutesForPlan(result.plan),
          });
          log.info(`Org ${result.orgId} upgraded to ${result.plan}`);
        }

        // ── Plan changed via Stripe billing portal (customer.subscription.updated) ──
        if (result.action === 'subscription_updated' && db.enabled) {
          const planToSet = result.plan || 'negocio';
          let orgId = result.orgId;
          // If orgId not in metadata (Payment Link customers), look up by subscriptionId
          if (!orgId && result.subscriptionId) {
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id')
              .eq('stripe_subscription_id', result.subscriptionId)
              .single().then(r => r, () => ({ data: null }));
            orgId = orgRow?.id || null;
          }
          if (orgId) {
            await db.updateOrg(orgId, {
              plan: planToSet,
              monthly_minutes_limit: _minutesForPlan(planToSet),
            });
            log.info(`Org ${orgId} plan updated via Stripe portal → ${planToSet}`);
          }
        }

        if (result.action === 'subscription_cancelled' && db.enabled) {
          let cancelledOrgId = result.orgId;

          if (!cancelledOrgId && result.subscriptionId) {
            // Payment Link customers — look up by stripe_subscription_id
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id')
              .eq('stripe_subscription_id', result.subscriptionId)
              .single().then(r => r, () => ({ data: null }));
            cancelledOrgId = orgRow?.id || null;
          }

          if (cancelledOrgId) {
            // Sin plan gratis: al cancelar la suscripción se DESACTIVA la org
            // (no hay tier gratuito al que degradar). Recupera el servicio
            // volviendo a suscribirse.
            await db.updateOrg(cancelledOrgId, {
              is_active: false,
              monthly_minutes_limit: 0,
            });
            log.warn(`Org ${cancelledOrgId} desactivada (suscripción cancelada — sin plan gratis)`);

            // Liberar número de teléfono al pool para reutilizarlo
            try {
              const { releaseNumber } = require('../telephony/phone-pool');
              const released = await releaseNumber(cancelledOrgId);
              if (released) log.info(`Número liberado al pool — org ${cancelledOrgId} canceló suscripción`);
            } catch (poolErr) {
              log.warn(`Error liberando número al pool: ${poolErr.message}`);
            }
          }
        }

        // ── New billing period — reset monthly usage counter ──────────────────
        // invoice.paid fires at the start of each Stripe billing cycle
        if (result.action === 'invoice_paid' && db.enabled && result.customerId) {
          try {
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id, monthly_minutes_used, automation_config')
              .eq('stripe_customer_id', result.customerId)
              .single().then(r => r, () => ({ data: null }));
            if (orgRow?.id) {
              // Packs de voz persisten hasta gastarse: descontar lo usado ANTES
              // de resetear el contador del mes (2026-07-04).
              const { settleMonthlyPack } = require('../billing/voice-packs');
              await settleMonthlyPack(orgRow, { db });
              await db.updateOrg(orgRow.id, { monthly_minutes_used: 0 });
              log.info(`Usage counter reset for org ${orgRow.id} (invoice paid — new period)`);
            }
          } catch (e) {
            log.warn(`Could not reset usage on invoice.paid: ${e.message}`);
          }
        }

        if (result.action === 'payment_failed') {
          log.warn(`Pago fallido — customer: ${result.customerId}`);
          // Notify the customer by email — look up in registros first (Payment Link customers),
          // then fall back to organizations (dashboard checkout customers).
          if (db.enabled && result.customerId) {
            try {
              let clientEmail = null;
              let clientFirstName = '';

              // 1. Try registros (Payment Link flow)
              const { data: registro } = await db.client
                .from('registros')
                .select('email, contacto')
                .eq('stripe_customer_id', result.customerId)
                .single().then(r => r, () => ({ data: null }));

              if (registro?.email) {
                clientEmail     = registro.email;
                clientFirstName = registro.contacto?.split(' ')[0] || '';
              } else {
                // 2. Fallback: look up in organizations (dashboard checkout flow)
                const { data: org } = await db.client
                  .from('organizations')
                  .select('owner_email, owner_name')
                  .eq('stripe_customer_id', result.customerId)
                  .single().then(r => r, () => ({ data: null }));
                if (org?.owner_email) {
                  clientEmail     = org.owner_email;
                  clientFirstName = org.owner_name?.split(' ')[0] || '';
                }
              }

              if (clientEmail) {
                await sendEmail({
                  to: clientEmail,
                  subject: '⚠️ Problema con tu pago en NodeFlow',
                  html: `
                    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
                      <h2 style="color:#e17055;">Problema con tu pago</h2>
                      <p>Hola ${clientFirstName || 'cliente'},</p>
                      <p>No hemos podido procesar el pago de tu suscripción a NodeFlow. Tu servicio puede verse interrumpido.</p>
                      <p>Por favor, actualiza tu método de pago o contacta con nosotros.</p>
                      <a href="https://wa.me/34666351319" style="background:#6c5ce7;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px;">Contactar por WhatsApp →</a>
                      <p style="margin-top:24px;font-size:12px;color:#999;">NodeFlow · unai@nodeflow.es</p>
                    </div>
                  `,
                  text: `Hola, no hemos podido procesar tu pago en NodeFlow. Contacta con nosotros en WhatsApp: +34 666 351 319`,
                });
                log.info(`Email pago fallido enviado a ${clientEmail}`);
              }
            } catch (e) {
              log.warn(`No se pudo notificar pago fallido: ${e.message}`);
            }
          }
        }

        res.json({ received: true });
      } catch (e) {
        log.error('Webhook error', { error: e.message });
        // Si reclamamos el registro pero el aprovisionamiento falló, lo liberamos
        // a estado reintentable para que el reintento de Stripe vuelva a procesarlo
        // (devolvemos 400 → Stripe reintenta).
        if (claimedRegistroId) {
          await releaseRegistroProvisioning(claimedRegistroId).catch(() => {});
        }
        res.status(400).json({ error: e.message });
      }
    }
  );

  log.info('Billing routes configured');
}

module.exports = { setupBillingRoutes };
