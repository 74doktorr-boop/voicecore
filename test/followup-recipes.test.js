// ============================================================
// NodeFlow — Recetario de seguimientos (2026-07-06)
// Ideas curadas por sector, añadibles como regla custom de un clic.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getRecipes, UNIVERSAL, BY_SECTOR } = require('../src/lifecycle/followup-recipes');
const { CUSTOM_TRIGGERS } = require('../src/lifecycle/sector-catalog');
const { normalizeRules } = require('../src/lifecycle/followup-rules');

describe('recetario — integridad', () => {
  test('toda receta usa un trigger permitido para reglas custom', () => {
    const all = [...UNIVERSAL, ...Object.values(BY_SECTOR).flat()];
    for (const r of all) {
      assert.ok(CUSTOM_TRIGGERS.includes(r.trigger), `${r.id}: trigger '${r.trigger}' no es custom-compatible`);
      assert.ok(r.id && r.label && r.serviceLabel && r.tip, `${r.id}: faltan textos`);
      assert.ok(Number.isFinite(r.days) && r.days >= 1 && r.days <= 365, `${r.id}: days raro`);
      assert.ok(r.tip.length >= 40, `${r.id}: el tip debe aportar consejo real, no relleno`);
    }
  });

  test('ids únicos en todo el recetario', () => {
    const all = [...UNIVERSAL, ...Object.values(BY_SECTOR).flat()];
    const ids = all.map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('toda receta se puede guardar tal cual como regla custom (normalizeRules)', () => {
    const all = [...UNIVERSAL, ...Object.values(BY_SECTOR).flat()];
    for (const r of all) {
      const res = normalizeRules('generico', { custom: [{ label: r.label, serviceLabel: r.serviceLabel, trigger: r.trigger, days: r.days, serviceFilter: r.serviceFilter, channel: 'whatsapp', enabled: true }] });
      assert.ok(!res.error, `${r.id}: normalizeRules rechazó la receta: ${res.error}`);
    }
  });
});

describe('getRecipes', () => {
  test('sector con recetas propias → propias primero + universales', () => {
    const out = getRecipes('peluqueria');
    assert.ok(out.length >= 4);
    assert.strictEqual(out[0].id, 'p_pack_color');
    assert.ok(out.some(r => r.id === 'u_rescate_60'));
  });

  test('sector sin recetas propias → al menos las universales', () => {
    const out = getRecipes('notaria');
    assert.ok(out.length >= 3);
    assert.ok(out.every(r => r.id.startsWith('u_')));
  });

  test('excluye las ya añadidas (por etiqueta, case-insensitive)', () => {
    const out = getRecipes('peluqueria', ['aviso de raíces', 'Rescate del cliente dormido']);
    assert.ok(!out.some(r => r.id === 'p_pack_color'));
    assert.ok(!out.some(r => r.id === 'u_rescate_60'));
    assert.ok(out.some(r => r.id === 'u_segunda_visita'));
  });
});
