// ============================================================
// NodeFlow — Importación masiva de clientes con caducidad (2026-07-06)
// El export de la clínica → contactos con sector_data.caducidad →
// el motor programa la renovación ~1 mes antes.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseImportCsv, countScheduled, importContacts, plannedReminder, DATE_FIELD, TYPE_FIELD } = require('../src/lifecycle/contact-import');

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

// ── Stub Supabase para el import EN BLOQUE ──────────────────
// Simula las 4 tablas que toca: contacts (lookup por variantes, insert
// masivo, upsert), contact_memory (opt-outs) y scheduled_reminders.
function stubDb({ existingContacts = [], memory = [] } = {}) {
  const inserted = [], upserted = [], reminders = [], cancelled = [];
  let nextId = 1;
  const db = {
    enabled: true,
    _inserted: inserted, _upserted: upserted, _reminders: reminders, _cancelled: cancelled,
    client: {
      from(table) {
        let mode = null, payload = null;
        const q = {
          select(cols) { if (mode === 'insert') return q; mode = mode || 'select'; return q; },
          insert(rows) { mode = 'insert'; payload = rows; return q; },
          upsert(rows) { mode = 'upsert'; payload = rows; upserted.push(...rows); return Promise.resolve({ error: null }); },
          update(patch) { mode = 'update'; payload = patch; return q; },
          eq() { return q; },
          in(col, vals) {
            if (mode === 'select') {
              if (table === 'contacts') return Promise.resolve({ data: existingContacts.filter(c => vals.includes(c.phone)) });
              if (table === 'contact_memory') return Promise.resolve({ data: memory.filter(m => vals.includes(m.contact_id)) });
              return Promise.resolve({ data: [] });
            }
            if (mode === 'update' && table === 'scheduled_reminders') {
              // segunda .in() de la cadena de cancelación → thenable
              return { in() { cancelled.push(vals); return Promise.resolve({ error: null }); }, then(res) { cancelled.push(vals); return Promise.resolve({ error: null }).then(res); } };
            }
            return q;
          },
          then(resolve) {
            if (mode === 'insert') {
              if (table === 'contacts') {
                const withIds = payload.map(r => ({ ...r, id: 'new-' + (nextId++) }));
                inserted.push(...withIds);
                return Promise.resolve({ data: withIds.map(r => ({ id: r.id, phone: r.phone })), error: null }).then(resolve);
              }
              if (table === 'scheduled_reminders') {
                reminders.push(...payload);
                return Promise.resolve({ error: null }).then(resolve);
              }
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return q;
      },
    },
  };
  return db;
}

describe('importContacts (bulk)', () => {
  test('crea nuevos en bloque y programa recordatorios con message_preview', async () => {
    const db = stubDb();
    const rows = [
      { name: 'Aitor', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01', [TYPE_FIELD]: 'B' } },
      { name: 'Sin fecha', phone: '+34600333444', sectorData: {} },
    ];
    const out = await importContacts('org1', rows, { db });
    assert.strictEqual(out.created, 2);
    assert.strictEqual(out.imported, 2);
    assert.strictEqual(out.scheduled, 1);                       // solo el que tiene caducidad
    assert.strictEqual(db._reminders.length, 1);
    assert.strictEqual(db._reminders[0].service_key, 'renovacion_psicotecnico');
    assert.match(db._reminders[0].message_preview, /renovar tu psicotécnico \(B\)/);
  });

  test('existente guardado en OTRO formato de teléfono → actualiza, no duplica', async () => {
    // El contacto está como nacional '600111222'; el CSV trae '+34600111222'.
    const db = stubDb({ existingContacts: [{ id: 'c-old', phone: '600111222', name: 'Aitor Zubeldia', sector_data: { otro_dato: 'x' } }] });
    const rows = [{ name: 'Aitor', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01' } }];
    const out = await importContacts('org1', rows, { db });
    assert.strictEqual(out.created, 0);
    assert.strictEqual(out.updated, 1);
    const up = db._upserted[0];
    assert.strictEqual(up.id, 'c-old');
    assert.strictEqual(up.sector_data.otro_dato, 'x');                  // conserva lo previo
    assert.strictEqual(up.sector_data[DATE_FIELD], '2099-01-01');       // añade la caducidad
    assert.strictEqual(up.name, 'Aitor Zubeldia');                      // no pisa el nombre bueno
  });

  test('dedupe del CSV: el mismo teléfono dos veces → un solo contacto (datos mergeados)', async () => {
    const db = stubDb();
    const rows = [
      { name: '', phone: '600111222', sectorData: { [TYPE_FIELD]: 'B' } },
      { name: 'Aitor', phone: '+34 600 11 12 22', sectorData: { [DATE_FIELD]: '2099-01-01' } },
    ];
    const out = await importContacts('org1', rows, { db });
    assert.strictEqual(out.created, 1);
    assert.strictEqual(db._inserted[0].name, 'Aitor');
    assert.strictEqual(db._inserted[0].sector_data[TYPE_FIELD], 'B');   // merge de ambas filas
  });

  test('respeta no_whatsapp: el bloqueado no recibe recordatorio', async () => {
    const db = stubDb({
      existingContacts: [{ id: 'c-blk', phone: '+34600111222', name: 'X', sector_data: {} }],
      memory: [{ contact_id: 'c-blk', no_whatsapp: true }],
    });
    const rows = [{ name: 'X', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01' } }];
    const out = await importContacts('org1', rows, { db });
    assert.strictEqual(out.updated, 1);
    assert.strictEqual(out.scheduled, 0);
    assert.strictEqual(db._reminders.length, 0);
  });

  test('re-import: cancela los pendientes previos antes de insertar (idempotente)', async () => {
    const db = stubDb({ existingContacts: [{ id: 'c1', phone: '+34600111222', name: 'X', sector_data: {} }] });
    const rows = [{ name: 'X', phone: '+34600111222', sectorData: { [DATE_FIELD]: '2099-01-01' } }];
    await importContacts('org1', rows, { db });
    assert.strictEqual(db._cancelled.length, 1);
    assert.deepStrictEqual(db._cancelled[0], ['c1']);
    assert.strictEqual(db._reminders.length, 1);
  });

  test('sin BD → todo a cero, no lanza', async () => {
    const out = await importContacts('org1', [{ phone: '+34600111222', sectorData: {} }], { db: { enabled: false } });
    assert.strictEqual(out.imported, 0);
  });
});
