// ============================================================
// NodeFlow — Usage limits / overage tests
// Ejecutar: npm test  (node --test test/)
//
// Blinda el modelo de "minutos extra a cambio de un plus":
// el plan de pago (Negocio) no corta llamadas en la cuota incluida
// (se facturan extra hasta un tope de seguridad). Plan único desde
// 2026-06-30; planes legacy (starter/pro) caen a límites de Negocio.
// ============================================================

'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { checkUsageLimits } = require('../src/auth/middleware');

function run(org) {
  const req = { org };
  const res = {
    statusCode: 200, headers: {}, body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let nexted = false;
  checkUsageLimits()(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

describe('checkUsageLimits — modelo de overage', () => {
  test('negocio por debajo de lo incluido → pasa, sin overage', () => {
    const { res, req, nexted } = run({ plan: 'negocio', monthly_minutes_used: 300 });
    assert.strictEqual(nexted, true);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!req.overage);
    assert.strictEqual(res.headers['X-NodeFlow-Overage'], undefined);
  });

  test('negocio en banda de extra (>500, <1500) → pasa y marca overage', () => {
    const { res, req, nexted } = run({ plan: 'negocio', monthly_minutes_used: 700 });
    assert.strictEqual(nexted, true, 'NO debe cortar la llamada');
    assert.strictEqual(req.overage, true);
    assert.strictEqual(res.headers['X-NodeFlow-Overage'], 'true');
    assert.strictEqual(res.headers['X-NodeFlow-Minutes-Included'], '500');
  });

  test('negocio en el tope de seguridad (3×) → corta con 402', () => {
    const { res, nexted } = run({ plan: 'negocio', monthly_minutes_used: 1500 });
    assert.strictEqual(nexted, false);
    assert.strictEqual(res.statusCode, 402);
    assert.strictEqual(res.body.hardCap, 1500);
  });

  test('plan legacy (starter) cae a límites de Negocio → pasa por debajo de 500', () => {
    const { res, req, nexted } = run({ plan: 'starter', monthly_minutes_used: 300 });
    assert.strictEqual(nexted, true, 'legacy starter usa límites de Negocio (no corta a 50)');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!req.overage);
  });

  test('plan legacy (pro) cae a límites de Negocio → corta en el tope 1500', () => {
    const cut = run({ plan: 'pro', monthly_minutes_used: 1500 });
    assert.strictEqual(cut.nexted, false);
    assert.strictEqual(cut.res.statusCode, 402);
    assert.strictEqual(cut.res.body.hardCap, 1500);
  });

  test('sin org → pasa (no es un endpoint autenticado)', () => {
    const { nexted } = run(undefined);
    assert.strictEqual(nexted, true);
  });
});
