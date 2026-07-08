// ============================================================
// NodeFlow — ENTIDADES v1: funciones puras de la ficha viva
//   · buildEntityTimeline — unión eventos + citas + avisos
//   · groupableField — vista agrupada por estado/fase
//   · entity-ai — candados deterministas de la IA que escribe
// Sin BD ni LLM: todo determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { buildEntityTimeline, MAX_ITEMS } = require('../src/entities/entity-timeline');
const { groupableField, ENTITY_TEMPLATES } = require('../src/entities/entity-types');
const {
  resolveDateField, dateFieldLabels, advanceDate, resolveTargetDate, draftIsComplete,
} = require('../src/entities/entity-ai');

const NOW = new Date('2026-07-08T12:00:00');

// ─── Timeline universal (unión de las tres fuentes) ─────────────────────────

describe('buildEntityTimeline', () => {
  test('une eventos + citas + avisos: próximos primero (ascendente), pasado después (descendente)', () => {
    const items = buildEntityTimeline({
      events: [
        { happens_at: '2026-07-01T10:00:00Z', kind: 'created', title: 'Vehículo creado: Golf', actor: 'staff' },
        { happens_at: '2026-07-05T10:00:00Z', kind: 'note', title: 'Cliente avisado por teléfono', actor: 'staff' },
      ],
      appointments: [
        { date: '2026-07-20', time: '10:00', service: 'ITV', status: 'confirmed' },   // futura
        { date: '2026-06-20', time: '09:00', service: 'Revisión', status: 'confirmed' }, // pasada
      ],
      reminders: [
        { status: 'pending', scheduled_for: '2026-07-15T09:00:00Z', message_preview: 'TXT:La ITV caduca pronto', channel: 'whatsapp' },
        { status: 'sent', sent_at: '2026-06-25T09:00:00Z', message_preview: 'Aviso previo', channel: 'whatsapp' },
      ],
      now: NOW,
    });

    // Próximos: aviso del 15 antes que la cita del 20 (ascendente)
    assert.strictEqual(items[0].kind, 'reminder_upcoming');
    assert.strictEqual(items[0].icon, '🔔');
    assert.strictEqual(items[0].upcoming, true);
    assert.strictEqual(items[1].kind, 'appointment');
    assert.strictEqual(items[1].upcoming, true);

    // Pasado: lo más reciente arriba (nota 5-jul > cita 20-jun)
    const past = items.filter(i => !i.upcoming);
    assert.strictEqual(past.length, 4);
    assert.ok(new Date(past[0].at) >= new Date(past[1].at));
    assert.ok(new Date(past[1].at) >= new Date(past[2].at));
  });

  test('títulos listos-para-pintar: TXT: se limpia, la IA se firma 🤖', () => {
    const items = buildEntityTimeline({
      events: [{ happens_at: '2026-07-01T10:00:00Z', kind: 'field_change', title: 'Datos actualizados: proxima_itv', actor: 'ai' }],
      reminders: [{ status: 'pending', scheduled_for: '2026-08-01T09:00:00Z', message_preview: 'TXT:La ITV de Golf caduca el 15/9', channel: 'whatsapp' }],
      now: NOW,
    });
    const ai = items.find(i => i.kind === 'event:field_change');
    assert.strictEqual(ai.icon, '🤖');
    assert.ok(ai.title.startsWith('La IA — '));
    const bell = items.find(i => i.kind === 'reminder_upcoming');
    assert.strictEqual(bell.title, 'Aviso programado — La ITV de Golf caduca el 15/9');
  });

  test('field_change trae el diff legible con las etiquetas del tipo', () => {
    const items = buildEntityTimeline({
      events: [{
        happens_at: '2026-07-01T10:00:00Z', kind: 'field_change',
        title: 'Datos actualizados: km',
        properties: { km: { antes: 100, despues: 200 } }, actor: 'staff',
      }],
      fieldLabels: { km: 'Kilómetros' },
      now: NOW,
    });
    assert.strictEqual(items[0].meta, 'Kilómetros: 100 → 200');
    assert.strictEqual(items[0].icon, '✏️');
  });

  test('citas canceladas se pintan pero NUNCA como próximas; avisos cancelados no aparecen', () => {
    const items = buildEntityTimeline({
      appointments: [{ date: '2026-08-01', time: '10:00', service: 'ITV', status: 'cancelled' }],
      reminders: [{ status: 'cancelled', scheduled_for: '2026-08-01T09:00:00Z', message_preview: 'x' }],
      now: NOW,
    });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].icon, '❌');
    assert.strictEqual(items[0].upcoming, false);
  });

  test('entrada vacía → [] y el cap de items se respeta', () => {
    assert.deepStrictEqual(buildEntityTimeline({}), []);
    const many = Array.from({ length: 200 }, (_, i) => ({
      happens_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`, kind: 'note', title: 'n' + i,
    }));
    assert.strictEqual(buildEntityTimeline({ events: many, now: NOW }).length, MAX_ITEMS);
  });

  test('aviso pospuesto sigue siendo próximo y lo dice en el meta', () => {
    const items = buildEntityTimeline({
      reminders: [{ status: 'postponed', scheduled_for: '2026-09-01T09:00:00Z', message_preview: 'Renovación', channel: 'whatsapp' }],
      now: NOW,
    });
    assert.strictEqual(items[0].upcoming, true);
    assert.ok(items[0].meta.includes('pospuesto'));
  });
});

// ─── Vista agrupada: detección del campo agrupable ───────────────────────────

describe('groupableField', () => {
  test('el PRIMER select con 2..6 opciones agrupa', () => {
    const gf = groupableField([
      { key: 'nombre', type: 'text' },
      { key: 'estado', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    ]);
    assert.strictEqual(gf.key, 'estado');
  });

  test('selects con >6 opciones se saltan (no caben como secciones en un móvil)', () => {
    // abogados: 'tipo' tiene 7 opciones → se salta; 'estado' (3) agrupa
    const gf = groupableField(ENTITY_TEMPLATES.abogados[0].fields);
    assert.strictEqual(gf.key, 'estado');
  });

  test('sin selects → null (la lista sigue plana): taller', () => {
    assert.strictEqual(groupableField(ENTITY_TEMPLATES.taller[0].fields), null);
  });

  test('casos representativos del catálogo: reformas→estado, autoescuela→tipo, veterinaria→especie', () => {
    assert.strictEqual(groupableField(ENTITY_TEMPLATES.reformas[0].fields).key, 'estado');
    assert.strictEqual(groupableField(ENTITY_TEMPLATES.autoescuela[0].fields).key, 'tipo');
    assert.strictEqual(groupableField(ENTITY_TEMPLATES.veterinaria[0].fields).key, 'especie');
  });

  test('genérico para las 36 plantillas: o null o un select válido de 2..6 opciones', () => {
    for (const [sector, templates] of Object.entries(ENTITY_TEMPLATES)) {
      const gf = groupableField(templates[0].fields);
      if (gf === null) continue;
      assert.strictEqual(gf.type, 'select', `${sector}: agrupable debe ser select`);
      assert.ok(gf.options.length >= 2 && gf.options.length <= 6, `${sector}: 2..6 opciones`);
    }
  });

  test('entrada basura → null', () => {
    assert.strictEqual(groupableField(null), null);
    assert.strictEqual(groupableField([]), null);
  });
});

// ─── IA que escribe: resolución del campo-fecha (candado) ────────────────────

describe('resolveDateField', () => {
  const fields = ENTITY_TEMPLATES.taller[0].fields; // proxima_itv, proxima_revision, cambio_aceite

  test('casa por key exacta y por label', () => {
    assert.strictEqual(resolveDateField(fields, 'proxima_itv').key, 'proxima_itv');
    assert.strictEqual(resolveDateField(fields, 'Próxima ITV').key, 'proxima_itv');
  });

  test('casa por inclusión hablada ("itv", "aceite")', () => {
    assert.strictEqual(resolveDateField(fields, 'itv').key, 'proxima_itv');
    assert.strictEqual(resolveDateField(fields, 'el aceite').key, 'cambio_aceite');
  });

  test('ambiguo → null (mejor preguntar que escribir donde no toca)', () => {
    // 'proxima' casa proxima_itv Y proxima_revision → ambiguo
    assert.strictEqual(resolveDateField(fields, 'proxima'), null);
  });

  test('CANDADO: jamás devuelve un campo que no sea fecha', () => {
    assert.strictEqual(resolveDateField(fields, 'notas'), null);
    assert.strictEqual(resolveDateField(fields, 'matricula'), null);
    assert.strictEqual(resolveDateField(fields, 'km'), null);
  });

  test('sin campos fecha → null; un solo campo fecha sin pista → ese', () => {
    assert.strictEqual(resolveDateField([{ key: 'x', type: 'text', label: 'X' }], 'x'), null);
    const single = [{ key: 'caducidad', type: 'date', label: 'Caducidad' }];
    assert.strictEqual(resolveDateField(single, '').key, 'caducidad');
  });

  test('dateFieldLabels — para preguntar con las palabras del negocio', () => {
    assert.deepStrictEqual(dateFieldLabels(fields),
      ['Próxima ITV', 'Próxima revisión', 'Próximo cambio de aceite']);
  });
});

// ─── IA que escribe: aritmética de calendario EN CÓDIGO ──────────────────────

describe('advanceDate / resolveTargetDate', () => {
  test('suma años/meses/días', () => {
    assert.strictEqual(advanceDate('2026-07-08', { years: 1 }), '2027-07-08');
    assert.strictEqual(advanceDate('2026-07-08', { months: 6 }), '2027-01-08');
    assert.strictEqual(advanceDate('2026-07-08', { days: 15 }), '2026-07-23');
    assert.strictEqual(advanceDate('2026-07-08', {}), '2026-07-08');
  });

  test('fin de mes seguro: 31-ene + 1 mes = 28-feb (clamp, nunca 2-mar)', () => {
    assert.strictEqual(advanceDate('2026-01-31', { months: 1 }), '2026-02-28');
    assert.strictEqual(advanceDate('2027-01-31', { months: 1 }), '2027-02-28');
    assert.strictEqual(advanceDate('2028-01-31', { months: 1 }), '2028-02-29'); // bisiesto
    assert.strictEqual(advanceDate('2028-02-29', { years: 1 }), '2029-02-28');  // 29-feb +1 año
  });

  test('base inválida → null', () => {
    assert.strictEqual(advanceDate('no-fecha', { years: 1 }), null);
    assert.strictEqual(advanceDate('', {}), null);
  });

  test('resolveTargetDate: "hoy" + plus_years=1 → dentro de un año (la cuenta la hace el código, no el LLM)', () => {
    const r = resolveTargetDate({ dateRaw: 'hoy', plusYears: 1, todayIso: '2026-07-08' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.iso, '2027-07-08');
  });

  test('resolveTargetDate: ISO directo pasa tal cual; lo ininteligible pide aclarar', () => {
    assert.strictEqual(resolveTargetDate({ dateRaw: '2027-03-15', todayIso: '2026-07-08' }).iso, '2027-03-15');
    const bad = resolveTargetDate({ dateRaw: 'cuando pueda', todayIso: '2026-07-08' });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.error.includes('cuando pueda'));
  });
});

// ─── Borradores de la IA: el badge se apaga solo al completar ────────────────

describe('draftIsComplete', () => {
  const fields = ENTITY_TEMPLATES.taller[0].fields; // matricula required

  test('required vacío → incompleto; con valor → completo', () => {
    assert.strictEqual(draftIsComplete(fields, { marca: 'Seat' }), false);
    assert.strictEqual(draftIsComplete(fields, { matricula: '1234ABC' }), true);
  });

  test('required en blanco o array vacío cuentan como falta', () => {
    assert.strictEqual(draftIsComplete(fields, { matricula: '' }), false);
    assert.strictEqual(draftIsComplete([{ key: 'tags', type: 'multiselect', required: true, options: [] }], { tags: [] }), false);
  });

  test('sin required → siempre completo (el borrador no se queda pegado)', () => {
    assert.strictEqual(draftIsComplete([{ key: 'x', type: 'text' }], {}), true);
    assert.strictEqual(draftIsComplete([], {}), true);
  });
});
