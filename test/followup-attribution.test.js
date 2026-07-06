// ============================================================
// NodeFlow — Atribución del motor de seguimientos (2026-07-06)
// "El motor te trajo N citas (~X€)": cita del mismo teléfono creada
// en los 14 días siguientes a un envío. Determinista y conservador.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { matchAttribution, summarize, getAttribution } = require('../src/lifecycle/followup-attribution');

describe('matchAttribution (pura)', () => {
  test('atribuye una cita creada tras el envío, mismo teléfono', () => {
    const out = matchAttribution(
      [{ phone: '+34600111222', at: '2026-07-01T10:00:00Z', source: 'auto' }],
      [{ phone: '600111222', created_at: '2026-07-03T09:00:00Z', date: '2026-07-10', service: 'corte', price: '25', status: 'confirmed' }],
    );
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, 'auto');
    assert.strictEqual(out[0].price, 25);
    assert.strictEqual(out[0].lagDays, 2);
  });

  test('normaliza formatos de teléfono distintos (+34 / nacional / espacios)', () => {
    const out = matchAttribution(
      [{ phone: '600 11 12 22', at: '2026-07-01T10:00:00Z', source: 'personal' }],
      [{ phone: '+34600111222', created_at: '2026-07-02T09:00:00Z', status: 'pending' }],
    );
    assert.strictEqual(out.length, 1);
  });

  test('NO atribuye fuera de la ventana de 14 días', () => {
    const out = matchAttribution(
      [{ phone: '600111222', at: '2026-06-01T10:00:00Z', source: 'auto' }],
      [{ phone: '600111222', created_at: '2026-07-01T09:00:00Z', status: 'confirmed' }],
    );
    assert.strictEqual(out.length, 0);
  });

  test('NO atribuye citas creadas ANTES del envío', () => {
    const out = matchAttribution(
      [{ phone: '600111222', at: '2026-07-05T10:00:00Z', source: 'auto' }],
      [{ phone: '600111222', created_at: '2026-07-03T09:00:00Z', status: 'confirmed' }],
    );
    assert.strictEqual(out.length, 0);
  });

  test('ignora citas canceladas y teléfonos sin envío', () => {
    const out = matchAttribution(
      [{ phone: '600111222', at: '2026-07-01T10:00:00Z', source: 'auto' }],
      [
        { phone: '600111222', created_at: '2026-07-02T09:00:00Z', status: 'cancelled' },
        { phone: '699999999', created_at: '2026-07-02T09:00:00Z', status: 'confirmed' },
      ],
    );
    assert.strictEqual(out.length, 0);
  });

  test('cada cita se atribuye al envío más reciente que la precede', () => {
    const out = matchAttribution(
      [
        { phone: '600111222', at: '2026-07-01T10:00:00Z', source: 'auto' },
        { phone: '600111222', at: '2026-07-04T10:00:00Z', source: 'personal' },
      ],
      [{ phone: '600111222', created_at: '2026-07-05T09:00:00Z', status: 'confirmed' }],
    );
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].source, 'personal');   // el de día 4, no el de día 1
  });
});

describe('summarize', () => {
  test('usa el precio real y cae al ticket medio si es 0', () => {
    const t = summarize(
      [{ price: 25, source: 'auto' }, { price: 0, source: 'personal' }],
      { avgTicket: 35 },
    );
    assert.strictEqual(t.count, 2);
    assert.strictEqual(t.value, 60);
    assert.strictEqual(t.auto, 1);
    assert.strictEqual(t.personal, 1);
  });
});

// ── Stub Supabase por tabla ─────────────────────────────────
function stubDb({ reminders = [], calls = [], appointments = [] } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const data = table === 'scheduled_reminders' ? reminders
                   : table === 'nf_calls' ? calls
                   : appointments;
        const q = {
          select() { return q; }, eq() { return q; }, gte() { return q; },
          limit() { return Promise.resolve({ data }); },
        };
        return q;
      },
    },
  };
}

describe('getAttribution', () => {
  test('combina envíos automáticos y personales; descartados no cuentan', async () => {
    const db = stubDb({
      reminders: [{ sent_at: '2026-07-01T10:00:00Z', contacts: { phone: '600111222' } }],
      calls: [
        { caller_number: '600333444', metrics: { followup: { done: true, at: '2026-07-01T10:00:00Z', channel: 'wa_link' } } },
        { caller_number: '600555666', metrics: { followup: { done: true, at: '2026-07-01T10:00:00Z', channel: 'dismissed' } } },
      ],
      appointments: [
        { phone: '600111222', created_at: '2026-07-02T09:00:00Z', price: '20', status: 'confirmed' },
        { phone: '600333444', created_at: '2026-07-03T09:00:00Z', price: '0', status: 'pending' },
        { phone: '600555666', created_at: '2026-07-03T09:00:00Z', price: '50', status: 'confirmed' },
      ],
    });
    const r = await getAttribution('org1', { db, avgTicket: 30 });
    assert.strictEqual(r.totals.count, 2);           // la del descartado NO
    assert.strictEqual(r.totals.auto, 1);
    assert.strictEqual(r.totals.personal, 1);
    assert.strictEqual(r.totals.value, 50);          // 20 real + 30 ticket medio
    assert.strictEqual(r.sentCount, 2);              // el descartado tampoco cuenta como envío
  });

  test('sin BD → vacío estable', async () => {
    const r = await getAttribution('org1', { db: { enabled: false } });
    assert.strictEqual(r.totals.count, 0);
    assert.deepStrictEqual(r.bookings, []);
  });
});
