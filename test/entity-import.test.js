// ============================================================
// NodeFlow — ENTIDADES v1: IMPORTACIÓN MÁGICA (funciones puras)
// Parser CSV/TSV, sugerencia de mapeo determinista (cero LLM),
// conversión de celdas al tipo del campo y validación de filas.
// Sin BD: todo determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  MAX_IMPORT_ROWS, parseCsv, suggestMapping, sanitizeMapping,
  convertCell, buildImportRows,
} = require('../src/entities/entity-import');
const { ENTITY_TEMPLATES } = require('../src/entities/entity-types');

const TALLER = ENTITY_TEMPLATES.taller[0];
const VETE   = ENTITY_TEMPLATES.veterinaria[0];

// ─── parseCsv — separadores, BOM, comillas ───────────────────────────────────

describe('parseCsv — el Excel del dueño, tal cual llega', () => {
  test('CSV con comas', () => {
    const r = parseCsv('Matricula,Marca\n1234ABC,Seat\n5678DEF,Opel');
    assert.deepStrictEqual(r.headers, ['Matricula', 'Marca']);
    assert.strictEqual(r.rows.length, 2);
    assert.deepStrictEqual(r.rows[0], ['1234ABC', 'Seat']);
    assert.strictEqual(r.sep, ',');
  });

  test('CSV con punto y coma (export típico de Excel-ES)', () => {
    const r = parseCsv('Matricula;Marca;Modelo\n1234ABC;Seat;León');
    assert.strictEqual(r.sep, ';');
    assert.deepStrictEqual(r.rows[0], ['1234ABC', 'Seat', 'León']);
  });

  test('TSV: pegar celdas desde Excel llega con tabuladores', () => {
    const r = parseCsv('Matricula\tMarca\tTeléfono\n1234ABC\tSeat\t612345678');
    assert.strictEqual(r.sep, '\t');
    assert.deepStrictEqual(r.headers, ['Matricula', 'Marca', 'Teléfono']);
    assert.deepStrictEqual(r.rows[0], ['1234ABC', 'Seat', '612345678']);
  });

  test('quita el BOM y las líneas vacías', () => {
    const r = parseCsv('﻿Matricula,Marca\n\n1234ABC,Seat\n\n');
    assert.strictEqual(r.headers[0], 'Matricula');   // sin BOM pegado
    assert.strictEqual(r.rows.length, 1);
  });

  test('comillas: una coma dentro de la celda no parte la columna', () => {
    const r = parseCsv('Matricula,Notas\n1234ABC,"ruido raro, revisar frenos"');
    assert.deepStrictEqual(r.rows[0], ['1234ABC', 'ruido raro, revisar frenos']);
  });

  test('texto vacío o solo cabecera → sin filas', () => {
    assert.strictEqual(parseCsv('').rows.length, 0);
    assert.strictEqual(parseCsv('Matricula,Marca').rows.length, 0);
  });
});

// ─── suggestMapping — heurística determinista de columnas ───────────────────

describe('suggestMapping — reconoce las columnas del sector', () => {
  test('taller: cabeceras reales → campos + teléfono/nombre del cliente', () => {
    const m = suggestMapping(
      ['Matrícula', 'Marca', 'Modelo', 'Teléfono', 'Cliente', 'Próxima ITV', 'Kms'],
      TALLER.fields
    );
    assert.deepStrictEqual(m, ['matricula', 'marca', 'modelo', '_phone', '_name', 'proxima_itv', 'km']);
  });

  test('tokens: «Fecha ITV» y «Fecha caducidad ITV» → proxima_itv', () => {
    assert.deepStrictEqual(suggestMapping(['Fecha ITV'], TALLER.fields), ['proxima_itv']);
  });

  test('columna desconocida → "" (no usar), jamás un invento', () => {
    assert.deepStrictEqual(suggestMapping(['Color favorito'], TALLER.fields), ['']);
  });

  test('veterinaria: «Nombre» es LA MASCOTA (campo exacto gana al cliente)', () => {
    const m = suggestMapping(['Nombre', 'Especie', 'Nombre del cliente', 'Teléfono del dueño'], VETE.fields);
    assert.deepStrictEqual(m, ['nombre', 'especie', '_name', '_phone']);
  });

  test('cada destino se asigna una sola vez (la primera columna gana)', () => {
    const m = suggestMapping(['Teléfono', 'Móvil'], TALLER.fields);
    assert.strictEqual(m[0], '_phone');
    assert.strictEqual(m[1], '');
  });
});

describe('sanitizeMapping — el mapeo del cliente no se cree nada', () => {
  test('keys inválidas y duplicados → ""', () => {
    const m = sanitizeMapping(['matricula', 'matricula', 'no_existe', '_phone', { evil: 1 }], TALLER.fields);
    assert.deepStrictEqual(m, ['matricula', '', '', '_phone', '']);
  });
  test('no-array → []', () => {
    assert.deepStrictEqual(sanitizeMapping('x', TALLER.fields), []);
  });
});

// ─── convertCell — la celda cruda al tipo del campo ──────────────────────────

describe('convertCell — traduce, nunca valida', () => {
  const dateF = TALLER.fields.find(f => f.key === 'proxima_itv');
  const numF  = TALLER.fields.find(f => f.key === 'km');
  const selF  = VETE.fields.find(f => f.key === 'especie');

  test('fechas dd/mm/aaaa y dd-mm-aaaa → ISO', () => {
    assert.strictEqual(convertCell(dateF, '15/03/2027'), '2027-03-15');
    assert.strictEqual(convertCell(dateF, '1-7-2027'), '2027-07-01');
    assert.strictEqual(convertCell(dateF, '2027-03-15'), '2027-03-15');
  });
  test('fecha imposible → se devuelve cruda (validateAttrs la señalará)', () => {
    assert.strictEqual(convertCell(dateF, 'marzo'), 'marzo');
  });
  test('números con coma decimal y €', () => {
    assert.strictEqual(convertCell(numF, '12,5'), '12.5');
    assert.strictEqual(convertCell(numF, '120 000'), '120000');
  });
  test('select por etiqueta, sin acentos ni mayúsculas: «Perro» → perro', () => {
    assert.strictEqual(convertCell(selF, 'Perro'), 'perro');
    assert.strictEqual(convertCell(selF, 'GATO'), 'gato');
    assert.strictEqual(convertCell(selF, 'dinosaurio'), 'dinosaurio');  // cruda → error después
  });
  test('boolean en cristiano: Sí/No', () => {
    const boolF = { key: 'x', type: 'boolean', label: 'X' };
    assert.strictEqual(convertCell(boolF, 'Sí'), 'true');
    assert.strictEqual(convertCell(boolF, 'no'), 'false');
  });
});

// ─── buildImportRows — validación fila a fila ────────────────────────────────

describe('buildImportRows — filas listas, borradores y saltadas', () => {
  const MAPPING = ['matricula', 'marca', '_phone', '_name', 'proxima_itv'];

  test('fila completa → attrs validados, fecha dd/mm → ISO y teléfono a +34', () => {
    const r = buildImportRows({
      rows: [['1234ABC', 'Seat', '612 34 56 78', 'María', '15/03/2027']],
      mapping: MAPPING, fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.skipped.length, 0);
    const row = r.rows[0];
    assert.strictEqual(row.attrs.matricula, '1234ABC');
    assert.strictEqual(row.attrs.proxima_itv, '2027-03-15');   // convertCell en el camino
    assert.strictEqual(row.phone, '+34612345678');
    assert.strictEqual(row.contactName, 'María');
    assert.strictEqual(row.isDraft, false);
    assert.strictEqual(row.attrs.is_draft, undefined);
  });

  test('falta el required (matrícula) → entra como BORRADOR, no se pierde', () => {
    const r = buildImportRows({
      rows: [['', 'Seat', '612345678', '', '2027-03-15']],
      mapping: MAPPING, fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].isDraft, true);
    assert.strictEqual(r.rows[0].attrs.is_draft, true);
  });

  test('valor presente inválido (fecha rota) → skip con la fila del Excel y el motivo', () => {
    const r = buildImportRows({
      rows: [['1234ABC', 'Seat', '612345678', 'María', 'pronto']],
      mapping: MAPPING, fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 0);
    assert.strictEqual(r.skipped.length, 1);
    assert.strictEqual(r.skipped[0].row, 2);            // fila 2 = primera de datos
    assert.match(r.skipped[0].reason, /fecha/i);
  });

  test('teléfono inválido NO tumba la fila — solo se queda sin vínculo', () => {
    const r = buildImportRows({
      rows: [['1234ABC', 'Seat', 'sin tlf', 'María', '2027-03-15']],
      mapping: MAPPING, fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].phone, null);
  });

  test('fila 100% vacía se ignora en silencio (colas de Excel)', () => {
    const r = buildImportRows({
      rows: [['', '', '', '', ''], ['1234ABC', '', '', '', '']],
      mapping: MAPPING, fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.skipped.length, 0);
  });

  test('fila con datos pero NINGUNO en columnas mapeadas → skip con motivo', () => {
    const r = buildImportRows({
      rows: [['algo']],
      mapping: [''],                       // ninguna columna en uso
      fields: TALLER.fields,
    });
    assert.strictEqual(r.rows.length, 0);
    assert.strictEqual(r.skipped.length, 1);
  });

  test(`cap de ${MAX_IMPORT_ROWS} filas → truncated informa del resto`, () => {
    const rows = [];
    for (let i = 0; i < MAX_IMPORT_ROWS + 25; i++) rows.push([`${1000 + i}ABC`, 'Seat', '', '', '']);
    const r = buildImportRows({ rows, mapping: MAPPING, fields: TALLER.fields });
    assert.strictEqual(r.rows.length, MAX_IMPORT_ROWS);
    assert.strictEqual(r.truncated, 25);
  });
});
