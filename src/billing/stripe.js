// ============================================
// VoiceCore — Stripe Billing Integration
// Subscriptions, usage metering, invoicing
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('BILLING');

// Minutos INCLUIDOS por plan (solo planes con overage). Debe coincidir con
// PLAN_LIMITS.minutesPerMonth en src/auth/middleware.js.
const OVERAGE_INCLUDED_MINUTES = { negocio: 500, enterprise: 99999 };

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

    // ÚNICO plan comercial: Negocio €49. (Starter y Pro retirados 2026-06-30.)
    // `enterprise` se mantiene SOLO como tier interno/custom (price null, nunca se
    // vende por checkout). Orgs legacy con plan 'starter'/'pro' caen a Negocio vía
    // el `|| billing.plans.negocio` de los llamadores.
    // Stripe env var: STRIPE_PRO_PRICE_ID = precio €49 Negocio (nombre histórico).
    this.plans = {
      negocio: {
        name: 'Negocio', price: 4900, priceId: config.proPriceId || process.env.STRIPE_PRO_PRICE_ID,
        // 0,15€/min — decisión Unai 2026-07-04, precio ÚNICO de overage en
        // todas partes (landing, portal, voices.json, KPIs). El Meter de
        // Stripe debe decir lo mismo. (Antes 0.05: por debajo de coste.)
        minutes: 500, assistants: 999, overagePerMinute: 0.15,
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
   * Aplica un CRÉDITO al saldo del cliente (p.ej. recompensa de referido).
   * `cents` POSITIVOS → se registra como saldo NEGATIVO (crédito que reduce la
   * próxima factura). `idempotencyKey` evita doble-crédito si se reintenta.
   * ⚠️ SIN VERIFICAR contra Stripe test mode — probar antes de confiar en producción.
   * @returns {Promise<{ok?:boolean,id?:string,amount?:number,skipped?:string,error?:string}>}
   */
  async applyCredit({ customerId, cents, description, idempotencyKey }) {
    if (!this.enabled) return { skipped: 'billing_disabled' };
    if (!customerId)   return { skipped: 'no_customer' };
    const amount = Math.round(Number(cents));
    if (!(amount > 0)) return { skipped: 'invalid_amount' };
    try {
      const txn = await this.stripe.customers.createBalanceTransaction(
        customerId,
        { amount: -amount, currency: 'eur', description: description || 'Crédito NodeFlow' },
        idempotencyKey ? { idempotencyKey } : undefined
      );
      return { ok: true, id: txn.id, amount: txn.amount };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
   * Checkout de AUTOSERVICIO desde /gracias: el lead recién registrado paga
   * sin esperar a que nadie le contacte. client_reference_id = registroId →
   * el webhook (payment_link_completed) dispara la provisión automática
   * completa (org + asistente + número + email de activación).
   */
  async createRegistroCheckout({ registroId, email, couponStripeCode }) {
    if (!this.enabled) throw new Error('Stripe no configurado');
    const priceId = this.plans.negocio.priceId;
    if (!priceId) throw new Error('Falta el precio del plan Negocio (STRIPE_PRO_PRICE_ID)');
    const base = process.env.PUBLIC_URL || 'https://nodeflow.es';
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: registroId,
      customer_email: email || undefined,
      // Si trajo cupón validado, se aplica solo; si no, puede teclear uno.
      ...(couponStripeCode
        ? { discounts: [{ coupon: couponStripeCode }] }
        : { allow_promotion_codes: true }),
      success_url: `${base}/gracias/?id=${encodeURIComponent(registroId)}&paid=1`,
      cancel_url: `${base}/onboarding.html`,
      metadata: { registroId },
      subscription_data: { metadata: { registroId } },
    });
    log.info(`Checkout de registro creado: ${registroId}`);
    return { url: session.url };
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

        // ── Pack de minutos de voz (compra puntual, mode:payment) ──
        if (session.metadata?.voicePackMinutes) {
          return {
            action:    'voice_pack_paid',
            orgId:     session.metadata.orgId,
            minutes:   Number(session.metadata.voicePackMinutes) || 0,
            sessionId: session.id,
          };
        }

        // ── Viene de un Payment Link (landing de nodeflow.es) ──
        if (session.payment_link || session.client_reference_id?.startsWith('reg_')) {
          // BUG-16 FIX: Prefer plan from metadata — don't rely solely on amount which changes.
          // Price IDs or subscription metadata are authoritative; amount is only a fallback.
          // Plan único: Negocio. (El importe ya no distingue plan; el metadata
          // manda si viene, pero todo cae a 'negocio'.)
          const planKey = session.metadata?.plan ||
            session.subscription_data?.metadata?.plan ||
            'negocio';

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
