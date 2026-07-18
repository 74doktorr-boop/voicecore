// ============================================================
// NodeFlow — Exportación completa de datos / portabilidad (2026-07-18)
// La garantía "sin lock-in" que pidió la crítica ronda 3. Tests del generador
// puro (CSV anti-inyección, mapeo de citas del scheduler) y del ZIP real.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { csvCell, contactsCsv, appointmentsCsv, buildExportZip } = require('../src/api/data-export');

describe('csvCell — escape + anti-inyección de fórmulas', () => {
  test('celda con coma/comilla se envuelve', () => {
    assert.strictEqual(csvCell('Ana, "la peque"'), '"Ana, ""la peque"""');
  });
  test('celda que empieza por = + - @ se neutraliza con apóstrofo', () => {
    assert.strictEqual(csvCell('=HYPERLINK("evil")'), "'=HYPERLINK(\"evil\")".replace(/"/g, '""').replace(/^/, '"').replace(/$/, '"'));
  });
  test('vacío/nulo → cadena vacía', () => {
    assert.strictEqual(csvCell(null), '');
    assert.strictEqual(csvCell(undefined), '');
  });
});

describe('contactsCsv', () => {
  test('cabecera + BOM + fila mapeada', () => {
    const csv = contactsCsv([{ name: 'Ana', phone: '+34600', call_count: 3, tags: ['vip', 'fisio'] }]);
    assert.ok(csv.startsWith('﻿'));
    assert.ok(csv.includes('Nombre,Teléfono'));
    assert.ok(csv.includes("Ana,'+34600,,3,"));   // '+' de teléfono neutralizado (anti-inyección)
    assert.ok(csv.includes('vip · fisio'));
  });
});

describe('appointmentsCsv — shape del scheduler', () => {
  test('mapea patientName/staff/location y marca origen IA', () => {
    const csv = appointmentsCsv([
      { date: '2026-07-20', time: '10:00', patientName: 'Beto', phone: '+34611', service: 'Corte', staff: 'Ana', location: 'Centro', status: 'confirmed', source: 'ai' },
      { date: '2026-07-21', time: '12:00', name: 'Cira', service: 'Tinte', status: 'pending', source: 'manual' },
    ]);
    assert.ok(csv.includes('Fecha,Hora,Cliente'));
    assert.ok(csv.includes("2026-07-20,10:00,Beto,'+34611,Corte,Ana,Centro,confirmed,Asistente IA"));
    assert.ok(csv.includes('2026-07-21,12:00,Cira,,Tinte,,,pending,manual'));
  });
  test('lista vacía → solo cabecera', () => {
    const csv = appointmentsCsv([]);
    assert.ok(csv.includes('Fecha,Hora,Cliente'));
  });
});

describe('buildExportZip — ZIP real de portabilidad', () => {
  test('contiene LEEME + clientes.csv + citas.csv, releíbles', async () => {
    const buf = await buildExportZip({
      bizName: 'Barbería Test',
      contacts: [{ name: 'Ana', phone: '+34600' }],
      appointments: [{ date: '2026-07-20', time: '10:00', patientName: 'Beto', service: 'Corte', source: 'ai' }],
      stamp: '2026-07-18',
    });
    assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
    const JSZip = require('jszip');
    const z = await JSZip.loadAsync(buf);
    assert.ok(z.file('LEEME.txt') && z.file('clientes.csv') && z.file('citas.csv'));
    const leeme = await z.file('LEEME.txt').async('string');
    assert.ok(leeme.includes('Barbería Test') && leeme.includes('PORTABILIDAD'));
    const citas = await z.file('citas.csv').async('string');
    assert.ok(citas.includes('Beto') && citas.includes('Asistente IA'));
  });
});
