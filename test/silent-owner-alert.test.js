// ============================================================
// NodeFlow — Aviso al dueño por desvío caído (2026-07-06)
// Negocio en silencio → email al DUEÑO con el código de reactivación
// exacto (su número NodeFlow). Rate-limit 72h, sin migraciones.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { notifySilentOwner } = require('../src/monitoring/client-health');
const { normalizeRules } = require('../src/lifecycle/followup-rules');

const NOW = Date.parse('2026-07-06T12:00:00Z');

function stubDb({ config = null, org = {}, pool = null, onUpsert } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const q = {
          select() { return q; }, eq() { return q; },
          maybeSingle() {
            if (table === 'org_reminder_config') return Promise.resolve({ data: config ? { config } : null });
            if (table === 'organizations') return Promise.resolve({ data: org });
            if (table === 'nf_phone_pool') return Promise.resolve({ data: pool });
            return Promise.resolve({ data: null });
          },
          upsert(row) { if (onUpsert) onUpsert(row); return Promise.resolve({ error: null }); },
        };
        return q;
      },
    },
  };
}

const ORG = { name: 'Peluquería Ainhoa', owner_email: 'ainhoa@x.es', automation_config: { config: {} } };

describe('notifySilentOwner', () => {
  test('envía email al dueño con el código de desvío de SU número', async () => {
    let sent = null, saved = null;
    const db = stubDb({ org: ORG, pool: { phone_number: '+34843987654' }, onUpsert: (r) => { saved = r; } });
    const r = await notifySilentOwner('org1', { db, now: NOW, sendEmail: async (m) => { sent = m; } });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(sent.to, 'ainhoa@x.es');
    assert.match(sent.subject, /no recibe llamadas/);
    assert.match(sent.html, /\*\*21\*\+34843987654#/);
    assert.strictEqual(saved.config._lastSilenceAlert, new Date(NOW).toISOString());
  });

  test('rate-limit: avisado hace <72h → no repite', async () => {
    let sent = false;
    const db = stubDb({ org: ORG, config: { _lastSilenceAlert: new Date(NOW - 24 * 3600e3).toISOString() } });
    const r = await notifySilentOwner('org1', { db, now: NOW, sendEmail: async () => { sent = true; } });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.reason, 'cooldown');
    assert.strictEqual(sent, false);
  });

  test('avisado hace >72h → vuelve a avisar', async () => {
    let sent = false;
    const db = stubDb({ org: ORG, config: { _lastSilenceAlert: new Date(NOW - 80 * 3600e3).toISOString() } });
    const r = await notifySilentOwner('org1', { db, now: NOW, sendEmail: async () => { sent = true; } });
    assert.strictEqual(r.sent, true);
    assert.strictEqual(sent, true);
  });

  test('sin email del dueño → no envía, no lanza', async () => {
    const db = stubDb({ org: { name: 'X', owner_email: null, automation_config: {} } });
    const r = await notifySilentOwner('org1', { db, now: NOW, sendEmail: async () => {} });
    assert.strictEqual(r.sent, false);
    assert.strictEqual(r.reason, 'no_email');
  });

  test('el marcador conserva las reglas existentes en la config (merge)', async () => {
    let saved = null;
    const db = stubDb({ org: ORG, config: { corte_pelo: { days: 30 }, _frequencyCapDays: 14 }, onUpsert: (r) => { saved = r; } });
    await notifySilentOwner('org1', { db, now: NOW, sendEmail: async () => {} });
    assert.strictEqual(saved.config.corte_pelo.days, 30);
    assert.strictEqual(saved.config._frequencyCapDays, 14);
    assert.ok(saved.config._lastSilenceAlert);
  });
});

describe('normalizeRules preserva _lastSilenceAlert (guardar reglas no lo borra)', () => {
  test('clave reservada sobrevive al PUT de reglas', () => {
    const existing = { _lastSilenceAlert: '2026-07-06T10:00:00Z', _dismissedSuggestions: ['x'] };
    const { config } = normalizeRules('peluqueria', { overrides: {} }, existing);
    assert.strictEqual(config._lastSilenceAlert, '2026-07-06T10:00:00Z');
    assert.deepStrictEqual(config._dismissedSuggestions, ['x']);
  });
});
