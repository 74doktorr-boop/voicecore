// ============================================================
// NodeFlow — Portal polish (2026-07-09): 3 fixes reportados por el fundador
//   1. hasPassword según el estado real (automation_config.auth.hash)
//   2. la pestaña de Entidades SIGUE al sector (deactivationPlan)
//   3. estados vacíos con el vocabulario del PROPIO sector (emptyStateVocabulary)
// Todo lógica PURA, sin BD: determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  ENTITY_TEMPLATES, templatesForSector,
  deactivationPlan, emptyStateVocabulary,
} = require('../src/entities/entity-types');

// ─── FIX 1: resolución de hasPassword ────────────────────────────────────────
// El GET /config resuelve hasPassword = !!(automation_config.auth.hash) sobre la
// fila FRESCA de BD. Fijamos la regla exacta (misma expresión que el endpoint).

describe('FIX 1 — hasPassword se resuelve de automation_config.auth.hash', () => {
  const resolve = (dbAuto) => !!(dbAuto && dbAuto.auth && dbAuto.auth.hash);

  test('org CON hash → true (el bug: se enseñaba el campo en blanco igualmente)', () => {
    assert.strictEqual(resolve({ auth: { salt: 's', hash: 'h', updatedAt: 'x' } }), true);
  });

  test('org SIN auth → false', () => {
    assert.strictEqual(resolve({ config: { avgTicket: 35 } }), false);
    assert.strictEqual(resolve({}), false);
    assert.strictEqual(resolve(null), false);
  });

  test('auth presente pero SIN hash (p.ej. limpiado) → false', () => {
    assert.strictEqual(resolve({ auth: {} }), false);
    assert.strictEqual(resolve({ auth: { salt: 's' } }), false);
  });

  test('el hash vive en .auth (raíz), NO bajo .config', () => {
    // Si alguien lo pusiera por error en .config, hasPassword debe seguir false:
    // la fuente de verdad es automation_config.auth.hash.
    assert.strictEqual(resolve({ config: { auth: { hash: 'h' } } }), false);
  });
});

// ─── FIX 2: la pestaña de Entidades sigue al sector ──────────────────────────

describe('FIX 2 — deactivationPlan: la pestaña sigue al sector actual', () => {
  test('fisioterapia → taller: se desactiva plan_tratamiento, se activa vehiculo', () => {
    // La org venía de fisioterapia (plan_tratamiento activo) y cambia a taller.
    const existing = [
      { id: 'p1', key: 'plan_tratamiento', is_active: true },
      { id: 'v1', key: 'vehiculo',         is_active: true },  // ya sembrado antes
    ];
    const plan = deactivationPlan(existing, templatesForSector('taller'));
    assert.deepStrictEqual(plan.toDeactivate, ['p1'], 'plan_tratamiento (ajeno) se desactiva');
    assert.deepStrictEqual(plan.toReactivate, [], 'vehiculo ya estaba activo');
  });

  test('volver a fisioterapia REACTIVA plan_tratamiento (datos intactos, no se borró)', () => {
    // Estado tras el cambio anterior: plan_tratamiento quedó is_active=false.
    const existing = [
      { id: 'p1', key: 'plan_tratamiento', is_active: false },
      { id: 'v1', key: 'vehiculo',         is_active: true },
    ];
    const plan = deactivationPlan(existing, templatesForSector('fisioterapia'));
    assert.deepStrictEqual(plan.toReactivate, ['p1'], 'plan_tratamiento vuelve a activarse');
    assert.deepStrictEqual(plan.toDeactivate, ['v1'], 'vehiculo (ahora ajeno) se desactiva');
  });

  test('sin cambios cuando ya está todo alineado con el sector', () => {
    const existing = [{ id: 'v1', key: 'vehiculo', is_active: true }];
    const plan = deactivationPlan(existing, templatesForSector('taller'));
    assert.deepStrictEqual(plan, { toDeactivate: [], toReactivate: [] });
  });

  test('filas sin id se ignoran (nunca se intenta un UPDATE inválido)', () => {
    const existing = [{ key: 'plan_tratamiento', is_active: true }]; // sin id
    const plan = deactivationPlan(existing, templatesForSector('taller'));
    assert.deepStrictEqual(plan, { toDeactivate: [], toReactivate: [] });
  });

  test('is_active undefined cuenta como activo (columna vieja sin default)', () => {
    const existing = [{ id: 'x1', key: 'plan_tratamiento' }]; // is_active ausente
    const plan = deactivationPlan(existing, templatesForSector('taller'));
    assert.deepStrictEqual(plan.toDeactivate, ['x1']);
  });

  test('entrada vacía / nula → plan vacío', () => {
    assert.deepStrictEqual(deactivationPlan([], templatesForSector('taller')), { toDeactivate: [], toReactivate: [] });
    assert.deepStrictEqual(deactivationPlan(null, []), { toDeactivate: [], toReactivate: [] });
  });
});

// ─── FIX 3: vocabulario del propio sector en el estado vacío ─────────────────

describe('FIX 3 — emptyStateVocabulary: cada sector con SUS palabras', () => {
  test('fisioterapia usa su vocabulario (revisión, caducidad del bono), no ITV', () => {
    const v = emptyStateVocabulary(ENTITY_TEMPLATES.fisioterapia[0]);
    assert.strictEqual(v.labelPlural, 'Planes de tratamiento');
    // Toma los 3 primeros campos-fecha del sector (catálogo enriquecido).
    assert.deepStrictEqual(v.dateExamples, ['revisión', 'caducidad del bono', 'sesión']);
    assert.strictEqual(v.examplesText, 'revisión, caducidad del bono, sesión');
    assert.ok(!/itv|vacuna/i.test(v.examplesText), 'nunca vocabulario de otro sector');
  });

  test('taller sí usa ITV/revisión/cambio de aceite (su propio vocabulario)', () => {
    const v = emptyStateVocabulary(ENTITY_TEMPLATES.taller[0]);
    assert.deepStrictEqual(v.dateExamples, ['itv', 'revisión', 'cambio de aceite']);
    assert.strictEqual(v.labelSingular, 'Vehículo');
  });

  test('limpia prefijos "Próxima/o", "Fecha de", "Última" y paréntesis', () => {
    const type = { fields: [
      { type: 'date', label: 'Próxima revisión' },
      { type: 'date', label: 'Fecha de renovación' },
      { type: 'date', label: 'Última visita (opcional)' },
    ] };
    assert.deepStrictEqual(emptyStateVocabulary(type).dateExamples,
      ['revisión', 'renovación', 'visita']);
  });

  test('máximo 3 ejemplos y sin duplicados', () => {
    const type = { fields: [
      { type: 'date', label: 'Próxima revisión' },
      { type: 'date', label: 'Revisión' },            // duplicado tras limpiar
      { type: 'date', label: 'Caducidad' },
      { type: 'date', label: 'Fin de garantía' },
      { type: 'date', label: 'Cuarta fecha' },
    ] };
    const v = emptyStateVocabulary(type);
    assert.strictEqual(v.dateExamples.length, 3);
    assert.deepStrictEqual(v.dateExamples, ['revisión', 'caducidad', 'fin de garantía']);
  });

  test('tipo SIN campos-fecha → texto genérico del propio tipo, jamás de otro', () => {
    const v = emptyStateVocabulary({ label_singular: 'Cosa', label_plural: 'Cosas', fields: [
      { type: 'text', label: 'Nombre' },
    ] });
    assert.deepStrictEqual(v.dateExamples, []);
    assert.strictEqual(v.examplesText, 'fechas importantes de cada cosa');
  });

  test('input vacío/undefined no revienta (gracia)', () => {
    const v = emptyStateVocabulary(undefined);
    assert.strictEqual(v.labelPlural, 'fichas');
    assert.deepStrictEqual(v.dateExamples, []);
  });

  test('CADA plantilla del catálogo produce vocabulario NO vacío', () => {
    for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
      const v = emptyStateVocabulary(templates[0]);
      assert.ok(v.examplesText && v.examplesText.length > 3, `${sector}: examplesText vacío`);
      // Todas las plantillas tienen al menos un campo-fecha (garantía del catálogo),
      // así que dateExamples nunca debería estar vacío.
      assert.ok(v.dateExamples.length >= 1, `${sector}: sin dateExamples pese a tener campo-fecha`);
    }
  });
});
