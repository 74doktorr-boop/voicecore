// ============================================================
// NodeFlow — Gating Pro: informe completo + conector (2026-07-27)
// Completa la matriz Básico/Pro: el informe cita-a-cita (+CSV) y el
// conector de integraciones son Pro. Básico ve el resumen del informe
// y NO puede activar el conector. Default PRO → cero regresión.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { hasPro } = require('../src/billing/plan');

// Réplica de la lógica de gating de los endpoints (sin arrancar el server):
// mantiene el test rápido y a la vez fija el contrato que codifican las rutas.
const basico = { automation_config: { config: { tier: 'basico' } } };
const pro = { automation_config: { config: { tier: 'pro' } } };
const sinTier = {}; // fundadores/existentes → pro por defecto

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
  test('sin tier (fundador/existente) → completo', () => {
    assert.strictEqual(stripDetail(sinTier, full).appointments.length, 3);
  });
  test('CSV → 402 en Básico, permitido en Pro/sin-tier', () => {
    const csvAllowed = (org) => hasPro(org);
    assert.strictEqual(csvAllowed(basico), false);
    assert.strictEqual(csvAllowed(pro), true);
    assert.strictEqual(csvAllowed(sinTier), true);
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
  test('Pro / sin tier → permitido', () => {
    assert.strictEqual(blocked(pro, { enabled: true }), false);
    assert.strictEqual(blocked(sinTier, { enabled: true }), false);
  });
});
