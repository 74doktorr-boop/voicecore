// ============================================================
// NodeFlow — Promociones por WhatsApp (2026-07-07)
// El dueño escribe una promo → llega a sus clientes elegibles.
// Los opt-outs son sagrados; cada envío queda en el ledger.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getRecipients, sendPromo } = require('../src/notifications/promo-broadcast');

function stubDb({ contacts = [], memory = [] } = {}) {
  const ledger = [];
  return {
    enabled: true, _ledger: ledger,
    client: {
      from(table) {
        const q = {
          select() { return q; }, eq() { return q; }, is() { return q; }, not() { return q; },
          in(col, vals) {
            if (table === 'contact_memory') return Promise.resolve({ data: memory.filter(m => vals.includes(m.contact_id)) });
            return q;
          },
          limit() { return Promise.resolve({ data: contacts }); },
          insert(row) { ledger.push(row); return { then(res) { return Promise.resolve({ error: null }).then(res); } }; },
        };
        return q;
      },
    },
  };
}

const CONTACTS = [
  { id: 'c1', name: 'María López', phone: '+34600111222', tags: ['vip'] },
  { id: 'c2', name: 'Aitor', phone: '+34600333444', tags: [] },
  { id: 'c3', name: 'Baja', phone: '+34600555666', tags: ['vip'] },
  { id: 'c4', name: 'Sin tel', phone: null, tags: [] },
];

describe('getRecipients', () => {
  test('excluye sin teléfono y a los opt-out (no_whatsapp)', async () => {
    const db = stubDb({ contacts: CONTACTS, memory: [{ contact_id: 'c3', no_whatsapp: true }] });
    const r = await getRecipients('org1', { db });
    assert.deepStrictEqual(r.map(c => c.id), ['c1', 'c2']);
  });
  test('filtro por etiqueta', async () => {
    const db = stubDb({ contacts: CONTACTS, memory: [{ contact_id: 'c3', no_whatsapp: true }] });
    const r = await getRecipients('org1', { db, tag: 'VIP' });
    assert.deepStrictEqual(r.map(c => c.id), ['c1']);   // c3 es vip pero opt-out
  });
});

describe('sendPromo', () => {
  test('envía con nombre de pila + negocio + texto, y registra en el ledger', async () => {
    const db = stubDb({ contacts: CONTACTS.slice(0, 2) });
    const sends = [];
    const out = await sendPromo('org1', { text: 'Este mes 15% de descuento en tintes.', bizName: 'Peluquería Ainhoa' }, {
      db, throttleMs: 0,
      sendTemplate: async (phone, name, lang, comps) => { sends.push({ phone, params: comps[0].parameters.map(p => p.text) }); return { ok: true }; },
    });
    assert.strictEqual(out.sent, 2);
    assert.deepStrictEqual(sends[0].params, ['María', 'Peluquería Ainhoa', 'Este mes 15% de descuento en tintes.']);
    assert.strictEqual(db._ledger.length, 2);
    assert.strictEqual(db._ledger[0].service_key, 'promo');
    assert.strictEqual(db._ledger[0].status, 'sent');
  });

  test('plantilla no aprobada → aborta al primer fallo con mensaje claro', async () => {
    const db = stubDb({ contacts: CONTACTS.slice(0, 2) });
    let calls = 0;
    const out = await sendPromo('org1', { text: 'Texto de promo suficientemente largo.' }, {
      db, throttleMs: 0,
      sendTemplate: async () => { calls++; return { ok: false, error: 'Template name does not exist in the translation' }; },
    });
    assert.strictEqual(calls, 1, 'no quema el bucle entero');
    assert.match(out.aborted, /revisión de Meta/);
    assert.strictEqual(db._ledger.length, 0);
  });

  test('texto demasiado corto → aborta sin enviar', async () => {
    const out = await sendPromo('org1', { text: 'hola' }, { db: stubDb({ contacts: CONTACTS }), throttleMs: 0, sendTemplate: async () => ({ ok: true }) });
    assert.match(out.aborted, /corto/);
    assert.strictEqual(out.sent, 0);
  });
});
