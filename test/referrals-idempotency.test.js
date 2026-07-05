// ============================================================
// NodeFlow — recordConversion es IDEMPOTENTE
// El webhook de Stripe puede reintentar (y el claim de provisión se libera si
// un paso posterior falla), así que recordConversion puede llamarse >1 vez para
// el mismo referido. La recompensa (times_converted / reward_pending) debe
// sumarse UNA sola vez — antes se doblaba el crédito manual.
// ============================================================
'use strict';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Estado del mock (simula la BD). El update condicional 'signup'→'converted'
// solo afecta filas no convertidas: 1ª vez devuelve fila, después vacío.
const state = { converted: new Set(), refUpdates: 0 };

function convChain() {
  const ctx = { registroId: null, onlySignup: false };
  const qb = {
    update() { return qb; },
    eq(col, val) {
      if (col === 'referee_registro_id') ctx.registroId = val;
      if (col === 'status' && val === 'signup') ctx.onlySignup = true;
      return qb;
    },
    select() {
      if (ctx.onlySignup && state.converted.has(ctx.registroId)) return Promise.resolve({ data: [] });
      if (ctx.onlySignup) { state.converted.add(ctx.registroId); return Promise.resolve({ data: [{ id: 'c1' }] }); }
      return Promise.resolve({ data: [{ id: 'c1' }] });
    },
  };
  return qb;
}
function refChain() {
  const qb = {
    select() { return qb; }, eq() { return qb; },
    maybeSingle() { return Promise.resolve({ data: { referrer_org_id: 'org-r', referrer_email: 'r@x.com', times_converted: 0, reward_pending: 0 } }); },
    update() { state.refUpdates++; return { eq: () => Promise.resolve({ error: null }) }; },
  };
  return qb;
}
function orgChain() {
  const qb = { select() { return qb; }, eq() { return qb; },
    maybeSingle() { return Promise.resolve({ data: { plan: 'negocio', stripe_customer_id: null } }); } };
  return qb;
}

const dbmod = require('../src/db/database');
dbmod.getDatabase = () => ({
  enabled: true,
  client: { from: (t) => t === 'nf_referral_conversions' ? convChain() : t === 'organizations' ? orgChain() : refChain() },
});

const { recordConversion } = require('../src/referrals/referrals');

describe('recordConversion — idempotente', () => {
  test('reintento del mismo referido NO dobla la recompensa', async () => {
    state.converted = new Set(); state.refUpdates = 0;
    const r1 = await recordConversion('REF-ABC', 'reg-1');
    const r2 = await recordConversion('REF-ABC', 'reg-1'); // reintento del webhook
    assert.ok(r1 && r1.referrerOrgId === 'org-r', 'la 1ª conversión devuelve el referrer para notificar');
    assert.strictEqual(r2, null, 'el reintento es no-op idempotente (no notifica ni suma)');
    assert.strictEqual(state.refUpdates, 1, 'times_converted/reward_pending se suma UNA sola vez');
  });

  test('dos referidos distintos SÍ suman cada uno', async () => {
    state.converted = new Set(); state.refUpdates = 0;
    await recordConversion('REF-ABC', 'reg-1');
    await recordConversion('REF-ABC', 'reg-2');
    assert.strictEqual(state.refUpdates, 2);
  });
});
