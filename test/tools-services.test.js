// ============================================================
// VoiceCore — get_services / get_pricing usan la serviceList REAL
// del negocio (sellada en la sesión), no datos seed.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ToolExecutor } = require('../src/tools/executor');

describe('Tools: servicios+precios reales del negocio', () => {
  const ex = new ToolExecutor();
  const ctx = { session: { orgId: 'org-1', serviceList: [
    { name: 'Corte de pelo', price: '15€', duration: '30 min', notes: 'incluye lavado' },
    { name: 'Tinte', price: '45€', duration: '90 min' },
  ] } };

  test('get_services devuelve los servicios reales', () => {
    const r = ex.getServices({}, 'plantilla-peluqueria', ctx);
    assert.equal(r.services.length, 2);
    assert.equal(r.services[0].name, 'Corte de pelo');
    assert.equal(r.services[0].price, '15€');
    assert.equal(r.services[0].duration, '30 min');
    assert.equal(r.services[0].notes, 'incluye lavado');
  });

  test('get_pricing formatea los precios reales (con duración)', () => {
    const r = ex.getPricing({}, 'plantilla-peluqueria', ctx);
    assert.match(r.pricing, /Corte de pelo: 15€ \(30 min\)/);
    assert.match(r.pricing, /Tinte: 45€ \(90 min\)/);
  });

  test('sin serviceList en sesión → no rompe (cae al comportamiento previo)', () => {
    const r = ex.getServices({}, 'demo-clinic', {});
    assert.ok(Array.isArray(r.services));
    const p = ex.getPricing({}, 'demo-clinic', {});
    assert.equal(typeof p.pricing, 'string');
  });
});
