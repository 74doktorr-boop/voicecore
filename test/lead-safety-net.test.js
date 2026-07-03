// ============================================================
// NodeFlow — Red de seguridad de leads (llamada real aca3576c,
// 2026-07-04): el asistente dijo "voy a registrar su interés y el
// equipo le llamará" y NO llamó a register_lead (toolCalls: 0).
// Resultado: promesa vacía — sin lead, sin aviso al dueño, y el
// contacto quedó sin nombre aunque el cliente dijo "me llamo Unay".
// La red es determinista y corre en servidor: si la llamada terminó
// en callback_requested y el tool no se usó, el lead se crea igual.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { applyLeadSafetyNet, isUsableName } = require('../src/lifecycle/lead-safety-net');

function fakeDeps() {
  const calls = { leadInsert: null, nameUpdate: null, notified: null };
  const db = {
    enabled: true,
    client: {
      from(table) {
        return {
          insert: async (row) => { if (table === 'leads') calls.leadInsert = row; return { error: null }; },
          update(patch) {
            return {
              eq() { return this; },
              or() { calls.nameUpdate = patch; return Promise.resolve({ error: null }); },
            };
          },
        };
      },
    },
  };
  const notify = (msg, bizId) => { calls.notified = { msg, bizId }; };
  return { db, notify, calls };
}

const BASE = {
  analysis: {
    outcome: 'callback_requested',
    summary: 'Cliente pidió info de recepcionistas virtuales.',
    extracted_data: { nombre_llamante: 'Unay Sánchez', interes: 'recepcionistas virtuales para peluquería' },
  },
  contactId: 'ct-1',
  orgId: 'org-1',
  callerNumber: '+34648122803',
  leadRegistered: false,
  callSessionId: 'call-1',
};

describe('applyLeadSafetyNet — la promesa del asistente se cumple aunque el LLM no llame al tool', () => {
  test('sin register_lead + callback_requested → crea el lead y avisa al dueño', async () => {
    const { db, notify, calls } = fakeDeps();
    const out = await applyLeadSafetyNet(BASE, { db, notify });
    assert.strictEqual(out.leadRecovered, true);
    assert.strictEqual(calls.leadInsert.org_id, 'org-1');
    assert.strictEqual(calls.leadInsert.name, 'Unay Sánchez');
    assert.strictEqual(calls.leadInsert.phone, '+34648122803');
    assert.match(calls.leadInsert.source, /safety/);
    assert.match(calls.notified.msg, /Unay Sánchez/);
    assert.match(calls.notified.msg, /\+34648122803/);
    assert.strictEqual(calls.notified.bizId, 'org-1');
  });

  test('si register_lead SÍ se llamó, la red no duplica nada', async () => {
    const { db, notify, calls } = fakeDeps();
    const out = await applyLeadSafetyNet({ ...BASE, leadRegistered: true }, { db, notify });
    assert.strictEqual(out.leadRecovered, false);
    assert.strictEqual(calls.leadInsert, null);
    assert.strictEqual(calls.notified, null);
  });

  test('outcome distinto (booked) → sin lead de la red', async () => {
    const { db, notify, calls } = fakeDeps();
    const out = await applyLeadSafetyNet({ ...BASE, analysis: { ...BASE.analysis, outcome: 'booked' } }, { db, notify });
    assert.strictEqual(out.leadRecovered, false);
    assert.strictEqual(calls.leadInsert, null);
  });

  test('el nombre del llamante ficha al contacto (donde estaba null o genérico)', async () => {
    const { db, notify, calls } = fakeDeps();
    const out = await applyLeadSafetyNet(BASE, { db, notify });
    assert.strictEqual(out.nameUpdated, true);
    assert.deepStrictEqual(calls.nameUpdate, { name: 'Unay Sánchez' });
  });

  test('nombre genérico ("cliente") jamás ficha a nadie', async () => {
    const { db, notify, calls } = fakeDeps();
    const out = await applyLeadSafetyNet(
      { ...BASE, analysis: { ...BASE.analysis, extracted_data: { nombre_llamante: 'cliente' } } },
      { db, notify }
    );
    assert.strictEqual(out.nameUpdated, false);
    assert.strictEqual(calls.nameUpdate, null);
  });

  test('análisis vacío o db apagada → no lanza y no hace nada', async () => {
    const out1 = await applyLeadSafetyNet({ ...BASE, analysis: null }, { db: { enabled: true }, notify: () => {} });
    assert.deepStrictEqual(out1, { leadRecovered: false, nameUpdated: false });
    const out2 = await applyLeadSafetyNet(BASE, { db: { enabled: false }, notify: () => {} });
    assert.deepStrictEqual(out2, { leadRecovered: false, nameUpdated: false });
  });
});

describe('isUsableName', () => {
  test('nombres reales pasan; genéricos y vacíos no', () => {
    assert.strictEqual(isUsableName('Unay Sánchez'), true);
    assert.strictEqual(isUsableName('cliente'), false);
    assert.strictEqual(isUsableName('la clienta'), false);
    assert.strictEqual(isUsableName('desconocido'), false);
    assert.strictEqual(isUsableName(''), false);
    assert.strictEqual(isUsableName(null), false);
  });
});
