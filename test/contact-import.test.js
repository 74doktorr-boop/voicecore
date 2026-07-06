// ============================================================
// NodeFlow — Importación masiva de clientes con caducidad (2026-07-06)
// El export de la clínica → contactos con sector_data.caducidad →
// el motor programa la renovación ~1 mes antes.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseImportCsv, countScheduled, importContacts, plannedReminder, DATE_FIELD } = require('../src/lifecycle/contact-import');

describe('parseImportCsv', () => {
  test('cabeceras con acento + separador coma', () => {
    const r = parseImportCsv('Nombre,Teléfono,Caduca_el,Tipo\nAitor,688760760,2026-08-10,B');
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0].name, 'Aitor');
    assert.strictEqual(r.rows[0].phone, '+34688760760');
    assert.strictEqual(r.rows[0].sectorData[DATE_FIELD], '2026-08-10');
    assert.strictEqual(r.rows[0].sectorData.tipo_psicotecnico, 'B');
  });

  test('separador ; (Excel-ES) y fecha dd/mm/aaaa', () => {
    const r = parseImportCsv('nombre;telefono;caducidad;tipo\nMaría;600111222;15/09/2026;C');
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0].sectorData[DATE_FIELD], '2026-09-15');
  });

  test('fecha dd-mm-aaaa e internacional', () => {
    const r = parseImportCsv('Nombre,Telefono,Caduca_el\nX,+34611223344,01-12-2026');
    assert.strictEqual(r.rows[0].phone, '+34611223344');
    assert.strictEqual(r.rows[0].sectorData[DATE_FIELD], '2026-12-01');
  });

  test('teléfono inválido → error por línea, no fila', () => {
    const r = parseImportCsv('Nombre,Telefono,Caduca_el\nMalo,notaphone,2026-08-10');
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].line, 2);
  });

  test('fecha inválida → error, no fila', () => {
    const r = parseImportCsv('Nombre,Telefono,Caduca_el\nX,600111222,32/13/2026');
    assert.strictEqual(r.total, 0);
    assert.match(r.errors[0].reason, /[Ff]echa/);
  });

  test('sin columna de teléfono → error de cabecera', () => {
    const r = parseImportCsv('Nombre,Caduca_el\nX,2026-08-10');
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.errors[0].line, 1);
  });

  test('fila sin fecha se acepta (contacto sin recordatorio)', () => {
    const r = parseImportCsv('Nombre,Telefono,Caduca_el\nX,600111222,');
    assert.strictEqual(r.total, 1);
    assert.deepStrictEqual(r.rows[0].sectorData, {});
  });

  test('respeta comillas con comas dentro', () => {
    const r = parseImportCsv('Nombre,Telefono,Caduca_el\n"Agirre, José",600111222,2026-08-10');
    assert.strictEqual(r.rows[0].name, 'Agirre, José');
  });

  test('CSV vacío o solo cabecera → sin filas', () => {
    assert.strictEqual(parseImportCsv('').total, 0);
    assert.strictEqual(parseImportCsv('Nombre,Telefono').total, 0);
  });
});

describe('plannedReminder', () => {
  const now = new Date('2026-07-06T00:00:00Z');
  test('caducidad ya pasada → null (no molestar)', () => {
    assert.strictEqual(plannedReminder('2026-06-01', now), null);
  });
  test('aviso normal = 30 días antes', () => {
    const p = plannedReminder('2026-09-15', now);
    assert.strictEqual(p.urgent, false);
    assert.strictEqual(p.when.toISOString().slice(0, 10), '2026-08-16');
  });
  test('caduca dentro de <30 días → urgente, avisa mañana', () => {
    const p = plannedReminder('2026-07-25', now);   // aviso normal (25-jun) ya pasó
    assert.strictEqual(p.urgent, true);
    assert.strictEqual(p.when.toISOString().slice(0, 10), '2026-07-07');
  });
  test('sin fecha → null', () => {
    assert.strictEqual(plannedReminder(undefined, now), null);
  });
});

describe('countScheduled', () => {
  test('cuenta normales + inminentes, no las ya caducadas', () => {
    const rows = [
      { sectorData: { [DATE_FIELD]: '2099-01-01' } },  // futuro → sí
      { sectorData: { [DATE_FIELD]: '2000-01-01' } },  // pasado → no
      { sectorData: {} },                               // sin fecha → no
    ];
    assert.strictEqual(countScheduled(rows), 1);
  });
});

// ── Stub Supabase encadenable para importContacts ───────────
function stubDb({ existingByPhone = {} } = {}) {
  const inserted = [], updated = [];
  const db = {
    enabled: true,
    _inserted: inserted, _updated: updated,
    client: {
      from() {
        let mode = null, phone = null, payload = null;
        const q = {
          select() { return q; },
          insert(row) { mode = 'insert'; payload = row; return q; },
          update(patch) { mode = 'update'; payload = patch; return q; },
          eq(col, val) { if (col === 'phone') phone = val; return q; },
          maybeSingle() {
            if (mode === 'insert') {
              const id = 'new-' + (inserted.length + 1);
              inserted.push({ id, ...payload });
              return Promise.resolve({ data: { id }, error: null });
            }
            // select existing por teléfono
            const ex = existingByPhone[phone];
            return Promise.resolve({ data: ex || null, error: null });
          },
          then(resolve) {
            if (mode === 'update') updated.push(payload);
            return Promise.resolve({ data: {}, error: null }).then(resolve);
          },
        };
        return q;
      },
    },
  };
  return db;
}

describe('importContacts', () => {
  test('crea nuevos, programa recordatorio y cuenta scheduled', async () => {
    const db = stubDb();
    const sched = [];
    const rows = [
      { name: 'Aitor', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01', tipo_psicotecnico: 'B' } },
      { name: 'Sin fecha', phone: '+34600333444', sectorData: {} },
    ];
    const out = await importContacts('org1', rows, { db, scheduleReminder: async (a) => { sched.push(a); } });
    assert.strictEqual(out.imported, 2);
    assert.strictEqual(out.created, 2);
    assert.strictEqual(out.scheduled, 1);           // solo el que tiene caducidad
    assert.strictEqual(sched.length, 1);            // no programa al de sin fecha
    assert.strictEqual(sched[0].serviceKey, 'renovacion_psicotecnico');
  });

  test('contacto existente: mergea sector_data sin pisar y no duplica', async () => {
    const db = stubDb({ existingByPhone: { '+34600111222': { id: 'c-old', name: 'Aitor Zubeldia', sector_data: { otro_dato: 'x' } } } });
    const rows = [{ name: 'Aitor', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01' } }];
    const out = await importContacts('org1', rows, { db, scheduleReminder: async () => {} });
    assert.strictEqual(out.created, 0);
    assert.strictEqual(out.updated, 1);
    const patch = db._updated[0];
    assert.strictEqual(patch.sector_data.otro_dato, 'x');                  // conserva lo previo
    assert.strictEqual(patch.sector_data[DATE_FIELD], '2099-01-01');       // añade la caducidad
    assert.strictEqual(patch.name, undefined);                            // no pisa el nombre bueno
  });

  test('sin BD → todo a cero, no lanza', async () => {
    const out = await importContacts('org1', [{ phone: '+34600111222', sectorData: {} }], { db: { enabled: false } });
    assert.strictEqual(out.imported, 0);
  });
});
