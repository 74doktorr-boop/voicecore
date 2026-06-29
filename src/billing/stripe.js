// ============================================
// VoiceCore — Stripe Billing Integration
// Subscriptions, usage metering, invoicing
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('BILLING');

// Minutos INCLUIDOS por plan (solo planes con overage). Debe coincidir con
// PLAN_LIMITS.minutesPerMonth en src/auth/middleware.js.
const OVERAGE_INCLUDED_MINUTES = { negocio: 500, pro: 2000, enterprise: 99999 };

/**
 * Minutos de overage que aporta una llamada: la parte de [prev, new] que cae por
 * encima de lo incluido en el plan. 0 si el plan no factura overage o no se pasa.
 * @returns {number} minutos extra (≥0)
 */
function computeOverageDelta(plan, prevMinutes, newMinutes) {
  const included = OVERAGE_INCLUDED_MINUTES[plan];
  if (!included) return 0; // plan sin overage (p.ej. starter) o desconocido
  const prev = Math.max(0, Number(prevMinutes) || 0);
  const next = Math.max(0, Number(newMinutes) || 0);
  const over = Math.max(0, next - included) - Math.max(0, prev - included);
  return over > 0 ? Math.round(over * 100) / 100 : 0;
}

class StripeBilling {
  constructor(config = {}) {
    this.secretKey = config.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    this.stripe = null;
    this.enabled = false;

    if (this.secretKey) {
      try {
        this.stripe = require('stripe')(this.secretKey);
        this.enabled = true;
        log.info('Stripe billing initialized');
      } catch (e) {
        log.warn('Stripe SDK not available — billing disabled');
      }
    } else {
      log.warn('No Stripe key — billing disabled');
    }

    // Plan keys match DB column `plan` (set by webhook).
    // DB values: 'starter' | 'negocio' | 'pro'
    // Stripe env vars: STRIPE_PRO_PRICE_ID (€49 Negocio), STRIPE_BUSINESS_PRICE_ID (€99 Pro)
    this.plans = {
      starter: {
        name: 'Starter', price: 0, priceId: config.starterPriceId || null,
        minutes: 50, assistants: 1, overagePerMinute: 0.05,
      },
      negocio: {
        name: 'Negocio', price: 4900, priceId: config.proPriceId || process.env.STRIPE_PRO_PRICE_ID,
        minutes: 500, assistants: 1, overagePerMinute: 0.05,
      },
      pro: {
        name: 'Pro', price: 9900, priceId: config.businessPriceId || process.env.STRIPE_BUSINESS_PRICE_ID,
        minutes: 2000, assistants: 999, overagePerMinute: 0.05,
      },
      enterprise: {
        name: 'Enterprise', price: null, priceId: null,
        minutes: 99999, assistants: 999, overagePerMinute: 0.03,
      },
    };
  }

  /**
   * Create a Stripe customer for a new org
   */
  async createCustomer({ email, name, orgId, metadata = {} }) {
    if (!this.enabled) return { id: `cus_mock_${orgId}` };

    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: { orgId, ...metadata },
    });

    log.info(`Customer created: ${customer.id} — ${email}`);
    return customer;
  }

  /**
   * Create a checkout session for plan subscription
   */
  async createCheckoutSession({ orgId, plan, customerId, successUrl, cancelUrl }) {
    if (!this.enabled) return { url: successUrl };

    const planConfig = this.plans[plan];
    if (!planConfig?.priceId) throw new Error(`No price configured for plan: ${plan}`);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: successUrl || `${process.env.PUBLIC_URL}/dashboard?checkout=success`,
      cancel_url: cancelUrl || `${process.env.PUBLIC_URL}/dashboard?checkout=cancelled`,
      metadata: { orgId, plan },
      subscription_data: { metadata: { orgId, plan } },
    });

    log.info(`Checkout session created for org ${orgId}: ${plan}`);
    return session;
  }

  /**
   * Create a billing portal session for managing subscription
   */
  async createPortalSession({ customerId, returnUrl }) {
    if (!this.enabled) return { url: returnUrl };

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${process.env.PUBLIC_URL}/dashboard`,
    });

    return session;
  }

  /**
   * Reporta minutos de overage a Stripe vía Billing Meters (API moderna; el viejo
   * createUsageRecord se eliminó en el SDK v22). El Meter agrega por cliente, así
   * que no hace falta guardar subscription_item_id. No-op si falta config.
   * @param {{stripeCustomerId:string, minutes:number, eventName?:string}} p
   */
  async reportUsage({ stripeCustomerId, minutes, eventName }) {
    if (!this.enabled) return;
    const event = eventName || process.env.STRIPE_OVERAGE_METER_EVENT;
    if (!event || !stripeCustomerId || !(minutes > 0)) return;

    await this.stripe.billing.meterEvents.create({
      event_name: event,
      payload: {
        stripe_customer_id: stripeCustomerId,
        value: String(Math.round(minutes * 100) / 100), // minutos extra (2 decimales)
      },
    });

    log.metric(`Overage reportado: ${Math.round(minutes * 100) / 100} min → meter '${event}' (cust ${stripeCustomerId})`);
  }

  /**
   * Calcula y reporta el overage de una llamada: solo los minutos que caen por
   * ENCIMA de lo incluido en el plan. Seguro (gated + best-effort, nunca lanza).
   */
  async reportOverage({ plan, stripeCustomerId, prevMinutes, newMinutes }) {
    const delta = computeOverageDelta(plan, prevMinutes, newMinutes);
    if (delta <= 0 || !stripeCustomerId) return;
    try {
      await this.reportUsage({ stripeCustomerId, minutes: delta });
    } catch (e) {
      log.error(`reportOverage falló: ${e.message}`);
    }
  }

  /**
   * Añade el item de minutos extra (precio MEDIDO) a una suscripción, para que
   * Stripe facture el overage que reportamos por el meter. Idempotente: no lo
   * añade si ya está. No-op si no hay STRIPE_OVERAGE_PRICE_ID. (Los Payment
   * Links de Stripe no admiten precios por consumo, por eso se añade aquí.)
   */
  async addOverageItem(subscriptionId, priceId) {
    const price = priceId || process.env.STRIPE_OVERAGE_PRICE_ID;
    if (!this.enabled || !subscriptionId || !price) return false;
    const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
    if (sub.items?.data?.some(it => it.price?.id === price)) return false; // ya existe
    await this.stripe.subscriptionItems.create({ subscription: subscriptionId, price });
    log.info(`Item de overage (${price}) añadido a la suscripción ${subscriptionId}`);
    return true;
  }

  /**
   * Get subscription details
   */
  async getSubscription(subscriptionId) {
    if (!this.enabled) return null;
    return await this.stripe.subscriptions.retrieve(subscriptionId);
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId, { atPeriodEnd = true } = {}) {
    if (!this.enabled) return null;

    const sub = await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: atPeriodEnd,
    });

    log.info(`Subscription ${subscriptionId} cancellation scheduled`);
    return sub;
  }

  /**
   * Get upcoming invoice
   */
  async getUpcomingInvoice(customerId) {
    if (!this.enabled) return null;
    try {
      return await this.stripe.invoices.retrieveUpcoming({ customer: customerId });
    } catch (e) {
      return null;
    }
  }

  /**
   * Get invoice history
   */
  async getInvoices(customerId, limit = 12) {
    if (!this.enabled) return [];
    const invoices = await this.stripe.invoices.list({ customer: customerId, limit });
    return invoices.data;
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(body, signature) {
    // BUG-15 FIX: Never accept webhook events when billing is not configured.
    // Silently accepting them would let anyone POST fake payment events.
    if (!this.enabled) throw new Error('Billing no configurado — webhook rechazado por seguridad');

    let event;
    try {
      event = this.stripe.webhooks.constructEvent(body, signature, this.webhookSecret);
    } catch (e) {
      throw new Error(`Webhook signature invalid: ${e.message}`);
    }

    log.info(`Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        // ── Viene de un Payment Link (landing de nodeflow.es) ──
        if (session.payment_link || session.client_reference_id?.startsWith('reg_')) {
          // BUG-16 FIX: Prefer plan from metadata — don't rely solely on amount which changes.
          // Price IDs or subscription metadata are authoritative; amount is only a fallback.
          const amount = session.amount_total || 0;
          const planKey = session.metadata?.plan ||
            session.subscription_data?.metadata?.plan ||
            (amount > 0 && amount <= 5500 ? 'negocio' : amount > 5500 ? 'pro' : 'negocio');

          return {
            action: 'payment_link_completed',
            registroId: session.client_reference_id || null,
            stripeCustomerId: session.customer,
            subscriptionId: session.subscription,
            email: session.customer_details?.email || session.customer_email,
            planKey,
            amountTotal: amount,
          };
        }

        // ── Viene del checkout clásico (dashboard interno) ──
        return {
          action: 'subscription_created',
          orgId: session.metadata?.orgId,
          plan: session.metadata?.plan,
          customerId: session.customer,
          subscriptionId: session.subscription,
        };
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        return {
          action: 'invoice_paid',
          customerId: invoice.customer,
          amount: invoice.amount_paid,
          period: invoice.period_start,
        };
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        log.warn(`Payment failed for customer ${invoice.customer}`);
        return {
          action: 'payment_failed',
          customerId: invoice.customer,
          amount: invoice.amount_due,
        };
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        return {
          action: 'subscription_updated',
          subscriptionId: sub.id,
          status: sub.status,
          plan: sub.metadata.plan,
          orgId: sub.metadata.orgId,
        };
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        log.warn(`Subscription cancelled: ${sub.id}`);
        return {
          action: 'subscription_cancelled',
          subscriptionId: sub.id,
          orgId: sub.metadata.orgId,
        };
      }

      default:
        return { action: 'unhandled', type: event.type };
    }
  }

  /**
   * Calculate cost for a call
   */
  calculateCallCost(durationMs, providers = {}) {
    const minutes = durationMs / 60000;
    const costs = {
      stt: minutes * 0.0043,  // Deepgram
      llm: minutes * 0.005,   // GPT-4o-mini estimate
      tts: minutes * 0.02,    // OpenAI TTS
      twilio: minutes * 0.018,
      platform: 0,            // We don't charge like Vapi!
    };

    // Adjust for actual providers used
    if (providers.llm === 'groq') costs.llm = minutes * 0.001;
    if (providers.llm === 'anthropic') costs.llm = minutes * 0.03;
    if (providers.tts === 'cartesia') costs.tts = minutes * 0.015;
    if (providers.tts === 'elevenlabs') costs.tts = minutes * 0.10;
    if (providers.tts === 'google') costs.tts = minutes * 0.016;

    costs.total = Object.values(costs).reduce((s, v) => s + v, 0);

    return {
      minutes: Math.round(minutes * 100) / 100,
      breakdown: Object.fromEntries(
        Object.entries(costs).map(([k, v]) => [k, Math.round(v * 10000) / 10000])
      ),
      total: Math.round(costs.total * 10000) / 10000,
    };
  }

  /**
   * Get plan info
   */
  getPlans() {
    return Object.entries(this.plans).map(([id, plan]) => ({
      id, ...plan, price: plan.price ? `€${(plan.price / 100).toFixed(0)}/mes` : 'Gratis',
    }));
  }
}

// Singleton
let billingInstance = null;
function getBilling(config) {
  if (!billingInstance) billingInstance = new StripeBilling(config);
  return billingInstance;
}

module.exports = { StripeBilling, getBilling, computeOverageDelta, OVERAGE_INCLUDED_MINUTES };
