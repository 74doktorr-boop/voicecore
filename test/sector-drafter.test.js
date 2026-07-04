// ============================================================
// NodeFlow — Auto-borrador de sectores (2026-07-04)
// Un LLM propone normas/métricas/alias de un vertical nuevo desde su
// descripción; el borrador pasa por validación y aprobación humana.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { draftSector } = require('../src/sectors/sector-drafter');

function fakeOpenAI(json, captured) {
  return {
    chat: { completions: { create: async ({ messages }) => {
      if (captured) captured.user = messages.find(m => m.role === 'user').content;
      return { choices: [{ message: { content: typeof json === 'string' ? json : JSON.stringify(json) } }] };
    } } },
  };
}

describe('draftSector', () => {
  test('propone un sector válido y normalizado desde la descripción', async () => {
    const cap = {};
    const def = await draftSector({ label: 'Floristería', description: 'venta de flores y ramos' }, {
      openai: fakeOpenAI({
        label: 'Floristería', aliases: ['floreria', 'flores'],
        norms: ['Pregunta el tipo de arreglo (ramo, centro, corona) y la fecha/lugar de entrega.', 'Para entregas urgentes, confírmalo y registra el pedido.'],
        metricChecks: [{ key: 'tipo_arreglo', label: '¿Capturó el tipo de arreglo?' }, { key: 'entrega', label: '¿Capturó fecha/lugar de entrega?' }],
      }, cap),
    });
    assert.ok(def, 'devuelve un borrador');
    assert.strictEqual(def.slug, 'floristeria');
    assert.ok(def.norms.length >= 2 && def.metricChecks.length >= 2);
    assert.strictEqual(def.custom, true);
    assert.match(cap.user, /Floristería/);
  });

  test('un borrador mal formado (sin normas) se descarta → null', async () => {
    const def = await draftSector({ label: 'Cosa rara' }, {
      openai: fakeOpenAI({ label: 'Cosa rara', norms: [], metricChecks: [] }),
    });
    assert.strictEqual(def, null);
  });

  test('sin openai o sin descripción → null (no inventa)', async () => {
    assert.strictEqual(await draftSector({ label: 'X' }, { openai: null }), null);
    assert.strictEqual(await draftSector({}, { openai: fakeOpenAI({}) }), null);
  });

  test('si el LLM lanza, no rompe → null', async () => {
    const boom = { chat: { completions: { create: async () => { throw new Error('boom'); } } } };
    assert.strictEqual(await draftSector({ label: 'X', description: 'y' }, { openai: boom }), null);
  });
});
