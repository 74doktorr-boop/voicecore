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

const { StripeBilling, computeOverageDelta, includedMinutes } = require('../src/billing/stripe');

// La cuota NO se escribe aquí. Estos tests decían 500 —y seguían verdes— nueve
// días después de bajar el plan a 200: se escribieron cuando la cuota era 500 y
// nadie los tocó al cambiarla. O sea que el suite no es que no viera el fallo,
// es que lo AFIRMABA: certificaba como correcto no cobrar el excedente.
//
// Un test que repite a mano el número que vigila deja de vigilarlo en cuanto el
// número cambia, y encima da confianza mientras tanto. Todo lo de aquí abajo se
// escribe RELATIVO a la cuota real del plan.
const CUOTA = includedMinutes('negocio');

describe('computeOverageDelta', () => {
  test('la cuota de referencia sale del plan, no de este fichero', () => {
    const { PLAN_LIMITS } = require('../src/auth/middleware');
    assert.strictEqual(CUOTA, PLAN_LIMITS.negocio.minutesPerMonth);
    assert.ok(CUOTA > 0);
  });
  test('plan legacy sin overage (starter) → 0', () => assert.strictEqual(computeOverageDelta('starter', 0, 100), 0));
  test('plan desconocido → 0', () => assert.strictEqual(computeOverageDelta('zzz', 0, 100), 0));
  test('todo dentro de lo incluido → 0', () => assert.strictEqual(computeOverageDelta('negocio', CUOTA / 4, CUOTA / 2), 0));
  test('justo hasta la cuota → 0', () => assert.strictEqual(computeOverageDelta('negocio', CUOTA - 10, CUOTA), 0));
  test('cruza la cuota → solo la parte por encima', () => assert.strictEqual(computeOverageDelta('negocio', CUOTA - 5, CUOTA + 5), 5));
  test('totalmente por encima → delta completo', () => assert.strictEqual(computeOverageDelta('negocio', CUOTA + 100, CUOTA + 110), 10));
  test('plan legacy pro (retirado) → 0, sin cuota propia', () => assert.strictEqual(computeOverageDelta('pro', 1998, 2003), 0));
  test('decimales redondeados a 2', () => assert.strictEqual(computeOverageDelta('negocio', CUOTA - 0.5, CUOTA + 1.25), 1.25));
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
    await billing.reportOverage({ plan: 'negocio', stripeCustomerId: 'cus_1', prevMinutes: CUOTA - 2, newMinutes: CUOTA + 3 });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].payload.value, '3');
  });

  test('reportOverage NO reporta si la llamada queda dentro de lo incluido', async () => {
    await billing.reportOverage({ plan: 'negocio', stripeCustomerId: 'cus_1', prevMinutes: CUOTA / 4, newMinutes: CUOTA / 2 });
    assert.strictEqual(sent.length, 0);
  });

  // El que faltaba, y es el que habría cazado el fallo: pasarse de la cuota SÍ
  // se cobra. Con los 500 escondidos, un cliente de 400 minutos sobre un plan de
  // 200 no generaba ni un evento de facturación — 30 € al mes en silencio.
  test('el doble de la cuota se factura entero, no se regala', async () => {
    await billing.reportOverage({ plan: 'negocio', stripeCustomerId: 'cus_1', prevMinutes: 0, newMinutes: CUOTA * 2 });
    assert.strictEqual(sent.length, 1, 'no se ha reportado NADA a Stripe habiendo excedente');
    assert.strictEqual(Number(sent[0].payload.value), CUOTA,
      `con ${CUOTA * 2} minutos gastados sobre ${CUOTA} incluidos hay que facturar ${CUOTA}`);
  });

  test('reportOverage no reporta para plan sin overage', async () => {
    await billing.reportOverage({ plan: 'starter', stripeCustomerId: 'cus_1', prevMinutes: 40, newMinutes: 120 });
    assert.strictEqual(sent.length, 0);
  });
});

describe('addOverageItem (engancha el precio medido a la suscripción)', () => {
  let billing, created;
  beforeEach(() => {
    billing = new StripeBilling({ stripeSecretKey: 'sk_test_fake' });
    billing.enabled = true;
    created = [];
  });

  test('añade el item si la suscripción no lo tiene', async () => {
    billing.stripe = {
      subscriptions:     { retrieve: async () => ({ items: { data: [{ price: { id: 'price_flat' } }] } }) },
      subscriptionItems: { create: async (p) => { created.push(p); return p; } },
    };
    const r = await billing.addOverageItem('sub_1', 'price_meter');
    assert.strictEqual(r, true);
    assert.deepStrictEqual(created, [{ subscription: 'sub_1', price: 'price_meter' }]);
  });

  test('idempotente: no añade si ya existe', async () => {
    billing.stripe = {
      subscriptions:     { retrieve: async () => ({ items: { data: [{ price: { id: 'price_meter' } }] } }) },
      subscriptionItems: { create: async (p) => { created.push(p); return p; } },
    };
    const r = await billing.addOverageItem('sub_1', 'price_meter');
    assert.strictEqual(r, false);
    assert.strictEqual(created.length, 0);
  });

  test('no-op sin subscription ni price', async () => {
    delete process.env.STRIPE_OVERAGE_PRICE_ID;
    billing.stripe = { subscriptions: { retrieve: async () => ({ items: { data: [] } }) }, subscriptionItems: { create: async () => { created.push(1); } } };
    assert.strictEqual(await billing.addOverageItem('', 'price_meter'), false);
    assert.strictEqual(await billing.addOverageItem('sub_1', ''), false);
    assert.strictEqual(created.length, 0);
  });
});
