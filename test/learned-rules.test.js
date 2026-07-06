// ============================================================
// NodeFlow — Reglas aprendidas: aprobar → aplicar (2026-07-06)
// Cierra el bucle de mejora sin auto-mutación: candidatas persistidas,
// dedup, aprobar/rechazar, e inyección de las ACTIVAS en el prompt.
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const LR = require('../src/lifecycle/learned-rules');

// ── Mock mínimo del cliente Supabase (in-memory) ──
function makeDb(initial) {
  const store = (initial || []).map((r, i) => ({ id: r.id || ('r' + (i + 1)), ...r }));
  let seq = store.length;
  const match = (filters) => (row) => filters.every(([k, v]) => row[k] === v);
  function builder() {
    const filters = [];
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; },
      eq(k, v) { filters.push([k, v]); return api; },
      maybeSingle() { return Promise.resolve({ data: store.find(match(filters)) || null, error: null }); },
      insert(p) { const row = { id: 'r' + (++seq), ...p }; store.push(row); return Promise.resolve({ data: row, error: null }); },
      update(p) { return { eq(k, v) { store.filter((x) => x[k] === v).forEach((x) => Object.assign(x, p)); return Promise.resolve({ error: null }); } }; },
      then(res, rej) { return Promise.resolve({ data: store.filter(match(filters)), error: null }).then(res, rej); },
    };
    return api;
  }
  return { enabled: true, client: { from() { return builder(); } }, _store: store };
}

beforeEach(() => LR._invalidate());

describe('ruleKey', () => {
  test('normaliza acentos, mayúsculas y puntuación → dedup', () => {
    assert.strictEqual(LR.ruleKey('Evitar repetir preguntas.'), LR.ruleKey('evitar  REPETIR preguntas'));
    assert.strictEqual(LR.ruleKey('Confírmalo'), 'confirmalo');
  });
  test('texto vacío → clave vacía', () => {
    assert.strictEqual(LR.ruleKey(''), '');
    assert.strictEqual(LR.ruleKey(null), '');
  });
});

describe('upsertCandidates', () => {
  test('inserta candidatas nuevas', async () => {
    const db = makeDb([]);
    const n = await LR.upsertCandidates('dental', [{ rule: 'No repetir preguntas', count: 6 }, { rule: 'Confirmar registro', count: 2, recurrent: true }], { db });
    assert.strictEqual(n, 2);
    assert.strictEqual(db._store.length, 2);
    assert.strictEqual(db._store[0].status, 'candidate');
  });
  test('dedup: la misma regla no se duplica (refresca contador)', async () => {
    const db = makeDb([{ sector: 'dental', rule_key: LR.ruleKey('No repetir preguntas'), text: 'No repetir preguntas', status: 'candidate', count: 3 }]);
    const n = await LR.upsertCandidates('dental', [{ rule: 'no repetir PREGUNTAS.', count: 7 }], { db });
    assert.strictEqual(n, 0, 'no añade duplicado');
    assert.strictEqual(db._store.length, 1);
    assert.strictEqual(db._store[0].count, 7, 'refresca el contador');
  });
  test('NO resucita una regla ya rechazada/activa', async () => {
    const db = makeDb([{ sector: 'dental', rule_key: LR.ruleKey('Idea mala'), text: 'Idea mala', status: 'rejected' }]);
    const n = await LR.upsertCandidates('dental', [{ rule: 'Idea mala' }], { db });
    assert.strictEqual(n, 0);
    assert.strictEqual(db._store[0].status, 'rejected');
  });
  test('sin BD → 0, no rompe', async () => {
    const n = await LR.upsertCandidates('dental', [{ rule: 'x' }], { db: { enabled: false } });
    assert.strictEqual(n, 0);
  });
});

describe('setStatus + activeRulesBlock', () => {
  test('aprobar pone active + approved_at', async () => {
    const db = makeDb([{ id: 'x1', sector: 'dental', rule_key: 'k', text: 'Regla X', status: 'candidate' }]);
    const r = await LR.setStatus('x1', 'active', { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(db._store[0].status, 'active');
    assert.ok(db._store[0].approved_at);
  });
  test('estado inválido → error', async () => {
    const db = makeDb([]);
    const r = await LR.setStatus('x', 'loquesea', { db });
    assert.strictEqual(r.ok, false);
  });
  test('activeRulesBlock inyecta global + sector (no otros sectores)', async () => {
    const db = makeDb([
      { sector: 'global', text: 'Sé siempre concisa', status: 'active' },
      { sector: 'dental', text: 'Pregunta si es primera visita', status: 'active' },
      { sector: 'restaurante', text: 'Pregunta comensales', status: 'active' },
      { sector: 'dental', text: 'Candidata no activa', status: 'candidate' },
    ]);
    LR._invalidate();
    const block = await LR.activeRulesBlock('dental', { db });
    assert.match(block, /MEJORAS APRENDIDAS/);
    assert.match(block, /Sé siempre concisa/);           // global
    assert.match(block, /Pregunta si es primera visita/); // sector
    assert.ok(!/comensales/.test(block), 'no incluye otro sector');
    assert.ok(!/Candidata no activa/.test(block), 'no incluye candidatas');
  });
  test('sin reglas activas → bloque vacío', async () => {
    const db = makeDb([]);
    LR._invalidate();
    assert.strictEqual(await LR.activeRulesBlock('dental', { db }), '');
  });
});
