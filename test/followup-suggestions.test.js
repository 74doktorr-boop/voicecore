// ============================================================
// NodeFlow — Sugerencias de seguimiento por sector (2026-07-06)
// El sistema mira las citas reales y propone ajustes; el dueño aprueba.
// Determinista (matemática sobre citas, sin LLM).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeSuggestions, returnGaps, median, applySuggestion, dismissSuggestion } = require('../src/lifecycle/followup-suggestions');

// Genera N clientes con 2 citas de un servicio separadas `gap` días.
function pairs(service, gap, n, startPhone = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const phone = '+3460000' + (startPhone + i);
    const d0 = new Date(Date.now() - (gap + 5) * 864e5).toISOString().slice(0, 10);
    const d1 = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
    out.push({ phone, service, date: d0, status: 'completed' });
    out.push({ phone, service, date: d1, status: 'completed' });
  }
  return out;
}

describe('median / returnGaps (puras)', () => {
  test('median impar y par', () => {
    assert.strictEqual(median([10, 20, 30]), 20);
    assert.strictEqual(median([10, 20, 30, 40]), 25);
    assert.strictEqual(median([]), null);
  });

  test('returnGaps agrupa por teléfono y etiqueta el servicio de vuelta', () => {
    const gaps = returnGaps([
      { phone: 'A', service: 'Corte', date: '2026-01-01' },
      { phone: 'A', service: 'Corte', date: '2026-02-01' },  // gap 31
      { phone: 'B', service: 'Tinte', date: '2026-01-01' },  // solo 1 → sin gap
    ]);
    assert.strictEqual(gaps.length, 1);
    assert.strictEqual(gaps[0].gap, 31);
    assert.strictEqual(gaps[0].service, 'corte');
  });

  test('descarta huecos absurdos (>730 días)', () => {
    const gaps = returnGaps([
      { phone: 'A', service: 'x', date: '2020-01-01' },
      { phone: 'A', service: 'x', date: '2026-01-01' },
    ]);
    assert.strictEqual(gaps.length, 0);
  });
});

describe('computeSuggestions — timing', () => {
  test('sugiere ajustar días cuando el retorno real difiere', () => {
    const appts = pairs('corte', 34, 7);   // vuelven a los 34, default corte_pelo=24
    const sug = computeSuggestions('peluqueria', {}, appts);
    const t = sug.find(s => s.id === 'timing:corte_pelo');
    assert.ok(t, 'debería sugerir ajuste de corte_pelo');
    assert.strictEqual(t.type, 'timing');
    assert.strictEqual(t.currentDays, 24);
    assert.strictEqual(t.suggestedDays, 34);
    assert.strictEqual(t.sampleSize, 7);
  });

  test('no sugiere si la diferencia es pequeña', () => {
    const appts = pairs('corte', 26, 7);   // 26 vs 24 → diff 2, ni absoluta ni relativa
    const sug = computeSuggestions('peluqueria', {}, appts);
    assert.strictEqual(sug.find(s => s.id === 'timing:corte_pelo'), undefined);
  });

  test('no sugiere con muestra insuficiente (<6)', () => {
    const appts = pairs('corte', 40, 3);
    const sug = computeSuggestions('peluqueria', {}, appts);
    assert.strictEqual(sug.find(s => s.id === 'timing:corte_pelo'), undefined);
  });

  test('respeta reglas desactivadas', () => {
    const appts = pairs('corte', 40, 7);
    const sug = computeSuggestions('peluqueria', { corte_pelo: { enabled: false } }, appts);
    assert.strictEqual(sug.find(s => s.id === 'timing:corte_pelo'), undefined);
  });

  test('descartadas no reaparecen', () => {
    const appts = pairs('corte', 40, 7);
    const sug = computeSuggestions('peluqueria', { _dismissedSuggestions: ['timing:corte_pelo'] }, appts);
    assert.strictEqual(sug.find(s => s.id === 'timing:corte_pelo'), undefined);
  });
});

describe('computeSuggestions — coverage', () => {
  test('propone crear regla para un servicio frecuente sin cubrir', () => {
    // 8 citas de "mechas" (servicio sin regla en peluquería)
    const appts = [];
    for (let i = 0; i < 8; i++) appts.push({ phone: '+3461111' + i, service: 'mechas', date: '2026-05-0' + (i % 9 + 1), status: 'completed' });
    const sug = computeSuggestions('peluqueria', {}, appts);
    const c = sug.find(s => s.type === 'coverage');
    assert.ok(c, 'debería proponer cobertura de mechas');
    assert.deepStrictEqual(c.serviceFilter, ['mechas']);
    assert.strictEqual(c.sampleSize, 8);
  });

  test('no propone cobertura para un servicio ya cubierto por una regla', () => {
    const appts = [];
    for (let i = 0; i < 10; i++) appts.push({ phone: '+3462222' + i, service: 'corte de caballero', date: '2026-05-0' + (i % 9 + 1) });
    const sug = computeSuggestions('peluqueria', {}, appts);
    assert.strictEqual(sug.find(s => s.type === 'coverage'), undefined); // 'corte' ya lo cubre corte_pelo
  });
});

// ── Stub Supabase (org_reminder_config + nf_appointments) ────
function stubDb({ config = {}, appointments = [], onUpsert } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const q = {
          select() { return q; }, eq() { return q; }, gte() { return q; }, order() { return q; },
          limit() { return Promise.resolve({ data: appointments }); },
          maybeSingle() { return Promise.resolve({ data: table === 'org_reminder_config' ? { config } : null, error: null }); },
          upsert(row) { if (onUpsert) onUpsert(row); return Promise.resolve({ error: null }); },
        };
        return q;
      },
    },
  };
}

describe('applySuggestion / dismissSuggestion', () => {
  test('aplicar timing escribe el override con los días sugeridos', async () => {
    let saved = null;
    const db = stubDb({ config: {}, appointments: pairs('corte', 34, 7), onUpsert: (r) => { saved = r; } });
    const r = await applySuggestion('org1', 'peluqueria', 'timing:corte_pelo', { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(saved.config.corte_pelo.days, 34);
    assert.strictEqual(saved.config.corte_pelo.enabled, true);
  });

  test('aplicar una sugerencia inexistente → error', async () => {
    const db = stubDb({ config: {}, appointments: [] });
    const r = await applySuggestion('org1', 'peluqueria', 'timing:corte_pelo', { db });
    assert.ok(r.error);
  });

  test('descartar añade el id a _dismissedSuggestions', async () => {
    let saved = null;
    const db = stubDb({ config: {}, onUpsert: (r) => { saved = r; } });
    const r = await dismissSuggestion('org1', 'timing:corte_pelo', { db });
    assert.strictEqual(r.ok, true);
    assert.ok(saved.config._dismissedSuggestions.includes('timing:corte_pelo'));
  });
});
