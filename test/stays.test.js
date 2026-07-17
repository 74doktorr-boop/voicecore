// ============================================================
// NodeFlow — Estancias por noches / inventario (2026-07-17)
// Hotel/residencia/guardería: rango de fechas con plazas por noche.
// checkout EXCLUSIVO (01→04 ocupa 01, 02, 03). DB-gated.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { nightsBetween, occupiesNight, rangeAvailability, checkStayAvailability, bookStay, cancelStay } = require('../src/scheduling/stays');

function makeDb(stays = []) {
  const rows = stays.map((r, i) => ({ id: r.id || 's' + i, status: 'confirmed', units: 1, ...r }));
  function table() {
    let op = null, payload = null, single = false;
    const eqs = {}, neqs = {}, lts = {}, gts = {};
    const match = (r) => {
      for (const [k, v] of Object.entries(eqs)) if (String(r[k]) !== String(v)) return false;
      for (const [k, v] of Object.entries(neqs)) if (String(r[k]) === String(v)) return false;
      for (const [k, v] of Object.entries(lts)) if (!(String(r[k]) < String(v))) return false;
      for (const [k, v] of Object.entries(gts)) if (!(String(r[k]) > String(v))) return false;
      return true;
    };
    const exec = () => {
      if (op === 'insert') { const row = { id: 'new' + rows.length, status: 'confirmed', ...payload }; rows.push(row); return { data: { id: row.id }, error: null }; }
      if (op === 'update') { const upd = []; for (const r of rows) if (match(r)) { Object.assign(r, payload); upd.push(r); } return { data: upd.map(r => ({ id: r.id })), error: null }; }
      const out = rows.filter(match);
      return single ? { data: out[0] || null, error: null } : { data: out, error: null };
    };
    const b = {
      select() { if (!['insert', 'update'].includes(op)) op = 'select'; return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      update(p) { op = 'update'; payload = p; return b; },
      eq(k, v) { eqs[k] = v; return b; }, neq(k, v) { neqs[k] = v; return b; },
      lt(k, v) { lts[k] = v; return b; }, gt(k, v) { gts[k] = v; return b; },
      single() { single = true; return b; }, then(res) { return Promise.resolve(res(exec())); },
    };
    return b;
  }
  return { enabled: true, client: { from: () => table() }, _rows: rows };
}

describe('nightsBetween (checkout exclusivo)', () => {
  test('3 noches', () => assert.deepStrictEqual(nightsBetween('2026-08-01', '2026-08-04'), ['2026-08-01', '2026-08-02', '2026-08-03']));
  test('1 noche', () => assert.deepStrictEqual(nightsBetween('2026-08-01', '2026-08-02'), ['2026-08-01']));
  test('cambio de mes', () => assert.deepStrictEqual(nightsBetween('2026-08-30', '2026-09-01'), ['2026-08-30', '2026-08-31']));
});

describe('occupiesNight', () => {
  const s = { checkin: '2026-08-01', checkout: '2026-08-04' };
  test('noche dentro', () => assert.strictEqual(occupiesNight(s, '2026-08-03'), true));
  test('noche del checkout NO se ocupa', () => assert.strictEqual(occupiesNight(s, '2026-08-04'), false));
  test('noche anterior no', () => assert.strictEqual(occupiesNight(s, '2026-07-31'), false));
});

describe('rangeAvailability', () => {
  test('aforo 1, plaza ocupada esa noche → no disponible', () => {
    const r = rangeAvailability([{ checkin: '2026-08-01', checkout: '2026-08-04' }], '2026-08-02', '2026-08-03', 1);
    assert.strictEqual(r.available, false);
    assert.deepStrictEqual(r.fullNights, ['2026-08-02']);
  });
  test('aforo 2, una ocupada → todavía cabe', () => {
    const r = rangeAvailability([{ checkin: '2026-08-01', checkout: '2026-08-04' }], '2026-08-02', '2026-08-03', 2);
    assert.strictEqual(r.available, true);
  });
  test('ignora las canceladas', () => {
    const r = rangeAvailability([{ checkin: '2026-08-01', checkout: '2026-08-04', status: 'cancelled' }], '2026-08-02', '2026-08-03', 1);
    assert.strictEqual(r.available, true);
  });
  test('rangos que no solapan → disponible', () => {
    const r = rangeAvailability([{ checkin: '2026-08-01', checkout: '2026-08-03' }], '2026-08-03', '2026-08-05', 1);
    assert.strictEqual(r.available, true); // el checkout 03 libera la noche 03
  });
});

describe('checkStayAvailability (BD)', () => {
  test('rango inválido → reason', async () => {
    const r = await checkStayAvailability('o', { checkin: '2026-08-05', checkout: '2026-08-01', capacity: 3 }, { db: makeDb() });
    assert.strictEqual(r.reason, 'rango_invalido');
  });
  test('con hueco → available', async () => {
    const db = makeDb([{ org_id: 'o', unit_key: 'suite', checkin: '2026-08-01', checkout: '2026-08-03' }]);
    const r = await checkStayAvailability('o', { unitKey: 'suite', checkin: '2026-08-10', checkout: '2026-08-12', capacity: 2 }, { db });
    assert.strictEqual(r.available, true);
  });
});

describe('bookStay / cancelStay', () => {
  test('reserva cuando hay hueco', async () => {
    const db = makeDb([]);
    const r = await bookStay('o', { unitKey: 'canil', guestName: 'Toby', phone: '+34600', checkin: '2026-08-01', checkout: '2026-08-05', capacity: 5 }, { db });
    assert.strictEqual(r.success, true);
    assert.ok(r.id);
    assert.strictEqual(db._rows.length, 1);
  });
  test('rechaza si una noche está completa', async () => {
    const db = makeDb([{ org_id: 'o', unit_key: 'suite', checkin: '2026-08-02', checkout: '2026-08-03', units: 1 }]);
    const r = await bookStay('o', { unitKey: 'suite', checkin: '2026-08-01', checkout: '2026-08-04', capacity: 1 }, { db });
    assert.strictEqual(r.success, false);
    assert.ok(r.fullNights.includes('2026-08-02'));
  });
  test('cancela una estancia', async () => {
    const db = makeDb([{ id: 'S1', org_id: 'o', checkin: '2026-08-01', checkout: '2026-08-03' }]);
    const r = await cancelStay('o', 'S1', { db });
    assert.strictEqual(r.success, true);
    assert.strictEqual(db._rows[0].status, 'cancelled');
  });
});
