// ============================================================
// NodeFlow — Teléfono del cliente según dirección de llamada (2026-07-19)
// Bug real (prueba de Unai): en una llamada SALIENTE la cita guardaba el número
// de NodeFlow (callerNumber = el que marca) en vez del cliente (calledNumber),
// así que la confirmación/recordatorio iban al número equivocado. INBOUND ya
// funcionaba (el que llama ES el cliente).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { _clientPhoneOf } = require('../src/tools/executor');

describe('_clientPhoneOf', () => {
  test('inbound → el cliente es quien llama (callerNumber)', () => {
    assert.strictEqual(_clientPhoneOf({ direction: 'inbound', callerNumber: '+34666351319', calledNumber: '+34843700849' }), '+34666351319');
  });
  test('outbound → el cliente es a quien llamamos (calledNumber), NO NodeFlow', () => {
    assert.strictEqual(_clientPhoneOf({ direction: 'outbound', callerNumber: '+34843700849', calledNumber: '+34639941265' }), '+34639941265');
  });
  test('sin dirección explícita → trata como inbound (callerNumber)', () => {
    assert.strictEqual(_clientPhoneOf({ callerNumber: '+34600' }), '+34600');
  });
  test('sin sesión → undefined (no revienta)', () => {
    assert.strictEqual(_clientPhoneOf(null), undefined);
    assert.strictEqual(_clientPhoneOf(undefined), undefined);
  });
});
