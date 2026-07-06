// ============================================================
// NodeFlow — Recálculo de cartera al cambiar reglas (2026-07-06)
// Ajustar una regla debe tener efecto en los clientes ACTUALES,
// no solo en los que vuelvan a tener actividad.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { recalculateOrg } = require('../src/lifecycle/reminder-engine');

// Stub Supabase por tabla. Contactos sin citas → recalculate no programa nada,
// pero recalculateOrg debe iterarlos igualmente (probamos la orquestación).
function stubDb({ contacts = [], sector = 'peluqueria', orgConfig = {}, onFrom } = {}) {
  function chain(table) {
    if (onFrom) onFrom(table);
    const q = {
      select() { return q; }, eq() { return q; }, is() { return q; }, gte() { return q; },
      in() { return q; }, neq() { return q; }, order() { return q; }, update() { return q; },
      limit() {
        if (table === 'contacts') return Promise.resolve({ data: contacts });
        return Promise.resolve({ data: [] });
      },
      maybeSingle() {
        if (table === 'organizations') return Promise.resolve({ data: { assistant_config: { sector } } });
        if (table === 'org_reminder_config') return Promise.resolve({ data: { config: orgConfig } });
        return Promise.resolve({ data: null });
      },
      insert() { return Promise.resolve({ error: null }); },
      then(res) { return Promise.resolve({ data: [], count: 0 }).then(res); },
    };
    return q;
  }
  return { enabled: true, client: { from: chain } };
}

function contacts(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'c' + i, phone: '+3460000' + i, sector_data: {} }));
}

describe('recalculateOrg', () => {
  test('itera toda la cartera', async () => {
    const db = stubDb({ contacts: contacts(5) });
    const r = await recalculateOrg('org1', { db });
    assert.strictEqual(r.total, 5);
    assert.strictEqual(r.processed, 5);
    assert.strictEqual(r.capped, false);
  });

  test('carga la config UNA vez para toda la cartera', async () => {
    let cfgReads = 0;
    const db = stubDb({ contacts: contacts(6), onFrom: (t) => { if (t === 'org_reminder_config') cfgReads++; } });
    await recalculateOrg('org1', { db });
    assert.strictEqual(cfgReads, 1);   // no una por contacto
  });

  test('respeta el tope y lo marca (sin recálculo silencioso)', async () => {
    const db = stubDb({ contacts: contacts(3) });
    const r = await recalculateOrg('org1', { db, limit: 2 });
    assert.strictEqual(r.capped, true);
    assert.strictEqual(r.processed, 2);
  });

  test('sin sector → no hace nada', async () => {
    const db = stubDb({ contacts: contacts(3), sector: null });
    const r = await recalculateOrg('org1', { db });
    assert.strictEqual(r.processed, 0);
  });

  test('sin BD → cero', async () => {
    const r = await recalculateOrg('org1', { db: { enabled: false } });
    assert.strictEqual(r.processed, 0);
  });

  test('org vacío → total 0', async () => {
    const db = stubDb({ contacts: [] });
    const r = await recalculateOrg('org1', { db });
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.processed, 0);
  });
});
