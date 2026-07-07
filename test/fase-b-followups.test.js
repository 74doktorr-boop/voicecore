// ============================================================
// NodeFlow — Fase B de seguimientos (2026-07-07, aprobada por Unai)
// 1) Cumpleaños UNIVERSAL: trigger yearly_field en todos los sectores
//    (salvo los que ya traen el suyo), campo fecha_cumpleanos en ficha.
// 2) Respuesta NEGATIVA al check-in como_fue → alerta urgente al dueño.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { calculateScheduledFor } = require('../src/lifecycle/reminder-engine');
const { toEngineDefaults, getSectorFollowups, serviceLabelFor } = require('../src/lifecycle/sector-catalog');
const { isNegativeFeedback, handleCheckinFeedback, checkinButtonKind, handleCheckinButton } = require('../src/whatsapp/reply-handler');

describe('cumpleaños universal — catálogo', () => {
  test('todos los sectores tienen la regla cumpleanos', () => {
    const defaults = toEngineDefaults();
    for (const [sector, rules] of Object.entries(defaults)) {
      assert.ok(rules.cumpleanos, `${sector} sin regla cumpleanos`);
    }
  });

  test('peluquería conserva SU cumpleanos promocional (21 días antes)', () => {
    const defaults = toEngineDefaults();
    // el catálogo propio del sector gana al universal
    const pelu = Object.entries(defaults).find(([, r]) => r.cumpleanos && r.cumpleanos.trigger === 'before_sector_field');
    assert.ok(pelu, 'algún sector con cumpleanos propio debe conservarlo');
    assert.strictEqual(pelu[1].cumpleanos.days, 21);
  });

  test('el universal lleva customText (mensaje del dueño → nodeflow_aviso)', () => {
    const fu = getSectorFollowups('taller').find(f => f.key === 'cumpleanos');
    assert.ok(fu, 'taller debe tener cumpleanos universal');
    assert.strictEqual(fu.trigger, 'yearly_field');
    assert.match(fu.customText, /felicidades/i);
    assert.match(fu.customText[0], /[a-záéíóúü¡¿]/, 'minúscula inicial: completa "un mensaje de {negocio}: …"');
  });

  test('serviceLabelFor resuelve el universal en cualquier sector', () => {
    assert.strictEqual(serviceLabelFor('fisioterapia', 'cumpleanos'), 'tu cumpleaños');
  });
});

describe('trigger yearly_field — calculateScheduledFor', () => {
  test('cumpleaños futuro este año → este año a las 09:00', () => {
    const now = new Date();
    const inTwoMonths = new Date(now.getFullYear() - 30, now.getMonth() + 2, 15); // nació hace 30 años
    const d = calculateScheduledFor(
      { trigger: 'yearly_field', field: 'fecha_cumpleanos', days: 0 },
      { fecha_cumpleanos: inTwoMonths.toISOString().slice(0, 10) },
      null
    );
    assert.ok(d, 'debe programarse');
    assert.strictEqual(d.getFullYear(), new Date(now.getFullYear(), now.getMonth() + 2, 15).getFullYear());
    assert.strictEqual(d.getHours(), 9);
  });

  test('cumpleaños ya pasado este año → año que viene', () => {
    const now = new Date();
    const lastMonth = new Date(1990, now.getMonth() - 1, 10);
    const d = calculateScheduledFor(
      { trigger: 'yearly_field', field: 'fecha_cumpleanos', days: 0 },
      { fecha_cumpleanos: lastMonth.toISOString().slice(0, 10) },
      null
    );
    assert.ok(d);
    assert.ok(d > now, 'siempre en el futuro');
    assert.strictEqual(d.getFullYear(), new Date(now.getFullYear() + 1, now.getMonth() - 1, 10).getFullYear());
  });

  test('sin fecha en la ficha → no se programa', () => {
    assert.strictEqual(calculateScheduledFor(
      { trigger: 'yearly_field', field: 'fecha_cumpleanos', days: 0 }, {}, null
    ), null);
  });

  test('fecha basura → no se programa', () => {
    assert.strictEqual(calculateScheduledFor(
      { trigger: 'yearly_field', field: 'fecha_cumpleanos', days: 0 },
      { fecha_cumpleanos: 'no-es-fecha' }, null
    ), null);
  });
});

describe('respuesta negativa al check-in — clasificador', () => {
  const NEGATIVOS = [
    'La verdad es que sigo con dolor',
    'Pues fatal, no me ha gustado nada',
    'no ha mejorado nada, estoy igual',
    'Todavía me duele bastante',
    'quería poner una queja',
    'Muy mal servicio, no pienso volver',
    'ha empeorado desde la sesión', // acentos/ñ vía \p{L}
  ];
  const POSITIVOS_O_NEUTROS = [
    'Todo genial, muchas gracias',
    'No está nada mal, la verdad',
    'menos mal que fui, ya no me duele',
    'mejor que antes, gracias',
    '¿me podéis dar cita para el jueves?',
    'ok',
  ];
  for (const t of NEGATIVOS) {
    test(`negativo: "${t.slice(0, 30)}…"`, () => assert.strictEqual(isNegativeFeedback(t), true));
  }
  for (const t of POSITIVOS_O_NEUTROS) {
    test(`NO negativo: "${t.slice(0, 30)}…"`, () => assert.strictEqual(isNegativeFeedback(t), false));
  }
});

describe('handleCheckinFeedback — escalado', () => {
  function fakeDb({ contact, checkinSent }) {
    return {
      enabled: true,
      client: {
        from: (table) => ({
          select: () => ({
            eq: () => ({
              in: () => ({ limit: async () => ({ data: contact ? [contact] : [] }) }),
              eq: () => ({
                eq: () => ({ eq: () => ({ gte: () => ({ limit: async () => ({ data: checkinSent ? [{ id: 'r1' }] : [] }) }) }) }),
              }),
            }),
          }),
        }),
      },
    };
  }

  test('negativo + como_fue reciente → alerta al dueño y acuse al cliente', async () => {
    const sent = [];
    const out = await handleCheckinFeedback(
      { from: '34600111222', businessId: 'org-1', text: 'sigo con dolor, ha ido fatal' },
      {
        db: fakeDb({ contact: { id: 'c1', name: 'Ana' }, checkinSent: true }),
        sendText: async (to, msg) => { sent.push({ to, msg }); return { ok: true }; },
        ownerPhone: '34666000111',
      }
    );
    assert.strictEqual(out, true);
    assert.strictEqual(sent.length, 2, 'dueño + cliente');
    assert.match(sent[0].msg, /NEGATIVA/);
    assert.match(sent[0].msg, /Ana/);
    assert.match(sent[1].msg, /sentimos/i);
  });

  test('negativo SIN como_fue reciente → no escala (flujo genérico)', async () => {
    const out = await handleCheckinFeedback(
      { from: '34600111222', businessId: 'org-1', text: 'fatal todo' },
      { db: fakeDb({ contact: { id: 'c1' }, checkinSent: false }), sendText: async () => ({ ok: true }), ownerPhone: '34666000111' }
    );
    assert.strictEqual(out, false);
  });

  test('texto positivo → ni consulta la BD', async () => {
    const out = await handleCheckinFeedback(
      { from: '34600111222', businessId: 'org-1', text: 'todo genial, gracias' },
      { db: { enabled: true, client: { from: () => { throw new Error('no debería tocarse'); } } } }
    );
    assert.strictEqual(out, false);
  });
});

describe('botones del check-in v2 (👍/👎)', () => {
  test('clasificador de botón', () => {
    assert.strictEqual(checkinButtonKind('Todo genial'), 'positive');
    assert.strictEqual(checkinButtonKind('👍 Todo genial'), 'positive');
    assert.strictEqual(checkinButtonKind('Se puede mejorar'), 'negative');
    assert.strictEqual(checkinButtonKind('CONFIRMAR'), null);
  });

  test('👍 con reviewUrl configurada → pide reseña de Google', async () => {
    const sent = [];
    // getBusinessConfig lee del scheduler real; inyectamos ownerPhone y capturamos send
    const { scheduler } = require('../src/scheduling/scheduler');
    scheduler.businessConfigs = scheduler.businessConfigs || new Map();
    const out = await handleCheckinButton(
      { from: '34600111222', businessId: 'org-rev', payload: 'Todo genial' },
      { sendText: async (to, msg) => { sent.push(msg); return { ok: true }; } }
    );
    assert.strictEqual(out, true);
    assert.strictEqual(sent.length, 1);
    // sin config de negocio no hay reviewUrl → agradece sin enlace, pero no rompe
    assert.match(sent[0], /alegra/i);
  });

  test('👎 → alerta al dueño + acuse al cliente', async () => {
    const sent = [];
    const out = await handleCheckinButton(
      { from: '34600111222', businessId: 'org-1', payload: 'Se puede mejorar' },
      { sendText: async (to, msg) => { sent.push({ to, msg }); return { ok: true }; }, ownerPhone: '34666000111' }
    );
    assert.strictEqual(out, true);
    assert.strictEqual(sent.length, 2);
    assert.match(sent[0].msg, /Se puede mejorar|mejorar/);
    assert.match(sent[1].msg, /sentimos/i);
  });

  test('payload que no es de check-in → no lo gestiona', async () => {
    const out = await handleCheckinButton(
      { from: '34600111222', businessId: 'org-1', payload: 'CANCELAR' },
      { sendText: async () => ({ ok: true }) }
    );
    assert.strictEqual(out, false);
  });
});
