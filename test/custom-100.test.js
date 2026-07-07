// ============================================================
// NodeFlow — Personalización 0→100% (2026-07-07)
// El negocio puede: escribir el mensaje ÍNTEGRO de su seguimiento
// (plantilla-portadora nodeflow_aviso, con {detalle} por ficha) e
// inventar FECHAS propias que aparecen en la ficha de cada cliente.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { normalizeRules, buildRulesView } = require('../src/lifecycle/followup-rules');
const { WA_TEMPLATES } = require('../src/whatsapp/templates');

describe('mensaje 100% del dueño (customText)', () => {
  test('se guarda saneado y la vista lo devuelve', () => {
    const { config } = normalizeRules('peluqueria', {
      custom: [{ label: 'Revisión del alisado', trigger: 'from_last_appointment', days: 45, customText: '¿Qué tal va {detalle}? Si quieres retoque, esta semana tenemos hueco.' }],
    }, {});
    assert.match(config._custom[0].customText, /\{detalle\}/);
    const view = buildRulesView('peluqueria', config);
    const mine = view.find(r => r.custom);
    assert.match(mine.customText, /retoque/);
  });

  test('mensaje demasiado corto → error claro', () => {
    const r = normalizeRules('peluqueria', {
      custom: [{ label: 'X corto', trigger: 'from_last_appointment', days: 30, customText: 'hola' }],
    }, {});
    assert.match(r.error, /demasiado corto/);
  });

  test('la plantilla-portadora nodeflow_aviso existe con sus 3 variables', () => {
    const t = WA_TEMPLATES.find(x => x.name === 'nodeflow_aviso');
    assert.ok(t);
    const body = t.components.find(c => c.type === 'BODY');
    assert.strictEqual((body.text.match(/\{\{\d\}\}/g) || []).length, 3);
    assert.ok(t.components.some(c => c.type === 'FOOTER' && /BAJA/.test(c.text)), 'opt-out obligatorio');
  });
});

describe('fecha inventada por el negocio (before_sector_field custom)', () => {
  test('crea el campo automático custom_<key> para la ficha', () => {
    const { config } = normalizeRules('taller', {
      custom: [{ label: 'Caducidad del extintor', trigger: 'before_sector_field', days: 15 }],
    }, {});
    const c = config._custom[0];
    assert.strictEqual(c.trigger, 'before_sector_field');
    assert.match(c.field, /^custom_caducidad_del_extintor/);
  });

  test('el disparador de fecha es válido para personalizados', () => {
    const r = normalizeRules('generico', {
      custom: [{ label: 'Fin de garantía', trigger: 'before_sector_field', days: 30 }],
    }, {});
    assert.ok(!r.error, r.error);
  });
});
