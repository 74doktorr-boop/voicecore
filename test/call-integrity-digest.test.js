// ============================================================
// PILOT-001 (F7) — Vigilancia de integridad de los datos de llamada
// Hasta ahora nadie miraba si una llamada se perdía o quedaba a medias: la
// única señal era un log.warn que no lee nadie. Estas señales entran en el
// digest del fundador para que una pérdida de datos (y de dinero) se vea.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { callIntegrityItems } = require('../src/monitoring/founder-digest');

// Instantes con offset '+00:00' (como los devuelve Supabase, no .toISOString()):
// así el test cubre el bug de comparar fechas como texto (revisión D8).
const hace = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().replace('Z', '+00:00');
const db = (rows) => ({
  enabled: true,
  client: { from: () => ({ select: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }) }) }) },
});
const txt = (items) => items.map(i => i.txt).join(' | ');

describe('callIntegrityItems', () => {
  test('todo sano → ningún aviso (no molesta al fundador)', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'ended', org_id: 'o1', outcome: 'booked', started_at: hace(1), duration_ms: 120000 },
      { id: 'b', status: 'ended', org_id: 'o1', outcome: 'info', started_at: hace(3), duration_ms: 60000 },
    ]));
    assert.deepStrictEqual(items, []);
  });

  test('huérfana (>3h en active) → CRÍTICO', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'active', org_id: 'o1', started_at: hace(5), duration_ms: null },
    ]));
    assert.strictEqual(items[0].sev, 'crit');
    assert.match(txt(items), /colgada/i);
  });

  test('activa de 2h NO alarma: el reaper (90min + tick horario) aún la está limpiando', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'active', org_id: 'o1', started_at: hace(2), duration_ms: null },
    ]));
    assert.deepStrictEqual(items, [], 'no despertar al fundador por algo que se arregla solo');
  });

  test('una llamada activa RECIENTE no alarma (está en curso ahora)', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'active', org_id: 'o1', started_at: hace(0.2), duration_ms: null },
    ]));
    assert.deepStrictEqual(items, []);
  });

  test('status LOST → CRÍTICO (la prueba de que un deploy se llevó llamadas)', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'lost', org_id: 'o1', outcome: null, started_at: hace(2), duration_ms: null },
    ]));
    assert.strictEqual(items[0].sev, 'crit');
    assert.match(txt(items), /PERDIDAS/);
  });

  test('terminada sin org_id → CRÍTICO (invisible en el panel del cliente)', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'ended', org_id: null, outcome: 'booked', started_at: hace(1), duration_ms: 90000 },
    ]));
    assert.match(txt(items), /sin negocio asignado/i);
  });

  test('activa reciente SIN org_id no alarma (demo/Llámame/saliente: números fuera del pool)', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'active', org_id: null, outcome: null, started_at: hace(0.1), duration_ms: null },
    ]));
    assert.deepStrictEqual(items, [], 'una llamada sana en curso no es una alarma crítica');
  });

  test('ended sin outcome → aviso de cierre a medias', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'ended', org_id: 'o1', outcome: null, started_at: hace(1), duration_ms: 90000 },
    ]));
    assert.match(txt(items), /sin resultado/i);
  });

  test('duración imposible (>1h o negativa) → aviso', async () => {
    const items = await callIntegrityItems(db([
      { id: 'a', status: 'ended', org_id: 'o1', outcome: 'info', started_at: hace(1), duration_ms: 119340000 }, // el "1989 minutos"
      { id: 'b', status: 'ended', org_id: 'o1', outcome: 'info', started_at: hace(2), duration_ms: -5 },
    ]));
    assert.match(txt(items), /duración imposible/i);
    assert.match(items.find(i => /imposible/i.test(i.txt)).txt, /^2 /);
  });

  test('sin llamadas en 24h → sin avisos (no inventa alarmas)', async () => {
    assert.deepStrictEqual(await callIntegrityItems(db([])), []);
  });
});
