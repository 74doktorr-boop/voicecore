// ============================================================
// NodeFlow — ENTIDADES: presets por sector (recetario de fichas)
// Integridad del catálogo contra las plantillas de entity-types
// (claves EXACTAS, valores válidos, fechas relativas resolubles)
// y funciones puras de resolución. Sin BD: todo determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  ENTITY_PRESETS, isRelativeDate, resolveRelativeDate,
  resolvePresetAttrs, presetsForSector, resolvePresetsForSector,
} = require('../src/entities/entity-presets');
const { ENTITY_TEMPLATES } = require('../src/entities/entity-types');
const { validateAttrs } = require('../src/entities/entities');
const { buildEntityReminderPlan } = require('../src/entities/entity-reminders');

const NOW = new Date('2026-07-08T12:00:00');

// ─── Cobertura: TODOS los sectores del catálogo tienen presets ──────────────

describe('ENTITY_PRESETS — cobertura del catálogo', () => {
  test('exactamente los mismos sectores que ENTITY_TEMPLATES (36)', () => {
    assert.deepStrictEqual(
      Object.keys(ENTITY_PRESETS).sort(),
      Object.keys(ENTITY_TEMPLATES).sort(),
      'cada sector con plantilla debe tener sus presets (y ninguno huérfano)');
  });

  test('3-8 presets por sector (ni vacío ni abrumador)', () => {
    for (const [sector, p] of Object.entries(ENTITY_PRESETS)) {
      assert.ok(p.items.length >= 3 && p.items.length <= 8,
        `${sector}: ${p.items.length} presets (esperados 3-8)`);
    }
  });

  test('ids únicos a nivel global', () => {
    const ids = Object.values(ENTITY_PRESETS).flatMap(p => p.items.map(i => i.id));
    assert.strictEqual(new Set(ids).size, ids.length,
      `ids duplicados: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  });

  test('intro por sector: 1 línea con vocabulario propio, no genérica', () => {
    for (const [sector, p] of Object.entries(ENTITY_PRESETS)) {
      assert.ok(p.intro && p.intro.length >= 40, `${sector}: intro demasiado corta`);
      assert.ok(p.intro.length <= 220, `${sector}: intro demasiado larga (${p.intro.length})`);
      assert.ok(!p.intro.includes('\n'), `${sector}: intro debe ser 1 línea`);
    }
  });
});

// ─── Integridad preset ↔ plantilla (la razón de ser de este test) ───────────

describe('ENTITY_PRESETS — integridad contra las plantillas', () => {
  for (const [sector, presets] of Object.entries(ENTITY_PRESETS)) {
    const template = (ENTITY_TEMPLATES[sector] || [])[0];

    test(`${sector} — cada preset solo usa claves que EXISTEN en la plantilla`, () => {
      assert.ok(template, `plantilla de ${sector} no encontrada`);
      const fieldKeys = new Set(template.fields.map(f => f.key));
      for (const p of presets.items) {
        assert.ok(p.label, `${p.id}: label`);
        assert.ok(p.description && !p.description.includes('\n'),
          `${p.id}: description de 1 línea`);
        assert.ok(Object.keys(p.attrs).length >= 1, `${p.id}: attrs vacíos`);
        for (const k of Object.keys(p.attrs)) {
          assert.ok(fieldKeys.has(k),
            `${p.id}: la clave '${k}' no existe en la plantilla ${sector}.${template.key}`);
        }
      }
    });

    test(`${sector} — attrs resueltos pasan validateAttrs (tipos, opciones, fechas)`, () => {
      for (const p of presets.items) {
        const resolved = resolvePresetAttrs(p.attrs, NOW);
        // partial: el preset PRE-RELLENA; los required que falten los pone
        // el dueño en el formulario (p. ej. la matrícula o el nombre).
        const r = validateAttrs(template.fields, resolved, { partial: true });
        assert.ok(r.ok, `${p.id}: ${JSON.stringify(r.errors)}`);
        // Ninguna clave debe perderse en la validación (clave válida + valor válido)
        for (const k of Object.keys(resolved)) {
          assert.ok(k in r.attrs, `${p.id}: '${k}' descartado por validateAttrs`);
        }
      }
    });

    test(`${sector} — campos-fecha SIEMPRE relativos (jamás fecha horneada)`, () => {
      const dateKeys = new Set(template.fields.filter(f => f.type === 'date').map(f => f.key));
      for (const p of presets.items) {
        for (const [k, v] of Object.entries(p.attrs)) {
          if (dateKeys.has(k)) {
            assert.ok(isRelativeDate(v),
              `${p.id}: '${k}' debe ser { rel_days } — nunca una fecha fija`);
            assert.ok(v.rel_days >= 0, `${p.id}: '${k}' rel_days no negativo`);
          } else {
            assert.ok(!isRelativeDate(v),
              `${p.id}: '${k}' no es campo fecha pero lleva rel_days`);
          }
        }
      }
    });

    test(`${sector} — al menos un preset programa un aviso real (rel_days + offset > 0)`, () => {
      // La promesa de la primera pantalla es "los avisos salen solos": un
      // preset cuyo aviso caería en el pasado es una promesa rota.
      const byKey = new Map(template.fields.map(f => [f.key, f]));
      let sectorHasReminder = false;
      for (const p of presets.items) {
        for (const [k, v] of Object.entries(p.attrs)) {
          const f = byKey.get(k);
          if (f && f.type === 'date' && f.reminder && isRelativeDate(v)) {
            assert.ok(v.rel_days + f.reminder.offset_days > 0,
              `${p.id}: '${k}' rel_days=${v.rel_days} + offset=${f.reminder.offset_days} → aviso en pasado`);
            sectorHasReminder = true;
          }
        }
      }
      assert.ok(sectorHasReminder, `${sector}: ningún preset programa aviso`);
    });

    test(`${sector} — el materializador genera el plan con los attrs del preset`, () => {
      // De punta a punta: preset → attrs resueltos → buildEntityReminderPlan.
      const byKey = new Map(template.fields.map(f => [f.key, f]));
      for (const p of presets.items) {
        const resolved = resolvePresetAttrs(p.attrs, NOW);
        const plan = buildEntityReminderPlan(template, { attrs: resolved }, NOW);
        const expected = Object.entries(p.attrs).filter(([k, v]) => {
          const f = byKey.get(k);
          return f && f.type === 'date' && f.reminder && isRelativeDate(v);
        }).length;
        assert.strictEqual(plan.length, expected,
          `${p.id}: ${plan.length} avisos planificados, esperados ${expected}`);
        for (const item of plan) {
          assert.ok(item.scheduledFor > NOW, `${p.id}: aviso en el futuro`);
        }
      }
    });
  }
});

// ─── Fechas relativas (funciones puras) ──────────────────────────────────────

describe('resolveRelativeDate', () => {
  test('hoy + 90 días', () => {
    assert.strictEqual(resolveRelativeDate({ rel_days: 90 }, new Date('2026-07-08T12:00:00')), '2026-10-06');
  });

  test('rel_days 0 = hoy', () => {
    assert.strictEqual(resolveRelativeDate({ rel_days: 0 }, new Date('2026-07-08T12:00:00')), '2026-07-08');
  });

  test('cruza fin de mes y fin de año', () => {
    assert.strictEqual(resolveRelativeDate({ rel_days: 30 }, new Date('2026-12-15T09:00:00')), '2027-01-14');
    assert.strictEqual(resolveRelativeDate({ rel_days: 1 }, new Date('2026-02-28T09:00:00')), '2026-03-01');
  });

  test('año bisiesto: 28-feb + 1 día = 29-feb', () => {
    assert.strictEqual(resolveRelativeDate({ rel_days: 1 }, new Date('2028-02-28T09:00:00')), '2028-02-29');
  });

  test('fecha LOCAL aunque now sea casi medianoche (no se cuela el día UTC)', () => {
    assert.strictEqual(resolveRelativeDate({ rel_days: 7 }, new Date('2026-07-08T23:30:00')), '2026-07-15');
  });

  test('isRelativeDate distingue marcadores de valores normales', () => {
    assert.strictEqual(isRelativeDate({ rel_days: 30 }), true);
    assert.strictEqual(isRelativeDate('2026-09-01'), false);
    assert.strictEqual(isRelativeDate(30), false);
    assert.strictEqual(isRelativeDate(null), false);
    assert.strictEqual(isRelativeDate([30]), false);
  });
});

describe('resolvePresetAttrs', () => {
  test('resuelve solo los marcadores; el resto pasa intacto', () => {
    const out = resolvePresetAttrs(
      { plan: 'Mensual', cuota_mensual: 35, fecha_renovacion: { rel_days: 30 } },
      new Date('2026-07-08T12:00:00'));
    assert.deepStrictEqual(out, { plan: 'Mensual', cuota_mensual: 35, fecha_renovacion: '2026-08-07' });
  });

  test('no muta el catálogo (los presets se sirven mil veces)', () => {
    const preset = ENTITY_PRESETS.fisioterapia.items[0];
    const before = JSON.stringify(preset.attrs);
    resolvePresetAttrs(preset.attrs, NOW);
    assert.strictEqual(JSON.stringify(preset.attrs), before);
  });

  test('attrs vacíos o nulos → {}', () => {
    assert.deepStrictEqual(resolvePresetAttrs(null), {});
    assert.deepStrictEqual(resolvePresetAttrs({}), {});
  });
});

// ─── Resolución por sector (aliases del registro, igual que las plantillas) ─

describe('presetsForSector / resolvePresetsForSector', () => {
  test('clave directa', () => {
    assert.ok(presetsForSector('fisioterapia').items.some(p => p.id === 'fis_bono5'));
    assert.ok(presetsForSector('taller').items.some(p => p.id === 'tal_itv_anual'));
  });

  test('alias del registro resuelve (veterinario → veterinaria, talleres → taller)', () => {
    assert.ok(presetsForSector('veterinario').items.some(p => p.id === 'vet_vacuna_anual'));
    assert.ok(presetsForSector('talleres').items.some(p => p.id === 'tal_itv_anual'));
  });

  test('entrada vacía o basura → null (nunca petar)', () => {
    assert.strictEqual(presetsForSector(''), null);
    assert.strictEqual(presetsForSector(null), null);
    assert.strictEqual(resolvePresetsForSector(''), null);
  });

  test('resolvePresetsForSector: type de la plantilla + fechas ya resueltas', () => {
    const r = resolvePresetsForSector('fisioterapia', NOW);
    assert.strictEqual(r.type, 'plan_tratamiento');
    assert.ok(r.intro);
    const bono = r.items.find(p => p.id === 'fis_bono5');
    assert.strictEqual(bono.attrs.caducidad_bono, '2026-10-06'); // hoy + 90
    assert.strictEqual(bono.attrs.sesiones_totales, 5);
  });

  test('resolvePresetsForSector: TODOS los sectores del catálogo sirven', () => {
    for (const sector of Object.keys(ENTITY_TEMPLATES)) {
      const r = resolvePresetsForSector(sector, NOW);
      assert.ok(r && r.items.length >= 3, `${sector}: sin presets servibles`);
      assert.strictEqual(r.type, ENTITY_TEMPLATES[sector][0].key,
        `${sector}: type no coincide con la plantilla`);
      for (const p of r.items) {
        for (const v of Object.values(p.attrs)) {
          assert.ok(!isRelativeDate(v), `${sector}/${p.id}: marcador sin resolver`);
        }
      }
    }
  });
});
