// ============================================================
// NodeFlow — Plan Básico vs Pro
// Gating del motor de seguimientos.
//
// LO CRÍTICO (cambiado el 2026-07-29): el defecto es BÁSICO. Antes era PRO, para
// que construir el gating no rompiera a nadie — pero el efecto económico no era
// neutro: toda org sin marcar recibía voz premium, crecimiento y WhatsApp propio
// (~64€/mes de complementos) dentro de un plan de 49€.
//
// Ahora Pro hay que tenerlo ESCRITO (`tier:'pro'`) o COMPRADO (`addons.pro`).
// Nada de entitlements que dependan de la ausencia de un campo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { tierOf, hasPro, upgradeMessage, PRO_FEATURES } = require('../src/billing/plan');

const org = (tier) => tier === undefined ? {} : { automation_config: { config: { tier } } };

describe('tierOf / hasPro — default BÁSICO', () => {
  test('org SIN tier → básico (ya no se regalan 64€/mes de complementos)', () => {
    assert.strictEqual(tierOf(org()), 'basico');
    assert.strictEqual(hasPro(org()), false);
  });
  test('org null/undefined → básico (fail-CLOSED: ante la duda, no se regala)', () => {
    assert.strictEqual(hasPro(null), false);
    assert.strictEqual(hasPro(undefined), false);
  });
  test("tier 'pro' EXPLÍCITO → pro (es lo que llevan los fundadores)", () => {
    assert.strictEqual(tierOf(org('pro')), 'pro');
    assert.strictEqual(hasPro(org('pro')), true);
  });
  test("tier 'basico' → NO pro", () => {
    assert.strictEqual(tierOf(org('basico')), 'basico');
    assert.strictEqual(hasPro(org('basico')), false);
  });
  test('valor de tier raro → básico (solo el literal "pro" desbloquea)', () => {
    assert.strictEqual(hasPro(org('gratis')), false);
    assert.strictEqual(hasPro(org('')), false);
    assert.strictEqual(hasPro(org('PRO')), false, 'y sin sorpresas por mayúsculas');
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
