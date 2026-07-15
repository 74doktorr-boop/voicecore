// ============================================================
// NodeFlow — Rescate de altas atascadas en 'provisioning' (auditoría 2026-07-16).
// Si el proceso muere entre el claim y 'active', el fundador pagó y se quedó a
// medias en silencio. reconcileStuckProvisioning lo rescata SIN arriesgar doble
// org/número: completa si ya hay org, reabre si no, y no toca altas en vuelo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { reconcileStuckProvisioning } = require('../src/api/routes-registro');

const NOW = Date.parse('2026-07-16T12:00:00.000Z');
const OLD = '2026-07-16T11:00:00.000Z';   // 60 min → pasado el umbral de 15
const RECENT = '2026-07-16T11:58:00.000Z'; // 2 min → en vuelo

function makeDb({ stuck = [], orgsByEmail = {} }) {
  const updates = [];
  return {
    enabled: true, _updates: updates,
    client: {
      from(table) {
        return {
          select() {
            const b = {};
            b.eq = (col, val) => {
              if (table === 'registros' && col === 'status') return Promise.resolve({ data: stuck, error: null });
              b._email = val; return b;                 // organizations: .eq('owner_email', …)
            };
            b.limit = () => b;
            b.maybeSingle = () => Promise.resolve({ data: orgsByEmail[b._email] || null });
            return b;
          },
          update(patch) {
            const u = { _id: null };
            u.eq = (col, val) => { if (col === 'id') u._id = val; return u; };
            u.select = () => { updates.push({ id: u._id, status: patch.status }); return Promise.resolve({ data: [{ id: u._id }], error: null }); };
            return u;
          },
        };
      },
    },
  };
}

describe('reconcileStuckProvisioning', () => {
  test('atascado + YA existe org → se marca active (finaliza el alta)', async () => {
    const db = makeDb({
      stuck: [{ id: 'r1', email: 'a@b.com', negocio: 'Bar A', provisioning_at: OLD, status: 'provisioning' }],
      orgsByEmail: { 'a@b.com': { id: 'org-1' } },
    });
    const out = await reconcileStuckProvisioning({ db, now: NOW });
    assert.strictEqual(out.completed, 1);
    assert.strictEqual(out.reopened, 0);
    assert.deepStrictEqual(db._updates, [{ id: 'r1', status: 'active' }]);
  });

  test('atascado + NO existe org → se reabre a pending_payment (seguro, sin número comprado)', async () => {
    const db = makeDb({
      stuck: [{ id: 'r2', email: 'c@d.com', negocio: 'Bar C', provisioning_at: OLD, status: 'provisioning' }],
      orgsByEmail: {},
    });
    const out = await reconcileStuckProvisioning({ db, now: NOW });
    assert.strictEqual(out.reopened, 1);
    assert.strictEqual(out.completed, 0);
    assert.deepStrictEqual(db._updates, [{ id: 'r2', status: 'pending_payment' }]);
  });

  test('en vuelo (provisioning_at reciente) → NO se toca', async () => {
    const db = makeDb({
      stuck: [{ id: 'r3', email: 'e@f.com', provisioning_at: RECENT, status: 'provisioning' }],
      orgsByEmail: {},
    });
    const out = await reconcileStuckProvisioning({ db, now: NOW });
    assert.strictEqual(out.skipped, 1);
    assert.strictEqual(db._updates.length, 0);
  });

  test('sin provisioning_at (pre-migración) → se salta (conservador)', async () => {
    const db = makeDb({ stuck: [{ id: 'r4', email: 'g@h.com', provisioning_at: null, status: 'provisioning' }] });
    const out = await reconcileStuckProvisioning({ db, now: NOW });
    assert.strictEqual(out.skipped, 1);
    assert.strictEqual(db._updates.length, 0);
  });

  test('db apagada → no-op', async () => {
    const out = await reconcileStuckProvisioning({ db: { enabled: false }, now: NOW });
    assert.deepStrictEqual(out, { checked: 0, completed: 0, reopened: 0, skipped: 0 });
  });

  test('mezcla: uno con org, uno sin org, uno en vuelo', async () => {
    const db = makeDb({
      stuck: [
        { id: 'r1', email: 'a@b.com', provisioning_at: OLD, status: 'provisioning' },
        { id: 'r2', email: 'c@d.com', provisioning_at: OLD, status: 'provisioning' },
        { id: 'r3', email: 'e@f.com', provisioning_at: RECENT, status: 'provisioning' },
      ],
      orgsByEmail: { 'a@b.com': { id: 'org-1' } },
    });
    const out = await reconcileStuckProvisioning({ db, now: NOW });
    assert.strictEqual(out.checked, 3);
    assert.strictEqual(out.completed, 1);
    assert.strictEqual(out.reopened, 1);
    assert.strictEqual(out.skipped, 1);
  });
});
