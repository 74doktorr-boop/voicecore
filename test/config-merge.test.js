// ============================================================
// NodeFlow — Integridad de la config del portal (2026-07-08)
// Incidente real: al dueño de una fisioterapia le "desaparecieron" servicios
// y precios. La data seguía SALVA en BD (automation_config.config.serviceList
// = 3 servicios); el fallo era de código (lectura de copia en memoria stale +
// clobber latente al escribir). Estos tests fijan las dos invariantes.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { effectiveConfigSource, mergeConfigForWrite } = require('../src/api/config-merge');

// Los 3 servicios reales de la fisioterapia, tal y como están en BD.
const DB_SERVICES = [
  { name: 'Primera consulta', price: '45€', duration: '60 min', notes: '' },
  { name: 'Sesión de fisioterapia', price: '35€', duration: '45 min', notes: '' },
  { name: 'Punción seca', price: '40€', duration: '30 min', notes: '' },
];

describe('LECTURA: la BD fresca gana a la copia en memoria (bug de servicios desaparecidos)', () => {
  test('memoria SIN serviceList + BD CON serviceList → se lee el de BD', () => {
    const mem = { avgTicket: 35 };                    // en memoria se perdió serviceList
    const db  = { serviceList: DB_SERVICES, address: 'Calle Mayor 1' };
    const src = effectiveConfigSource(mem, db);
    assert.strictEqual(src.serviceList.length, 3, 'los 3 servicios de BD deben aparecer');
    assert.strictEqual(src.serviceList[1].name, 'Sesión de fisioterapia');
    assert.strictEqual(src.address, 'Calle Mayor 1');
  });

  test('la BD pisa un valor obsoleto de memoria campo a campo', () => {
    const mem = { serviceList: [], avgTicket: 99, address: 'vieja' };  // memoria stale
    const db  = { serviceList: DB_SERVICES, avgTicket: 35, address: 'nueva' };
    const src = effectiveConfigSource(mem, db);
    assert.strictEqual(src.serviceList.length, 3);
    assert.strictEqual(src.avgTicket, 35);
    assert.strictEqual(src.address, 'nueva');
  });

  test('sin BD (dev) → cae a la memoria sin reventar', () => {
    const src = effectiveConfigSource({ serviceList: DB_SERVICES }, null);
    assert.strictEqual(src.serviceList.length, 3);
    assert.deepStrictEqual(effectiveConfigSource(null, null), {});
  });
});

describe('ESCRITURA: guardar sin serviceList NO borra el de BD (clobber latente)', () => {
  test('PATCH solo con horario preserva serviceList de BD', () => {
    const db = { serviceList: DB_SERVICES, avgTicket: 35 };
    // El dueño guardó SOLO el horario → el body no trae serviceList.
    const patch = { schedule: { mon: { open: '09:00', close: '18:00' } } };
    const merged = mergeConfigForWrite(db, patch);
    assert.strictEqual(merged.serviceList.length, 3, 'serviceList de BD debe sobrevivir');
    assert.deepStrictEqual(merged.schedule.mon, { open: '09:00', close: '18:00' });
    assert.strictEqual(merged.avgTicket, 35);
  });

  test('PATCH que SÍ trae serviceList lo actualiza', () => {
    const db = { serviceList: DB_SERVICES };
    const nuevos = [{ name: 'Osteopatía', price: '50€', duration: '45 min', notes: '' }];
    const merged = mergeConfigForWrite(db, { serviceList: nuevos });
    assert.strictEqual(merged.serviceList.length, 1);
    assert.strictEqual(merged.serviceList[0].name, 'Osteopatía');
  });

  test('el parche NO arrastra claves ausentes (no clona memoria completa)', () => {
    const db = { serviceList: DB_SERVICES, reviewUrl: 'https://g.page/x' };
    // patch limpio: solo address → reviewUrl y serviceList intactos
    const merged = mergeConfigForWrite(db, { address: 'Nueva 2' });
    assert.strictEqual(merged.address, 'Nueva 2');
    assert.strictEqual(merged.reviewUrl, 'https://g.page/x');
    assert.strictEqual(merged.serviceList.length, 3);
  });

  test('BD vacía + patch con datos → escribe los datos', () => {
    const merged = mergeConfigForWrite(null, { serviceList: DB_SERVICES });
    assert.strictEqual(merged.serviceList.length, 3);
  });
});
