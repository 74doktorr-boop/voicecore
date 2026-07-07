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
  // Meta NO admite eu/gl en WhatsApp (verificado por API 2026-07-07): el
  // clamp DEBE caer a 'es' para no enrutar a una plantilla inexistente
  // (que rompería el envío WhatsApp del cliente eu/gl).
  test('preferencia eu/gl cae a es en el canal WhatsApp', () => {
    for (const name of ['nodeflow_recordatorio_servicio', 'nodeflow_aviso', 'nodeflow_como_fue']) {
      assert.strictEqual(templateLanguage(name, 'eu'), 'es', `${name} eu debe caer a es`);
      assert.strictEqual(templateLanguage(name, 'gl'), 'es', `${name} gl debe caer a es`);
      assert.strictEqual(templateLanguage(name, 'es'), 'es');
    }
  });
  test('no hay ninguna plantilla eu/gl (Meta no las admite)', () => {
    const bad = WA_TEMPLATES.filter(t => t.language === 'eu' || t.language === 'gl');
    assert.strictEqual(bad.length, 0, 'Meta rechaza eu/gl — no deben registrarse');
  });
  test('plantilla desconocida → es (default seguro)', () => {
    assert.strictEqual(templateLanguage('no_existe', 'eu'), 'es');
  });
});
