// ============================================================
// NodeFlow — Paquete de mensajes (2026-07-07)
// 200 incluidos/mes + 0,10€/mensaje extra. El delta se reporta a
// Stripe UNA vez (marcador mensual); sin meter configurado no se cobra.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { usageSummary, reportOverageForOrg, monthStartISO } = require('../src/billing/message-usage');

afterEach(() => { delete process.env.STRIPE_MSG_METER_EVENT; });

function stubDb({ sentCount = 0, config = null } = {}) {
  const upserts = [];
  return {
    enabled: true, _upserts: upserts,
    client: {
      from(table) {
        const q = {
          select(cols, opts) { q._head = opts && opts.head; return q; },
          eq() { return q; },
          gte() { return Promise.resolve({ count: sentCount }); },
          maybeSingle() { return Promise.resolve({ data: config ? { config } : null }); },
          upsert(row) { upserts.push(row); return Promise.resolve({ error: null }); },
        };
        return q;
      },
    },
  };
}

describe('usageSummary', () => {
  test('dentro del paquete → sin excedente', async () => {
    const u = await usageSummary('org1', { db: stubDb({ sentCount: 143 }) });
    assert.strictEqual(u.used, 143);
    assert.strictEqual(u.included, 200);
    assert.strictEqual(u.overage, 0);
    assert.strictEqual(u.overageEur, 0);
  });
  test('pasado el paquete → excedente a 0,10€', async () => {
    const u = await usageSummary('org1', { db: stubDb({ sentCount: 223 }) });
    assert.strictEqual(u.overage, 23);
    assert.strictEqual(u.overageEur, 2.3);
  });
  test('monthStartISO devuelve un instante del mes en curso', () => {
    const iso = monthStartISO(new Date('2026-07-15T10:00:00Z'));
    assert.match(iso, /^2026-0?6-30T22:00|^2026-07-01T/);
  });
});

describe('reportOverageForOrg', () => {
  const ORG = { id: 'org1', stripe_customer_id: 'cus_123' };

  test('sin STRIPE_MSG_METER_EVENT → no reporta (solo contador)', async () => {
    let called = false;
    const r = await reportOverageForOrg(ORG, { db: stubDb({ sentCount: 500 }), billing: { reportUsage: async () => { called = true; } } });
    assert.strictEqual(r.reported, 0);
    assert.strictEqual(called, false);
  });

  test('reporta el DELTA y guarda el marcador (no cobra dos veces)', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    const db = stubDb({ sentCount: 230, config: { _msgOverage: { month: new Date().toISOString().slice(0, 7), reported: 10 } } });
    let sent = null;
    const r = await reportOverageForOrg(ORG, { db, billing: { reportUsage: async (p) => { sent = p; } } });
    assert.strictEqual(r.reported, 20);                    // 30 de excedente - 10 ya reportados
    assert.strictEqual(sent.minutes, 20);
    assert.strictEqual(sent.eventName, 'mensajes_extra');
    assert.strictEqual(db._upserts[0].config._msgOverage.reported, 30);
  });

  test('sin excedente → nada', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    const r = await reportOverageForOrg(ORG, { db: stubDb({ sentCount: 50 }), billing: { reportUsage: async () => { throw new Error('no debería'); } } });
    assert.strictEqual(r.reported, 0);
  });
});
