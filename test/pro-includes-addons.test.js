// ============================================================
// NodeFlow — Pro incluye TODOS los add-ons de capacidad (2026-07-27)
// Decisión de producto: el plan Pro (85€) trae voz premium, WhatsApp propio
// y reactivación SIN coste extra. hasAddon abre para Pro; listAddons los marca
// includedInPro (sin botón de compra) → sin doble-cobro. Básico intacto.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { hasAddon, listAddons, ADDONS } = require('../src/billing/addons');

// Desde 2026-07-29 el defecto es BÁSICO: Pro hay que tenerlo escrito o comprado.
const pro = { automation_config: { config: { tier: 'pro' } } };
const proExplicito = pro;
const sinTier = {};                                               // → básico
const basico = { automation_config: { config: { tier: 'basico' } } };
const basicoConGrowth = { automation_config: { config: { tier: 'basico', addons: { growth: { itemId: 'si_x' } } } } };
const CAP = ['voice_premium', 'growth', 'wa_own_number'];

describe('hasAddon — Pro incluye todos los de capacidad', () => {
  for (const k of CAP) {
    test(`Pro (defecto) tiene '${k}'`, () => assert.strictEqual(hasAddon(pro, k), true));
    test(`Pro explícito tiene '${k}'`, () => assert.strictEqual(hasAddon(proExplicito, k), true));
    test(`Básico NO tiene '${k}' de gratis`, () => assert.strictEqual(hasAddon(basico, k), false));
  }
  test("Pro NO se auto-incluye 'pro' (evita circular)", () => {
    assert.strictEqual(hasAddon(pro, 'pro'), false);
  });
  test('org SIN tier ya NO recibe los complementos de gratis', () => {
    for (const k of CAP) {
      assert.strictEqual(hasAddon(sinTier, k), false,
        `sin tier explícito no puede venir '${k}' regalado: eran ~64€/mes dentro de un plan de 49€`);
    }
  });
  test('Básico que compró growth aparte lo conserva (sin regresión)', () => {
    assert.strictEqual(hasAddon(basicoConGrowth, 'growth'), true);
    assert.strictEqual(hasAddon(basicoConGrowth, 'voice_premium'), false);
  });
});

describe('listAddons — includedInPro (anti doble-cobro)', () => {
  test('Pro: todos activos + includedInPro (sin botón comprar)', () => {
    for (const a of listAddons(pro)) {
      assert.strictEqual(a.active, true, `${a.key} activo`);
      assert.strictEqual(a.includedInPro, true, `${a.key} includedInPro`);
    }
  });
  test('Básico: ninguno incluido (se compran aparte)', () => {
    for (const a of listAddons(basico)) {
      assert.strictEqual(a.includedInPro, false);
      assert.strictEqual(a.active, false);
    }
  });
  test("'pro' está hidden → no aparece en la caja de Complementos", () => {
    assert.ok(!listAddons(pro).some(a => a.key === 'pro'));
    assert.ok(ADDONS.pro.hidden);
  });
});
