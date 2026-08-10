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
    // OJO CON LA ARITMÉTICA DE FECHAS. Este test comparaba contra
    // `created.getTime() + 90 * DAY`, o sea milisegundos a pelo, y eso IGNORA el
    // cambio de hora. El código usa `setDate(getDate() + 90)`, que conserva la
    // hora LOCAL — que es lo que espera una persona cuando le dicen «dentro de
    // 90 días»: si te dieron de alta a la una, te toca a la una.
    //
    // Las dos cosas se separan una hora en cuanto la fecha objetivo cruza el
    // último domingo de octubre, y si la hora del alta cae cerca de medianoche,
    // esa hora es UN DÍA ENTERO de diferencia. El 06/08/2026 el test falló por
    // esto en Madrid y ACUSABA AL CÓDIGO, que estaba bien; en CI (UTC, sin
    // cambio de hora) pasaba tan tranquilo. Un test que depende de la zona
    // horaria de quien lo ejecuta no protege: entrena a mirar para otro lado.
    //
    // Al arreglarlo caí DOS VECES en la misma trampa: primero fijé el día
    // esperado leyendo la fecha en UTC (en Madrid ese instante ya es el día
    // siguiente), y luego lo dejé clavado a un día concreto, que volvía a
    // depender de la zona. Se comprueba la INVARIANTE, que es lo que de verdad
    // se promete, y no un día del calendario.
    const created = new Date('2026-07-31T23:11:50.000Z');
    const d = calculateScheduledFor(
      { trigger: 'from_signup', days: 90 }, {}, null,
      { contactCreatedAt: created.toISOString() },
    );
    assert.ok(d, 'debe programarse');

    // 1) A la MISMA hora local, aunque por medio se cambie la hora. Esto es lo
    //    que rompía la aritmética de milisegundos.
    assert.strictEqual(d.getHours(), created.getHours(),
      'el aviso se ha movido de hora al cruzar el cambio horario');
    assert.strictEqual(d.getMinutes(), created.getMinutes());

    // 2) Y exactamente 90 días de CALENDARIO después, contados en local. Se
    //    cuenta a mediodía a propósito: así la resta no puede caer dentro de la
    //    hora que el cambio horario añade o quita.
    const aMediodia = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    assert.strictEqual((aMediodia(d) - aMediodia(created)) / DAY, 90);
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
