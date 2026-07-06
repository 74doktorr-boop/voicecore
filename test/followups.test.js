// ============================================================
// NodeFlow — Seguimientos personalizados (2026-07-06)
// El sistema sugiere candidatos (quien llamó y no reservó) + redacta
// un mensaje personalizado; el dueño lo envía por su WhatsApp.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { draftMessage, getCandidates, markDone } = require('../src/lifecycle/followups');

// ── Stub mínimo del cliente Supabase (encadenable) ──────────
function stubDb({ calls = [], contacts = [], onUpdate } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const rows = table === 'contacts' ? contacts : calls;
        const q = {
          _rows: rows,
          select() { return q; },
          eq() { return q; },
          gte() { return q; },
          neq() { return q; },
          in() { return q; },
          order() { return q; },
          limit() { return Promise.resolve({ data: q._rows }); },
          update(patch) {
            if (onUpdate) onUpdate(table, patch);
            return { eq() { return { eq() { return Promise.resolve({ error: null }); } }; } };
          },
          then(resolve) { return Promise.resolve({ data: q._rows }).then(resolve); },
        };
        return q;
      },
    },
  };
}

describe('draftMessage (pura)', () => {
  test('usa el nombre de pila cuando existe', () => {
    const m = draftMessage({ name: 'María López', reason: 'info', bizName: 'Clínica Osakin' });
    assert.match(m, /Hola María/);
    assert.match(m, /Soy Clínica Osakin\./);
  });

  test('sin nombre → saludo genérico, sin "undefined"', () => {
    const m = draftMessage({ reason: 'info', bizName: 'X' });
    assert.match(m, /^Hola,/);
    assert.doesNotMatch(m, /undefined/);
  });

  test('callback_requested habla de agendar', () => {
    assert.match(draftMessage({ reason: 'callback_requested' }), /agend/i);
  });

  test('abandoned menciona el corte de la llamada', () => {
    assert.match(draftMessage({ reason: 'abandoned' }), /cort/i);
  });

  test('reason desconocido cae al mensaje de consulta', () => {
    assert.match(draftMessage({ reason: 'zzz' }), /consultaste/i);
  });
});

describe('getCandidates', () => {
  test('sin BD → []', async () => {
    const out = await getCandidates('org1', { db: { enabled: false } });
    assert.deepStrictEqual(out, []);
  });

  test('excluye las ya seguidas (followup_sent) y las de número desconocido', async () => {
    const db = stubDb({
      calls: [
        { id: 'c1', caller_number: '+34600111222', outcome: 'info', started_at: 'x', followup_sent: null, metrics: {} },
        { id: 'c2', caller_number: '+34600333444', outcome: 'info', started_at: 'x', followup_sent: true, metrics: {} },
        { id: 'c3', caller_number: 'unknown',      outcome: 'info', started_at: 'x', followup_sent: null, metrics: {} },
      ],
    });
    const out = await getCandidates('org1', { db, bizName: 'Nego' });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].callId, 'c1');
    assert.match(out[0].draft, /Nego/);
  });

  test('resuelve el nombre del contacto por teléfono', async () => {
    const db = stubDb({
      calls:    [{ id: 'c1', caller_number: '+34600111222', outcome: 'callback_requested', started_at: 'x', followup_sent: null, metrics: { audit: { score: 42 } } }],
      contacts: [{ name: 'Aitor', phone: '+34600111222' }],
    });
    const out = await getCandidates('org1', { db });
    assert.strictEqual(out[0].name, 'Aitor');
    assert.strictEqual(out[0].score, 42);
    assert.match(out[0].draft, /Hola Aitor/);
  });
});

describe('markDone', () => {
  test('marca followup_sent=true en la llamada correcta', async () => {
    let captured = null;
    const db = stubDb({ onUpdate: (t, patch) => { captured = { t, patch }; } });
    const r = await markDone('c1', 'org1', { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(captured.t, 'nf_calls');
    assert.strictEqual(captured.patch.followup_sent, true);
  });

  test('sin BD → ok:false', async () => {
    const r = await markDone('c1', 'org1', { db: { enabled: false } });
    assert.strictEqual(r.ok, false);
  });
});
