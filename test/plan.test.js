// ============================================================
// NodeFlow — Plan Básico vs Pro (2026-07-27)
// Gating del motor de seguimientos. LO CRÍTICO: default = PRO (solo un
// tier:'basico' explícito capa) → construir el gating NO rompe a nadie
// (orgs existentes y fundadores conservan TODO).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { tierOf, hasPro, upgradeMessage, PRO_FEATURES } = require('../src/billing/plan');

const org = (tier) => tier === undefined ? {} : { automation_config: { config: { tier } } };

describe('tierOf / hasPro — default PRO', () => {
  test('org SIN tier → pro (no rompe a nadie: fundadores/existentes)', () => {
    assert.strictEqual(tierOf(org()), 'pro');
    assert.strictEqual(hasPro(org()), true);
  });
  test('org null/undefined → pro (fail-open)', () => {
    assert.strictEqual(hasPro(null), true);
    assert.strictEqual(hasPro(undefined), true);
  });
  test("tier 'pro' → pro", () => {
    assert.strictEqual(hasPro(org('pro')), true);
  });
  test("tier 'basico' → NO pro (única forma de capar)", () => {
    assert.strictEqual(tierOf(org('basico')), 'basico');
    assert.strictEqual(hasPro(org('basico')), false);
  });
  test('valor de tier raro → tratado como pro (solo el literal basico capa)', () => {
    assert.strictEqual(hasPro(org('gratis')), true);
    assert.strictEqual(hasPro(org('')), true);
  });
});

describe('hasPro vía add-on Pro (upgrade self-serve del Básico)', () => {
  const withAddon = (tier, addons) => ({ automation_config: { config: { tier, addons } } });
  test("Básico + add-on 'pro' → PRO (el add-on anula el cap)", () => {
    assert.strictEqual(hasPro(withAddon('basico', { pro: { itemId: 'si_x', since: 'now' } })), true);
  });
  test('Básico + otros add-ons (no pro) → sigue capado', () => {
    assert.strictEqual(hasPro(withAddon('basico', { voice_premium: { itemId: 'si_y' } })), false);
  });
  test('Básico sin add-ons → capado', () => {
    assert.strictEqual(hasPro(withAddon('basico', {})), false);
    assert.strictEqual(hasPro(withAddon('basico', undefined)), false);
  });
  test("cancelar el add-on (queda tier:'basico') vuelve a capar", () => {
    // simula estado tras cancelAddon: addons.pro borrado, tier intacto
    assert.strictEqual(hasPro(withAddon('basico', { wa_own_number: {} })), false);
  });
});

describe('upgradeMessage', () => {
  test('nombra la feature Pro y apunta a Facturación', () => {
    const m = upgradeMessage('reviews');
    assert.ok(m.includes(PRO_FEATURES.reviews));
    assert.ok(/Pro/.test(m) && /Facturación/.test(m));
  });
  test('feature desconocida → mensaje genérico, no revienta', () => {
    assert.ok(upgradeMessage('inexistente').includes('plan Pro'));
  });
});
