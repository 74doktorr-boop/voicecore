// ============================================================
// NodeFlow — Red de regresión del webhook de Stripe (handleWebhook).
// Es el punto de entrada de CADA pago y no tenía NINGÚN test (auditoría
// 2026-07-16). Ya hubo aquí un ReferenceError (`amount` no definida) que
// mató el webhook de cada pago de la landing (2026-07-07). Estos tests
// fijan el contrato de las acciones que devuelve para cada tipo de evento.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { StripeBilling } = require('../src/billing/stripe');

// Instancia con un stripe FALSO: constructEvent devuelve el evento dado
// (simula firma válida). Así probamos el router sin llamar a Stripe.
function billingWith(event, { throwOnVerify = false } = {}) {
  const b = new StripeBilling({});
  b.enabled = true;
  b.webhookSecret = 'whsec_test';
  b.stripe = { webhooks: { constructEvent: () => {
    if (throwOnVerify) throw new Error('bad signature');
    return event;
  } } };
  return b;
}
const co = (object) => ({ type: 'checkout.session.completed', data: { object } });

describe('handleWebhook — seguridad', () => {
  test('billing no configurado → rechaza (no acepta pagos falsos)', async () => {
    const b = new StripeBilling({});
    b.enabled = false;
    await assert.rejects(() => b.handleWebhook('{}', 'sig'), /no configurado/i);
  });

  test('firma inválida → lanza', async () => {
    const b = billingWith(null, { throwOnVerify: true });
    await assert.rejects(() => b.handleWebhook('{}', 'sig'), /signature invalid/i);
  });
});

describe('handleWebhook — checkout.session.completed', () => {
  test('pack de voz → action voice_pack_paid con minutos y sessionId', async () => {
    const b = billingWith(co({ id: 'cs_1', metadata: { voicePackMinutes: '50', orgId: 'org-1' } }));
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'voice_pack_paid');
    assert.strictEqual(r.minutes, 50);
    assert.strictEqual(r.orgId, 'org-1');
    assert.strictEqual(r.sessionId, 'cs_1');
  });

  test('REGRESIÓN: payment link NO lanza y devuelve amountTotal (el ReferenceError de `amount`)', async () => {
    const b = billingWith(co({
      payment_link: 'plink_123', client_reference_id: 'reg_abc',
      customer: 'cus_1', subscription: 'sub_1', amount_total: 4900,
      customer_details: { email: 'a@b.com' }, metadata: {},
    }));
    const r = await b.handleWebhook('{}', 'sig');   // antes: ReferenceError → 500 en cada pago
    assert.strictEqual(r.action, 'payment_link_completed');
    assert.strictEqual(r.amountTotal, 4900);
    assert.strictEqual(r.registroId, 'reg_abc');
    assert.strictEqual(r.stripeCustomerId, 'cus_1');
    assert.strictEqual(r.planKey, 'negocio');
  });

  test('payment link sin amount_total → amountTotal null (no rompe)', async () => {
    const b = billingWith(co({ payment_link: 'plink_1', customer: 'cus_1', metadata: {} }));
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'payment_link_completed');
    assert.strictEqual(r.amountTotal, null);
  });

  test('checkout clásico (dashboard) → subscription_created', async () => {
    const b = billingWith(co({ metadata: { orgId: 'org-9', plan: 'negocio' }, customer: 'cus_9', subscription: 'sub_9' }));
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'subscription_created');
    assert.strictEqual(r.orgId, 'org-9');
  });
});

describe('handleWebhook — otros eventos', () => {
  test('invoice.paid → invoice_paid', async () => {
    const b = billingWith({ type: 'invoice.paid', data: { object: { customer: 'cus_1', amount_paid: 8900, period_start: 1 } } });
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'invoice_paid');
    assert.strictEqual(r.amount, 8900);
  });

  test('invoice.payment_failed → payment_failed', async () => {
    const b = billingWith({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1', amount_due: 8900 } } });
    assert.strictEqual((await b.handleWebhook('{}', 'sig')).action, 'payment_failed');
  });

  test('subscription.deleted → subscription_cancelled', async () => {
    const b = billingWith({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { orgId: 'org-1' } } } });
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'subscription_cancelled');
    assert.strictEqual(r.orgId, 'org-1');
  });

  test('evento no manejado → unhandled (no lanza)', async () => {
    const b = billingWith({ type: 'charge.refunded', data: { object: {} } });
    const r = await b.handleWebhook('{}', 'sig');
    assert.strictEqual(r.action, 'unhandled');
    assert.strictEqual(r.type, 'charge.refunded');
  });
});
