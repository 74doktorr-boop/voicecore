// ============================================================
// NodeFlow — ENTIDADES: LA FICHA COMUNICA — resumen al cliente
//   · buildEntitySummaryMessage — PURA, sector-aware, emoji-safe
// Sin BD ni LLM: todo determinista.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { buildEntitySummaryMessage, wellFormed, sendEntitySummary } = require('../src/entities/entity-notify');
const { ENTITY_TEMPLATES } = require('../src/entities/entity-types');

/** Plantilla del catálogo por sector (primera del array). */
function tpl(sector) { return ENTITY_TEMPLATES[sector][0]; }

describe('buildEntitySummaryMessage', () => {
  test('fisioterapia — plan de sesiones: saludo con nombre + datos clave humanos', () => {
    const type = tpl('fisioterapia');
    const entity = {
      display_name: 'Plan Hombro · 10/10',
      attrs: { motivo: 'Hombro', sesiones_totales: 10, sesiones_restantes: 10, proxima_sesion: '2026-12-07' },
    };
    const msg = buildEntitySummaryMessage(type, entity, { name: 'Raúl García' });
    assert.ok(msg.startsWith('Hola Raúl 👋'), msg);
    assert.ok(msg.includes('Plan Hombro'), msg);
    assert.ok(msg.includes('7/12/2026'), 'fecha bonita: ' + msg);
    assert.ok(msg.includes('respóndenos por aquí'), msg);
    // No es un volcado: la nota nunca aparece
    assert.ok(!/notas/i.test(msg), msg);
  });

  test('taller — vehículo: fecha con etiqueta y "el <fecha>"; sin nombre → saludo genérico', () => {
    const type = tpl('taller');
    const entity = {
      display_name: 'Seat Ibiza · 1234 ABC',
      attrs: { matricula: '1234 ABC', marca: 'Seat', modelo: 'Ibiza', proxima_itv: '2026-09-15' },
    };
    const msg = buildEntitySummaryMessage(type, entity, {});
    assert.ok(msg.startsWith('¡Hola! 👋'), msg);
    assert.ok(msg.includes('Seat Ibiza'), msg);
    assert.ok(/próxima itv el 15\/9\/2026/i.test(msg), 'fecha etiquetada: ' + msg);
    // La matrícula ya está en el título → no se repite como "Matrícula: 1234 ABC"
    assert.ok(!/matrícula:/i.test(msg), 'no repite identificador del título: ' + msg);
  });

  test('estetica_avanzada — bono: select con label legible, no el value crudo', () => {
    const type = tpl('laser'); // zona es un select
    const entity = {
      display_name: 'Láser Piernas · 3/8',
      attrs: { zona: 'piernas', sesiones_totales: 8, sesiones_restantes: 3, proxima_sesion: '2026-08-01' },
    };
    const msg = buildEntitySummaryMessage(type, entity, { name: 'Ana' });
    // 'piernas' aparece en el display_name → se omite del cuerpo; no debe salir el value crudo
    assert.ok(!/zona: piernas/i.test(msg), msg);
    assert.ok(msg.includes('3'), 'sesiones restantes: ' + msg);
  });

  test('seguros — póliza: skip de campos vacíos, NUNCA "undefined" ni "null"', () => {
    const type = tpl('seguros');
    const entity = {
      display_name: 'Auto Mapfre · P-123',
      attrs: { numero: 'P-123', compania: 'Mapfre', ramo: 'auto', fecha_renovacion: '2026-10-01' },
      // prima_anual ausente a propósito
    };
    const msg = buildEntitySummaryMessage(type, entity, { name: 'Luis' });
    assert.ok(!/undefined/i.test(msg), msg);
    assert.ok(!/null/i.test(msg), msg);
    assert.ok(/renovación el 1\/10\/2026/i.test(msg), msg);
  });

  test('emoji-safe: siempre termina bien (nunca corta un suplente UTF-16)', () => {
    const type = tpl('veterinaria');
    const entity = { display_name: 'Toby (perro)', attrs: { nombre: 'Toby', especie: 'perro', proxima_vacuna: '2026-09-01' } };
    const msg = buildEntitySummaryMessage(type, entity, { name: 'Marta' });
    // Sin suplentes huérfanos: wellFormed(msg) === msg
    assert.strictEqual(wellFormed(msg), msg);
    // encodeURIComponent no lanza (el botón wa.me sobrevive)
    assert.doesNotThrow(() => encodeURIComponent(msg));
  });

  test('sin datos clave rellenos: cae a un mensaje honesto, no inventa', () => {
    const type = tpl('generico');
    const entity = { display_name: 'Renovación seguro coche', attrs: { nombre: 'Renovación seguro coche' } };
    const msg = buildEntitySummaryMessage(type, entity, { name: 'Pep' });
    assert.ok(msg.startsWith('Hola Pep 👋'), msg);
    assert.ok(msg.includes('Renovación seguro coche'), msg);
    assert.ok(!/undefined|null|:\s*\./.test(msg), msg);
  });

  test('robusto ante entrada basura: tipo/entidad vacíos no revientan', () => {
    assert.doesNotThrow(() => buildEntitySummaryMessage(null, null, null));
    const msg = buildEntitySummaryMessage({}, { display_name: 'X' }, {});
    assert.ok(typeof msg === 'string' && msg.length > 0);
  });
});

// ─── Guardas del envío (sendEntitySummary) ──────────────────────────────────
// Solo cubrimos los caminos que retornan ANTES de tocar el dispatcher real:
// sin BD, sin dueño, y dueño sin teléfono/email. El envío feliz vive en las
// pruebas de integración con Supabase.

/** Mock mínimo: contacts.select(...).eq(...).eq(...).maybeSingle() → {data}. */
function mockDb(contactRow) {
  return {
    enabled: true,
    client: {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({ data: contactRow }); },
        };
      },
    },
  };
}

describe('sendEntitySummary — guardas honestas', () => {
  const type = tpl('fisioterapia');
  const entity = { id: 'ent1', contact_id: 'c1', display_name: 'Plan X', attrs: {} };

  test('db deshabilitada → db_disabled', async () => {
    const r = await sendEntitySummary({ orgId: 'o1', entityType: type, entity, db: { enabled: false } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'db_disabled');
  });

  test('ficha sin dueño vinculado → no_contact', async () => {
    const r = await sendEntitySummary({
      orgId: 'o1', entityType: type,
      entity: { id: 'ent1', contact_id: null, display_name: 'Plan X', attrs: {} },
      db: mockDb(null),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_contact');
  });

  test('dueño sin teléfono ni email → no_phone', async () => {
    const r = await sendEntitySummary({
      orgId: 'o1', entityType: type, entity,
      db: mockDb({ name: 'Ana', phone: null, email: null }),
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no_phone');
  });
});

describe('wellFormed', () => {
  test('elimina un suplente alto huérfano', () => {
    const broken = 'Hola \uD83D';          // mitad de un emoji
    assert.strictEqual(wellFormed(broken), 'Hola ');
  });
  test('conserva un emoji completo', () => {
    const ok = 'Hola 👋';        // 👋
    assert.strictEqual(wellFormed(ok), ok);
  });
});
