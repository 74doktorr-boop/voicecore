// ============================================================
// NodeFlow — Registro canónico de sectores (2026-07-04)
// El bucle de mejora se vuelve sector-aware: cada vertical tiene sus
// normas, métricas y parámetros. Estos tests fijan el contrato.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { resolveSector, isCurated, SECTORS } = require('../src/sectors/sector-registry');

describe('resolveSector', () => {
  test('resuelve un sector piloto con sus 3 pilares', () => {
    const s = resolveSector('dental');
    assert.strictEqual(s.slug, 'dental');
    assert.ok(s.norms.length >= 1, 'tiene normas propias');
    assert.ok(s.metricChecks.length >= 1, 'tiene métricas propias');
    assert.ok(Array.isArray(s.requiredFields), 'incluye requiredFields');
    assert.ok(s.metricChecks.every(m => m.key && m.label), 'métricas bien formadas');
  });

  test('resuelve por ALIAS al sector canónico', () => {
    assert.strictEqual(resolveSector('dentista').slug, 'dental');
    assert.strictEqual(resolveSector('clinica').slug, 'dental');
    assert.strictEqual(resolveSector('barberia').slug, 'peluqueria');
    assert.strictEqual(resolveSector('mecanico').slug, 'taller');
  });

  test('normaliza mayúsculas/acentos/espacios', () => {
    assert.strictEqual(resolveSector('  Odontología ').slug, 'dental');
  });

  test('sector desconocido o vacío → GENERICO (nunca null)', () => {
    assert.strictEqual(resolveSector('queseria-artesana').slug, 'generico');
    assert.strictEqual(resolveSector('').slug, 'generico');
    assert.strictEqual(resolveSector(undefined).slug, 'generico');
    assert.deepStrictEqual(resolveSector('generico').norms, []);
  });

  test('taller trae sus requiredFields desde sector-fields', () => {
    const s = resolveSector('taller');
    assert.ok(s.requiredFields.some(f => f.key === 'matricula'), 'taller pide matrícula');
  });
});

describe('isCurated', () => {
  test('pilotos curados = true; desconocido = false', () => {
    assert.strictEqual(isCurated('restaurante'), true);
    assert.strictEqual(isCurated('peluqueria'), true);
    assert.strictEqual(isCurated('sector-inventado'), false);
    assert.strictEqual(isCurated('generico'), false);
  });
});

describe('integridad del registro', () => {
  test('cada sector tiene slug/label y métricas con key única', () => {
    for (const s of Object.values(SECTORS)) {
      assert.ok(s.slug && s.label, `${s.slug} bien formado`);
      const keys = s.metricChecks.map(m => m.key);
      assert.strictEqual(new Set(keys).size, keys.length, `${s.slug}: métricas con key repetida`);
    }
  });
});
