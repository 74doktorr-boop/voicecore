// ============================================================
// NodeFlow — Derecho de supresión operativo (RGPD art. 17, auditoría 2026-07-29)
//
// La política de privacidad promete la supresión y las Condiciones dicen que
// "los datos se suprimen o devuelven al terminar la relación". En el código no
// existía NADA: el único borrado era un soft-delete (is_active:false) que dejaba
// intactos transcripciones, citas, contactos y memoria de los clientes finales —
// terceros que nunca contrataron con NodeFlow. Una reclamación ante la AEPD no
// se podía atender con ninguna herramienta.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { eraseOrgData, ERASURE_PLAN } = require('../src/api/data-erasure');

// Supabase falso: registra las operaciones y devuelve un contador por tabla.
function fakeDb(filasPorTabla = {}, opts = {}) {
  const ops = [];
  const client = {
    from(tabla) {
      return {
        select(_cols, o) {
          return {
            eq(col, val) {
              ops.push({ tipo: 'select', tabla, col, val, head: !!(o && o.head) });
              if (opts.sinColumna && opts.sinColumna[tabla] === col) {
                return Promise.resolve({ error: { code: '42703', message: `column ${tabla}.${col} does not exist` } });
              }
              if (opts.sinTabla && opts.sinTabla.includes(tabla)) {
                return Promise.resolve({ error: { code: '42P01', message: `relation "${tabla}" does not exist` } });
              }
              return Promise.resolve({ count: filasPorTabla[tabla] || 0, error: null });
            },
          };
        },
        delete(o) {
          return {
            eq(col, val) {
              ops.push({ tipo: 'delete', tabla, col, val, exact: !!(o && o.count) });
              return Promise.resolve({ count: filasPorTabla[tabla] || 0, error: null });
            },
          };
        },
      };
    },
  };
  return { db: { client }, ops };
}

describe('eraseOrgData — seguridad', () => {
  test('POR DEFECTO simula: nunca borra por accidente', async () => {
    const { db, ops } = fakeDb({ contacts: 5 });
    const r = await eraseOrgData(db, 'org-1');
    assert.strictEqual(r.dryRun, true);
    assert.ok(ops.every(o => o.tipo === 'select'), 'no puede haber ni un DELETE sin pedirlo explícitamente');
  });

  test('TODA operación va filtrada por organización, sin excepción', async () => {
    const { db, ops } = fakeDb({}, {});
    await eraseOrgData(db, 'org-1', { dryRun: false });
    assert.ok(ops.length > 0);
    for (const o of ops) {
      assert.ok(['org_id', 'organization_id'].includes(o.col), `filtro inesperado: ${o.col} en ${o.tabla}`);
      assert.strictEqual(o.val, 'org-1', 'un borrado sin filtro de org sería el peor incidente del producto');
    }
  });

  test('sin orgId lanza: no hay borrado "de todo"', async () => {
    const { db } = fakeDb();
    await assert.rejects(() => eraseOrgData(db, ''), /orgId requerido/);
    await assert.rejects(() => eraseOrgData(db, null), /orgId requerido/);
    await assert.rejects(() => eraseOrgData(db, undefined), /orgId requerido/);
  });

  test('sin base de datos lanza en vez de fingir que borró', async () => {
    await assert.rejects(() => eraseOrgData(null, 'org-1'), /base de datos/);
    await assert.rejects(() => eraseOrgData({}, 'org-1'), /base de datos/);
  });
});

describe('eraseOrgData — cobertura y resultado', () => {
  test('cubre las tablas con datos de clientes finales', async () => {
    const nombres = ERASURE_PLAN.map(p => p.tabla);
    for (const t of ['nf_calls', 'nf_appointments', 'contacts', 'contact_memory', 'nf_wa_messages', 'scheduled_reminders']) {
      assert.ok(nombres.includes(t), `falta ${t} en el plan de supresión`);
    }
  });

  test('borra las dependencias ANTES que la raíz', async () => {
    const nombres = ERASURE_PLAN.map(p => p.tabla);
    assert.ok(nombres.indexOf('contact_memory') < nombres.indexOf('contacts'));
    assert.ok(nombres.indexOf('nf_entity_events') < nombres.indexOf('nf_entities'));
  });

  test('cada tabla declara QUÉ dato personal contiene (revisable)', () => {
    for (const p of ERASURE_PLAN) assert.ok(p.motivo && p.motivo.length > 10, `sin motivo: ${p.tabla}`);
  });

  test('la simulación devuelve el recuento por tabla y el total', async () => {
    const { db } = fakeDb({ contacts: 120, nf_calls: 53, nf_appointments: 40 });
    const r = await eraseOrgData(db, 'org-1', { dryRun: true });
    assert.strictEqual(r.total, 213);
    assert.strictEqual(r.tablas.find(t => t.tabla === 'contacts').filas, 120);
  });

  test('dryRun:false ejecuta DELETE de verdad', async () => {
    const { db, ops } = fakeDb({ contacts: 3 });
    const r = await eraseOrgData(db, 'org-1', { dryRun: false });
    assert.strictEqual(r.dryRun, false);
    assert.ok(ops.some(o => o.tipo === 'delete' && o.tabla === 'contacts'));
  });

  test('prueba el segundo nombre de columna si el primero no existe', async () => {
    const { db, ops } = fakeDb({ nf_calls: 7 }, { sinColumna: { nf_calls: 'org_id' } });
    const r = await eraseOrgData(db, 'org-1', { dryRun: true });
    const fila = r.tablas.find(t => t.tabla === 'nf_calls');
    assert.strictEqual(fila.columna, 'organization_id', 'el esquema mezcla org_id y organization_id');
    assert.strictEqual(fila.filas, 7);
    assert.ok(ops.filter(o => o.tabla === 'nf_calls').length === 2);
  });

  test('una tabla que no existe en este entorno se anota, no rompe el borrado', async () => {
    const { db } = fakeDb({ contacts: 4 }, { sinTabla: ['nf_entities', 'nf_entity_events'] });
    const r = await eraseOrgData(db, 'org-1', { dryRun: true });
    assert.strictEqual(r.ok, true, 'que falte una tabla opcional no puede impedir atender el derecho');
    assert.ok(r.tablas.find(t => t.tabla === 'nf_entities').nota);
  });

  test('declara qué se CONSERVA y por qué (audit_log, la propia org)', async () => {
    const { db } = fakeDb();
    const r = await eraseOrgData(db, 'org-1');
    const claves = r.seConserva.map(([t]) => t);
    assert.ok(claves.includes('audit_log'), 'la prueba de que se atendió el derecho no puede borrarse');
    assert.ok(claves.includes('organizations'));
  });
});
