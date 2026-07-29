// ============================================================
// NodeFlow — Alta de dos tiers: mapeo elección → tier/billing (2026-07-27)
// El checkout de dos tiers descansa en parseSignupPlan: un mapeo PURO que
// decide base Stripe, tier de gating y si se cobra el add-on Pro. Cero
// regresión pre-lanzamiento: sin elección explícita → comportamiento actual.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseSignupPlan } = require('../src/billing/signup-tier');

describe('parseSignupPlan', () => {
  test("'basico' → base negocio, capa tier, sin add-on", () => {
    const r = parseSignupPlan('basico');
    assert.deepStrictEqual(r, { choice: 'basico', basePlan: 'negocio', tier: 'basico', wantsProAddon: false });
  });

  test("'pro' → base negocio, sin tier (Pro por defecto), cobra add-on", () => {
    const r = parseSignupPlan('pro');
    assert.strictEqual(r.basePlan, 'negocio');
    assert.strictEqual(r.tier, null);       // defecto Pro; no se escribe 'basico'
    assert.strictEqual(r.wantsProAddon, true);
  });

  // Desde que el defecto es BÁSICO (2026-07-29), el tier del fundador se ESCRIBE.
  // Dejarlo a null lo caparía en silencio y romperíamos su oferta —Pro completo a
  // 49€ de por vida— sin que nadie lo notara hasta que echara algo en falta.
  test('FUNDADOR gana siempre: aunque elija Pro, sin add-on y con tier pro ESCRITO (Pro a 49€)', () => {
    const r = parseSignupPlan('pro', { isFounder: true });
    assert.strictEqual(r.wantsProAddon, false); // NO se le cobra el +36€
    assert.strictEqual(r.tier, 'pro');          // su promesa, en los datos
    assert.strictEqual(r.basePlan, 'negocio');  // precio base 49€
  });

  test('fundador que elige básico → tampoco capado (su deal es Pro)', () => {
    assert.strictEqual(parseSignupPlan('basico', { isFounder: true }).tier, 'pro');
  });

  test("ausente / 'negocio' / legacy / basura → comportamiento actual (base, sin tier, sin add-on)", () => {
    for (const v of [undefined, null, '', 'negocio', 'starter', 'PRO_pirata', 'xxx']) {
      const r = parseSignupPlan(v);
      assert.strictEqual(r.tier, null, `tier para ${JSON.stringify(v)}`);
      assert.strictEqual(r.wantsProAddon, false, `addon para ${JSON.stringify(v)}`);
      assert.strictEqual(r.basePlan, 'negocio');
    }
  });

  test('mayúsculas/espacios tolerados', () => {
    assert.strictEqual(parseSignupPlan('  PRO ').wantsProAddon, true);
    assert.strictEqual(parseSignupPlan('Basico').tier, 'basico');
  });
});

describe('checkout: línea del add-on Pro (lógica de createRegistroCheckout)', () => {
  // Réplica de la decisión de line_items: base siempre; +Pro solo si lo pide Y
  // hay precio configurado. Gated → sin env nunca rompe el checkout.
  const buildLines = (proAddon, proPriceId) => {
    const lines = [{ price: 'price_base', quantity: 1 }];
    if (proAddon && proPriceId) lines.push({ price: proPriceId, quantity: 1 });
    return lines;
  };
  test('Pro + precio configurado → 2 líneas (85€)', () => {
    assert.strictEqual(buildLines(true, 'price_pro').length, 2);
  });
  test('Pro SIN precio configurado → solo base (cae elegante a 49€, no rompe)', () => {
    assert.strictEqual(buildLines(true, undefined).length, 1);
  });
  test('Básico → solo base', () => {
    assert.strictEqual(buildLines(false, 'price_pro').length, 1);
  });
});
