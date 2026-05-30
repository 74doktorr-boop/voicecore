// ============================================
// VoiceCore — Billing API Routes
// Stripe checkout, portal, usage, invoices
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { getBilling } = require('../billing/stripe');
const { getDatabase } = require('../db/database');
const { getRegistro, updateRegistro } = require('./routes-registro');
const { sendEmail, notifyNuevoCliente, sendBienvenida, sendWelcomePortalEmail } = require('../notifications/email');
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

  // ─── Create Checkout Session ───
  app.post('/api/billing/checkout', auth, async (req, res) => {
    try {
      const { plan } = req.body;
      if (!plan) return res.status(400).json({ error: 'Plan required' });
      if (!['negocio', 'pro'].includes(plan)) {
        return res.status(400).json({ error: "plan debe ser 'negocio' o 'pro'" });
      }

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

      const session = await billing.createCheckoutSession({
        orgId: req.org.id,
        plan,
        customerId,
        successUrl: req.body.successUrl,
        cancelUrl: req.body.cancelUrl,
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

      const session = await billing.createPortalSession({
        customerId,
        returnUrl: req.body.returnUrl,
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
          plan: req.org.plan || 'starter',
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
      const planConfig = billing.plans[req.org.plan] || billing.plans.starter;
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
      try {
        const sig = req.headers['stripe-signature'];
        const result = await billing.handleWebhook(req.body, sig);

        // ── Payment Link completado (nuevo cliente desde la landing) ──
        if (result.action === 'payment_link_completed') {
          const { registroId, stripeCustomerId, subscriptionId, email, planKey } = result;

          log.info(`Pago confirmado — registroId: ${registroId}, cliente: ${email}`);

          // Recuperar datos del registro
          const registro = await getRegistro(registroId);

          if (registro) {
            // Idempotency guard: if this registro was already activated by a previous
            // webhook delivery, skip org creation to avoid duplicates.
            if (registro.status === 'active') {
              log.warn(`Webhook duplicado ignorado — registro ${registroId} ya está activo`);
              return res.json({ received: true, duplicate: true });
            }

            // Plan del formulario coincide directamente con el valor de DB ('starter'|'negocio'|'pro')
            const orgPlan = registro.plan || 'negocio';

            // ── Crear org + asistente automáticamente ──
            let apiKey = null;
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

                // Actualizar org con datos de Stripe
                await db.updateOrg(org.id, {
                  stripe_customer_id: stripeCustomerId,
                  stripe_subscription_id: subscriptionId,
                });

                // Crear asistente por defecto
                const lang      = registro.idioma || 'es';
                const langName  = lang === 'gl' ? 'galego' : lang === 'eu' ? 'euskera' : 'español';
                const defaultGreeting = lang === 'gl'
                  ? `Grazas por chamar a ${registro.negocio}, en que podo axudarche?`
                  : lang === 'eu'
                  ? `Eskerrik asko ${registro.negocio}-ra deitu izanagatik, nola lagundu dezaket?`
                  : `Gracias por llamar a ${registro.negocio}, ¿en qué puedo ayudarte?`;

                await db.createAssistant(org.id, {
                  name:         `Asistente de ${registro.negocio}`,
                  voice:        registro.voz || 'nova',
                  language:     lang,
                  firstMessage: registro.saludo || defaultGreeting,
                  systemPrompt: `Eres el asistente virtual de ${registro.negocio}. Atiendes llamadas de clientes de forma amable y profesional. Responde siempre en ${langName}. Sé conciso y útil.`,
                  model:        'gpt-4o-mini',
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

            // Notificar a Unai
            await notifyNuevoCliente({ ...registro, stripe_customer_id: stripeCustomerId, api_key: apiKey });

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

        // Helper: minutes limit matching PLAN_LIMITS constants
        const _minutesForPlan = (plan) =>
          plan === 'negocio' ? 500 : plan === 'pro' ? 2000 : plan === 'enterprise' ? 99999 : 50;

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
          const planToSet = result.plan || 'starter';
          let orgId = result.orgId;
          // If orgId not in metadata (Payment Link customers), look up by subscriptionId
          if (!orgId && result.subscriptionId) {
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id')
              .eq('stripe_subscription_id', result.subscriptionId)
              .single().catch(() => ({ data: null }));
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
          if (result.orgId) {
            await db.updateOrg(result.orgId, {
              plan: 'starter',
              is_active: true,
              monthly_minutes_limit: 50,
            });
            log.warn(`Org ${result.orgId} downgraded to starter (sub cancelled)`);
          } else if (result.subscriptionId) {
            // Payment Link customers — look up by stripe_subscription_id
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id')
              .eq('stripe_subscription_id', result.subscriptionId)
              .single().catch(() => ({ data: null }));
            if (orgRow) {
              await db.updateOrg(orgRow.id, {
                plan: 'starter',
                monthly_minutes_limit: 50,
              });
              log.warn(`Org ${orgRow.id} downgraded to starter (Payment Link cancellation)`);
            }
          }
        }

        // ── New billing period — reset monthly usage counter ──────────────────
        // invoice.paid fires at the start of each Stripe billing cycle
        if (result.action === 'invoice_paid' && db.enabled && result.customerId) {
          try {
            const { data: orgRow } = await db.client
              .from('organizations')
              .select('id')
              .eq('stripe_customer_id', result.customerId)
              .single().catch(() => ({ data: null }));
            if (orgRow?.id) {
              await db.updateOrg(orgRow.id, { monthly_minutes_used: 0 });
              log.info(`Usage counter reset for org ${orgRow.id} (invoice paid — new period)`);
            }
          } catch (e) {
            log.warn(`Could not reset usage on invoice.paid: ${e.message}`);
          }
        }

        if (result.action === 'payment_failed') {
          log.warn(`Pago fallido — customer: ${result.customerId}`);
          // Intentar encontrar el cliente por stripe_customer_id y avisarle
          if (db.enabled && result.customerId) {
            try {
              const { data: registro } = await db.client
                .from('registros')
                .select('*')
                .eq('stripe_customer_id', result.customerId)
                .single();

              if (registro?.email) {
                await sendEmail({
                  to: registro.email,
                  subject: '⚠️ Problema con tu pago en NodeFlow',
                  html: `
                    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
                      <h2 style="color:#e17055;">Problema con tu pago</h2>
                      <p>Hola ${registro.contacto?.split(' ')[0] || ''},</p>
                      <p>No hemos podido procesar el pago de tu suscripción a NodeFlow. Tu servicio puede verse interrumpido.</p>
                      <p>Por favor, actualiza tu método de pago o contacta con nosotros.</p>
                      <a href="https://wa.me/34666351319" style="background:#6c5ce7;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px;">Contactar por WhatsApp →</a>
                      <p style="margin-top:24px;font-size:12px;color:#999;">NodeFlow · unai@nodeflow.es</p>
                    </div>
                  `,
                  text: `Hola, no hemos podido procesar tu pago en NodeFlow. Contacta con nosotros en WhatsApp: +34 666 351 319`,
                });
                log.info(`Email pago fallido enviado a ${registro.email}`);
              }
            } catch (e) {
              log.warn(`No se pudo notificar pago fallido: ${e.message}`);
            }
          }
        }

        res.json({ received: true });
      } catch (e) {
        log.error('Webhook error', { error: e.message });
        res.status(400).json({ error: e.message });
      }
    }
  );

  log.info('Billing routes configured');
}

module.exports = { setupBillingRoutes };
