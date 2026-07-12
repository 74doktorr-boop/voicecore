// ============================================================
// NodeFlow — Destinatario de los avisos al dueño (2026-07-12)
// El email de avisos configurable en el portal (automations.config.notifyEmail)
// MANDA sobre el email de alta (ownerEmail). Bug real: se cambió en el portal y
// los avisos seguían yendo al de alta.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ownerNotifyEmail } = require('../src/notifications/call-notifications');

describe('ownerNotifyEmail', () => {
  test('con notifyEmail en el portal → gana sobre el de alta', () => {
    const config = { ownerEmail: 'alta@negocio.com', automations: { config: { notifyEmail: 'avisos@negocio.com' } } };
    assert.strictEqual(ownerNotifyEmail(config), 'avisos@negocio.com');
  });

  test('sin notifyEmail → cae al email de alta (ownerEmail)', () => {
    const config = { ownerEmail: 'alta@negocio.com', automations: { config: {} } };
    assert.strictEqual(ownerNotifyEmail(config), 'alta@negocio.com');
  });

  test('notifyEmail vacío/espacios → cae al de alta', () => {
    const config = { ownerEmail: 'alta@negocio.com', automations: { config: { notifyEmail: '   ' } } };
    assert.strictEqual(ownerNotifyEmail(config), 'alta@negocio.com');
  });

  test('sin ninguno → null (el envío se salta)', () => {
    assert.strictEqual(ownerNotifyEmail({ automations: { config: {} } }), null);
    assert.strictEqual(ownerNotifyEmail({}), null);
  });
});
