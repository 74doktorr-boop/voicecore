// ============================================================
// NodeFlow — WhatsApp opt-out (BAJA/STOP) tests
// Ejecutar: npm test  (node --test test/)
//
// Honrar bajas por WhatsApp es cumplimiento obligatorio y evita
// reportes/bans. Verifica la detección y la persistencia de
// no_whatsapp en el contacto.
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Parchear deps que reply-handler destructura AL CARGAR.
const cw = require('../src/notifications/client-whatsapp');
let sent = [];
cw.sendText = async (to, msg) => { sent.push({ to, msg }); return { ok: true }; };
const acc = require('../src/whatsapp/accounts');
acc.getWaCredentials = async () => ({ phoneNumberId: 'x' });

// Deps lazy (requeridas dentro de handleOptOut) — parcheo sus exports.
const cm = require('../src/lifecycle/call-memory');
let memUpserts = [];
cm.upsertContactMemory = async (contactId, orgId, updates) => { memUpserts.push({ contactId, orgId, updates }); };

const dbmod = require('../src/db/database');
let contactRows = [];
function chain() {
  const qb = {
    select() { return qb; }, eq() { return qb; }, in() { return qb; }, limit() { return qb; },
    then(resolve) { return resolve({ data: contactRows, error: null }); },
  };
  return qb;
}
dbmod.getDatabase = () => ({ enabled: true, client: { from: () => chain() } });

const { isOptOut, handleOptOut } = require('../src/whatsapp/reply-handler');

describe('isOptOut — detección de baja', () => {
  const yes = ['BAJA', 'baja', 'Me doy de baja', 'STOP', 'stop', 'no quiero más mensajes',
               'No quiero mas mensajes', 'dejar de recibir', 'unsubscribe', 'cancelar suscripción', 'NO MOLESTAR'];
  for (const t of yes) {
    test(`detecta baja: "${t}"`, () => assert.strictEqual(isOptOut(t), true));
  }
  const no = ['CONFIRMAR', 'Sí, confirmo', 'cancelar', 'quiero cancelar mi cita', 'bajamos los precios', 'hola buenas'];
  for (const t of no) {
    test(`NO es baja: "${t}"`, () => assert.strictEqual(isOptOut(t), false));
  }
});

describe('handleOptOut — persistencia', () => {
  test('marca no_whatsapp en el contacto y confirma', async () => {
    memUpserts = []; sent = []; contactRows = [{ id: 'c1', phone: '34612345678' }];
    const ok = await handleOptOut({ from: '34612345678', businessId: 'org1' });
    assert.strictEqual(ok, true);
    assert.strictEqual(memUpserts.length, 1);
    assert.strictEqual(memUpserts[0].contactId, 'c1');
    assert.strictEqual(memUpserts[0].orgId, 'org1');
    assert.strictEqual(memUpserts[0].updates.no_whatsapp, true);
    assert.strictEqual(sent.length, 1, 'envía confirmación de baja');
  });

  test('si no encuentra el contacto, igualmente confirma (persisted=false)', async () => {
    memUpserts = []; sent = []; contactRows = [];
    const ok = await handleOptOut({ from: '34699999999', businessId: 'org1' });
    assert.strictEqual(ok, false);
    assert.strictEqual(memUpserts.length, 0);
    assert.strictEqual(sent.length, 1);
  });

  test('sin businessId no revienta', async () => {
    memUpserts = []; sent = [];
    const ok = await handleOptOut({ from: '34688112233' });
    assert.strictEqual(ok, false);
    assert.strictEqual(sent.length, 1);
  });
});
