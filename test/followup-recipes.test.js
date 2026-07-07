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

  test('sector desconocido → al menos las universales', () => {
    const out = getRecipes('sector_inventado');
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

// ── Recetario AMPLIADO (2026-07-07): los 33 sectores cubiertos y filtrado
// por los servicios reales del negocio ("cada negocio ve SU recetario").
describe('recetario ampliado — cobertura y filtrado por negocio', () => {
  const { SECTOR_CATALOG, getSectorFollowups } = require('../src/lifecycle/sector-catalog');

  test('TODOS los sectores del catálogo tienen recetas propias (≥2)', () => {
    for (const slug of Object.keys(SECTOR_CATALOG)) {
      const own = BY_SECTOR[slug] || [];
      assert.ok(own.length >= 2, `${slug}: solo ${own.length} recetas propias`);
    }
  });

  test('BY_SECTOR sin sectores fantasma (toda clave existe en el catálogo)', () => {
    for (const slug of Object.keys(BY_SECTOR)) {
      assert.ok(SECTOR_CATALOG[slug], `${slug} no existe en SECTOR_CATALOG`);
    }
  });

  test('ninguna receta pisa la etiqueta de un default del sector', () => {
    for (const [slug, recipes] of Object.entries(BY_SECTOR)) {
      const defaults = new Set(getSectorFollowups(slug).map(f => f.label.toLowerCase()));
      for (const r of recipes) {
        assert.ok(!defaults.has(r.label.toLowerCase()), `${slug}/${r.id}: pisa el default "${r.label}"`);
      }
    }
  });

  test('filtrado por servicios: peluquería sin tintes NO ve la idea de raíces', () => {
    const soloCortes = [{ name: 'Corte caballero' }, { name: 'Corte señora' }];
    const out = getRecipes('peluqueria', [], soloCortes);
    assert.ok(!out.some(r => r.id === 'p_pack_color'), 'raíces requiere ofrecer color/tinte');
    assert.ok(out.some(r => r.id === 'p_evento'), 'las ideas sin serviceFilter siempre aplican');
  });

  test('con tintes SÍ la ve; sin serviceList no se restringe', () => {
    const conTinte = [{ name: 'Tinte y mechas' }];
    assert.ok(getRecipes('peluqueria', [], conTinte).some(r => r.id === 'p_pack_color'));
    assert.ok(getRecipes('peluqueria', [], null).some(r => r.id === 'p_pack_color'));
  });
});
