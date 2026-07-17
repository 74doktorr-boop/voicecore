// ============================================================
// NodeFlow — Solicitud de señal/depósito (2026-07-17)
// Objeción de 16 sectores: "un recordatorio no frena el no-show caro".
// v1 sin procesar dinero: envía el enlace de pago PROPIO del negocio al
// reservar. Opt-in, OFF por defecto. Ligado a la crítica sectorial.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { depositConfig, buildDepositBody, maybeRequestDeposit, _clearCache } = require('../src/billing/deposit-request');

describe('depositConfig', () => {
  test('sin config → null', () => assert.strictEqual(depositConfig({}), null));
  test('deshabilitada → null', () => assert.strictEqual(depositConfig({ automation_config: { config: { deposit: { enabled: false, url: 'x' } } } }), null));
  test('sin url → null (no envía a ningún sitio)', () => assert.strictEqual(depositConfig({ automation_config: { config: { deposit: { enabled: true } } } }), null));
  test('activa y con url → la devuelve', () => {
    const d = depositConfig({ automation_config: { config: { deposit: { enabled: true, url: 'https://pay/x', amountText: '10 €' } } } });
    assert.ok(d && d.url === 'https://pay/x');
  });
});

describe('buildDepositBody', () => {
  test('con importe con €', () => {
    const b = buildDepositBody({ url: 'https://pay/x', amountText: '10 €' }, null);
    assert.match(b, /10 €/);
    assert.match(b, /https:\/\/pay\/x/);
    assert.match(b, /confirmar tu cita/);
  });
  test('importe sin símbolo → añade "una señal de"', () => {
    const b = buildDepositBody({ url: 'u', amountText: '10' }, null);
    assert.match(b, /una señal de 10/);
  });
  test('incluye la fecha si se pasa', () => {
    const b = buildDepositBody({ url: 'u', amountText: '10 €' }, 'martes 5 de agosto');
    assert.match(b, /del martes 5 de agosto/);
  });
});

describe('maybeRequestDeposit', () => {
  const apt = { id: 'APT-1', patientName: 'Ana García', phone: '+34600111222' };

  test('sin config activa → no-op (skipped)', async () => {
    _clearCache();
    let sent = false;
    const r = await maybeRequestDeposit(apt, 'org1', { org: { name: 'X' }, sendTemplate: async () => { sent = true; return { ok: true }; } });
    assert.strictEqual(r.skipped, true);
    assert.strictEqual(sent, false);
  });

  test('con señal activa → envía por nodeflow_aviso con el enlace', async () => {
    let captured = null;
    const org = { name: 'Clínica X', language: 'es', automation_config: { config: { deposit: { enabled: true, url: 'https://buy.stripe/x', amountText: '15 €' } } } };
    const r = await maybeRequestDeposit(apt, 'org1', {
      org,
      sendTemplate: async (phone, tpl, lang, params) => { captured = { phone, tpl, params }; return { ok: true }; },
      getWaCredentials: async () => ({ phoneNumberId: 'P', accessToken: 't' }),
    });
    assert.strictEqual(r.requested, true);
    assert.strictEqual(captured.tpl, 'nodeflow_aviso');
    assert.strictEqual(captured.phone, '+34600111222');
    const body = captured.params[0].parameters[2].text;
    assert.match(body, /15 €/);
    assert.match(body, /buy\.stripe\/x/);
  });

  test('sin teléfono → no-op', async () => {
    const r = await maybeRequestDeposit({ id: 'A' }, 'org1', { org: { automation_config: { config: { deposit: { enabled: true, url: 'u' } } } } });
    assert.strictEqual(r.requested, false);
  });

  test('fail-open: si el envío lanza, no propaga', async () => {
    const org = { automation_config: { config: { deposit: { enabled: true, url: 'u' } } } };
    const r = await maybeRequestDeposit(apt, 'org1', { org, sendTemplate: async () => { throw new Error('boom'); }, getWaCredentials: async () => null });
    assert.strictEqual(r.requested, false);
  });
});
