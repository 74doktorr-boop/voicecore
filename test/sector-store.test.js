// ============================================================
// NodeFlow — Persistencia de sectores custom (2026-07-04)
// Guarda/carga verticales aprobados en caliente. FAIL-OPEN: sin tabla,
// el sistema sigue con la semilla.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { hydrateFromDb, saveSector, loadCustomSectors } = require('../src/sectors/sector-store');
const { resolveSector, hydrate } = require('../src/sectors/sector-registry');

function fakeDb({ rows = [], failSelect = false, failUpsert = false } = {}) {
  const saved = {};
  return {
    _saved: saved,
    enabled: true,
    client: {
      from: () => ({
        select: () => ({ eq: async () => failSelect ? { data: null, error: { message: 'no existe la tabla' } } : { data: rows, error: null } }),
        upsert: (row) => { saved.row = row; return Promise.resolve(failUpsert ? { error: { message: 'no existe la tabla' } } : { error: null }); },
      }),
    },
  };
}

const VALID = {
  label: 'Cerrajería', aliases: ['cerrajero'],
  norms: ['Pregunta si es una urgencia (alguien atrapado) y la dirección.'],
  metricChecks: [{ key: 'urgencia', label: '¿Detectó urgencia?' }],
};

describe('saveSector', () => {
  test('sector válido → en caché EN CALIENTE + persistido', async () => {
    const db = fakeDb();
    const out = await saveSector(db, VALID);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.persisted, true);
    assert.strictEqual(resolveSector('cerrajeria').slug, 'cerrajeria'); // resoluble ya
    assert.strictEqual(db._saved.row.slug, 'cerrajeria');
    hydrate([]); // limpieza
  });

  test('fail-open: si la BD falla al persistir, queda en caché (ok, persisted:false)', async () => {
    const db = fakeDb({ failUpsert: true });
    const out = await saveSector(db, VALID);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.persisted, false);
    assert.ok(out.warning);
    assert.strictEqual(resolveSector('cerrajero').slug, 'cerrajeria');
    hydrate([]);
  });

  test('def inválida → ok:false, no toca nada', async () => {
    const out = await saveSector(fakeDb(), { label: 'X', norms: [], metricChecks: [] });
    assert.strictEqual(out.ok, false);
  });
});

describe('hydrateFromDb / loadCustomSectors', () => {
  test('carga las defs de BD en el registro', async () => {
    const rows = [{ definition: { slug: 'tatuador', label: 'Estudio de tatuaje', norms: ['Pregunta zona y tamaño.'], metricChecks: [{ key: 'zona', label: '¿Capturó la zona?' }] } }];
    const n = await hydrateFromDb(fakeDb({ rows }));
    assert.strictEqual(n, 1);
    assert.strictEqual(resolveSector('tatuador').slug, 'tatuador');
    hydrate([]); // limpieza
    assert.strictEqual(resolveSector('tatuador').slug, 'generico');
  });

  test('FAIL-OPEN: tabla ausente/error → [] (usa solo la semilla)', async () => {
    assert.deepStrictEqual(await loadCustomSectors(fakeDb({ failSelect: true })), []);
    assert.deepStrictEqual(await loadCustomSectors({ enabled: false }), []);
  });
});

describe('saveDraft — cola de revisión (guardas puras)', () => {
  const { saveDraft } = require('../src/sectors/sector-store');
  const VALID_NEW = { label: 'Apicultura', norms: ['Pregunta qué producto y cantidad.'], metricChecks: [{ key: 'producto', label: '¿Capturó el producto?' }] };
  test('def inválida → ok:false', async () => {
    assert.strictEqual((await saveDraft({ enabled: false }, { label: 'X', norms: [], metricChecks: [] })).ok, false);
  });
  test('slug que YA existe (semilla) → already:true, no crea pendiente', async () => {
    const out = await saveDraft({ enabled: false }, { label: 'dental', norms: ['x'], metricChecks: [{ key: 'k', label: 'l' }] });
    assert.strictEqual(out.already, true);
  });
  test('vertical nuevo sin BD → pending en memoria (no persiste, no rompe)', async () => {
    const out = await saveDraft({ enabled: false }, VALID_NEW);
    assert.strictEqual(out.ok, true);
    assert.strictEqual(out.pending, true);
    assert.strictEqual(out.persisted, false);
  });
});
