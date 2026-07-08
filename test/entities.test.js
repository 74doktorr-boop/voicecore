// ============================================================
// NodeFlow — ENTIDADES v0: funciones puras
// Plantillas por sector (integridad del catálogo), validación de
// attrs, display_name y plan de recordatorios del materializador.
// Sin BD: todo determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  ENTITY_TEMPLATES, TEMPLATE_VERSION, MAX_FIELDS, FIELD_TYPES,
  templatesForSector, sectorHasEntityTemplates, instantiateTemplate,
} = require('../src/entities/entity-types');
const {
  validateAttrs, computeDisplayName, normalizePlate, diffAttrs,
} = require('../src/entities/entities');
const {
  entityServiceKey, buildEntityReminderPlan,
} = require('../src/entities/entity-reminders');

// ─── Integridad del catálogo de plantillas (los 14 sectores) ────────────────

describe('ENTITY_TEMPLATES — integridad del catálogo', () => {
  const EXPECTED_SECTORS = [
    'taller', 'veterinaria', 'inmobiliaria', 'abogados', 'asesoria',
    'seguros', 'gimnasio', 'academia', 'optica', 'clima',
    'informatica', 'reformas', 'agencia_viajes', 'dental',
  ];

  test('cubre exactamente los sectores esperados', () => {
    assert.deepStrictEqual(Object.keys(ENTITY_TEMPLATES).sort(), [...EXPECTED_SECTORS].sort());
  });

  test('1 tipo de entidad por sector (regla del catálogo)', () => {
    for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
      assert.strictEqual(templates.length, 1, `${sector} debe tener exactamente 1 tipo`);
    }
  });

  for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
    const t = templates[0];

    test(`${sector}.${t.key} — metadatos completos`, () => {
      assert.ok(t.key && /^[a-z_]+$/.test(t.key), 'key en snake_case');
      assert.ok(t.label_singular, 'label_singular');
      assert.ok(t.label_plural, 'label_plural (nombre de la pestaña)');
      assert.ok(t.label_template, 'label_template');
      assert.ok(t.icon, 'icono para la pestaña');
    });

    test(`${sector}.${t.key} — ≤${MAX_FIELDS} campos, claves únicas, tipos válidos`, () => {
      assert.ok(t.fields.length >= 1 && t.fields.length <= MAX_FIELDS,
        `${t.fields.length} campos (cap duro v0: ${MAX_FIELDS})`);
      const keys = t.fields.map(f => f.key);
      assert.strictEqual(new Set(keys).size, keys.length, 'claves de campo únicas');
      for (const f of t.fields) {
        assert.ok(FIELD_TYPES.includes(f.type), `tipo válido: ${f.key}=${f.type}`);
        assert.ok(f.label, `label de ${f.key}`);
        if (f.type === 'select' || f.type === 'multiselect') {
          assert.ok(Array.isArray(f.options) && f.options.length >= 2, `options de ${f.key}`);
          for (const o of f.options) assert.ok(o.value && o.label, `option {value,label} en ${f.key}`);
        }
      }
    });

    test(`${sector}.${t.key} — al menos un campo-fecha con recordatorio (la killer feature)`, () => {
      const reminders = t.fields.filter(f => f.type === 'date' && f.reminder);
      assert.ok(reminders.length >= 1, `${sector} sin campo-fecha con reminder`);
      for (const f of reminders) {
        assert.strictEqual(typeof f.reminder.offset_days, 'number', `offset_days numérico en ${f.key}`);
        assert.ok(f.reminder.offset_days < 0, `offset_days negativo (avisar ANTES) en ${f.key}`);
        assert.ok(f.reminder.campaign_kind, `campaign_kind en ${f.key}`);
      }
    });

    test(`${sector}.${t.key} — label_template solo referencia campos existentes`, () => {
      const keys = new Set(t.fields.map(f => f.key));
      const refs = [...t.label_template.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map(m => m[1]);
      assert.ok(refs.length >= 1, 'el template usa al menos un campo');
      for (const r of refs) assert.ok(keys.has(r), `{{${r}}} no existe en fields`);
    });

    test(`${sector}.${t.key} — columnas de lista acotadas (máx 5)`, () => {
      const inList = t.fields.filter(f => f.show_in_list);
      assert.ok(inList.length >= 1 && inList.length <= 5, `${inList.length} columnas show_in_list`);
    });
  }
});

// ─── Resolución por sector (aliases y sectores sin entidad) ─────────────────

describe('templatesForSector', () => {
  test('clave directa del catálogo', () => {
    assert.strictEqual(templatesForSector('taller')[0].key, 'vehiculo');
    assert.strictEqual(templatesForSector('seguros')[0].key, 'poliza');
  });

  test('alias del registro de sectores resuelve (veterinario → veterinaria)', () => {
    assert.strictEqual(templatesForSector('veterinario')[0].key, 'mascota');
  });

  test('plural español resuelve (talleres → taller)', () => {
    assert.strictEqual(templatesForSector('talleres')[0].key, 'vehiculo');
  });

  test('sector sin entidades → [] (peluquería: la persona YA es el objeto)', () => {
    assert.deepStrictEqual(templatesForSector('peluqueria'), []);
    assert.deepStrictEqual(templatesForSector('restaurante'), []);
    assert.deepStrictEqual(templatesForSector(''), []);
    assert.deepStrictEqual(templatesForSector(null), []);
  });

  test('sectorHasEntityTemplates — gate del portal y del tool de voz', () => {
    assert.strictEqual(sectorHasEntityTemplates('taller'), true);
    assert.strictEqual(sectorHasEntityTemplates('dental'), true);
    assert.strictEqual(sectorHasEntityTemplates('peluqueria'), false);
  });

  test('kill-switch ENTITIES_DISABLED=1 apaga el gate', () => {
    process.env.ENTITIES_DISABLED = '1';
    try {
      assert.strictEqual(sectorHasEntityTemplates('taller'), false);
    } finally {
      delete process.env.ENTITIES_DISABLED;
    }
    assert.strictEqual(sectorHasEntityTemplates('taller'), true);
  });
});

// ─── Copy-on-create: instanciación de plantillas ─────────────────────────────

describe('instantiateTemplate', () => {
  test('genera la fila con catalog_key versionado (reconciliación v1)', () => {
    const tpl = ENTITY_TEMPLATES.taller[0];
    const row = instantiateTemplate(tpl, 'org-123', 'taller');
    assert.strictEqual(row.organization_id, 'org-123');
    assert.strictEqual(row.key, 'vehiculo');
    assert.strictEqual(row.catalog_key, `taller.vehiculo@${TEMPLATE_VERSION}`);
    assert.strictEqual(row.label_plural, 'Vehículos');
    assert.strictEqual(row.is_active, true);
    assert.deepStrictEqual(row.fields, tpl.fields);
  });
});

// ─── Validación de attrs (regla de negocio en código, no en el LLM) ─────────

describe('validateAttrs', () => {
  const fields = ENTITY_TEMPLATES.taller[0].fields; // matricula required, km number, fechas…

  test('alta válida', () => {
    const r = validateAttrs(fields, {
      matricula: ' 1234ABC ', marca: 'Seat', km: '120000', proxima_itv: '2026-09-15',
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.attrs.matricula, '1234ABC'); // trim
    assert.strictEqual(r.attrs.km, 120000);           // coerción a número
    assert.strictEqual(r.attrs.proxima_itv, '2026-09-15');
  });

  test('required falta → error (solo en alta completa)', () => {
    const r = validateAttrs(fields, { marca: 'Seat' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errors[0].field, 'matricula');
  });

  test('partial (PATCH): required ausente NO es error; vacío = borrar', () => {
    const r = validateAttrs(fields, { km: '', marca: 'Opel' }, { partial: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.attrs.km, null);      // borrado explícito
    assert.strictEqual(r.attrs.marca, 'Opel');
    assert.ok(!('matricula' in r.attrs));
  });

  test('número inválido y coma decimal', () => {
    assert.strictEqual(validateAttrs(fields, { matricula: 'X', km: 'muchos' }).ok, false);
    assert.strictEqual(validateAttrs(fields, { matricula: 'X', km: '1,5' }).attrs.km, 1.5);
  });

  test('fecha inválida (formato y calendario)', () => {
    assert.strictEqual(validateAttrs(fields, { matricula: 'X', proxima_itv: '15/09/2026' }).ok, false);
    assert.strictEqual(validateAttrs(fields, { matricula: 'X', proxima_itv: '2026-02-30' }).ok, false);
    assert.strictEqual(validateAttrs(fields, { matricula: 'X', proxima_itv: '2028-02-29' }).ok, true); // bisiesto
  });

  test('select fuera de opciones → error; opción válida pasa', () => {
    const vetFields = ENTITY_TEMPLATES.veterinaria[0].fields;
    assert.strictEqual(validateAttrs(vetFields, { nombre: 'Luna', especie: 'dinosaurio' }).ok, false);
    const ok = validateAttrs(vetFields, { nombre: 'Luna', especie: 'gato' });
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.attrs.especie, 'gato');
  });

  test('claves desconocidas se descartan (jamás entran a la BD)', () => {
    const r = validateAttrs(fields, { matricula: 'X', hacker: 'sí', __proto__: 'x' });
    assert.strictEqual(r.ok, true);
    assert.ok(!('hacker' in r.attrs));
  });

  test('boolean coerciona strings', () => {
    const boolFields = [{ key: 'activo', type: 'boolean', label: 'Activo' }];
    assert.strictEqual(validateAttrs(boolFields, { activo: 'true' }).attrs.activo, true);
    assert.strictEqual(validateAttrs(boolFields, { activo: 'false' }).attrs.activo, false);
  });

  test('note se recorta a 4000 chars; text a 300', () => {
    const r = validateAttrs(fields, { matricula: 'A'.repeat(500), notas: 'B'.repeat(5000) });
    assert.strictEqual(r.attrs.matricula.length, 300);
    assert.strictEqual(r.attrs.notas.length, 4000);
  });
});

// ─── display_name (lección 1.3 de Twenty: etiqueta desnormalizada) ──────────

describe('computeDisplayName', () => {
  test('plantilla completa', () => {
    assert.strictEqual(
      computeDisplayName('{{marca}} {{modelo}} · {{matricula}}',
        { marca: 'Seat', modelo: 'León', matricula: '1234ABC' }),
      'Seat León · 1234ABC');
  });

  test('limpia separadores huérfanos con campos vacíos', () => {
    assert.strictEqual(
      computeDisplayName('{{marca}} {{modelo}} · {{matricula}}', { matricula: '1234ABC' }),
      '1234ABC');
    assert.strictEqual(
      computeDisplayName('{{marca}} {{modelo}} · {{matricula}}', { marca: 'Seat' }),
      'Seat');
    assert.strictEqual(
      computeDisplayName('{{nombre}} ({{especie}})', { nombre: 'Luna' }),
      'Luna');
  });

  test('todo vacío → fallback, nunca cadena vacía', () => {
    assert.strictEqual(computeDisplayName('{{marca}} {{modelo}}', {}, 'Vehículo'), 'Vehículo');
    assert.strictEqual(computeDisplayName('', {}), 'Sin nombre');
  });

  test('normalizePlate — "1234 abc" y "1234-ABC" son la misma matrícula', () => {
    assert.strictEqual(normalizePlate('1234 abc'), normalizePlate('1234-ABC'));
    assert.strictEqual(normalizePlate(' 1234 abc '), '1234ABC');
  });

  test('diffAttrs — solo las claves que cambian', () => {
    const d = diffAttrs({ km: 100, marca: 'Seat' }, { km: 200, marca: 'Seat' });
    assert.deepStrictEqual(d, { km: { antes: 100, despues: 200 } });
  });
});

// ─── Plan de recordatorios (materializador nocturno) ────────────────────────

describe('buildEntityReminderPlan', () => {
  const vehiculoType = {
    key: 'vehiculo',
    label_singular: 'Vehículo',
    label_template: '{{marca}} {{modelo}} · {{matricula}}',
    fields: ENTITY_TEMPLATES.taller[0].fields,
  };
  const NOW = new Date('2026-07-08T12:00:00');

  test('campo-fecha con reminder → aviso offset_days antes, a las 09:00', () => {
    const plan = buildEntityReminderPlan(vehiculoType, {
      display_name: 'Seat León · 1234ABC',
      attrs: { matricula: '1234ABC', proxima_itv: '2026-09-15' },
    }, NOW);

    assert.strictEqual(plan.length, 1);
    const p = plan[0];
    assert.strictEqual(p.serviceKey, 'entity:vehiculo:proxima_itv');
    // -30 días desde el 15-sep → 16-ago 09:00
    assert.strictEqual(p.scheduledFor.getFullYear(), 2026);
    assert.strictEqual(p.scheduledFor.getMonth(), 7);   // agosto
    assert.strictEqual(p.scheduledFor.getDate(), 16);
    assert.strictEqual(p.scheduledFor.getHours(), 9);
    // message_hint es frase completa → marcador TXT: (envío íntegro)
    assert.ok(p.messagePreview.startsWith('TXT:La ITV de Seat León · 1234ABC caduca el '));
  });

  test('fecha cuyo aviso caería en pasado → NO se programa', () => {
    const plan = buildEntityReminderPlan(vehiculoType, {
      attrs: { matricula: 'X', proxima_itv: '2026-07-20' }, // -30d = junio (pasado)
    }, NOW);
    assert.strictEqual(plan.length, 0);
  });

  test('varios campos-fecha → varios avisos independientes', () => {
    const plan = buildEntityReminderPlan(vehiculoType, {
      attrs: { matricula: 'X', proxima_itv: '2026-10-01', cambio_aceite: '2026-09-01' },
    }, NOW);
    assert.deepStrictEqual(plan.map(p => p.serviceKey).sort(), [
      'entity:vehiculo:cambio_aceite',
      'entity:vehiculo:proxima_itv',
    ]);
  });

  test('campos vacíos, inválidos o date-sin-reminder se ignoran', () => {
    const vetType = { key: 'mascota', label_singular: 'Mascota', label_template: '{{nombre}} ({{especie}})', fields: ENTITY_TEMPLATES.veterinaria[0].fields };
    const plan = buildEntityReminderPlan(vetType, {
      attrs: { nombre: 'Luna', proxima_vacuna: '', desparasitacion: 'no-es-fecha' },
    }, NOW);
    assert.strictEqual(plan.length, 0);

    // gimnasio: fecha_alta es date SIN reminder → no genera aviso
    const gymType = { key: 'membresia', label_singular: 'Membresía', label_template: 'Plan {{plan}}', fields: ENTITY_TEMPLATES.gimnasio[0].fields };
    const plan2 = buildEntityReminderPlan(gymType, { attrs: { plan: 'Anual', fecha_alta: '2026-12-01' } }, NOW);
    assert.strictEqual(plan2.length, 0);
  });

  test('sin display_name lo computa del template para el mensaje', () => {
    const plan = buildEntityReminderPlan(vehiculoType, {
      attrs: { matricula: '9999ZZZ', proxima_itv: '2026-12-01' },
    }, NOW);
    assert.ok(plan[0].messagePreview.includes('9999ZZZ'));
  });

  test('entityServiceKey — formato estable (dedupe del job)', () => {
    assert.strictEqual(entityServiceKey('poliza', 'fecha_renovacion'), 'entity:poliza:fecha_renovacion');
  });

  test('todas las plantillas del catálogo generan al menos un aviso con datos', () => {
    // Garantía de punta a punta del catálogo: con su primer campo-fecha
    // relleno, CADA sector produce un recordatorio bien formado.
    for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
      const t = templates[0];
      const dateField = t.fields.find(f => f.type === 'date' && f.reminder);
      const attrs = {};
      for (const f of t.fields) {
        if (f.required) attrs[f.key] = (f.type === 'select') ? f.options[0].value : 'Dato';
      }
      attrs[dateField.key] = '2027-06-01'; // lejos en el futuro
      const plan = buildEntityReminderPlan(t, { attrs }, NOW);
      const hit = plan.find(p => p.serviceKey === `entity:${t.key}:${dateField.key}`);
      assert.ok(hit, `${sector}: sin aviso para ${dateField.key}`);
      assert.ok(hit.scheduledFor > NOW, `${sector}: aviso en futuro`);
      assert.ok(hit.messagePreview && hit.messagePreview.length > 4, `${sector}: mensaje vacío`);
    }
  });
});
