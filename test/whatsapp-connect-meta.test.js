// ============================================================
// NodeFlow — Admin WhatsApp Meta-direct connect tests
// Ejecutar: npm test  (node --test test/)
//
// Tras cancelar 360dialog, el alta de WhatsApp es por Meta Cloud
// API directo (apiBase=null). Este test verifica que el endpoint
// admin existe, valida campos y guarda con apiBase=null.
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Interceptar accounts.js ANTES de cargar las rutas admin.
const accounts = require('../src/whatsapp/accounts');
let savedWith = null;
let revoked = null;
accounts.saveWaCredentials = async (businessId, creds) => { savedWith = { businessId, creds }; };
accounts.revokeWaCredentials = async (businessId) => { revoked = businessId; };

const { setupAdminRoutes } = require('../src/api/routes-admin');

// Fake express app que captura los handlers por método+ruta.
function makeApp() {
  const routes = {};
  const reg = (m) => (path, ...h) => { routes[`${m} ${path}`] = h[h.length - 1]; };
  return { routes, get: reg('GET'), post: reg('POST'), delete: reg('DELETE'), patch: reg('PATCH'), put: reg('PUT'), use() {} };
}

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const app = makeApp();
setupAdminRoutes(app, { adminToken: 'x' }, {});

describe('admin: WhatsApp connect-meta (Meta Cloud API directo)', () => {
  test('la ruta POST /api/admin/whatsapp/connect-meta existe', () => {
    assert.ok(app.routes['POST /api/admin/whatsapp/connect-meta'], 'ruta no registrada');
    assert.ok(app.routes['DELETE /api/admin/whatsapp/connect-meta/:businessId'], 'ruta delete no registrada');
  });

  test('rechaza si faltan campos', async () => {
    const handler = app.routes['POST /api/admin/whatsapp/connect-meta'];
    const res = mockRes();
    savedWith = null;
    await handler({ body: { businessId: 'org1' } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /Faltan campos/);
    assert.strictEqual(savedWith, null, 'no debe guardar con campos incompletos');
  });

  test('guarda con apiBase=null (Meta directo)', async () => {
    const handler = app.routes['POST /api/admin/whatsapp/connect-meta'];
    const res = mockRes();
    savedWith = null;
    await handler({ body: {
      businessId: 'org1', phoneNumberId: '123', accessToken: 'EAAtoken', phoneNumber: '+34688112233', wabaId: 'waba9',
    } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.provider, 'meta-cloud-api');
    assert.strictEqual(savedWith.businessId, 'org1');
    assert.strictEqual(savedWith.creds.apiBase, null, 'debe ser Meta directo, no 360dialog');
    assert.strictEqual(savedWith.creds.phoneNumberId, '123');
  });

  test('DELETE revoca el número', async () => {
    const handler = app.routes['DELETE /api/admin/whatsapp/connect-meta/:businessId'];
    const res = mockRes();
    await handler({ params: { businessId: 'org1' } }, res);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(revoked, 'org1');
  });
});
