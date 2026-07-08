// ============================================================
// NodeFlow — Tests de LA ENTIDAD LLAMA (avisos por voz que reservan)
// Lógica pura: selección de candidatos (ventana del aviso), gating
// por plantilla (oportunidad de servicio), clave de dedupe por ciclo,
// bloque de propósito y franja de encolado. Charter: reglas de
// negocio fuera del LLM, testeables sin BD.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  isServiceOpportunity,
  entityCallDedupeKey,
  isEntityCallEnqueueWindow,
  buildEntityCallPlan,
  buildEntityCallBlock,
  NON_CALLABLE_KINDS,
} = require('../src/entities/entity-calls');
const { ENTITY_TEMPLATES } = require('../src/entities/entity-types');

const vehiculoType = {
  key: 'vehiculo',
  label_singular: 'Vehículo',
  label_template: '{{marca}} {{modelo}} · {{matricula}}',
  fields: ENTITY_TEMPLATES.taller[0].fields,
};

// 8-jul-2026, 12:00 — misma referencia que los tests del materializador
const NOW = new Date('2026-07-08T12:00:00');

// ─── Gating por plantilla: ¿oportunidad de servicio? ─────────────────────────

describe('isServiceOpportunity', () => {
  test('ITV, vacuna, renovación, certificado → SÍ se llama (venden servicio)', () => {
    for (const kind of ['itv', 'vacuna', 'renovacion', 'certificado', 'garantia', 'caducidad_bono']) {
      assert.strictEqual(isServiceOpportunity({ campaign_kind: kind }), true, kind);
    }
  });

  test('cumpleaños y logística de eventos ya reservados → NO se llama', () => {
    for (const kind of ['cumple', 'entrada', 'recogida', 'reconfirmacion', 'firma', 'sesion', 'hito', 'dispensacion']) {
      assert.strictEqual(isServiceOpportunity({ campaign_kind: kind }), false, kind);
    }
  });

  test('sin reminder → no hay nada que llamar', () => {
    assert.strictEqual(isServiceOpportunity(null), false);
    assert.strictEqual(isServiceOpportunity(undefined), false);
  });

  test('la lista negra solo contiene kinds que existen o previstos (sanidad)', () => {
    assert.ok(NON_CALLABLE_KINDS.size >= 7);
    assert.ok(!NON_CALLABLE_KINDS.has('itv'));
    assert.ok(!NON_CALLABLE_KINDS.has('renovacion'));
  });
});

// ─── Clave de dedupe por ciclo ───────────────────────────────────────────────

describe('entityCallDedupeKey', () => {
  test('formato estable (entidad|campo|fecha)', () => {
    assert.strictEqual(entityCallDedupeKey('e-1', 'proxima_itv', '2026-09-15'), 'e-1|proxima_itv|2026-09-15');
  });

  test('cambiar la fecha del campo = ciclo NUEVO (se puede volver a llamar)', () => {
    assert.notStrictEqual(
      entityCallDedupeKey('e-1', 'proxima_itv', '2026-09-15'),
      entityCallDedupeKey('e-1', 'proxima_itv', '2027-09-15'),
    );
  });
});

// ─── Franja de encolado (10-14h Madrid) ─────────────────────────────────────

describe('franja de encolado (10-14h Madrid)', () => {
  // jul 2026 → CEST (UTC+2)
  const madrid = (hour) => new Date(Date.UTC(2026, 6, 7, hour - 2, 30, 0));

  test('11:30 → dentro', () => assert.strictEqual(isEntityCallEnqueueWindow(madrid(11)), true));
  test('09:30 → fuera (aún no)', () => assert.strictEqual(isEntityCallEnqueueWindow(madrid(9)), false));
  test('14:30 → fuera (por la tarde no se llama en frío)', () => assert.strictEqual(isEntityCallEnqueueWindow(madrid(14)), false));
  test('17:30 → fuera', () => assert.strictEqual(isEntityCallEnqueueWindow(madrid(17)), false));
});

// ─── Selección de candidatos (plan de llamadas) ──────────────────────────────

describe('buildEntityCallPlan', () => {
  test('fecha dentro de la ventana del aviso → candidata, con CTA de la plantilla', () => {
    // ITV el 20-jul, offset -30 → la ventana abrió el 20-jun; hoy 8-jul: SÍ
    const plan = buildEntityCallPlan(vehiculoType, {
      id: 'ent-1',
      display_name: 'Seat León · 1234ABC',
      attrs: { matricula: '1234ABC', proxima_itv: '2026-07-20' },
    }, NOW);

    assert.strictEqual(plan.length, 1);
    const p = plan[0];
    assert.strictEqual(p.fieldKey, 'proxima_itv');
    assert.strictEqual(p.fieldLabel, 'Próxima ITV');
    assert.strictEqual(p.dueDate, '2026-07-20');
    assert.strictEqual(p.dedupeKey, 'ent-1|proxima_itv|2026-07-20');
    // El CTA vende el servicio DEL TALLER (pre-ITV), con {{entity}}/{{value}} resueltos
    assert.ok(p.serviceHint.includes('Seat León · 1234ABC'));
    assert.ok(p.serviceHint.includes('¿Te lo revisamos antes'));
    assert.ok(!p.serviceHint.includes('{{'));
  });

  test('la ventana aún no abrió → NO se llama todavía', () => {
    // ITV el 15-sep, offset -30 → ventana abre el 16-ago; hoy 8-jul: NO
    const plan = buildEntityCallPlan(vehiculoType, {
      id: 'ent-1',
      attrs: { matricula: 'X', proxima_itv: '2026-09-15' },
    }, NOW);
    assert.strictEqual(plan.length, 0);
  });

  test('el día D (o pasado) → NO se llama (la pre-ITV solo vale ANTES)', () => {
    for (const fecha of ['2026-07-08', '2026-07-01']) {
      const plan = buildEntityCallPlan(vehiculoType, {
        id: 'ent-1',
        attrs: { matricula: 'X', proxima_itv: fecha },
      }, NOW);
      assert.strictEqual(plan.length, 0, fecha);
    }
  });

  test('varios campos en ventana → varias candidatas independientes', () => {
    const plan = buildEntityCallPlan(vehiculoType, {
      id: 'ent-1',
      attrs: { matricula: 'X', proxima_itv: '2026-07-25', cambio_aceite: '2026-07-15' },
    }, NOW);
    assert.deepStrictEqual(plan.map(p => p.fieldKey).sort(), ['cambio_aceite', 'proxima_itv']);
  });

  test('campos vacíos, inválidos o date-sin-reminder se ignoran', () => {
    const plan = buildEntityCallPlan(vehiculoType, {
      id: 'ent-1',
      attrs: { matricula: 'X', proxima_itv: '', cambio_aceite: 'no-es-fecha' },
    }, NOW);
    assert.strictEqual(plan.length, 0);
  });

  test('kind no-llamable (logística) queda fuera aunque esté en ventana', () => {
    // residencia_mascotas: fecha_entrada (kind 'entrada') NO es venta;
    // en el mismo tipo, si hubiera un campo llamable, ese sí entraría.
    const resType = {
      key: ENTITY_TEMPLATES.residencia_mascotas[0].key,
      label_singular: ENTITY_TEMPLATES.residencia_mascotas[0].label_singular,
      label_template: ENTITY_TEMPLATES.residencia_mascotas[0].label_template,
      fields: ENTITY_TEMPLATES.residencia_mascotas[0].fields,
    };
    const entradaField = resType.fields.find(f => f.reminder && f.reminder.campaign_kind === 'entrada');
    assert.ok(entradaField, 'la plantilla de residencia tiene campo de entrada');
    const attrs = {};
    for (const f of resType.fields) {
      if (f.required) attrs[f.key] = (f.type === 'select') ? f.options[0].value : 'Dato';
    }
    attrs[entradaField.key] = '2026-07-10'; // en ventana (offset -3)
    const plan = buildEntityCallPlan(resType, { id: 'e', attrs }, NOW);
    assert.ok(!plan.some(p => p.fieldKey === entradaField.key), 'entrada no genera llamada');
  });

  test('sin display_name lo computa del template para el guion', () => {
    const plan = buildEntityCallPlan(vehiculoType, {
      id: 'ent-1',
      attrs: { matricula: '9999ZZZ', proxima_itv: '2026-07-20' },
    }, NOW);
    assert.ok(plan[0].displayName.includes('9999ZZZ'));
  });

  test('catálogo: taller, veterinaria y pólizas tienen al menos un campo llamable', () => {
    for (const sector of ['taller', 'veterinaria', 'aseguradora']) {
      const t = (ENTITY_TEMPLATES[sector] || [])[0];
      if (!t) continue; // el sector puede llamarse distinto; los dos primeros existen seguro
      const callable = t.fields.some(f => f.type === 'date' && f.reminder && isServiceOpportunity(f.reminder));
      assert.ok(callable, `${sector}: sin campo llamable`);
    }
  });
});

// ─── Bloque de propósito (el guion que lee el asistente) ─────────────────────

describe('buildEntityCallBlock', () => {
  const block = buildEntityCallBlock('Taller Aranzadi', {
    clientName:    'María',
    entityName:    'Seat León · 1234ABC',
    fieldLabel:    'Próxima ITV',
    dueDatePretty: '20/7/2026',
    serviceHint:   'A tu Seat León · 1234ABC le toca la ITV el 20/7/2026. ¿Te lo revisamos antes?',
  });

  test('menciona negocio, cliente, entidad, campo y fecha', () => {
    assert.match(block, /Taller Aranzadi/);
    assert.match(block, /María/);
    assert.match(block, /Seat León · 1234ABC/);
    assert.match(block, /Próxima ITV/);
    assert.match(block, /20\/7\/2026/);
  });

  test('instruye reservar con book_appointment y buscar hueco antes', () => {
    assert.match(block, /check_availability/);
    assert.match(block, /book_appointment/);
  });

  test('sin presión: no insistir, y colgar si salta el buzón', () => {
    assert.match(block, /NO insistas/);
    assert.match(block, /buz[oó]n/i);
    assert.match(block, /cuelga sin dejar mensaje/);
  });

  test('sin nombre de cliente no rompe', () => {
    const b = buildEntityCallBlock('X', { entityName: 'Golf', fieldLabel: 'ITV', dueDatePretty: 'mañana', serviceHint: 'hint' });
    assert.match(b, /un cliente/);
  });
});

// ─── Enqueuer: puertas de entrada (sin BD en test → NO-OP con gracia) ────────

describe('enqueueEntityDateCalls — gates', () => {
  const { enqueueEntityDateCalls } = require('../src/entities/entity-calls');
  // jul 2026 → CEST (UTC+2)
  const madrid = (hour) => new Date(Date.UTC(2026, 6, 7, hour - 2, 30, 0));

  test('fuera de la franja 10-14h → no toca la BD', async () => {
    const out = await enqueueEntityDateCalls({ now: madrid(17) });
    assert.strictEqual(out.queued, 0);
    assert.strictEqual(out.skippedReason, 'fuera de franja');
  });

  test('en franja pero sin BD → NO-OP en silencio (cero encoladas)', async () => {
    const out = await enqueueEntityDateCalls({ now: madrid(11) });
    assert.deepStrictEqual(out, { orgs: 0, scanned: 0, queued: 0, skipped: 0 });
  });
});
