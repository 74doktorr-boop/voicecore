// ============================================================
// NodeFlow — Ingreso de integraciones (2026-07-17)
// El otro lado del conector: un sistema externo empuja sus reservas/cancela-
// ciones a NodeFlow (firmado HMAC) para evitar overbooking. Reutiliza
// scheduler.bookAppointment/cancelAppointment. Rutas Express reales sobre
// puerto efímero (mismo patrón que http.test.js).
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { sign } = require('../src/integrations/connector');
const { setupIntegrationRoutes } = require('../src/api/routes-integrations');

const SECRET = 'inbound-shhh';
const fakeScheduler = {
  bookAppointment(orgId, a) {
    if (a.time === '99:99') return { success: false, error: 'hora inválida' };
    if (a.time === '10:00') return { success: false, error: 'Esa hora ya está ocupada. Por favor elige otra.' };
    return { success: true, appointment: { id: 'APT-777', ...a } };
  },
  cancelAppointment(id) {
    return id === 'APT-777' ? { success: true } : { success: false, error: 'no encontrada' };
  },
};

function buildApp(inboundSecret) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  setupIntegrationRoutes(app, { scheduler: fakeScheduler, configOpts: { config: inboundSecret ? { enabled: true, inboundSecret } : null } });
  return app;
}

function signedPost(base, path, body) {
  const bodyStr = JSON.stringify(body);
  const ts = Date.now();
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NodeFlow-Timestamp': String(ts),
      'X-NodeFlow-Signature': sign(`${ts}.${bodyStr}`, SECRET),
    },
    body: bodyStr,
  });
}

describe('ingreso de integraciones — con inboundSecret configurado', () => {
  let server, base;
  before(async () => {
    const app = buildApp(SECRET);
    await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  after(() => server && server.close());

  test('ping SIN firma → 401', async () => {
    const res = await fetch(base + '/api/integrations/org1/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.strictEqual(res.status, 401);
  });

  test('ping con firma válida → 200', async () => {
    const res = await signedPost(base, '/api/integrations/org1/ping', {});
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.ok, true);
  });

  test('firma manipulada (body cambiado) → 401', async () => {
    const ts = Date.now();
    const res = await fetch(base + '/api/integrations/org1/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NodeFlow-Timestamp': String(ts), 'X-NodeFlow-Signature': sign(`${ts}.{}`, SECRET) },
      body: '{"tampered":1}',
    });
    assert.strictEqual(res.status, 401);
  });

  test('crear cita externa válida → 201 + id', async () => {
    const res = await signedPost(base, '/api/integrations/org1/appointments', { patientName: 'Ext', phone: '+34600', service: 'x', date: '2099-01-01', time: '11:00' });
    assert.strictEqual(res.status, 201);
    const j = await res.json();
    assert.strictEqual(j.success, true);
    assert.strictEqual(j.id, 'APT-777');
  });

  test('hueco ocupado → 409 (no overbooking)', async () => {
    const res = await signedPost(base, '/api/integrations/org1/appointments', { date: '2099-01-01', time: '10:00' });
    assert.strictEqual(res.status, 409);
    const j = await res.json();
    assert.strictEqual(j.success, false);
  });

  test('faltan date/time → 400', async () => {
    const res = await signedPost(base, '/api/integrations/org1/appointments', { patientName: 'x' });
    assert.strictEqual(res.status, 400);
  });

  test('cancelar cita existente → 200', async () => {
    const res = await signedPost(base, '/api/integrations/org1/appointments/APT-777/cancel', { patientName: 'Ext' });
    assert.strictEqual(res.status, 200);
  });

  test('cancelar inexistente → 404', async () => {
    const res = await signedPost(base, '/api/integrations/org1/appointments/APT-000/cancel', {});
    assert.strictEqual(res.status, 404);
  });
});

describe('ingreso — negocio SIN integración configurada', () => {
  let server, base;
  before(async () => {
    const app = buildApp(null);
    await new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); });
  });
  after(() => server && server.close());

  test('ping firmado pero sin inboundSecret → 404 (inerte)', async () => {
    const res = await signedPost(base, '/api/integrations/org1/ping', {});
    assert.strictEqual(res.status, 404);
  });
});
