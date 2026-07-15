// ============================================================
// NodeFlow — ENTIDADES: UPSERT POR IDENTIFICADOR (funciones puras)
// Reimportar el mismo Excel NO duplica: normalización del identificador
// («1234-ABC» == «1234 abc»), resolución del campo identificador por
// plantilla (con fallback al catálogo para filas sembradas antes de la
// feature) y reparto insertar/actualizar/saltar. Sin BD: determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { normalizeIdentifier } = require('../src/entities/entities');
const { resolveImportActions } = require('../src/entities/entity-import');
const { ENTITY_TEMPLATES, identifierField } = require('../src/entities/entity-types');

// ─── normalizeIdentifier — la matrícula se compara sin formato ───────────────

describe('normalizeIdentifier — trim, mayúsculas, sin espacios/guiones/acentos', () => {
  test('matrículas con y sin guion son la MISMA', () => {
    assert.strictEqual(normalizeIdentifier('1234-ABC'), '1234ABC');
    assert.strictEqual(normalizeIdentifier('1234 abc'), '1234ABC');
    assert.strictEqual(normalizeIdentifier('  1234abc  '), '1234ABC');
    assert.strictEqual(normalizeIdentifier('1234-ABC'), normalizeIdentifier('1234 abc'));
  });

  test('acentos y símbolos fuera (direcciones, referencias)', () => {
    assert.strictEqual(normalizeIdentifier('Calle José 5, 2ºB'), 'CALLEJOSE52B');
    assert.strictEqual(normalizeIdentifier('EXP-2024/017'), 'EXP2024017');
  });

  test('vacío/null/undefined → "" (nunca casa con nada)', () => {
    assert.strictEqual(normalizeIdentifier(''), '');
    assert.strictEqual(normalizeIdentifier(null), '');
    assert.strictEqual(normalizeIdentifier(undefined), '');
    assert.strictEqual(normalizeIdentifier('  -- '), '');
  });

  test('números también valen (nº de chip)', () => {
    assert.strictEqual(normalizeIdentifier(941000012345678), '941000012345678');
  });
});

// ─── identifierField — un juicio por plantilla, honesto donde no hay ─────────

describe('identifierField — el identificador natural de cada plantilla', () => {
  // La tabla de verdad de la decisión de producto: qué campo identifica la
  // COSA en el mundo real. Si alguien la cambia, este test le obliga a mirar.
  const EXPECTED = {
    vehiculo:             'matricula',    // taller
    mascota:              'chip',         // veterinaria
    propiedad:            'direccion',    // inmobiliaria
    expediente:           'numero',       // abogados
    poliza:               'numero',       // seguros
    documento_viaje:      'numero',       // agencia de viajes
    expediente_notarial:  'referencia',   // notaría
    obra:                 'direccion',    // reformas
    proyecto:             'nombre',       // arquitectura
  };

  test('cada plantilla tiene el identificador esperado (o NINGUNO, y es a propósito)', () => {
    for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
      for (const t of templates) {
        const f = identifierField(t);
        const want = EXPECTED[t.key] || null;
        assert.strictEqual(f ? f.key : null, want,
          `${sector}.${t.key}: identificador esperado ${want}, obtenido ${f ? f.key : null}`);
      }
    }
  });

  test('los sectores de bonos/planes/eventos NO tienen identificador (honesto)', () => {
    for (const key of ['bono_sesiones', 'bono_laser', 'bono_spa', 'plan_sesiones', 'evento', 'grupo', 'membresia', 'renovacion']) {
      const t = Object.values(ENTITY_TEMPLATES).flat().find(x => x.key === key);
      assert.ok(t, `plantilla ${key} existe`);
      assert.strictEqual(identifierField(t), null, `${key} no debe tener identificador`);
    }
  });

  test('invariante del catálogo: máx 1 identificador por plantilla, tipo text y existente', () => {
    for (const templates of Object.values(ENTITY_TEMPLATES)) {
      for (const t of templates) {
        const marked = (t.fields || []).filter(f => f.is_identifier);
        assert.ok(marked.length <= 1, `${t.key}: más de un is_identifier`);
        if (marked.length) assert.strictEqual(marked[0].type, 'text', `${t.key}: el identificador debe ser text`);
      }
    }
  });

  test('fila de nf_entity_types sembrada ANTES de la feature (fields sin is_identifier) → cae al catálogo por key', () => {
    const stale = {
      key: 'vehiculo',
      fields: ENTITY_TEMPLATES.taller[0].fields.map(f => {
        const { is_identifier, ...rest } = f;   // eslint-disable-line no-unused-vars
        return rest;
      }),
    };
    const f = identifierField(stale);
    assert.ok(f, 'debe resolver por catálogo');
    assert.strictEqual(f.key, 'matricula');
  });

  test('null/tipo desconocido → null', () => {
    assert.strictEqual(identifierField(null), null);
    assert.strictEqual(identifierField({ key: 'tipo_custom_raro', fields: [] }), null);
  });
});

// ─── resolveImportActions — insertar vs actualizar vs saltar ─────────────────

describe('resolveImportActions — reimportar NO duplica', () => {
  const ID = { key: 'matricula', label: 'Matrícula' };
  const row = (n, matricula, extra) => ({ row: n, attrs: { matricula, ...(extra || {}) }, isDraft: false, phone: null });

  test('sin idField → todo inserta (sectores sin identificador, como antes)', () => {
    const rows = [row(2, '1234ABC'), row(3, '1234ABC')];
    const r = resolveImportActions({ rows, idField: null, existingIndex: null });
    assert.strictEqual(r.inserts.length, 2);
    assert.strictEqual(r.updates.length, 0);
    assert.strictEqual(r.skipped.length, 0);
  });

  test('identificador que casa con ficha existente → UPDATE (normalizado)', () => {
    const existing = new Map([['1234ABC', { id: 'ent-1', attrs: { matricula: '1234 abc' } }]]);
    const r = resolveImportActions({
      rows: [row(2, '1234-ABC', { marca: 'Seat' }), row(3, '5678DEF')],
      idField: ID, existingIndex: existing,
    });
    assert.strictEqual(r.updates.length, 1);
    assert.strictEqual(r.updates[0].entity.id, 'ent-1');
    assert.strictEqual(r.updates[0].row.row, 2);
    assert.deepStrictEqual(r.inserts.map(x => x.row), [3]);
    assert.strictEqual(r.skipped.length, 0);
  });

  test('fila SIN valor en el identificador → inserta (no hay con qué casar)', () => {
    const existing = new Map([['1234ABC', { id: 'ent-1' }]]);
    const r = resolveImportActions({
      rows: [{ row: 2, attrs: { marca: 'Opel' } }],
      idField: ID, existingIndex: existing,
    });
    assert.strictEqual(r.inserts.length, 1);
    assert.strictEqual(r.updates.length, 0);
  });

  test('identificador repetido EN EL MISMO archivo → la primera gana, la segunda se salta con motivo', () => {
    const r = resolveImportActions({
      rows: [row(2, '1234ABC'), row(5, '1234-abc'), row(6, '9999ZZZ')],
      idField: ID, existingIndex: new Map(),
    });
    assert.deepStrictEqual(r.inserts.map(x => x.row), [2, 6]);
    assert.strictEqual(r.skipped.length, 1);
    assert.strictEqual(r.skipped[0].row, 5);
    assert.match(r.skipped[0].reason, /Matrícula/);
    assert.match(r.skipped[0].reason, /fila 2/);
  });

  test('repetido en el archivo Y existente → la primera actualiza, la segunda se salta', () => {
    const existing = new Map([['1234ABC', { id: 'ent-1' }]]);
    const r = resolveImportActions({
      rows: [row(2, '1234ABC'), row(3, '1234ABC')],
      idField: ID, existingIndex: existing,
    });
    assert.strictEqual(r.updates.length, 1);
    assert.strictEqual(r.skipped.length, 1);
    assert.strictEqual(r.inserts.length, 0);
  });

  test('reimportar el MISMO archivo entero → 0 inserts, todo updates (el bug que arregla esto)', () => {
    const file = [row(2, '1234ABC'), row(3, '5678-DEF'), row(4, '9012 GHI')];
    // Primera pasada: nada existe → todo inserta
    const first = resolveImportActions({ rows: file, idField: ID, existingIndex: new Map() });
    assert.strictEqual(first.inserts.length, 3);
    // Lo insertado pasa a ser el índice de existentes (como en BD)
    const index = new Map(first.inserts.map((r2, i) =>
      [normalizeIdentifier(r2.attrs.matricula), { id: 'ent-' + i, attrs: r2.attrs }]));
    // Segunda pasada: el mismo archivo → CERO inserts
    const second = resolveImportActions({ rows: file, idField: ID, existingIndex: index });
    assert.strictEqual(second.inserts.length, 0);
    assert.strictEqual(second.updates.length, 3);
    assert.strictEqual(second.skipped.length, 0);
  });
});

// Auditoría 2026-07-16 — tipos SIN identificador: clave blanda por nombre
describe('resolveImportActions — dedupe blando por nombre (tipos sin id)', () => {
  const { normalizeSoftName } = require('../src/entities/entity-import');
  const nameRow = (n, nombre) => ({ row: n, attrs: { nombre }, isDraft: false, phone: null });
  const softKeyOf = (r) => normalizeSoftName(r.attrs.nombre);

  test('sin idField y sin softKeyOf → todo inserta (comportamiento intacto)', () => {
    const r = resolveImportActions({ rows: [nameRow(2, 'Rex'), nameRow(3, 'Rex')], idField: null, existingIndex: null });
    assert.strictEqual(r.inserts.length, 2);
  });

  test('reimportar por nombre → casa con la ficha existente (UPDATE, no duplica)', () => {
    const existing = new Map([['rex', { id: 'ent-rex' }]]);
    const r = resolveImportActions({ rows: [nameRow(2, 'REX'), nameRow(3, 'Michi')], idField: null, existingIndex: existing, softKeyOf });
    assert.strictEqual(r.updates.length, 1);
    assert.strictEqual(r.updates[0].entity.id, 'ent-rex');
    assert.deepStrictEqual(r.inserts.map(x => x.row), [3]);
  });

  test('nombre AMBIGUO en BD (2+ fichas iguales) → inserta, NO fusiona a ciegas', () => {
    const existing = new Map([['rex', { __ambiguous: true }]]);
    const r = resolveImportActions({ rows: [nameRow(2, 'Rex')], idField: null, existingIndex: existing, softKeyOf });
    assert.strictEqual(r.inserts.length, 1);
    assert.strictEqual(r.updates.length, 0);
  });

  test('mismo nombre repetido en el archivo → la primera gana, la segunda se salta', () => {
    const r = resolveImportActions({ rows: [nameRow(2, 'Rex'), nameRow(4, 'rex ')], idField: null, existingIndex: new Map(), softKeyOf });
    assert.deepStrictEqual(r.inserts.map(x => x.row), [2]);
    assert.strictEqual(r.skipped.length, 1);
    assert.strictEqual(r.skipped[0].row, 4);
  });

  test('normalizeSoftName: acentos, mayúsculas y espacios', () => {
    assert.strictEqual(normalizeSoftName('  José  Pérez '), 'jose perez');
    assert.strictEqual(normalizeSoftName('MICHI'), 'michi');
  });
});
