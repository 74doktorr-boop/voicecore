// ============================================================
// NodeFlow — Disparador "a los N días del alta" (from_signup) (2026-07-08)
// El "alta" es la fecha en que el cliente entró en la agenda (created_at):
// dispara SOLO, sin que el dueño rellene ningún campo por cliente. Nace del
// dolor de "Sesión de mantenimiento — a los 90 días del alta ⚠️ ningún cliente
// tiene esta fecha rellenada": antes usaba un campo manual que nadie llenaba.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateScheduledFor } = require('../src/lifecycle/reminder-engine');
const { SECTOR_CATALOG, TRIGGERS, CUSTOM_TRIGGERS, NO_DATA_TRIGGERS, toEngineDefaults } = require('../src/lifecycle/sector-catalog');
const { buildRulesView, normalizeRules } = require('../src/lifecycle/followup-rules');

const DAY = 864e5;

describe('trigger from_signup — calculateScheduledFor', () => {
  test('alta reciente → programa a los N días del alta', () => {
    const created = new Date(Date.now() - 10 * DAY); // dado de alta hace 10 días
    const d = calculateScheduledFor(
      { trigger: 'from_signup', days: 90 }, {}, null,
      { contactCreatedAt: created.toISOString() }
    );
    assert.ok(d, 'debe programarse');
    const expected = new Date(created.getTime() + 90 * DAY);
    assert.strictEqual(d.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
  });

  test('alta muy antigua (la fecha ya pasó) → no se programa en el pasado', () => {
    const created = new Date(Date.now() - 200 * DAY);
    const d = calculateScheduledFor(
      { trigger: 'from_signup', days: 90 }, {}, null,
      { contactCreatedAt: created.toISOString() }
    );
    assert.strictEqual(d, null);
  });

  test('sin fecha de alta → no se programa (no revienta)', () => {
    assert.strictEqual(
      calculateScheduledFor({ trigger: 'from_signup', days: 90 }, {}, null, {}),
      null
    );
    assert.strictEqual(
      calculateScheduledFor({ trigger: 'from_signup', days: 90 }, {}, null),
      null
    );
  });

  test('fecha de alta basura → no se programa', () => {
    assert.strictEqual(
      calculateScheduledFor({ trigger: 'from_signup', days: 90 }, {}, null, { contactCreatedAt: 'no-es-fecha' }),
      null
    );
  });

  test('días por defecto (30) si no se especifica', () => {
    const created = new Date(Date.now() - 5 * DAY);
    const d = calculateScheduledFor({ trigger: 'from_signup' }, {}, null, { contactCreatedAt: created.toISOString() });
    assert.ok(d);
    const expected = new Date(created.getTime() + 30 * DAY);
    assert.strictEqual(d.toISOString().slice(0, 10), expected.toISOString().slice(0, 10));
  });
});

describe('regla "sesión de mantenimiento" — ya NO pide dato manual', () => {
  test('fisioterapia.mantenimiento dispara del alta (from_signup, sin field)', () => {
    const rule = SECTOR_CATALOG.fisioterapia.followups.find(f => f.key === 'mantenimiento');
    assert.ok(rule, 'debe existir la regla mantenimiento');
    assert.strictEqual(rule.trigger, 'from_signup');
    assert.strictEqual(rule.field, undefined, 'no debe apoyarse en un campo manual');
    assert.strictEqual(rule.days, 90);
  });

  test('toEngineDefaults expone mantenimiento con from_signup', () => {
    const eng = toEngineDefaults();
    assert.strictEqual(eng.fisioterapia.mantenimiento.trigger, 'from_signup');
  });

  test('la vista de reglas la marca "noData" (dispara sola)', () => {
    const rules = buildRulesView('fisioterapia', {});
    const mant = rules.find(r => r.key === 'mantenimiento');
    assert.ok(mant);
    assert.strictEqual(mant.noData, true, 'no requiere que el dueño rellene nada');
    assert.strictEqual(mant.editableDays, true, 'los días se pueden ajustar');
  });
});

describe('from_signup como disparador personalizable', () => {
  test('está en TRIGGERS, CUSTOM_TRIGGERS y NO_DATA_TRIGGERS', () => {
    assert.ok(TRIGGERS.from_signup, 'debe tener etiqueta para la UI');
    assert.ok(CUSTOM_TRIGGERS.includes('from_signup'), 'el dueño puede elegirlo');
    assert.ok(NO_DATA_TRIGGERS.includes('from_signup'), 'no pide dato por cliente');
  });

  test('el dueño puede crear una regla personalizada from_signup', () => {
    const res = normalizeRules('peluqueria', {
      custom: [{ label: 'Bienvenida a los 7 días', trigger: 'from_signup', days: 7, channel: 'whatsapp' }],
    });
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.config._custom.length, 1);
    assert.strictEqual(res.config._custom[0].trigger, 'from_signup');
    assert.strictEqual(res.config._custom[0].days, 7);
    // from_signup NO crea campo manual en la ficha (a diferencia de before_sector_field)
    assert.strictEqual(res.config._custom[0].field, undefined);
  });

  test('la regla personalizada from_signup se ve marcada noData', () => {
    const rules = buildRulesView('peluqueria', {
      _custom: [{ key: 'custom_bienvenida', label: 'Bienvenida', trigger: 'from_signup', days: 7, channel: 'whatsapp', enabled: true }],
    });
    const c = rules.find(r => r.key === 'custom_bienvenida');
    assert.ok(c);
    assert.strictEqual(c.noData, true);
  });
});
