// ============================================================
// NodeFlow — Caja negra de la IA (auditable por llamada) — captura
// Cada decisión (tool) del asistente se acumula en la sesión para poder
// enseñarle al dueño qué hizo su IA con cada cliente. Coste cero y nunca rompe
// la llamada. Aquí: el resumen legible y la acumulación defensiva.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { _decisionSummary, _recordDecision } = require('../src/tools/executor');

describe('_decisionSummary — línea legible por herramienta', () => {
  test('reserva con datos', () => {
    const s = _decisionSummary('book_appointment', { service: 'limpieza' },
      { success: true, appointment: { patientName: 'Ana', date: '2026-07-29', time: '10:00' } });
    assert.match(s, /Reservó cita/); assert.match(s, /Ana/); assert.match(s, /10:00/);
  });
  test('reserva fallida se dice como intento', () => {
    assert.match(_decisionSummary('book_appointment', {}, { success: false }), /no se pudo/i);
  });
  test('lead con nombre y urgencia', () => {
    const s = _decisionSummary('register_lead', { name: 'Jon', urgency: 'alta' }, { success: true });
    assert.match(s, /lead/i); assert.match(s, /Jon/); assert.match(s, /alta/);
  });
  test('urgencia marcada', () => {
    assert.match(_decisionSummary('flag_urgent', {}, {}), /URGENTE/);
  });
  test('herramienta desconocida no revienta (fallback legible)', () => {
    assert.strictEqual(typeof _decisionSummary('algo_nuevo', {}, {}), 'string');
  });
});

describe('_recordDecision — acumulación en la sesión', () => {
  test('empuja la decisión a session.aiDecisions con ok/summary', () => {
    const ctx = { session: {} };
    _recordDecision(ctx, 'check_availability', { service: 'corte' }, { success: true }, true);
    assert.strictEqual(ctx.session.aiDecisions.length, 1);
    const d = ctx.session.aiDecisions[0];
    assert.strictEqual(d.tool, 'check_availability');
    assert.strictEqual(d.ok, true);
    assert.match(d.summary, /disponibilidad/i);
    assert.ok(typeof d.at === 'number');
  });
  test('un tool con success:false queda ok:false', () => {
    const ctx = { session: {} };
    _recordDecision(ctx, 'book_appointment', {}, { success: false }, true);
    assert.strictEqual(ctx.session.aiDecisions[0].ok, false);
  });
  test('sin sesión no hace nada (no rompe)', () => {
    assert.doesNotThrow(() => _recordDecision({}, 'x', {}, {}, true));
    assert.doesNotThrow(() => _recordDecision(undefined, 'x', {}, {}, true));
  });
  test('techo de 60 decisiones por llamada (memoria acotada)', () => {
    const ctx = { session: { aiDecisions: [] } };
    for (let i = 0; i < 100; i++) _recordDecision(ctx, 'check_availability', {}, {}, true);
    assert.strictEqual(ctx.session.aiDecisions.length, 60);
  });
});
