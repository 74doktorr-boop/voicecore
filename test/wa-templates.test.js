// ============================================================
// NodeFlow — Plantillas WhatsApp del motor (2026-07-06)
// La plantilla que envía el lifecycle-scheduler DEBE estar en la lista
// de alta (bug real: no estaba → todo el canal WA del motor fallaba).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { WA_TEMPLATES, templateLanguage } = require('../src/whatsapp/templates');

describe('WA_TEMPLATES — integridad', () => {
  test('la plantilla del motor de seguimientos está dada de alta', () => {
    const t = WA_TEMPLATES.find(x => x.name === 'nodeflow_recordatorio_servicio');
    assert.ok(t, 'nodeflow_recordatorio_servicio debe existir (la usa el scheduler)');
    assert.strictEqual(t.category, 'UTILITY');
    const body = t.components.find(c => c.type === 'BODY');
    assert.match(body.text, /\{\{1\}\}/);
    assert.match(body.text, /\{\{2\}\}/);
    assert.match(body.text, /\{\{3\}\}/);
    assert.strictEqual(body.example.body_text[0].length, 3);  // ejemplo con las 3 vars
  });

  test('toda plantilla tiene BODY con ejemplo del mismo nº de variables', () => {
    for (const t of WA_TEMPLATES) {
      const body = t.components.find(c => c.type === 'BODY');
      assert.ok(body, `${t.name}: sin BODY`);
      const vars = (body.text.match(/\{\{\d\}\}/g) || []).length;
      assert.strictEqual(body.example.body_text[0].length, vars, `${t.name}: ejemplo no cuadra con las variables`);
    }
  });
});

describe('templateLanguage — clamp de idioma', () => {
  test('preferencia no aprobada (eu/gl) cae al idioma aprobado', () => {
    assert.strictEqual(templateLanguage('nodeflow_recordatorio_servicio', 'eu'), 'es');
    assert.strictEqual(templateLanguage('nodeflow_recordatorio_servicio', 'gl'), 'es');
  });
  test('preferencia aprobada se respeta', () => {
    assert.strictEqual(templateLanguage('nodeflow_recordatorio_servicio', 'es'), 'es');
  });
  test('plantilla desconocida → es (default seguro)', () => {
    assert.strictEqual(templateLanguage('no_existe', 'eu'), 'es');
  });
});
