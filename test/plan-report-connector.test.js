// ============================================================
// NodeFlow — Gating Pro: informe completo + conector (2026-07-27)
// Completa la matriz Básico/Pro: el informe cita-a-cita (+CSV) y el
// conector de integraciones son Pro. Básico ve el resumen del informe
// y NO puede activar el conector. Defecto BÁSICO desde 2026-07-29: una org sin
// tier explícito queda capada (antes recibía Pro de gratis).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { hasPro } = require('../src/billing/plan');

// Réplica de la lógica de gating de los endpoints (sin arrancar el server):
// mantiene el test rápido y a la vez fija el contrato que codifican las rutas.
const basico = { automation_config: { config: { tier: 'basico' } } };
const pro = { automation_config: { config: { tier: 'pro' } } };
const sinTier = {}; // sin tier explícito → BÁSICO (los fundadores llevan tier:'pro' escrito)

describe('informe completo (roi-report) — gating Pro', () => {
  const stripDetail = (org, report) => {
    if (!hasPro(org)) { const { appointments, ...summary } = report; return { ...summary, appointments: [], proLocked: true }; }
    return report;
  };
  const full = { rescuedValue: 900, apptCount: 3, appointments: [{ service: 'x' }, { service: 'y' }, { service: 'z' }] };

  test('Básico → resumen sin detalle cita a cita', () => {
    const r = stripDetail(basico, full);
    assert.strictEqual(r.proLocked, true);
    assert.deepStrictEqual(r.appointments, []);
    assert.strictEqual(r.rescuedValue, 900); // el resumen (€ recuperado) SÍ se ve
  });
  test('Pro → informe completo con detalle', () => {
    const r = stripDetail(pro, full);
    assert.strictEqual(r.appointments.length, 3);
    assert.ok(!r.proLocked);
  });
  test('sin tier explícito → capado (ya no hereda Pro por omisión)', () => {
    const r = stripDetail(sinTier, full);
    assert.strictEqual(r.appointments.length, 0);
    assert.ok(r.proLocked);
  });
  test('CSV → 402 en Básico y en sin-tier, permitido en Pro', () => {
    const csvAllowed = (org) => hasPro(org);
    assert.strictEqual(csvAllowed(basico), false);
    assert.strictEqual(csvAllowed(sinTier), false);
    assert.strictEqual(csvAllowed(pro), true);
  });
});

describe('conector (integraciones) — gating Pro', () => {
  // Réplica del gate: activar = enabled | inboundSecret | outbound con items.
  const wantsConnector = (ig) => !!(ig.enabled || ig.inboundSecret || (Array.isArray(ig.outbound) && ig.outbound.length));
  const blocked = (org, ig) => wantsConnector(ig) && !hasPro(org);

  test('Básico activando conector → bloqueado (402)', () => {
    assert.strictEqual(blocked(basico, { enabled: true }), true);
    assert.strictEqual(blocked(basico, { inboundSecret: 'x' }), true);
    assert.strictEqual(blocked(basico, { outbound: [{ url: 'https://a' }] }), true);
  });
  test('Básico APAGANDO el conector → permitido (no capamos desactivar)', () => {
    assert.strictEqual(blocked(basico, { enabled: false, outbound: [] }), false);
  });
  test('Pro → permitido; sin tier explícito → bloqueado', () => {
    assert.strictEqual(blocked(pro, { enabled: true }), false);
    assert.strictEqual(blocked(sinTier, { enabled: true }), true);
  });
});
