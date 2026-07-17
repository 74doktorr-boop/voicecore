// ============================================================
// NodeFlow — WhatsApp semanal de ROI al dueño (2026-07-17)
// Simulación de embudo (500 clientes): el 23% del churn era "no vi resultados",
// y lo pidieron textual — "enséñame en un WhatsApp: esta semana te he salvado
// 3 citas = tantos euros". El email lo abre poca gente; el dato en la mano sí.
// HONESTO: "citas salvadas" = las que agendó el BOT (outcome='booked'), y el €
// solo se dice si hay ticket medio configurado (nunca inventamos un número).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildRoiWhatsApp } = require('../src/reports/weekly-report');

const base = { totalCalls: 12, totalMinutes: 34, bookedCalls: 3, rescuedValue: 180, remindersSent: 5 };

describe('buildRoiWhatsApp', () => {
  test('dice las citas salvadas y los € cuando hay ticket medio', () => {
    const m = buildRoiWhatsApp({ bizName: 'Fisio Unai', stats: base });
    assert.match(m, /Fisio Unai/);
    assert.match(m, /salvado 3 citas/);
    assert.match(m, /~180€/);
    assert.match(m, /12 llamadas atendidas/);
    assert.match(m, /34 min/);
    assert.match(m, /5 avisos enviados/);
  });

  test('SIN ticket medio no inventa un importe (sin €)', () => {
    const m = buildRoiWhatsApp({ bizName: 'X', stats: { ...base, rescuedValue: 0 } });
    assert.match(m, /salvado 3 citas que se habrían perdido\./);
    assert.doesNotMatch(m, /€/);
  });

  test('singular correcto con 1 cita / 1 llamada', () => {
    const m = buildRoiWhatsApp({ bizName: 'X', stats: { totalCalls: 1, totalMinutes: 2, bookedCalls: 1, rescuedValue: 60, remindersSent: 0 } });
    assert.match(m, /salvado 1 cita que/);
    assert.match(m, /1 llamada atendida/);
    assert.doesNotMatch(m, /avisos? enviado/);   // 0 avisos → no se menciona
  });

  test('sin avisos no aparece esa línea', () => {
    const m = buildRoiWhatsApp({ bizName: 'X', stats: { ...base, remindersSent: 0 } });
    assert.doesNotMatch(m, /aviso/);
  });

  test('sin nombre de negocio no rompe', () => {
    const m = buildRoiWhatsApp({ stats: base });
    assert.match(m, /tu negocio/);
  });
});
