// ============================================================
// NodeFlow — Tests del Campaign Core (dispatcher de salientes)
// Helpers puros: ventana de llamadas y política de reintentos.
// El dispatcher es CIEGO AL DOMINIO — aquí no hay peluquerías.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { isWithinCallingWindow, nextRetryAt, enqueueCampaignCall } = require('../src/campaigns/dispatcher');

// Construye un Date que en Europe/Madrid cae en el día/hora deseados (jul 2026, CEST = UTC+2)
function madrid(dayOfMonth, hour) {
  return new Date(Date.UTC(2026, 6, dayOfMonth, hour - 2, 30, 0));
}

describe('ventana de llamadas (L-S 10-20h Madrid)', () => {
  test('martes 12:30 → dentro', () => {
    assert.strictEqual(isWithinCallingWindow(madrid(7, 12)), true); // 2026-07-07 es martes
  });
  test('martes 09:30 → fuera (demasiado pronto)', () => {
    assert.strictEqual(isWithinCallingWindow(madrid(7, 9)), false);
  });
  test('martes 20:30 → fuera (demasiado tarde)', () => {
    assert.strictEqual(isWithinCallingWindow(madrid(7, 20)), false);
  });
  test('sábado 11:30 → dentro', () => {
    assert.strictEqual(isWithinCallingWindow(madrid(11, 11)), true); // 2026-07-11 es sábado
  });
  test('domingo 12:30 → fuera (nadie llama en domingo)', () => {
    assert.strictEqual(isWithinCallingWindow(madrid(12, 12)), false); // 2026-07-12 es domingo
  });
});

describe('política de reintentos', () => {
  const now = Date.UTC(2026, 6, 7, 10, 0, 0);
  test('1er reintento → +30 min', () => {
    assert.strictEqual(nextRetryAt(1, now), new Date(now + 30 * 60 * 1000).toISOString());
  });
  test('2º reintento → +2 h', () => {
    assert.strictEqual(nextRetryAt(2, now), new Date(now + 2 * 60 * 60 * 1000).toISOString());
  });
  test('reintentos posteriores no crecen más allá de 2 h', () => {
    assert.strictEqual(nextRetryAt(7, now), new Date(now + 2 * 60 * 60 * 1000).toISOString());
  });
});

describe('enqueue — validaciones', () => {
  test('sin orgId/campaignType/phone → error claro', async () => {
    await assert.rejects(() => enqueueCampaignCall({ orgId: 'o', phone: '+34600000000' }), /obligatorios/);
    await assert.rejects(() => enqueueCampaignCall({ campaignType: 'recovery', phone: '+34600000000' }), /obligatorios/);
    await assert.rejects(() => enqueueCampaignCall({ orgId: 'o', campaignType: 'recovery' }), /obligatorios/);
  });
});
