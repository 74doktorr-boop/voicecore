// ============================================================
// NodeFlow — Seguimientos en el briefing diario (2026-07-06)
// "Tienes N mensajes redactados esperando" + deep-link → crea el hábito.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildEmail } = require('../src/reports/daily-briefing');

const base = { apts: [], freeSlots: [], missedCalls: [], winback: [] };

describe('buildEmail — seguimientos pendientes', () => {
  test('con pendientes → sección con contador y deep-link', () => {
    const { html, text } = buildEmail({ bizName: 'X', today: '2026-07-06', data: { ...base, followupsPending: 4 } });
    assert.match(html, /SEGUIMIENTOS LISTOS PARA ENVIAR \(4\)/);
    assert.match(html, /go=seguimientos/);
    assert.match(text, /Seguimientos listos para enviar: 4/);
  });

  test('sin pendientes → la sección no aparece', () => {
    const { html, text } = buildEmail({ bizName: 'X', today: '2026-07-06', data: { ...base, followupsPending: 0 } });
    assert.doesNotMatch(html, /SEGUIMIENTOS LISTOS/);
    assert.doesNotMatch(text, /Seguimientos listos/);
  });

  test('singular bien escrito con 1 pendiente', () => {
    const { html } = buildEmail({ bizName: 'X', today: '2026-07-06', data: { ...base, followupsPending: 1 } });
    assert.match(html, /1 cliente que llamaron|1 cliente/);
    assert.doesNotMatch(html, /1 clientes/);
  });
});
