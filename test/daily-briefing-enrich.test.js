// ============================================================
// NodeFlow — Briefing diario enriquecido: caja negra + gasto
// El resumen del día ahora enseña "lo que hizo tu asistente ayer" (de la caja
// negra) y el gasto del mes — ata #1 (gasto) y #2 (caja negra) al canal de
// retención que el dueño ya recibe cada mañana.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildEmail } = require('../src/reports/daily-briefing');

const base = {
  bizName: 'Clínica X', today: '2026-07-29',
  data: { apts: [], freeSlots: [], missedCalls: [], winback: [], followupsPending: 0 },
};
const withData = (over) => ({ ...base, data: { ...base.data, ...over } });

describe('buildEmail — caja negra "lo que hizo tu asistente ayer"', () => {
  test('renderiza atendidas/citas/leads/urgencias', () => {
    const { html, text } = buildEmail(withData({ assistantDid: { attended: 8, booked: 3, leads: 2, urgent: 1 } }));
    assert.match(html, /LO QUE HIZO TU ASISTENTE AYER/);
    assert.match(html, /8 llamadas atendidas/);
    assert.match(html, /3 citas reservadas/);
    assert.match(html, /2 leads captados/);
    assert.match(html, /1 urgencia marcada/);
    assert.match(text, /Ayer tu asistente: 8 llamadas atendidas/);
  });

  test('singular/plural correctos', () => {
    const { html } = buildEmail(withData({ assistantDid: { attended: 1, booked: 1, leads: 0, urgent: 0 } }));
    assert.match(html, /1 llamada atendida/); assert.match(html, /1 cita reservada/);
    assert.ok(!/leads/.test(html), 'no muestra leads si es 0');
  });

  test('sin actividad del asistente → no aparece la sección', () => {
    const { html } = buildEmail(withData({ assistantDid: { attended: 0, booked: 0, leads: 0, urgent: 0 } }));
    assert.ok(!/LO QUE HIZO TU ASISTENTE/.test(html));
  });
});

describe('buildEmail — línea de gasto del mes', () => {
  test('muestra gasto y tope', () => {
    const { html, text } = buildEmail(withData({ assistantDid: { attended: 2 }, spend: { eur: 12, cap: 50 } }));
    assert.match(html, /Gasto variable este mes:/);
    assert.match(html, /12€/); assert.match(html, /tu tope: 50€/);
    assert.match(text, /Gasto del mes: 12€/);
  });

  test('gasto 0 → sin línea de gasto', () => {
    const { html } = buildEmail(withData({ assistantDid: { attended: 2 }, spend: { eur: 0, cap: 50 } }));
    assert.ok(!/Gasto variable este mes/.test(html));
  });

  test('sin tope (0) → solo el gasto, sin "tu tope"', () => {
    const { html } = buildEmail(withData({ assistantDid: { attended: 2 }, spend: { eur: 8, cap: 0 } }));
    assert.match(html, /8€/); assert.ok(!/tu tope/.test(html));
  });

  test('compat: sin assistantDid ni spend no rompe', () => {
    assert.doesNotThrow(() => buildEmail(base));
  });
});
