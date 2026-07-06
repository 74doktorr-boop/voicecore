// ============================================================
// NodeFlow — Cobertura del catálogo de seguimientos (2026-07-06)
// TODO sector del registro debe tener seguimientos de fábrica con
// triggers válidos, y los basados en fecha deben tener su campo
// declarado en sector-fields (si no, el wizard nunca lo pediría).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { SECTOR_CATALOG, toEngineDefaults, TRIGGERS } = require('../src/lifecycle/sector-catalog');
const { SECTOR_REQUIRED_FIELDS } = require('../src/lifecycle/sector-fields');
const registry = require('../src/sectors/sector-registry');

// Slugs reales del registro de sectores (la fuente de resolveSector).
const registrySlugs = Object.values(registry.SECTORS || registry.SECTOR_CATALOG || {})
  .map(s => s.slug).filter(Boolean);

describe('cobertura de sectores', () => {
  test('todo sector del registro tiene seguimientos de fábrica', () => {
    assert.ok(registrySlugs.length >= 25, `el registro debería tener 25+ sectores (tiene ${registrySlugs.length})`);
    const missing = registrySlugs.filter(slug => {
      const def = SECTOR_CATALOG[slug];
      return !def || !def.followups || !def.followups.length;
    });
    assert.deepStrictEqual(missing, [], `sectores sin seguimientos: ${missing.join(', ')}`);
  });

  test('resolveSector de cada sector del catálogo cae en un slug con catálogo', () => {
    for (const slug of Object.keys(SECTOR_CATALOG)) {
      const resolved = registry.resolveSector(slug).slug;
      assert.ok(SECTOR_CATALOG[resolved], `resolveSector('${slug}') → '${resolved}' sin entrada en el catálogo`);
    }
  });

  test('todos los triggers son válidos y los days coherentes', () => {
    for (const [sector, def] of Object.entries(SECTOR_CATALOG)) {
      for (const fu of def.followups) {
        assert.ok(TRIGGERS[fu.trigger], `${sector}.${fu.key}: trigger desconocido '${fu.trigger}'`);
        assert.ok(fu.key && fu.label && fu.serviceLabel && fu.desc, `${sector}.${fu.key}: faltan textos`);
        if (fu.trigger !== 'custom_frequency' && fu.field !== 'suministro_lentillas_dias') {
          assert.ok(Number.isFinite(fu.days) && fu.days > 0 && fu.days <= 400, `${sector}.${fu.key}: days raro (${fu.days})`);
        }
        if (fu.trigger === 'before_sector_field' || fu.trigger === 'from_sector_field') {
          assert.ok(fu.field, `${sector}.${fu.key}: trigger de campo sin field`);
        }
      }
    }
  });

  test('todo seguimiento con field tiene el campo declarado en sector-fields', () => {
    const problems = [];
    for (const [sector, def] of Object.entries(SECTOR_CATALOG)) {
      const fields = (SECTOR_REQUIRED_FIELDS[sector] || []).map(f => f.key);
      for (const fu of def.followups) {
        if (fu.field && !fields.includes(fu.field)) problems.push(`${sector}.${fu.key} → falta campo '${fu.field}'`);
      }
    }
    assert.deepStrictEqual(problems, [], problems.join('; '));
  });

  test('toEngineDefaults expone todos los sectores del catálogo', () => {
    const engine = toEngineDefaults();
    assert.strictEqual(Object.keys(engine).length, Object.keys(SECTOR_CATALOG).length);
    assert.ok(engine.generico.reactivacion, 'hasta genérico debe traer reactivación');
    assert.ok(engine.reconocimientos.renovacion_psicotecnico, 'CRC standalone con renovación');
  });
});
