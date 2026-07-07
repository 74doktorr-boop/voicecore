// ============================================================
// NodeFlow — Hueco libre → oferta automática a lista de espera
// (2026-07-07, oportunidad 4). Al cancelarse una cita se ofrece el
// hueco al primer candidato que encaje; su respuesta cierra el lazo.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { offerFreedSlot, serviceMatches } = require('../src/lifecycle/waitlist-offer');
const { waitlistReplyKind, handleWaitlistResponse } = require('../src/whatsapp/reply-handler');

afterEach(() => { delete process.env.WA_WAITLIST_AUTOOFFER; });

describe('serviceMatches', () => {
  test('sin servicio en alguno → encaja', () => {
    assert.strictEqual(serviceMatches('', 'Fisioterapia'), true);
    assert.strictEqual(serviceMatches('Corte', ''), true);
  });
  test('coincidencia por inclusión / token', () => {
    assert.strictEqual(serviceMatches('fisioterapia deportiva', 'Fisioterapia'), true);
    assert.strictEqual(serviceMatches('Corte de pelo', 'corte'), true);
  });
  test('servicios distintos → no encaja', () => {
    assert.strictEqual(serviceMatches('Manicura', 'Fisioterapia'), false);
  });
});

describe('offerFreedSlot', () => {
  function fakeDb({ candidates = [], claimWins = true }) {
    const updates = [];
    return {
      _updates: updates,
      enabled: true,
      client: {
        from(table) {
          const q = {
            _table: table, _isUpdate: false,
            select() {
              if (q._isUpdate) return Promise.resolve({ data: claimWins ? [{ id: 'w1' }] : [] });
              return q;
            },
            update(row) { q._isUpdate = true; updates.push({ table, row }); return q; },
            insert() { return Promise.resolve({ error: null }); },
            eq() { return q; },
            in() { return q; },
            order() { return q; },
            limit() { return Promise.resolve({ data: candidates }); },
          };
          return q;
        },
      },
    };
  }
  const SLOT = { businessId: 'org-1', date: '2026-07-10', time: '17:00', service: 'Fisioterapia', humanDate: 'jueves 10 de julio', bizName: 'Clínica Osakin' };

  test('sin la env → no-op', async () => {
    const r = await offerFreedSlot(SLOT, { db: fakeDb({ candidates: [{ id: 'w1', phone: '34600', service: 'Fisioterapia' }] }), sendTemplate: async () => ({ ok: true }) });
    assert.strictEqual(r.offered, false);
    assert.strictEqual(r.reason, 'disabled');
  });

  test('ofrece al primer candidato que encaja y avisa al dueño', async () => {
    process.env.WA_WAITLIST_AUTOOFFER = '1';
    const sent = [], ownerMsgs = [];
    const db = fakeDb({ candidates: [
      { id: 'w1', name: 'Ana', phone: '34600111222', service: 'Manicura' },   // no encaja
      { id: 'w2', name: 'Beñat', phone: '34600333444', service: 'Fisioterapia' }, // encaja
    ] });
    const r = await offerFreedSlot(SLOT, {
      db,
      sendTemplate: async (phone, tpl, lang, comps) => { sent.push({ phone, tpl, comps }); return { ok: true }; },
      notifyOwner: async (m) => { ownerMsgs.push(m); },
    });
    assert.strictEqual(r.offered, true);
    assert.strictEqual(r.to, '34600333444');
    assert.strictEqual(sent[0].tpl, 'nodeflow_hueco_libre');
    assert.strictEqual(sent[0].comps[0].parameters[0].text, 'Beñat');
    assert.match(ownerMsgs[0], /ofrecido/i);
    // marcó contacted
    assert.ok(db._updates.some(u => u.row.status === 'contacted'));
  });

  test('nadie encaja → no ofrece', async () => {
    process.env.WA_WAITLIST_AUTOOFFER = '1';
    const r = await offerFreedSlot(SLOT, {
      db: fakeDb({ candidates: [{ id: 'w1', name: 'Ana', phone: '34600', service: 'Manicura' }] }),
      sendTemplate: async () => ({ ok: true }),
    });
    assert.strictEqual(r.offered, false);
    assert.strictEqual(r.reason, 'no_match');
  });

  test('si el claim lo gana otra cancelación → no envía', async () => {
    process.env.WA_WAITLIST_AUTOOFFER = '1';
    let sends = 0;
    const r = await offerFreedSlot(SLOT, {
      db: fakeDb({ candidates: [{ id: 'w1', name: 'Ana', phone: '34600', service: 'Fisioterapia' }], claimWins: false }),
      sendTemplate: async () => { sends++; return { ok: true }; },
    });
    assert.strictEqual(r.offered, false);
    assert.strictEqual(r.reason, 'claim_lost');
    assert.strictEqual(sends, 0);
  });
});

describe('waitlistReplyKind', () => {
  test('acepta', () => {
    assert.strictEqual(waitlistReplyKind('Lo quiero'), 'accept');
    assert.strictEqual(waitlistReplyKind('sí, lo quiero'), 'accept');
    assert.strictEqual(waitlistReplyKind('me interesa'), 'accept');
  });
  test('rechaza', () => {
    assert.strictEqual(waitlistReplyKind('Ahora no'), 'decline');
    assert.strictEqual(waitlistReplyKind('no puedo'), 'decline');
  });
  test('ambiguo → null', () => {
    assert.strictEqual(waitlistReplyKind('¿a qué hora?'), null);
  });

  // Revisión 2026-07-07: "no me interesa" contiene "me interesa" — antes se
  // clasificaba como ACEPTAR. El rechazo debe ganar.
  test('negaciones NO se cuelan como aceptación', () => {
    assert.strictEqual(waitlistReplyKind('no me interesa'), 'decline');
    assert.strictEqual(waitlistReplyKind('no lo quiero'), 'decline');
    assert.strictEqual(waitlistReplyKind('uf, ahora no puedo'), 'decline');
    assert.strictEqual(waitlistReplyKind('no me viene bien'), 'decline');
  });
  test('afirmaciones siguen funcionando', () => {
    assert.strictEqual(waitlistReplyKind('sí, me interesa'), 'accept');
    assert.strictEqual(waitlistReplyKind('lo quiero!'), 'accept');
    assert.strictEqual(waitlistReplyKind('perfecto, adelante'), 'accept');
  });
});

describe('handleWaitlistResponse', () => {
  function fakeDb({ entry }) {
    const updates = [];
    // Cadena que soporta .update(row).eq().eq().then() y .select().eq()...limit()
    function chain(onUpdate) {
      const c = {
        select() { return c; },
        update(row) { updates.push(row); return c; },
        eq() { return c; },
        in() { return c; },
        order() { return c; },
        limit() { return Promise.resolve({ data: entry ? [entry] : [] }); },
        then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); },
      };
      return c;
    }
    return {
      _updates: updates, enabled: true,
      client: { from() { return chain(); } },
    };
  }

  test('sin oferta pendiente → no gestiona', async () => {
    const r = await handleWaitlistResponse({ from: '34600', businessId: 'org-1', payload: 'Lo quiero' },
      { db: fakeDb({ entry: null }), sendText: async () => ({ ok: true }) });
    assert.strictEqual(r, false);
  });

  test('acepta → marca booked + avisa al dueño + acusa al cliente', async () => {
    const sent = [];
    const db = fakeDb({ entry: { id: 'w1', name: 'Ana', phone: '34600', service: 'Fisio', status: 'contacted' } });
    const r = await handleWaitlistResponse({ from: '34600', businessId: 'org-1', payload: 'Lo quiero' },
      { db, sendText: async (to, msg) => { sent.push({ to, msg }); return { ok: true }; }, ownerPhone: '34666' });
    assert.strictEqual(r, true);
    assert.ok(db._updates.some(u => u.status === 'booked'));
    assert.match(sent[0].msg, /hueco/i);   // al dueño
    assert.match(sent[1].msg, /Ana|Genial/); // al cliente
  });

  test('rechaza → vuelve a waiting', async () => {
    const db = fakeDb({ entry: { id: 'w1', name: 'Ana', phone: '34600', status: 'contacted' } });
    const r = await handleWaitlistResponse({ from: '34600', businessId: 'org-1', payload: 'Ahora no' },
      { db, sendText: async () => ({ ok: true }), ownerPhone: '34666' });
    assert.strictEqual(r, true);
    assert.ok(db._updates.some(u => u.status === 'waiting'));
  });
});
