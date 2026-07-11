// ============================================================
// NodeFlow — Materializador de avisos de entidad: VARIAS antelaciones
// (Fase 2A, 2026-07). Un campo-fecha puede tener f.reminders = lista de
// avisos, cada uno con su antelación (offset_days) y su serviceKey propio
// (para que el dedupe no los colapse). Retrocompatible con el `reminder`
// único de siempre.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildEntityReminderPlan, entityServiceKey } = require('../src/entities/entity-reminders');

const NOW = new Date('2026-07-01T09:00:00Z');

function typeWith(fieldExtra) {
  return {
    key: 'plan_tratamiento', label_singular: 'Plan', label_template: 'Plan {{motivo}}',
    fields: [Object.assign({ key: 'caducidad_bono', type: 'date', label: 'Caducidad del bono' }, fieldExtra)],
  };
}
const entity = { display_name: 'Plan Hombro', contact_id: 'c1', attrs: { caducidad_bono: '2026-12-01', motivo: 'Hombro' } };
const day = (item) => item.scheduledFor.toISOString().slice(0, 10);

describe('buildEntityReminderPlan — varias antelaciones', () => {
  test('reminder ÚNICO (compat): un aviso, serviceKey sin sufijo', () => {
    const plan = buildEntityReminderPlan(typeWith({ reminder: { offset_days: -14, message_hint: 'Caduca el {{value}}' } }), entity, NOW);
    assert.strictEqual(plan.length, 1);
    assert.strictEqual(plan[0].serviceKey, entityServiceKey('plan_tratamiento', 'caducidad_bono'));
    assert.strictEqual(day(plan[0]), '2026-11-17'); // 2026-12-01 − 14
    assert.match(plan[0].messagePreview, /^TXT:Caduca el 1\/12\/2026/);
  });

  test('VARIAS antelaciones → varios avisos, cada uno con serviceKey distinto', () => {
    const plan = buildEntityReminderPlan(typeWith({ reminders: [
      { offset_days: -14, message_hint: 'Caduca el {{value}}' },
      { offset_days: -3,  message_hint: 'Últimos días para tu {{entity}} ({{value}})' },
    ] }), entity, NOW);
    assert.strictEqual(plan.length, 2);
    const keys = plan.map(p => p.serviceKey).sort();
    assert.deepStrictEqual(keys, [
      'entity:plan_tratamiento:caducidad_bono:o14',
      'entity:plan_tratamiento:caducidad_bono:o3',
    ]);
    const days = plan.map(day).sort();
    assert.deepStrictEqual(days, ['2026-11-17', '2026-11-28']); // −14 y −3
    // el {{entity}} se sustituye por el display_name
    assert.ok(plan.some(p => /Plan Hombro/.test(p.messagePreview)));
  });

  test('las antelaciones YA pasadas se descartan (solo futuras)', () => {
    // El aviso a −14 desde una fecha muy próxima cae en el pasado respecto a NOW.
    const soon = { ...entity, attrs: { ...entity.attrs, caducidad_bono: '2026-07-05' } };
    const plan = buildEntityReminderPlan(typeWith({ reminders: [
      { offset_days: -14, message_hint: 'a' },  // 2026-06-21 → pasado
      { offset_days: -1,  message_hint: 'b' },  // 2026-07-04 → futuro
    ] }), soon, NOW);
    assert.strictEqual(plan.length, 1);
    assert.strictEqual(day(plan[0]), '2026-07-04');
  });

  test('sin valor de fecha → ningún aviso', () => {
    const noVal = { ...entity, attrs: { motivo: 'Hombro' } };
    const plan = buildEntityReminderPlan(typeWith({ reminders: [{ offset_days: -3, message_hint: 'x' }] }), noVal, NOW);
    assert.strictEqual(plan.length, 0);
  });

  test('reminders vacío o con nulos no rompe', () => {
    const plan = buildEntityReminderPlan(typeWith({ reminders: [null, undefined] }), entity, NOW);
    assert.strictEqual(plan.length, 0);
  });
});

describe('buildEntityReminderPlan — destinatario negocio (Fase 2B)', () => {
  test('aviso al NEGOCIO → serviceKey acaba en :biz y recipient=business', () => {
    const plan = buildEntityReminderPlan(typeWith({
      reminder: { offset_days: -1, recipient: 'business', message_hint: 'Mañana viene {{entity}}' },
    }), entity, NOW);
    assert.strictEqual(plan.length, 1);
    assert.ok(plan[0].serviceKey.endsWith(':biz'), plan[0].serviceKey);
    assert.strictEqual(plan[0].recipient, 'business');
  });

  test('mismo campo: aviso al cliente Y al negocio → keys distintas, recipients correctos', () => {
    const plan = buildEntityReminderPlan(typeWith({ reminders: [
      { offset_days: -3, recipient: 'client',   message_hint: 'Te espero el {{value}}' },
      { offset_days: -1, recipient: 'business',  message_hint: 'Mañana viene {{entity}}' },
    ] }), entity, NOW);
    assert.strictEqual(plan.length, 2);
    const biz = plan.find(p => p.recipient === 'business');
    const cli = plan.find(p => p.recipient === 'client');
    assert.ok(biz && cli, 'uno de cada');
    assert.ok(biz.serviceKey.endsWith(':biz'));
    assert.ok(!cli.serviceKey.endsWith(':biz'));
    assert.notStrictEqual(biz.serviceKey, cli.serviceKey);
  });

  test('client por defecto (sin recipient) → recipient=client, sin :biz', () => {
    const plan = buildEntityReminderPlan(typeWith({ reminder: { offset_days: -3, message_hint: 'x' } }), entity, NOW);
    assert.strictEqual(plan[0].recipient, 'client');
    assert.ok(!plan[0].serviceKey.endsWith(':biz'));
  });
});
