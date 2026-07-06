// ============================================================
// NodeFlow — Rescate del pago abandonado (2026-07-06)
// El lead que no pagó recibe en el email de acuse un enlace que crea
// una Checkout Session fresca con su registroId → provisión automática.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { StripeBilling } = require('../src/billing/stripe');

function stubbedBilling(capture) {
  const b = new StripeBilling({ stripeSecretKey: null });
  b.enabled = true;
  b.plans.negocio.priceId = 'price_test_negocio';
  b.stripe = {
    checkout: {
      sessions: {
        create: async (params) => { capture.params = params; return { url: 'https://checkout.stripe.com/pay/cs_test_123' }; },
      },
    },
  };
  return b;
}

describe('createRegistroCheckout', () => {
  test('sesión de suscripción con client_reference_id = registroId', async () => {
    const cap = {};
    const b = stubbedBilling(cap);
    const out = await b.createRegistroCheckout({ registroId: 'reg_abc123', email: 'lead@x.es' });
    assert.strictEqual(out.url, 'https://checkout.stripe.com/pay/cs_test_123');
    assert.strictEqual(cap.params.mode, 'subscription');
    assert.strictEqual(cap.params.client_reference_id, 'reg_abc123');
    assert.strictEqual(cap.params.customer_email, 'lead@x.es');
    assert.strictEqual(cap.params.line_items[0].price, 'price_test_negocio');
    assert.match(cap.params.success_url, /gracias\/\?id=reg_abc123&paid=1/);
    // sin cupón → puede teclear un código promo
    assert.strictEqual(cap.params.allow_promotion_codes, true);
    assert.strictEqual(cap.params.discounts, undefined);
  });

  test('con cupón validado → se aplica solo (y sin campo promo)', async () => {
    const cap = {};
    const b = stubbedBilling(cap);
    await b.createRegistroCheckout({ registroId: 'reg_x', email: 'a@b.c', couponStripeCode: 'PROMO50' });
    assert.deepStrictEqual(cap.params.discounts, [{ coupon: 'PROMO50' }]);
    assert.strictEqual(cap.params.allow_promotion_codes, undefined);
  });

  test('sin Stripe configurado → lanza (el endpoint redirige al funnel)', async () => {
    const b = new StripeBilling({ stripeSecretKey: null });
    await assert.rejects(() => b.createRegistroCheckout({ registroId: 'r' }), /Stripe no configurado/);
  });

  test('sin priceId → lanza con mensaje claro', async () => {
    const b = new StripeBilling({ stripeSecretKey: null });
    b.enabled = true; b.plans.negocio.priceId = null;
    await assert.rejects(() => b.createRegistroCheckout({ registroId: 'r' }), /STRIPE_PRO_PRICE_ID/);
  });
});
