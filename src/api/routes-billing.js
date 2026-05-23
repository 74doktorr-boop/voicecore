// ============================================
// VoiceCore — Billing API Routes
// Stripe checkout, portal, usage, invoices
// ============================================

const { Logger } = require('../utils/logger');
const { requireAuth } = require('../auth/middleware');
const { getBilling } = require('../billing/stripe');
const { getDatabase } = require('../db/database');
const { getRegistro, updateRegistro } = require('./routes-registro');
const { notifyNuevoCliente, sendBienvenida } = require('../notifications/email');

const log = new Logger('API:BILLING');

function setupBillingRoutes(app, config) {
  const auth = requireAuth(config);
  const billing = getBilling();
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
        percentUsed: Math.round((minutesUsed / minutesLimit) * 100),
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
  // Stripe envía el body como raw bytes — DEBE ir antes de express.json()
  app.post('/api/billing/webhook',
    require('express').raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        const sig = req.headers['stripe-signature'];
        const result = await billing.handleWebhook(req.body, sig);

        // ── Payment Link completado (nuevo cliente desde la landing) ──
        if (result.action === 'payment_link_completed') {
          const { registroId, stripeCustomerId, subscriptionId, email } = result;

          log.info(`Pago confirmado — registroId: ${registroId}, cliente: ${email}`);

          // Recuperar datos del registro
          const registro = await getRegistro(registroId);

          if (registro) {
            // Marcar como pagado
            await updateRegistro(registroId, {
              status: 'active',
              stripe_customer_id: stripeCustomerId,
              stripe_subscription_id: subscriptionId,
              paid_at: new Date().toISOString(),
            });

            // Notificar a Unai
            await notifyNuevoCliente({ ...registro, stripe_customer_id: stripeCustomerId });

            // Email de bienvenida al cliente
            await sendBienvenida(registro);

            log.info(`Cliente activado: ${registro.negocio} (${registro.plan})`);
          } else {
            // No hay registro (usuario llegó directo al payment link sin pasar por el formulario)
            // Notificamos igual con los datos que tenemos de Stripe
            log.warn(`No se encontró registro para registroId: ${registroId} — email: ${email}`);
            await notifyNuevoCliente({
              id: registroId || 'sin-registro',
              negocio: '(sin datos de formulario)',
              sector: '—', contacto: '—', telefono: '—',
              email: email || '—', ciudad: '—', plan: result.planKey || '—',
              voz: '—', idioma: '—', saludo: '—', horario: {},
              stripe_customer_id: stripeCustomerId,
              created_at: new Date().toISOString(),
            });
          }
        }

        // ── Flujo legacy (checkout sessions con orgId) ──
        if (result.action === 'subscription_created' && db.enabled && result.orgId) {
          await db.updateOrg(result.orgId, {
            plan: result.plan,
            stripe_subscription_id: result.subscriptionId,
          });
          log.info(`Org ${result.orgId} upgraded to ${result.plan}`);
        }

        if (result.action === 'subscription_cancelled' && db.enabled && result.orgId) {
          await db.updateOrg(result.orgId, { plan: 'starter' });
          log.warn(`Org ${result.orgId} downgraded to starter`);
        }

        if (result.action === 'payment_failed') {
          log.warn(`Pago fallido — customer: ${result.customerId}`);
          // TODO: enviar email de aviso al cliente
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
