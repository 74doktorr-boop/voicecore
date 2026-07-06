// ============================================================
// NodeFlow — Auto-provisión de números Telnyx (2026-07-06)
// El pool manual bloqueaba el alta con el pool vacío. Estos tests fijan
// la compra por API: buscar, comprar apuntando a la App de voz, y los
// fallos (sin config, regulatorio ES, tope de seguridad).
// ============================================================
'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const prov = require('../src/telephony/telnyx-provision');

const OK = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const ERR = (status, errors) => ({ ok: false, status, json: async () => ({ errors }) });

let orderBody = null;
function fetchMock({ search = OK([{ phone_number: '+34843000111' }]), order = OK({ id: 'ord1', status: 'success' }) } = {}) {
  return async (url, opts) => {
    if (url.includes('/available_phone_numbers')) return typeof search === 'function' ? search(url) : search;
    if (url.includes('/number_orders')) { orderBody = JSON.parse(opts.body); return order; }
    return ERR(404, [{ detail: 'no ruta' }]);
  };
}

describe('telnyx-provision', () => {
  beforeEach(() => { process.env.TELNYX_API_KEY = 'k'; process.env.TELNYX_APP_ID = 'app123'; delete process.env.TELNYX_REQUIREMENT_GROUP_ID; orderBody = null; });
  afterEach(() => { delete process.env.TELNYX_API_KEY; delete process.env.TELNYX_APP_ID; delete process.env.TELNYX_REQUIREMENT_GROUP_ID; });

  test('isConfigured refleja las env', () => {
    assert.strictEqual(prov.isConfigured(), true);
    delete process.env.TELNYX_API_KEY;
    assert.strictEqual(prov.isConfigured(), false);
  });

  test('findAvailableNumber devuelve el primer número de voz', async () => {
    const n = await prov.findAvailableNumber({ fetchImpl: fetchMock() });
    assert.strictEqual(n, '+34843000111');
  });

  test('provisionNumber compra y apunta a la App de voz (connection_id)', async () => {
    const n = await prov.provisionNumber({ fetchImpl: fetchMock() });
    assert.strictEqual(n, '+34843000111');
    assert.strictEqual(orderBody.connection_id, 'app123');
    assert.strictEqual(orderBody.phone_numbers[0].phone_number, '+34843000111');
    assert.strictEqual(orderBody.phone_numbers[0].requirement_group_id, undefined);
  });

  test('adjunta el bundle regulatorio si TELNYX_REQUIREMENT_GROUP_ID está', async () => {
    process.env.TELNYX_REQUIREMENT_GROUP_ID = 'req9';
    await prov.provisionNumber({ fetchImpl: fetchMock() });
    assert.strictEqual(orderBody.phone_numbers[0].requirement_group_id, 'req9');
  });

  test('sin config → null (cero regresión, cae al flujo de siempre)', async () => {
    delete process.env.TELNYX_API_KEY;
    const n = await prov.provisionNumber({ fetchImpl: fetchMock() });
    assert.strictEqual(n, null);
  });

  test('sin stock disponible → null', async () => {
    const n = await prov.provisionNumber({ fetchImpl: fetchMock({ search: OK([]) }) });
    assert.strictEqual(n, null);
  });

  test('rechazo regulatorio ES → null (no lanza)', async () => {
    const n = await prov.provisionNumber({ fetchImpl: fetchMock({ order: ERR(422, [{ detail: 'Regulatory requirement (address) missing' }]) }) });
    assert.strictEqual(n, null);
  });

  test('topUpPool compra hasta el objetivo y respeta el tope de seguridad', async () => {
    const added = [];
    const deps = {
      fetchImpl: fetchMock(),
      addNumber: async ({ phoneNumber }) => { added.push(phoneNumber); },
      getPoolStats: async () => ({ available: 1 }),
    };
    const n = await prov.topUpPool(3, deps); // need 2
    assert.strictEqual(n, 2);
    assert.strictEqual(added.length, 2);

    added.length = 0;
    deps.getPoolStats = async () => ({ available: 0 });
    const n2 = await prov.topUpPool(100, deps); // pediría 100 → capado
    assert.strictEqual(n2, prov.MAX_TOPUP_PER_RUN);
  });
});
