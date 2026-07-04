// ============================================================
// NodeFlow — Registro canónico de sectores (2026-07-04)
// El bucle de mejora se vuelve sector-aware: cada vertical tiene sus
// normas, métricas y parámetros. Estos tests fijan el contrato.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  resolveSector, isCurated, SECTORS,
  normalizeSectorDef, hydrate, upsertSector, allSectors,
} = require('../src/sectors/sector-registry');

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

// ── Sectores como DATO: alta en caliente sin deploy (2026-07-04) ──────────
describe('normalizeSectorDef — valida candidatos (LLM/BD) sin confiar a ciegas', () => {
  test('def válida se normaliza (slug del label, alias/keys normalizados)', () => {
    const d = normalizeSectorDef({
      label: 'Floristería', aliases: ['Flores', 'floristeria'],
      norms: ['Pregunta el tipo de arreglo y la fecha de entrega.'],
      metricChecks: [{ key: 'Tipo Arreglo', label: '¿Capturó el tipo de arreglo?' }],
    });
    assert.strictEqual(d.slug, 'floristeria');
    assert.strictEqual(d.label, 'Floristería');
    assert.ok(d.aliases.includes('flores'));
    assert.strictEqual(d.metricChecks[0].key, 'tipo_arreglo');
    assert.strictEqual(d.custom, true);
  });
  test('sin normas o sin métricas → null (no aporta)', () => {
    assert.strictEqual(normalizeSectorDef({ label: 'X', norms: [], metricChecks: [] }), null);
    assert.strictEqual(normalizeSectorDef({ label: 'X', norms: ['a'], metricChecks: [] }), null);
    assert.strictEqual(normalizeSectorDef(null), null);
  });
});

describe('upsertSector / hydrate / allSectors — sin deploy', () => {
  test('upsert añade un sector custom resoluble al instante', () => {
    const def = upsertSector({
      label: 'Cerrajería', aliases: ['cerrajero'],
      norms: ['Pregunta si es una urgencia (persona/mascota atrapada) y la dirección.'],
      metricChecks: [{ key: 'urgencia', label: '¿Detectó urgencia?' }],
    });
    assert.ok(def);
    assert.strictEqual(resolveSector('cerrajeria').slug, 'cerrajeria');
    assert.strictEqual(resolveSector('cerrajero').slug, 'cerrajeria'); // por alias
    assert.strictEqual(isCurated('cerrajeria'), true);
  });
  test('NO puede pisar un sector de la semilla', () => {
    assert.strictEqual(upsertSector({ label: 'dental', norms: ['x'], metricChecks: [{ key: 'k', label: 'l' }] }), null);
    assert.match(resolveSector('dental').label, /dental/i); // sigue siendo el de semilla
  });
  test('hydrate carga un conjunto custom y descarta lo inválido', () => {
    const n = hydrate([
      { slug: 'tatuador', label: 'Estudio de tatuaje', norms: ['Pregunta zona y tamaño y si trae diseño.'], metricChecks: [{ key: 'diseno', label: '¿Capturó el diseño?' }] },
      { label: 'malo' }, // sin normas/métricas → descartado
    ]);
    assert.strictEqual(n, 1);
    assert.strictEqual(resolveSector('tatuador').slug, 'tatuador');
    hydrate([]); // limpia para no afectar a otros tests
    assert.strictEqual(resolveSector('tatuador').slug, 'generico');
  });
  test('allSectors incluye semilla + custom, ordenado', () => {
    upsertSector({ label: 'Óptica ZZZ test', norms: ['x'], metricChecks: [{ key: 'k', label: 'l' }] });
    const all = allSectors();
    assert.ok(all.some(s => s.slug === 'dental'), 'incluye semilla');
    assert.ok(all.some(s => s.custom), 'incluye custom');
    hydrate([]); // limpieza
  });
});
