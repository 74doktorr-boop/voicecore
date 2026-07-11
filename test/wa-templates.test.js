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

  // Regla de Meta que ya nos costó un rechazo: el BODY no puede empezar
  // ni terminar en variable.
  test('ningún BODY empieza ni termina en variable (regla de alta de Meta)', () => {
    for (const t of WA_TEMPLATES) {
      const body = t.components.find(c => c.type === 'BODY');
      assert.ok(!/^\{\{\d\}\}/.test(body.text.trim()), `${t.name}: empieza en variable`);
      assert.ok(!/\{\{\d\}\}$/.test(body.text.trim()), `${t.name}: termina en variable`);
    }
  });

  // Toda MARKETING necesita opt-out ("Responde BAJA…") — Meta lo exige y
  // nosotros lo usamos para procesar la baja en el webhook.
  test('toda plantilla MARKETING lleva footer con opt-out BAJA', () => {
    for (const t of WA_TEMPLATES.filter(x => x.category === 'MARKETING')) {
      const footer = t.components.find(c => c.type === 'FOOTER');
      assert.ok(footer, `${t.name}: MARKETING sin FOOTER`);
      assert.match(footer.text, /Responde BAJA/, `${t.name}: footer sin opt-out`);
    }
  });
});

describe('lote de plantillas de entidades (2026-07-08)', () => {
  const expectativas = [
    { name: 'nodeflow_pre_itv', category: 'MARKETING', vars: 3 },
    { name: 'nodeflow_hueco_urgente', category: 'MARKETING', vars: 4 },
    { name: 'nodeflow_garantia', category: 'UTILITY', vars: 4 },
    { name: 'nodeflow_cumple_mascota', category: 'MARKETING', vars: 3 },
  ];
  for (const e of expectativas) {
    test(`${e.name} existe como ${e.category} con ${e.vars} variables`, () => {
      const t = WA_TEMPLATES.find(x => x.name === e.name);
      assert.ok(t, `${e.name} debe existir`);
      assert.strictEqual(t.category, e.category);
      assert.strictEqual(t.language, 'es');
      const body = t.components.find(c => c.type === 'BODY');
      assert.strictEqual((body.text.match(/\{\{\d\}\}/g) || []).length, e.vars);
    });
  }
});

describe('nodeflow_cita_recordatorio — botones que el webhook empareja (Fase 3)', () => {
  test('existe con botones QUICK_REPLY CONFIRMAR y CANCELAR exactos', () => {
    const t = WA_TEMPLATES.find(x => x.name === 'nodeflow_cita_recordatorio');
    assert.ok(t, 'debe existir (la envía sendWaReminder)');
    assert.strictEqual(t.category, 'UTILITY');
    const btns = t.components.find(c => c.type === 'BUTTONS');
    assert.ok(btns, 'debe llevar BUTTONS');
    const texts = btns.buttons.map(b => b.text);
    // El webhook empareja por texto (payload.includes('CONFIRMAR'/'CANCELAR')):
    // si estos cambian, el confirmar/cancelar entrante deja de funcionar.
    assert.ok(texts.includes('CONFIRMAR'), 'botón CONFIRMAR');
    assert.ok(texts.includes('CANCELAR'), 'botón CANCELAR');
    assert.ok(btns.buttons.every(b => b.type === 'QUICK_REPLY'), 'ambos QUICK_REPLY');
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
