// ============================================================
// NodeFlow — Opt-out de LLAMADAS de voz (no_calls)
// Ejecutar: npm test  (node --test test/)
//
// Compliance/respeto al cliente: un contacto con no_calls=true NO
// debe recibir llamadas de voz salientes, aunque no tenga las otras
// bajas (no_whatsapp/no_email/no_sms). El choke point es contactInfo()
// y la persistencia one-way vive en upsertContactMemory().
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

// ── Mock de BD: query-builder por tabla ─────────────────────────────
// Se instala ANTES de requerir los SUT (que destructuran getDatabase al cargar).
const dbmod = require('../src/db/database');

let CONTACT = { id: 'c1', name: 'Ana' };   // fila de contacts
let MEM = null;                            // fila de contact_memory
const upserts = [];                        // filas escritas via upsert

function qb(table) {
  const chain = {
    select() { return chain; },
    eq()     { return chain; },
    maybeSingle() {
      const data = table === 'contacts' ? CONTACT : table === 'contact_memory' ? MEM : null;
      return Promise.resolve({ data, error: null });
    },
    upsert(row) { upserts.push({ table, row }); return Promise.resolve({ error: null }); },
  };
  return chain;
}
dbmod.getDatabase = () => ({ enabled: true, client: { from: (t) => qb(t) } });

const { contactInfo } = require('../src/campaigns/enqueuers');
const { upsertContactMemory } = require('../src/lifecycle/call-memory');

describe('contactInfo — bloqueo de llamadas de voz', () => {
  test('no_calls=true (sin las otras bajas) → blocked', async () => {
    CONTACT = { id: 'c1', name: 'Ana' };
    MEM = { no_whatsapp: false, no_email: false, no_sms: false, no_calls: true };
    const info = await contactInfo('org1', '+34600111222');
    assert.strictEqual(info.blocked, true, 'no_calls debe bloquear la voz por sí solo');
    assert.strictEqual(info.noCalls, true);
    assert.strictEqual(info.contactId, 'c1');
  });

  test('opt-out SOLO de WhatsApp (sin no_calls) → NO blocked (regresión: seguía llamando)', async () => {
    MEM = { no_whatsapp: true, no_email: false, no_sms: false, no_calls: false };
    const info = await contactInfo('org1', '+34600111222');
    assert.strictEqual(info.blocked, false, 'una baja de WhatsApp no bloquea la voz');
    assert.strictEqual(info.noCalls, false);
  });

  test('do-not-contact TOTAL (las tres bajas) → blocked (semántica intacta)', async () => {
    MEM = { no_whatsapp: true, no_email: true, no_sms: true, no_calls: false };
    const info = await contactInfo('org1', '+34600111222');
    assert.strictEqual(info.blocked, true);
  });

  test('sin memoria de contacto → NO blocked', async () => {
    MEM = null;
    const info = await contactInfo('org1', '+34600111222');
    assert.strictEqual(info.blocked, false);
  });

  test('contacto inexistente → NO blocked, sin id', async () => {
    CONTACT = null;
    const info = await contactInfo('org1', '+34600111222');
    assert.strictEqual(info.blocked, false);
    assert.strictEqual(info.contactId, null);
  });
});

describe('upsertContactMemory — no_calls one-way + escritura condicional', () => {
  test('updates.no_calls=true → se escribe no_calls=true', async () => {
    CONTACT = { id: 'c1' }; MEM = null; upserts.length = 0;
    await upsertContactMemory('c1', 'org1', { no_calls: true });
    const row = upserts.find(u => u.table === 'contact_memory').row;
    assert.strictEqual(row.no_calls, true);
  });

  test('sin no_calls y sin existente → NO se incluye la columna (no rompe si falta la migración)', async () => {
    MEM = null; upserts.length = 0;
    await upsertContactMemory('c1', 'org1', { last_call_summary: 'hola' });
    const row = upserts.find(u => u.table === 'contact_memory').row;
    assert.ok(!('no_calls' in row), 'no debe referenciar la columna cuando no aplica');
  });

  test('existente no_calls=true persiste aunque el update no lo traiga', async () => {
    MEM = { no_calls: true }; upserts.length = 0;
    await upsertContactMemory('c1', 'org1', { last_call_summary: 'hola' });
    const row = upserts.find(u => u.table === 'contact_memory').row;
    assert.strictEqual(row.no_calls, true, 'one-way: no se auto-limpia');
  });
});
