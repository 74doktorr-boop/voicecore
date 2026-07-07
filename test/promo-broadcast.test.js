// ============================================================
// NodeFlow — Promociones por WhatsApp (2026-07-07)
// El dueño escribe una promo → llega a sus clientes elegibles.
// Los opt-outs son sagrados; cada envío queda en el ledger.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getRecipients, sendPromo } = require('../src/notifications/promo-broadcast');

function stubDb({ contacts = [], memory = [], appointments = [] } = {}) {
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
          limit() {
            if (table === 'nf_appointments') return Promise.resolve({ data: appointments });
            return Promise.resolve({ data: contacts });
          },
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

describe('getRecipients — segmentos (2026-07-07)', () => {
  const NOW = new Date('2026-07-07T12:00:00Z');
  const SEG_CONTACTS = [
    { id: 'a', name: 'Ana', phone: '+34600000001', tags: [], sector_data: { fecha_cumpleanos: '1990-07-20' } },
    { id: 'b', name: 'Beñat', phone: '+34600000002', tags: [], sector_data: { fecha_cumpleanos: '1985-03-10' } },
    { id: 'c', name: 'Carla', phone: '+34600000003', tags: [], sector_data: {} },
  ];
  const APTS = [
    { phone: '+34600000001', service: 'Tinte y corte', date: '2026-06-01', status: 'completed' }, // Ana, reciente
    { phone: '+34600000002', service: 'Fisioterapia', date: '2025-01-01', status: 'completed' },  // Beñat, dormido
    { phone: '+34600000003', service: 'Manicura', date: '2026-06-20', status: 'completed' },       // Carla, reciente
  ];

  test('cumpleaños este mes (julio) → solo Ana', async () => {
    const db = stubDb({ contacts: SEG_CONTACTS });
    const r = await getRecipients('org1', { db, birthdayMonth: true, now: NOW });
    assert.deepStrictEqual(r.map(c => c.id), ['a']);
  });

  test('servicio consumido "tinte" → solo Ana', async () => {
    const db = stubDb({ contacts: SEG_CONTACTS, appointments: APTS });
    const r = await getRecipients('org1', { db, service: 'tinte', now: NOW });
    assert.deepStrictEqual(r.map(c => c.id), ['a']);
  });

  test('dormidos +180 días → solo Beñat (última cita 2025)', async () => {
    const db = stubDb({ contacts: SEG_CONTACTS, appointments: APTS });
    const r = await getRecipients('org1', { db, inactiveDays: 180, now: NOW });
    assert.deepStrictEqual(r.map(c => c.id), ['b']);
  });

  test('filtros combinados en AND (cumpleaños + servicio) → vacío si no casan', async () => {
    const db = stubDb({ contacts: SEG_CONTACTS, appointments: APTS });
    // Beñat cumple en marzo, no en julio → el AND lo excluye aunque hizo fisio
    const r = await getRecipients('org1', { db, birthdayMonth: true, service: 'fisio', now: NOW });
    assert.deepStrictEqual(r.map(c => c.id), []);
  });

  test('opt-out se respeta también con segmentos', async () => {
    const db = stubDb({ contacts: SEG_CONTACTS, appointments: APTS, memory: [{ contact_id: 'a', no_whatsapp: true }] });
    const r = await getRecipients('org1', { db, service: 'tinte', now: NOW });
    assert.deepStrictEqual(r.map(c => c.id), []); // Ana casaba pero es opt-out
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
