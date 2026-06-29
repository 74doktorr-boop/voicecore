// ============================================================
// NodeFlow — Stripe webhook idempotency tests
// Ejecutar: npm test  (node --test test/)
//
// Blinda el claim atómico (compare-and-set) que evita el
// doble-aprovisionamiento ante entregas duplicadas de Stripe
// o procesamiento concurrente entre réplicas (Docker Swarm).
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

// ── Fake mínimo de Supabase: simula el CAS a nivel "BD" sobre un Map ──────────
// Soporta exactamente las cadenas que usan claim/release:
//   update(patch).eq().not('status','in','(...)').select('id')
//   select('status').eq().maybeSingle()
//   update(patch).eq().eq()
const ROWS = new Map();
class QB {
  constructor(rows) { this.rows = rows; this._isUpdate = false; this._patch = null; this._filters = []; this._notIn = null; this._select = false; this._single = false; }
  update(patch) { this._isUpdate = true; this._patch = patch; return this; }
  select() { this._select = true; return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  not(col, op, val) {
    if (op === 'in') this._notIn = [col, val.replace(/[()"]/g, '').split(',').map(s => s.trim())];
    return this;
  }
  maybeSingle() { this._single = true; return this; }
  _match(r) {
    return this._filters.every(([c, v]) => r[c] === v)
        && (!this._notIn || !this._notIn[1].includes(r[this._notIn[0]]));
  }
  then(resolve) {
    if (this._isUpdate) {
      const affected = [];
      for (const r of this.rows.values()) if (this._match(r)) { Object.assign(r, this._patch); affected.push(r); }
      return resolve({ data: this._select ? affected.map(r => ({ id: r.id })) : null, error: null });
    }
    const matched = [...this.rows.values()].filter(r => this._match(r));
    return resolve({ data: this._single ? (matched[0] || null) : matched, error: null });
  }
}

// Interceptar getDatabase ANTES de requerir routes-registro (destructura al cargar).
const dbMod = require('../src/db/database');
dbMod.getDatabase = () => ({ enabled: true, client: { from: () => new QB(ROWS) } });

const { claimRegistroForProvisioning, releaseRegistroProvisioning } = require('../src/api/routes-registro');

function seed(id, status) { ROWS.set(id, { id, status }); }
function statusOf(id) { return ROWS.get(id)?.status; }

describe('idempotencia webhook Stripe — claim atómico', () => {
  beforeEach(() => ROWS.clear());

  test('primer claim gana y deja el registro en provisioning', async () => {
    seed('reg_1', 'pending_payment');
    assert.strictEqual(await claimRegistroForProvisioning('reg_1'), true);
    assert.strictEqual(statusOf('reg_1'), 'provisioning');
  });

  test('segundo claim (entrega duplicada) NO gana', async () => {
    seed('reg_2', 'pending_payment');
    assert.strictEqual(await claimRegistroForProvisioning('reg_2'), true);
    assert.strictEqual(await claimRegistroForProvisioning('reg_2'), false);
  });

  test('claim sobre un registro ya active devuelve false', async () => {
    seed('reg_3', 'active');
    assert.strictEqual(await claimRegistroForProvisioning('reg_3'), false);
    assert.strictEqual(statusOf('reg_3'), 'active'); // no se pisa
  });

  test('dos entregas concurrentes: exactamente una gana', async () => {
    seed('reg_4', 'pending_payment');
    const [a, b] = await Promise.all([
      claimRegistroForProvisioning('reg_4'),
      claimRegistroForProvisioning('reg_4'),
    ]);
    assert.strictEqual([a, b].filter(Boolean).length, 1, 'debería ganar exactamente uno');
  });

  test('release devuelve a pending_payment y permite reintento', async () => {
    seed('reg_5', 'pending_payment');
    await claimRegistroForProvisioning('reg_5');
    await releaseRegistroProvisioning('reg_5');
    assert.strictEqual(statusOf('reg_5'), 'pending_payment');
    assert.strictEqual(await claimRegistroForProvisioning('reg_5'), true); // reintento re-aprovisiona
  });

  test('release NO pisa un registro ya active', async () => {
    seed('reg_6', 'active');
    await releaseRegistroProvisioning('reg_6');
    assert.strictEqual(statusOf('reg_6'), 'active');
  });

  test('claim sobre registro inexistente en BD devuelve false (no revienta)', async () => {
    assert.strictEqual(await claimRegistroForProvisioning('reg_missing'), false);
  });
});
