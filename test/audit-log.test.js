'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { recordAudit, listAudit, ipOf } = require('../src/audit/audit-log');

// db mock: registra inserts y sirve selects encadenados.
function mockDb(opts = {}) {
  const inserts = [];
  const rows = opts.rows || [];
  const chain = {
    _filters: {},
    select() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    eq(k, v) { chain._filters[k] = v; return chain; },
    then(res) { // hace la cadena "awaitable"
      let out = rows;
      for (const k in chain._filters) out = out.filter(r => r[k] === chain._filters[k]);
      return Promise.resolve({ data: out, error: opts.selectError || null }).then(res);
    },
    insert(row) { inserts.push(row); return Promise.resolve({ error: opts.insertError || null }); },
  };
  return { enabled: opts.enabled !== false, client: { from() { chain._filters = {}; return chain; } }, _inserts: inserts };
}

describe('audit-log', () => {
  test('recordAudit inserta la fila con los campos correctos', async () => {
    const db = mockDb();
    const r = await recordAudit({ actor: 'unai', action: 'org_create', targetType: 'org', targetId: 42, details: { name: 'X' }, ip: '1.2.3.4' }, { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(db._inserts.length, 1);
    assert.strictEqual(db._inserts[0].action, 'org_create');
    assert.strictEqual(db._inserts[0].target_id, '42');     // normalizado a string
    assert.deepStrictEqual(db._inserts[0].details, { name: 'X' });
  });

  test('recordAudit NO lanza y no bloquea si el insert falla', async () => {
    const db = mockDb({ insertError: { message: 'tabla no existe' } });
    const r = await recordAudit({ action: 'x' }, { db });
    assert.strictEqual(r.ok, false);      // no rompe la acción del admin
  });

  test('recordAudit no hace nada si la BD está deshabilitada', async () => {
    const db = mockDb({ enabled: false });
    const r = await recordAudit({ action: 'x' }, { db });
    assert.strictEqual(r.skipped, 'db');
  });

  test('listAudit devuelve filas y filtra por action', async () => {
    const db = mockDb({ rows: [
      { action: 'admin_login', actor: 'unai' },
      { action: 'org_create', actor: 'unai' },
    ] });
    const all = await listAudit({}, { db });
    assert.strictEqual(all.length, 2);
    const filtered = await listAudit({ action: 'org_create' }, { db });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].action, 'org_create');
  });

  test('ipOf extrae la IP del request', () => {
    assert.strictEqual(ipOf({ ip: '9.9.9.9' }), '9.9.9.9');
    assert.strictEqual(ipOf({ headers: { 'x-forwarded-for': '8.8.8.8' } }), '8.8.8.8');
    assert.strictEqual(ipOf(null), null);
  });
});
