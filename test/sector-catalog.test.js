// ============================================================
// NodeFlow — Catálogo de seguimientos por sector (2026-07-06)
// Fuente única: presentación + campos del motor. Bloquea valores clave.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { toEngineDefaults, getSectorFollowups, serviceLabelFor, SECTOR_CATALOG } = require('../src/lifecycle/sector-catalog');

describe('toEngineDefaults', () => {
  const eng = toEngineDefaults();

  test('reproduce valores clave del motor (candado anti-regresión)', () => {
    assert.strictEqual(eng.peluqueria.corte_pelo.days, 24);
    assert.strictEqual(eng.dental.ortodoncia.onlyIfCompleted, true);
    assert.strictEqual(eng.optica.reposicion_lentillas.daysOffset, -5);
    assert.strictEqual(eng.clinica.renovacion_psicotecnico.field, 'fecha_caducidad_psicotecnico');
    assert.strictEqual(eng.psicologia.sesion_habitual.trigger, 'custom_frequency');
  });

  test('no filtra presentación al motor (sin label/desc/serviceLabel)', () => {
    for (const sector of Object.values(eng)) {
      for (const rule of Object.values(sector)) {
        assert.strictEqual(rule.label, undefined);
        assert.strictEqual(rule.desc, undefined);
        assert.strictEqual(rule.serviceLabel, undefined);
      }
    }
  });
});

describe('getSectorFollowups / serviceLabelFor', () => {
  test('devuelve la presentación completa', () => {
    const fus = getSectorFollowups('peluqueria');
    assert.ok(fus.length >= 4);
    assert.strictEqual(fus[0].label, 'Recordar corte de pelo');
    assert.ok(fus[0].serviceLabel);
  });

  test('sector desconocido → []', () => {
    assert.deepStrictEqual(getSectorFollowups('zzz'), []);
  });

  test('serviceLabelFor: conocido usa catálogo, desconocido humaniza la key', () => {
    assert.strictEqual(serviceLabelFor('peluqueria', 'corte_pelo'), 'tu corte de pelo');
    assert.strictEqual(serviceLabelFor('peluqueria', 'algo_raro'), 'algo raro');
  });

  test('todo followup tiene key, label y serviceLabel', () => {
    for (const [sector, def] of Object.entries(SECTOR_CATALOG)) {
      assert.ok(def.label, `${sector} sin label`);
      for (const f of def.followups) {
        assert.ok(f.key && f.label && f.serviceLabel && f.trigger, `${sector}.${f.key} incompleto`);
      }
    }
  });
});
