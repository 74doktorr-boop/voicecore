// ============================================================
// NodeFlow — Paquete de mensajes (2026-07-07)
// 200 incluidos/mes + 0,10€/mensaje extra. El delta se reporta a
// Stripe UNA vez (marcador mensual); sin meter configurado no se cobra.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { usageSummary, reportOverageForOrg, monthStartISO } = require('../src/billing/message-usage');

// El mes se calcula donde lo calcula el CÓDIGO: en Madrid.
//
// Estos tests construían el marcador con `new Date().toISOString().slice(0,7)`,
// que es UTC, mientras message-usage.js usa Europe/Madrid. Coinciden 363 días
// al año, así que el fallo esperó al 1 de agosto a la 01:00 —cuando en Madrid
// ya es agosto y en UTC sigue siendo julio— para aparecer de golpe, en dos
// tests de FACTURACIÓN y sin que nadie hubiera tocado nada.
//
// Con los meses descuadrados, el marcador de «ya reportado» no se reconoce y
// el test ve cobrar el excedente entero (30) en vez del delta (20). El código
// está bien: lo que medía en otra zona horaria era el test. Es la segunda vez
// en dos días que aparece esta familia de bug en este repo (la primera fue el
// informe semanal), y por eso va como helper con nombre y no como una línea
// más: para que la próxima se escriba bien de entrada.
const mesMadrid = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()).slice(0, 7);

afterEach(() => { delete process.env.STRIPE_MSG_METER_EVENT; });

function stubDb({ sentCount = 0, config = null, claimWins = true } = {}) {
  const updates = [], inserts = [];
  return {
    enabled: true, _updates: updates, _inserts: inserts,
    client: {
      from(table) {
        const q = {
          // select() es a la vez arranque de lectura y finalizador del update
          // condicional (.update(...).eq().filter().select('org_id')).
          select(cols, opts) {
            if (q._update) {
              return Promise.resolve({ data: claimWins ? [{ org_id: 'org1' }] : [], error: null });
            }
            q._head = opts && opts.head; return q;
          },
          update(row) { q._update = row; updates.push(row); return q; },
          insert(row) { inserts.push(row); return Promise.resolve({ error: claimWins ? null : { message: 'duplicate key' } }); },
          filter() { return q; },
          or() { return q; },
          eq() { return q; },
          gte() { return Promise.resolve({ count: sentCount }); },
          maybeSingle() { return Promise.resolve({ data: config ? { config } : null }); },
        };
        return q;
      },
    },
  };
}

describe('usageSummary', () => {
  test('dentro del paquete → sin excedente', async () => {
    const u = await usageSummary('org1', { db: stubDb({ sentCount: 143 }) });
    assert.strictEqual(u.used, 143);
    assert.strictEqual(u.included, 200);
    assert.strictEqual(u.overage, 0);
    assert.strictEqual(u.overageEur, 0);
  });
  test('pasado el paquete → excedente a 0,10€', async () => {
    const u = await usageSummary('org1', { db: stubDb({ sentCount: 223 }) });
    assert.strictEqual(u.overage, 23);
    assert.strictEqual(u.overageEur, 2.3);
  });
  test('monthStartISO devuelve un instante del mes en curso', () => {
    const iso = monthStartISO(new Date('2026-07-15T10:00:00Z'));
    assert.match(iso, /^2026-0?6-30T22:00|^2026-07-01T/);
  });
});

describe('reportOverageForOrg', () => {
  const ORG = { id: 'org1', stripe_customer_id: 'cus_123' };

  test('sin STRIPE_MSG_METER_EVENT → no reporta (solo contador)', async () => {
    let called = false;
    const r = await reportOverageForOrg(ORG, { db: stubDb({ sentCount: 500 }), billing: { reportUsage: async () => { called = true; } } });
    assert.strictEqual(r.reported, 0);
    assert.strictEqual(called, false);
  });

  test('reporta el DELTA y guarda el marcador (no cobra dos veces)', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    const db = stubDb({ sentCount: 230, config: { _msgOverage: { month: mesMadrid(), reported: 10 } } });
    let sent = null;
    const r = await reportOverageForOrg(ORG, { db, billing: { reportUsage: async (p) => { sent = p; } } });
    assert.strictEqual(r.reported, 20);                    // 30 de excedente - 10 ya reportados
    assert.strictEqual(sent.minutes, 20);
    assert.strictEqual(sent.eventName, 'mensajes_extra');
    assert.strictEqual(db._updates[0].config._msgOverage.reported, 30);
  });

  test('sin excedente → nada', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    const r = await reportOverageForOrg(ORG, { db: stubDb({ sentCount: 50 }), billing: { reportUsage: async () => { throw new Error('no debería'); } } });
    assert.strictEqual(r.reported, 0);
  });

  // Auditoría 2026-07-07: el RECLAMO va antes que Stripe. Si otra instancia
  // gana la carrera, esta NO reporta — imposible cobrar el mismo delta dos veces.
  test('carrera: si otra instancia reclama primero, NO se toca Stripe', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    let called = false;
    const db = stubDb({ sentCount: 230, claimWins: false, config: { _msgOverage: { month: mesMadrid(), reported: 10 } } });
    const r = await reportOverageForOrg(ORG, { db, billing: { reportUsage: async () => { called = true; } } });
    assert.strictEqual(r.reported, 0);
    assert.strictEqual(called, false, 'Stripe no debe recibir el delta perdido');
  });

  test('sin fila de config: el insert que choca por PK tampoco reporta', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    let called = false;
    const db = stubDb({ sentCount: 230, claimWins: false, config: null });
    const r = await reportOverageForOrg(ORG, { db, billing: { reportUsage: async () => { called = true; } } });
    assert.strictEqual(r.reported, 0);
    assert.strictEqual(called, false);
    assert.strictEqual(db._inserts.length, 1, 'intentó reclamar por insert');
  });

  test('si Stripe falla tras reclamar, el marcador se devuelve (reintento mañana)', async () => {
    process.env.STRIPE_MSG_METER_EVENT = 'mensajes_extra';
    const month = mesMadrid();
    const db = stubDb({ sentCount: 230, config: { _msgOverage: { month, reported: 10 } } });
    const r = await reportOverageForOrg(ORG, { db, billing: { reportUsage: async () => { throw new Error('stripe caído'); } } });
    assert.strictEqual(r.reported, 0);
    // 1er update = reclamo (30), 2º update = reversión (10)
    assert.strictEqual(db._updates.length, 2);
    assert.strictEqual(db._updates[1].config._msgOverage.reported, 10);
  });
});
