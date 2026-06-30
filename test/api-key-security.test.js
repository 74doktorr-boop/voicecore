// ============================================================
// VoiceCore — La clave legacy 'voicecore-dev' (acceso enterprise) NO
// debe funcionar en producción si sigue siendo el default inseguro.
// En dev/test sí, por comodidad.
// ============================================================
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { requireAuth } = require('../src/auth/middleware');

const ORIG_ENV = process.env.NODE_ENV;

async function call(mw, key) {
  const req = { headers: { 'x-api-key': key } };
  let nexted = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await mw(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

describe('seguridad: clave legacy API_KEY', () => {
  afterEach(() => { process.env.NODE_ENV = ORIG_ENV; });

  test('en producción, el default voicecore-dev NO concede enterprise', async () => {
    process.env.NODE_ENV = 'production';
    const mw = requireAuth({ apiKey: 'voicecore-dev' });
    const { req, res, nexted } = await call(mw, 'voicecore-dev');
    assert.strictEqual(nexted, false, 'no debe dejar pasar');
    assert.ok(!(req.org && req.org.plan === 'enterprise'), 'no debe ser enterprise');
    assert.strictEqual(res.statusCode, 401);
  });

  test('en dev/test, el default voicecore-dev sí funciona (comodidad)', async () => {
    process.env.NODE_ENV = 'test';
    const mw = requireAuth({ apiKey: 'voicecore-dev' });
    const { req, nexted } = await call(mw, 'voicecore-dev');
    assert.strictEqual(nexted, true);
    assert.strictEqual(req.org.plan, 'enterprise');
  });

  test('en producción, una API_KEY secreta sí honra el acceso legacy', async () => {
    process.env.NODE_ENV = 'production';
    const mw = requireAuth({ apiKey: 'k_supersecreta_1234567890' });
    const { req, nexted } = await call(mw, 'k_supersecreta_1234567890');
    assert.strictEqual(nexted, true);
    assert.strictEqual(req.org.plan, 'enterprise');
  });
});
