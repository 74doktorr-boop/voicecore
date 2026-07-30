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

const { checkUsageLimits, PLAN_LIMITS } = require('../src/auth/middleware');

// Los umbrales se LEEN de la fuente, no se escriben a mano. Antes estaban
// clavados (500 incluidos, 1500 de tope) y al bajar el cupo comercial de 500 a
// 200 minutos se cayeron cinco tests que en realidad no habían encontrado
// ningún fallo: sólo estaban repitiendo un número. Un test debe comprobar el
// COMPORTAMIENTO —no corta dentro del cupo, factura extra por encima, corta en
// el tope— y sobrevivir a un cambio de tarifa.
const L         = PLAN_LIMITS.negocio;
const INCLUIDOS = L.minutesPerMonth;
const TOPE      = INCLUIDOS * L.hardCapMultiplier;
const DENTRO    = Math.floor(INCLUIDOS * 0.6);   // cómodamente dentro del cupo
const EXTRA     = Math.floor((INCLUIDOS + TOPE) / 2); // en la banda de extra

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
    const { res, req, nexted } = run({ plan: 'negocio', monthly_minutes_used: DENTRO });
    assert.strictEqual(nexted, true);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!req.overage);
    assert.strictEqual(res.headers['X-NodeFlow-Overage'], undefined);
  });

  test('negocio por encima del cupo pero bajo el tope → NO corta, factura extra', () => {
    const { res, req, nexted } = run({ plan: 'negocio', monthly_minutes_used: EXTRA });
    assert.strictEqual(nexted, true, 'NO debe cortar la llamada');
    assert.strictEqual(req.overage, true);
    assert.strictEqual(res.headers['X-NodeFlow-Overage'], 'true');
    assert.strictEqual(res.headers['X-NodeFlow-Minutes-Included'], String(INCLUIDOS));
  });

  test('negocio en el tope de seguridad → corta con 402', () => {
    const { res, nexted } = run({ plan: 'negocio', monthly_minutes_used: TOPE });
    assert.strictEqual(nexted, false);
    assert.strictEqual(res.statusCode, 402);
    assert.strictEqual(res.body.hardCap, TOPE);
  });

  test('plan legacy (starter) cae a límites de Negocio → pasa dentro del cupo', () => {
    const { res, req, nexted } = run({ plan: 'starter', monthly_minutes_used: DENTRO });
    assert.strictEqual(nexted, true, 'legacy starter usa límites de Negocio (no corta a 50)');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(!req.overage);
  });

  test('plan legacy (pro) cae a límites de Negocio → corta en el mismo tope', () => {
    const cut = run({ plan: 'pro', monthly_minutes_used: TOPE });
    assert.strictEqual(cut.nexted, false);
    assert.strictEqual(cut.res.statusCode, 402);
    assert.strictEqual(cut.res.body.hardCap, TOPE);
  });

  test('sin org → pasa (no es un endpoint autenticado)', () => {
    const { nexted } = run(undefined);
    assert.strictEqual(nexted, true);
  });
});
