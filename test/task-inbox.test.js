// ============================================================
// NodeFlow — Inbox de acciones que la IA llena sola (2026-07-08)
// buildSuggestedTasks() es PURA (sin BD ni reloj): recibe las señales YA
// agregadas — las MISMAS del briefing matinal — y devuelve tareas sugeridas
// ordenadas por urgencia (dinero/tiempo primero), sin ceros, dedup por key y
// filtrando las que el dueño descartó (con caducidad para que un "riesgo de
// mañana" pueda resurgir cuando vuelva a ser real).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  buildSuggestedTasks, dismissKeyFor, filterDismissed,
  pruneDismissed, addDismissal, DISMISS_TTL_DAYS,
} = require('../src/lifecycle/task-inbox');

const TODAY = '2026-07-08';

// Set de señales de ejemplo, todas activas (una de cada fuente).
function fullSignals() {
  return {
    missedOpportunities: [
      { phone: '+34600111222', name: 'Raúl', lastCallId: 'call-1' },
    ],
    atRiskTomorrow: {
      date: '2026-07-09',
      list: [{ id: 'apt-9', patientName: 'Marta', time: '10:00' }],
    },
    draftEntities: [
      { id: 'ent-7', display_name: 'Golf 1234ABC', type_label: 'vehículo' },
    ],
    inactiveClients: { count: 4, euros: 40 },
    expiringBonos: [
      { id: 'ent-9', display_name: 'Bono 10 sesiones', remaining: 1, daysToExpiry: 5, ownerName: 'Ana' },
    ],
  };
}

describe('generación — una tarea por señal activa', () => {
  test('cada fuente activa produce su tarea, con key/icon/text/section/sourceId', () => {
    const tasks = buildSuggestedTasks(fullSignals(), { today: TODAY });
    const bySection = Object.fromEntries(tasks.map(t => [t.section, t]));
    assert.ok(bySection.oportunidades, 'oportunidad sin responder');
    assert.ok(bySection.citas, 'riesgo de plantón');
    assert.ok(bySection.entidades, 'ficha en borrador o bono');
    assert.ok(bySection.clientes, 'cliente inactivo');
    // Contrato de cada tarea
    for (const t of tasks) {
      assert.ok(t.key && typeof t.key === 'string');
      assert.ok(t.icon && t.text);
      assert.ok(t.section);
      assert.ok(t.urgency && ['money', 'time'].includes(t.urgency.kind));
    }
  });

  test('la oportunidad nombra al cliente: "Llama a Raúl"', () => {
    const t = buildSuggestedTasks(fullSignals(), { today: TODAY }).find(x => x.section === 'oportunidades');
    assert.match(t.text, /Llama a Raúl/);
    assert.strictEqual(t.sourceId, 'call-1');
  });

  test('la cita en riesgo pide confirmar: "Confirma la cita de Marta"', () => {
    const t = buildSuggestedTasks(fullSignals(), { today: TODAY }).find(x => x.section === 'citas');
    assert.match(t.text, /Confirma la cita de Marta/);
  });

  test('la ficha en borrador pide completarla: "Completa la ficha del Golf 1234ABC"', () => {
    const t = buildSuggestedTasks(fullSignals(), { today: TODAY }).find(x => x.key.startsWith('draft:'));
    assert.match(t.text, /Completa la ficha.*Golf 1234ABC/);
    assert.strictEqual(t.sourceId, 'ent-7');
  });

  test('cliente inactivo con € honesto (~40€) y "~" cuando hay ticket', () => {
    const t = buildSuggestedTasks(fullSignals(), { today: TODAY }).find(x => x.section === 'clientes');
    assert.match(t.text, /~40€/);
    assert.strictEqual(t.urgency.kind, 'money');
    assert.strictEqual(t.urgency.value, 40);
  });

  test('cliente inactivo SIN ticket → sin € inventado', () => {
    const s = fullSignals(); s.inactiveClients = { count: 3, euros: 0 };
    const t = buildSuggestedTasks(s, { today: TODAY }).find(x => x.section === 'clientes');
    assert.ok(!t.text.includes('€'));
  });

  test('bono a punto de agotarse: nombra sesiones restantes', () => {
    const t = buildSuggestedTasks(fullSignals(), { today: TODAY }).find(x => x.key.startsWith('bono:'));
    assert.ok(t, 'debe existir tarea de bono');
    assert.match(t.text, /Bono 10 sesiones/);
    assert.strictEqual(t.section, 'entidades');
  });
});

describe('solo ACCIONABLE — los ceros se saltan', () => {
  test('señales vacías → 0 tareas', () => {
    assert.strictEqual(buildSuggestedTasks({}, { today: TODAY }).length, 0);
    assert.strictEqual(buildSuggestedTasks(null, { today: TODAY }).length, 0);
  });
  test('count 0 de inactivos no genera tarea', () => {
    const s = { inactiveClients: { count: 0, euros: 100 } };
    assert.strictEqual(buildSuggestedTasks(s, { today: TODAY }).length, 0);
  });
  test('listas vacías no generan tarea', () => {
    const s = { missedOpportunities: [], draftEntities: [], expiringBonos: [], atRiskTomorrow: { list: [] } };
    assert.strictEqual(buildSuggestedTasks(s, { today: TODAY }).length, 0);
  });
});

describe('dedup por key', () => {
  test('dos oportunidades del mismo teléfono → una sola tarea', () => {
    const s = { missedOpportunities: [
      { phone: '+34600111222', name: 'Raúl', lastCallId: 'c1' },
      { phone: '+34600111222', name: 'Raúl', lastCallId: 'c2' },
    ] };
    const tasks = buildSuggestedTasks(s, { today: TODAY });
    assert.strictEqual(tasks.length, 1);
  });
  test('teléfonos distintos → dos tareas', () => {
    const s = { missedOpportunities: [
      { phone: '+34600111222', name: 'Raúl', lastCallId: 'c1' },
      { phone: '+34600999888', name: 'Eva',  lastCallId: 'c2' },
    ] };
    assert.strictEqual(buildSuggestedTasks(s, { today: TODAY }).length, 2);
  });
});

describe('orden por urgencia — dinero y tiempo primero', () => {
  test('riesgo de mañana (tiempo) por encima de ficha en borrador', () => {
    const s = fullSignals();
    const tasks = buildSuggestedTasks(s, { today: TODAY });
    const iCita  = tasks.findIndex(t => t.section === 'citas');
    const iDraft = tasks.findIndex(t => t.key.startsWith('draft:'));
    assert.ok(iCita < iDraft, 'la cita en riesgo va antes que el borrador');
  });
  test('más € recuperable ordena por delante a igualdad de tipo', () => {
    const s = { inactiveClients: { count: 2, euros: 200 }, missedOpportunities: [] };
    const s2 = { ...s };
    // dos fuentes money: bono (poco) vs clientes (mucho) — clientes primero
    s2.expiringBonos = [{ id: 'e1', display_name: 'Bono', remaining: 2, daysToExpiry: 20, ownerName: 'X' }];
    const tasks = buildSuggestedTasks(s2, { today: TODAY });
    assert.ok(tasks.length >= 2);
  });
});

describe('descarte persistente con caducidad', () => {
  test('dismissKeyFor es estable para la misma tarea', () => {
    const t = { key: 'opp:+34600111222', sourceId: 'c1' };
    assert.strictEqual(dismissKeyFor(t), dismissKeyFor(t));
  });
  test('el riesgo de mañana se descarta por sourceId+fecha (resurge otro día)', () => {
    const t = { key: 'atrisk:apt-9', sourceId: 'apt-9', section: 'citas', dismissScope: '2026-07-09' };
    assert.match(dismissKeyFor(t), /2026-07-09/);
  });

  test('filterDismissed quita las descartadas no caducadas', () => {
    const tasks = buildSuggestedTasks(fullSignals(), { today: TODAY });
    const victim = tasks.find(t => t.section === 'oportunidades');
    const dk = dismissKeyFor(victim);
    const dismissed = { [dk]: '2999-01-01T00:00:00.000Z' }; // no caducada
    const out = filterDismissed(tasks, dismissed, new Date(TODAY + 'T09:00:00Z'));
    assert.ok(!out.some(t => t.section === 'oportunidades'));
    assert.strictEqual(out.length, tasks.length - 1);
  });

  test('un descarte CADUCADO ya no filtra (la tarea resurge)', () => {
    const tasks = buildSuggestedTasks(fullSignals(), { today: TODAY });
    const victim = tasks.find(t => t.section === 'oportunidades');
    const dk = dismissKeyFor(victim);
    const dismissed = { [dk]: '2020-01-01T00:00:00.000Z' }; // ya caducado
    const out = filterDismissed(tasks, dismissed, new Date(TODAY + 'T09:00:00Z'));
    assert.ok(out.some(t => t.section === 'oportunidades'), 'resurge tras caducar');
  });

  test('pruneDismissed borra solo las entradas caducadas', () => {
    const now = new Date('2026-07-08T09:00:00Z');
    const map = {
      viva:     '2999-01-01T00:00:00.000Z',
      caducada: '2020-01-01T00:00:00.000Z',
    };
    const pruned = pruneDismissed(map, now);
    assert.ok(pruned.viva);
    assert.ok(!('caducada' in pruned));
  });

  test('addDismissal fija caducidad a TTL días vista y no muta el original', () => {
    const now = new Date('2026-07-08T09:00:00Z');
    const orig = {};
    const next = addDismissal(orig, 'opp:+34600111222', now);
    assert.deepStrictEqual(orig, {}, 'no muta el original');
    const exp = new Date(next['opp:+34600111222']);
    const days = Math.round((exp - now) / 86400000);
    assert.strictEqual(days, DISMISS_TTL_DAYS);
  });
});
