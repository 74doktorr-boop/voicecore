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
    assert.strictEqual(resolveSector('odontologia').slug, 'dental');
    assert.strictEqual(resolveSector('barberia').slug, 'peluqueria');
    assert.strictEqual(resolveSector('mecanico').slug, 'taller');
    assert.strictEqual(resolveSector('dietetica').slug, 'nutricion'); // slug del prompt-generator
    assert.strictEqual(resolveSector('abogado').slug, 'abogados');
  });

  test('clinica es su PROPIO sector (médica), no un alias de dental', () => {
    assert.strictEqual(resolveSector('clinica').slug, 'clinica');
    assert.strictEqual(resolveSector('clinica').label, 'Clínica médica');
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
  test('cada sector tiene slug/label, ≥1 norma y métricas con key única', () => {
    for (const s of Object.values(SECTORS)) {
      assert.ok(s.slug && s.label, `${s.slug} bien formado`);
      assert.ok(s.norms.length >= 1, `${s.slug} sin normas`);
      assert.ok(s.metricChecks.length >= 1, `${s.slug} sin métricas`);
      const keys = s.metricChecks.map(m => m.key);
      assert.strictEqual(new Set(keys).size, keys.length, `${s.slug}: métricas con key repetida`);
    }
  });

  test('la key de cada sector coincide con su clave en el mapa', () => {
    for (const [k, s] of Object.entries(SECTORS)) assert.strictEqual(k, s.slug, `desajuste ${k} vs ${s.slug}`);
  });

  test('ningún ALIAS colisiona (mismo alias en dos sectores o pisa un slug ajeno)', () => {
    const seen = {};
    for (const s of Object.values(SECTORS)) {
      for (const a of s.aliases || []) {
        assert.ok(!seen[a], `alias "${a}" duplicado (${seen[a]} y ${s.slug})`);
        assert.ok(!SECTORS[a] || SECTORS[a].slug === s.slug, `alias "${a}" pisa el slug de otro sector`);
        seen[a] = s.slug;
      }
    }
  });
});

describe('cobertura: TODOS los sectores del prompt-generator están curados', () => {
  // Slugs manejados por sectorBlock() en prompt-generator.js — si añades uno
  // allí, cúralo aquí (este test lo obliga).
  const PROMPT_SECTORS = [
    'restaurante', 'fisioterapia', 'dental', 'clinica', 'peluqueria', 'gimnasio',
    'optica', 'psicologia', 'coaching', 'nutricion', 'dietetica', 'podologia',
    'autoescuela', 'spa', 'estetica_avanzada', 'laser', 'yoga', 'pilates',
    'guarderia_canina', 'residencia_mascotas', 'abogado', 'abogados', 'notaria',
    'agencia_viajes', 'reformas', 'arquitectura', 'veterinaria', 'farmacia',
    'hotel', 'taller', 'academia', 'asesoria', 'inmobiliaria',
  ];
  for (const slug of PROMPT_SECTORS) {
    test(`"${slug}" resuelve a un sector curado con normas y métricas`, () => {
      const s = resolveSector(slug);
      assert.notStrictEqual(s.slug, 'generico', `${slug} cae a genérico — sin curar`);
      assert.ok(s.norms.length >= 1 && s.metricChecks.length >= 1);
    });
  }
});
