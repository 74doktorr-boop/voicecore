// ============================================================
// NodeFlow — Bonos / paquetes prepagados (2026-07-17)
// Objeción nº3 de la crítica sectorial (~15 sectores). Saldo, consumo atómico
// (CAS) y caducidad. DB-gated: NO-OP sin tabla.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getBalance, consumeOne, refundOne, refundByAppointment, grantBono, _left, _notExpired } = require('../src/billing/bonos');

// ── Mock de Supabase por TABLA (nf_bonos + nf_bono_consumptions) ─────────────
function makeDb(bonoRows = [], consRows = []) {
  const tables = {
    nf_bonos: bonoRows.map((r, i) => ({ id: r.id || 'b' + i, used_sessions: 0, total_sessions: 0, service_key: null, expires_at: null, ...r })),
    nf_bono_consumptions: consRows.map((r, i) => ({ id: r.id || 'c' + i, ...r })),
  };
  function table(name) {
    const rows = tables[name] || (tables[name] = []);
    let op = null, payload = null, single = false, limit = null;
    const filters = {}, inFilters = {};
    const exec = () => {
      const match = (r) => {
        for (const [k, v] of Object.entries(filters)) if (String(r[k]) !== String(v)) return false;
        for (const [k, vals] of Object.entries(inFilters)) if (!vals.map(String).includes(String(r[k]))) return false;
        return true;
      };
      if (op === 'insert') { const row = { id: 'new-' + rows.length, used_sessions: 0, ...payload }; rows.push(row); return { data: { id: row.id }, error: null }; }
      if (op === 'update') {
        const upd = [];
        for (const r of rows) if (match(r)) { Object.assign(r, payload); upd.push(r); }
        return { data: upd.map(r => ({ id: r.id, total_sessions: r.total_sessions, used_sessions: r.used_sessions })), error: null };
      }
      if (op === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return { data: null, error: null }; }
      let out = rows.filter(match);
      if (limit) out = out.slice(0, limit);
      return single ? { data: out[0] || null, error: null } : { data: out, error: null };
    };
    const b = {
      select() { if (!['update', 'insert', 'delete'].includes(op)) op = 'select'; return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      eq(c, v) { filters[c] = v; return b; },
      in(c, v) { inFilters[c] = v; return b; },
      limit(n) { limit = n; return b; },
      single() { single = true; return b; },
      then(res) { return Promise.resolve(res(exec())); },
    };
    return b;
  }
  return { enabled: true, client: { from: (n) => table(n) }, _rows: tables.nf_bonos, _cons: tables.nf_bono_consumptions };
}

describe('helpers puros', () => {
  test('_left', () => assert.strictEqual(_left({ total_sessions: 10, used_sessions: 3 }), 7));
  test('_notExpired', () => {
    assert.strictEqual(_notExpired({ expires_at: null }, '2026-07-17'), true);
    assert.strictEqual(_notExpired({ expires_at: '2026-07-20' }, '2026-07-17'), true);
    assert.strictEqual(_notExpired({ expires_at: '2026-07-10' }, '2026-07-17'), false);
  });
});

describe('getBalance', () => {
  test('sin DB → null', async () => assert.strictEqual(await getBalance('o', '+34600', 'x', { db: { enabled: false } }), null));
  test('contacto sin bono → null (no 0)', async () => {
    const db = makeDb([{ org_id: 'o', phone: '+34600999', total_sessions: 5 }]);
    assert.strictEqual(await getBalance('o', '+34600111', null, { db }), null);
  });
  test('suma el saldo de bonos activos', async () => {
    const db = makeDb([
      { org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 3 },
      { org_id: 'o', phone: '+34600111', total_sessions: 5, used_sessions: 5 }, // agotado
    ]);
    assert.strictEqual(await getBalance('o', '+34600111', null, { db }), 7);
  });
  test('ignora bonos caducados', async () => {
    const db = makeDb([{ org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 0, expires_at: '2000-01-01' }]);
    assert.strictEqual(await getBalance('o', '+34600111', null, { db, today: '2026-07-17' }), 0); // tiene bono pero caducado → 0
  });
});

describe('consumeOne (atómico)', () => {
  test('consume una sesión y baja el saldo', async () => {
    const db = makeDb([{ org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 2 }]);
    const r = await consumeOne('o', '+34600111', null, { db });
    assert.strictEqual(r.consumed, true);
    assert.strictEqual(r.remaining, 7);            // 10 - 3
    assert.strictEqual(db._rows[0].used_sessions, 3);
  });
  test('sin saldo → no consume', async () => {
    const db = makeDb([{ org_id: 'o', phone: '+34600111', total_sessions: 3, used_sessions: 3 }]);
    assert.strictEqual((await consumeOne('o', '+34600111', null, { db })).consumed, false);
  });
  test('sin bono → no consume', async () => {
    const db = makeDb([]);
    assert.strictEqual((await consumeOne('o', '+34600111', null, { db })).consumed, false);
  });
  test('respeta el service_key del bono', async () => {
    const db = makeDb([{ org_id: 'o', phone: '+34600111', total_sessions: 5, used_sessions: 0, service_key: 'masaje' }]);
    assert.strictEqual((await consumeOne('o', '+34600111', 'otro', { db })).consumed, false);
    assert.strictEqual((await consumeOne('o', '+34600111', 'masaje', { db })).consumed, true);
  });
});

describe('refundOne (reembolso al cancelar)', () => {
  test('devuelve una sesión al bono', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 4 }]);
    const r = await refundOne('o', 'B1', { db });
    assert.strictEqual(r.refunded, true);
    assert.strictEqual(r.remaining, 7);            // 10 - 3
    assert.strictEqual(db._rows[0].used_sessions, 3);
  });
  test('no baja de 0', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600', total_sessions: 5, used_sessions: 0 }]);
    assert.strictEqual((await refundOne('o', 'B1', { db })).refunded, false);
  });
  test('no reembolsa un bono de otra org', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600', total_sessions: 5, used_sessions: 2 }]);
    assert.strictEqual((await refundOne('otra-org', 'B1', { db })).refunded, false);
  });
  test('consume y luego reembolsa → saldo intacto', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 0 }]);
    const c = await consumeOne('o', '+34600111', null, { db });
    assert.strictEqual(c.remaining, 9);
    const r = await refundOne('o', c.bonoId, { db });
    assert.strictEqual(r.remaining, 10);
    assert.strictEqual(db._rows[0].used_sessions, 0);
  });
});

describe('ledger — reembolso robusto por cita (sobrevive reinicios)', () => {
  test('consumeOne con appointmentId registra el consumo en el ledger', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 0 }]);
    await consumeOne('o', '+34600111', null, { db, appointmentId: 'APT-9' });
    assert.strictEqual(db._cons.length, 1);
    assert.strictEqual(db._cons[0].appointment_id, 'APT-9');
    assert.strictEqual(db._cons[0].bono_id, 'B1');
  });

  test('refundByAppointment devuelve la sesión y borra el registro', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600', total_sessions: 10, used_sessions: 3 }],
                      [{ id: 'C1', org_id: 'o', bono_id: 'B1', appointment_id: 'APT-9' }]);
    const r = await refundByAppointment('o', 'APT-9', { db });
    assert.strictEqual(r.refunded, true);
    assert.strictEqual(r.remaining, 8);              // 10 - 2
    assert.strictEqual(db._rows[0].used_sessions, 2);
    assert.strictEqual(db._cons.length, 0);          // registro borrado (no doble reembolso)
  });

  test('sin registro (cita sin bono) → no reembolsa', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600', total_sessions: 5, used_sessions: 1 }], []);
    const r = await refundByAppointment('o', 'APT-X', { db });
    assert.strictEqual(r.refunded, false);
    assert.strictEqual(r.reason, 'no_consumption');
  });

  test('ciclo real: consume (con cita) → refundByAppointment → saldo intacto', async () => {
    const db = makeDb([{ id: 'B1', org_id: 'o', phone: '+34600111', total_sessions: 10, used_sessions: 0 }]);
    await consumeOne('o', '+34600111', null, { db, appointmentId: 'APT-7' });
    assert.strictEqual(db._rows[0].used_sessions, 1);
    const r = await refundByAppointment('o', 'APT-7', { db });
    assert.strictEqual(r.refunded, true);
    assert.strictEqual(db._rows[0].used_sessions, 0);   // devuelto
    assert.strictEqual(db._cons.length, 0);
  });
});

describe('grantBono', () => {
  test('crea un bono', async () => {
    const db = makeDb([]);
    const r = await grantBono('o', { phone: '+34600111', sessions: 10, label: 'Bono 10' }, { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(db._rows.length, 1);
    assert.strictEqual(db._rows[0].total_sessions, 10);
  });
  test('sessions inválidas → no crea', async () => {
    const db = makeDb([]);
    assert.strictEqual((await grantBono('o', { phone: '+34600', sessions: 0 }, { db })).ok, false);
  });
});
