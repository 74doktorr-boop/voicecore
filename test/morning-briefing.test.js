// ============================================================
// NodeFlow — Briefing matinal accionable (2026-07-08)
// buildBriefing() es PURA: saludo por hora, líneas solo con algo
// accionable (sin ceros), máx. 4, formato de €, y estado "todo al
// día" que NUNCA deja la caja vacía.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildBriefing, greetingByHour, fmtEuros, ALL_CLEAR_TEXT } = require('../src/lifecycle/morning-briefing');

const VACIO = {}; // sin datos = sin líneas

describe('saludo por hora de Madrid', () => {
  test('mañana (9h) → Buenos días', () => {
    assert.strictEqual(buildBriefing(VACIO, 9).greeting, 'Buenos días');
  });
  test('límite 13h → Buenos días, 14h → Buenas tardes (mismo criterio que dashHero)', () => {
    assert.strictEqual(greetingByHour(13), 'Buenos días');
    assert.strictEqual(greetingByHour(14), 'Buenas tardes');
  });
  test('límite 19h → Buenas tardes, 20h → Buenas noches', () => {
    assert.strictEqual(greetingByHour(19), 'Buenas tardes');
    assert.strictEqual(greetingByHour(20), 'Buenas noches');
  });
  test('madrugada (2h) → Buenos días · medianoche (0h) también', () => {
    assert.strictEqual(greetingByHour(2), 'Buenos días');
    assert.strictEqual(greetingByHour(0), 'Buenos días');
  });
  test('hora no numérica → no rompe (saludo por defecto)', () => {
    assert.strictEqual(buildBriefing(VACIO, undefined).greeting, 'Buenos días');
  });
});

describe('resumen de ayer', () => {
  test('plural con citas: "Ayer: 5 llamadas atendidas (2 citas)."', () => {
    const b = buildBriefing({ yesterdayCalls: 5, yesterdayBooked: 2 }, 9);
    assert.strictEqual(b.summary, 'Ayer: 5 llamadas atendidas (2 citas).');
  });
  test('singular sin citas: "Ayer: 1 llamada atendida."', () => {
    const b = buildBriefing({ yesterdayCalls: 1, yesterdayBooked: 0 }, 9);
    assert.strictEqual(b.summary, 'Ayer: 1 llamada atendida.');
  });
  test('sin llamadas ayer → sin resumen (regla: los ceros se saltan)', () => {
    assert.strictEqual(buildBriefing({ yesterdayCalls: 0 }, 9).summary, null);
  });
});

describe('líneas accionables — solo lo que tiene algo que hacer', () => {
  test('cada contador a 0 NO genera línea', () => {
    const b = buildBriefing({ missedCount: 0, atRiskCount: 0, inactiveCount: 0, followupsPending: 0 }, 9);
    assert.strictEqual(b.lines.length, 0);
  });

  test('solo oportunidades → 1 línea hacia "oportunidades"', () => {
    const b = buildBriefing({ missedCount: 2 }, 9);
    assert.strictEqual(b.lines.length, 1);
    assert.strictEqual(b.lines[0].section, 'oportunidades');
    assert.strictEqual(b.lines[0].count, 2);
    assert.match(b.lines[0].text, /2 oportunidades sin responder/);
  });

  test('singular: 1 oportunidad / 1 cita en riesgo / 1 mensaje', () => {
    const b = buildBriefing({ missedCount: 1, atRiskCount: 1, followupsPending: 1 }, 9);
    assert.match(b.lines[0].text, /^1 oportunidad sin responder/);
    assert.match(b.lines[1].text, /^1 cita de mañana con riesgo de plantón/);
    assert.match(b.lines[2].text, /1 mensaje de seguimiento/);
  });

  test('las 4 fuentes activas → 4 líneas, cada una a su sección', () => {
    const b = buildBriefing({ missedCount: 2, atRiskCount: 3, inactiveCount: 4, recoverableEuros: 340, followupsPending: 5 }, 9);
    assert.strictEqual(b.lines.length, 4);
    assert.deepStrictEqual(b.lines.map(l => l.section), ['oportunidades', 'citas', 'clientes', 'seguimientos']);
    assert.ok(b.lines.every(l => l.icon && l.text && l.count > 0));
    assert.strictEqual(b.allClear, false);
    assert.strictEqual(b.allClearText, null);
  });

  test('nunca más de 4 líneas', () => {
    const b = buildBriefing({ missedCount: 9, atRiskCount: 9, inactiveCount: 9, recoverableEuros: 900, followupsPending: 9 }, 9);
    assert.ok(b.lines.length <= 4);
  });

  test('contadores negativos o basura se tratan como 0 (no rompen)', () => {
    const b = buildBriefing({ missedCount: -3, atRiskCount: 'nope', inactiveCount: null }, 9);
    assert.strictEqual(b.lines.length, 0);
    assert.strictEqual(b.allClear, true);
  });
});

describe('formato de euros — honesto y con "~"', () => {
  test('con ticket medio: "~340€ escribiendo a 4 clientes inactivos"', () => {
    const b = buildBriefing({ inactiveCount: 4, recoverableEuros: 340 }, 9);
    assert.match(b.lines[0].text, /recuperar ~340€ escribiendo a 4 clientes inactivos/);
    assert.strictEqual(b.lines[0].section, 'clientes');
  });
  test('miles con separador es-ES: 12500 → "12.500"', () => {
    assert.strictEqual(fmtEuros(12500), '12.500');
    const b = buildBriefing({ inactiveCount: 100, recoverableEuros: 12500 }, 9);
    assert.match(b.lines[0].text, /~12\.500€/);
  });
  test('sin ticket configurado (0€) NO se inventa cifra: línea sin €', () => {
    const b = buildBriefing({ inactiveCount: 3, recoverableEuros: 0 }, 9);
    assert.ok(!b.lines[0].text.includes('€'));
    assert.match(b.lines[0].text, /3 clientes inactivos/);
  });
  test('redondeo: 339.6 → 340', () => {
    assert.strictEqual(fmtEuros(339.6), '340');
  });
});

describe('allClear — nunca una caja vacía', () => {
  test('sin nada accionable → allClear con la línea serena', () => {
    const b = buildBriefing({ yesterdayCalls: 0 }, 9);
    assert.strictEqual(b.allClear, true);
    assert.strictEqual(b.allClearText, ALL_CLEAR_TEXT);
    assert.strictEqual(b.allClearText, 'Todo al día. Tu asistente sigue de guardia 24/7.');
  });
  test('con actividad ayer pero nada accionable hoy → resumen + allClear', () => {
    const b = buildBriefing({ yesterdayCalls: 7, yesterdayBooked: 3 }, 9);
    assert.strictEqual(b.allClear, true);
    assert.strictEqual(b.summary, 'Ayer: 7 llamadas atendidas (3 citas).');
  });
  test('greetingName se devuelve tal cual (y vacío si falta)', () => {
    assert.strictEqual(buildBriefing({ greetingName: 'Clínica Sonrisa' }, 9).greetingName, 'Clínica Sonrisa');
    assert.strictEqual(buildBriefing(VACIO, 9).greetingName, '');
    assert.strictEqual(buildBriefing(null, 9).allClear, true); // data null tampoco rompe
  });
});
