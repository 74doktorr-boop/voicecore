// ============================================================
// NodeFlow — Overage billing tests (Stripe Billing Meters)
// Ejecutar: npm test  (node --test test/)
//
// Verifica el cálculo del overage (solo minutos por encima de lo
// incluido) y el reporte vía meter events (API moderna; el viejo
// createUsageRecord se eliminó en el SDK v22).
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

const { StripeBilling, computeOverageDelta } = require('../src/billing/stripe');

describe('computeOverageDelta', () => {
  test('plan sin overage (starter) → 0', () => assert.strictEqual(computeOverageDelta('starter', 0, 100), 0));
  test('plan desconocido → 0', () => assert.strictEqual(computeOverageDelta('zzz', 0, 100), 0));
  test('todo dentro de lo incluido → 0', () => assert.strictEqual(computeOverageDelta('negocio', 100, 200), 0));
  test('justo hasta la cuota (500) → 0', () => assert.strictEqual(computeOverageDelta('negocio', 490, 500), 0));
  test('cruza la cuota → solo la parte por encima', () => assert.strictEqual(computeOverageDelta('negocio', 495, 505), 5));
  test('totalmente por encima → delta completo', () => assert.strictEqual(computeOverageDelta('negocio', 600, 610), 10));
  test('pro (2000 incluidos)', () => assert.strictEqual(computeOverageDelta('pro', 1998, 2003), 3));
  test('decimales redondeados a 2', () => assert.strictEqual(computeOverageDelta('negocio', 499.5, 501.25), 1.25));
});

describe('reportUsage / reportOverage (Billing Meters)', () => {
  let billing, sent;
  beforeEach(() => {
    billing = new StripeBilling({ stripeSecretKey: 'sk_test_fake' });
    sent = [];
    // Sustituye el cliente Stripe real por un mock que captura los meter events.
    billing.stripe = { billing: { meterEvents: { create: async (e) => { sent.push(e); return e; } } } };
    billing.enabled = true;
    process.env.STRIPE_OVERAGE_METER_EVENT = 'nodeflow_overage_minutes';
  });

  test('reportUsage crea un meter event con cliente y valor', async () => {
    await billing.reportUsage({ stripeCustomerId: 'cus_1', minutes: 3.5 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].event_name, 'nodeflow_overage_minutes');
    assert.strictEqual(sent[0].payload.stripe_customer_id, 'cus_1');
    assert.strictEqual(sent[0].payload.value, '3.5');
  });

  test('no-op si no hay event name configurado (sin Stripe aún)', async () => {
    delete process.env.STRIPE_OVERAGE_METER_EVENT;
    await billing.reportUsage({ stripeCustomerId: 'cus_1', minutes: 5 });
    assert.strictEqual(sent.length, 0);
  });

  test('no-op sin cliente o con minutos<=0', async () => {
    await billing.reportUsage({ stripeCustomerId: '', minutes: 5 });
    await billing.reportUsage({ stripeCustomerId: 'cus_1', minutes: 0 });
    assert.strictEqual(sent.length, 0);
  });

  test('reportOverage reporta SOLO la parte por encima de lo incluido', async () => {
    await billing.reportOverage({ plan: 'negocio', stripeCustomerId: 'cus_1', prevMinutes: 498, newMinutes: 503 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].payload.value, '3'); // 503-500=3
  });

  test('reportOverage NO reporta si la llamada queda dentro de lo incluido', async () => {
    await billing.reportOverage({ plan: 'negocio', stripeCustomerId: 'cus_1', prevMinutes: 100, newMinutes: 200 });
    assert.strictEqual(sent.length, 0);
  });

  test('reportOverage no reporta para plan sin overage', async () => {
    await billing.reportOverage({ plan: 'starter', stripeCustomerId: 'cus_1', prevMinutes: 40, newMinutes: 120 });
    assert.strictEqual(sent.length, 0);
  });
});
