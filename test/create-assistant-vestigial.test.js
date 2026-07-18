// ============================================================
// NodeFlow — createAssistant tolerante al drift (2026-07-19)
// La tabla `assistants` es vestigial (0 filas; el runtime lee de
// organizations.assistant_config). Un drift de esquema en prod (faltaba la
// columna `speed`, 42703) tumbaba POST /api/assistants con un 500 latente
// (auditoría de seguridad). Ahora el insert fallido degrada a un objeto
// sintético sin lanzar. Único llamador: routes.js:323 (endpoint sin UI).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Database } = require('../src/db/database');

function dbWithInsertError(err) {
  const db = new Database({});
  db.enabled = true;
  db.client = {
    from() {
      return {
        insert() { return this; },
        select() { return this; },
        async single() { return { data: null, error: err }; },
      };
    },
  };
  return db;
}

describe('createAssistant — tolerante al drift de la tabla vestigial', () => {
  test('error 42703 (columna inexistente) → objeto sintético, NO lanza', async () => {
    const db = dbWithInsertError({ code: '42703', message: 'column "speed" does not exist' });
    const out = await db.createAssistant('org-1', { name: 'Recepción', voice: 'nova' });
    assert.ok(out && out.id, 'devuelve un objeto con id');
    assert.strictEqual(out.org_id, 'org-1');
    assert.strictEqual(out.name, 'Recepción');   // conserva el config recibido
  });

  test('cualquier error de esquema degrada igual (no solo speed)', async () => {
    const db = dbWithInsertError({ code: '42P01', message: 'relation "assistants" does not exist' });
    await assert.doesNotReject(() => db.createAssistant('org-2', { name: 'X' }));
  });

  test('sin BD → sintético directo (camino ya existente)', async () => {
    const db = new Database({});
    db.enabled = false;
    const out = await db.createAssistant('org-3', { name: 'Y' });
    assert.strictEqual(out.org_id, 'org-3');
    assert.strictEqual(out.name, 'Y');
  });
});
