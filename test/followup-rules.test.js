// ============================================================
// NodeFlow — Reglas de seguimiento por sector (2026-07-06)
// Defaults editables + personalizados con nombre/tiempo, validados,
// con estimación de alcance.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildRulesView, normalizeRules, estimateReach, saveRules } = require('../src/lifecycle/followup-rules');

describe('buildRulesView', () => {
  test('defaults del sector, editables marcados', () => {
    const rules = buildRulesView('peluqueria', {});
    assert.ok(rules.length >= 4);
    const corte = rules.find(r => r.key === 'corte_pelo');
    assert.strictEqual(corte.custom, false);
    assert.strictEqual(corte.enabled, true);
    assert.strictEqual(corte.days, 24);
    assert.strictEqual(corte.editableDays, true);
  });

  test('aplica overrides del dueño (días, canal, desactivar)', () => {
    const rules = buildRulesView('peluqueria', { corte_pelo: { days: 30, channel: 'email', enabled: false } });
    const corte = rules.find(r => r.key === 'corte_pelo');
    assert.strictEqual(corte.days, 30);
    assert.strictEqual(corte.channel, 'email');
    assert.strictEqual(corte.enabled, false);
  });

  test('incluye personalizados', () => {
    const rules = buildRulesView('peluqueria', { _custom: [{ key: 'custom_blanqueamiento', label: 'Blanqueamiento', trigger: 'from_last_appointment', days: 90 }] });
    const c = rules.find(r => r.key === 'custom_blanqueamiento');
    assert.ok(c);
    assert.strictEqual(c.custom, true);
    assert.strictEqual(c.days, 90);
  });
});

describe('normalizeRules — validación', () => {
  test('override válido persiste solo lo tocado', () => {
    const { config } = normalizeRules('peluqueria', { overrides: { corte_pelo: { days: 30 } } });
    assert.deepStrictEqual(config.corte_pelo, { days: 30 });
  });

  test('override a una key que no es del sector se ignora', () => {
    const { config } = normalizeRules('peluqueria', { overrides: { no_existe: { days: 30 } } });
    assert.strictEqual(config.no_existe, undefined);
  });

  test('canal inválido → error', () => {
    const r = normalizeRules('peluqueria', { overrides: { corte_pelo: { channel: 'paloma' } } });
    assert.ok(r.error);
  });

  test('días se acotan a [1, 3650]', () => {
    const { config } = normalizeRules('peluqueria', { overrides: { corte_pelo: { days: 99999 } } });
    assert.strictEqual(config.corte_pelo.days, 3650);
  });

  test('custom: nombre corto → error', () => {
    assert.ok(normalizeRules('peluqueria', { custom: [{ label: 'x', trigger: 'from_last_appointment', days: 10 }] }).error);
  });

  test('custom: disparador no permitido → error', () => {
    // before_sector_field YA se permite (personalización 0→100%, 2026-07-07);
    // custom_frequency sigue restringido (requiere datos que no todos tienen).
    assert.ok(normalizeRules('peluqueria', { custom: [{ label: 'Prueba', trigger: 'custom_frequency', days: 10 }] }).error);
    assert.ok(normalizeRules('peluqueria', { custom: [{ label: 'Prueba', trigger: 'inventado', days: 10 }] }).error);
  });

  test('custom: sin días → error', () => {
    assert.ok(normalizeRules('peluqueria', { custom: [{ label: 'Prueba', trigger: 'from_last_appointment' }] }).error);
  });

  test('custom: key derivada del nombre, sin colisión con defaults', () => {
    const { config } = normalizeRules('peluqueria', { custom: [
      { label: 'Corte pelo', trigger: 'from_last_appointment', days: 30 },   // slug chocaría con default corte_pelo... pero se prefija custom_
    ]});
    assert.strictEqual(config._custom[0].key, 'custom_corte_pelo');
  });

  test('custom: dos con el mismo nombre → keys únicas', () => {
    const { config } = normalizeRules('peluqueria', { custom: [
      { label: 'Repaso', trigger: 'from_last_appointment', days: 20 },
      { label: 'Repaso', trigger: 'from_last_appointment', days: 40 },
    ]});
    assert.notStrictEqual(config._custom[0].key, config._custom[1].key);
  });

  test('custom: serviceFilter desde string separado por comas', () => {
    const { config } = normalizeRules('peluqueria', { custom: [
      { label: 'Mechas', trigger: 'from_last_appointment', days: 45, serviceFilter: 'mechas, balayage' },
    ]});
    assert.deepStrictEqual(config._custom[0].serviceFilter, ['mechas', 'balayage']);
  });

  test('custom: más de 20 → error', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ label: 'R' + i, trigger: 'from_last_appointment', days: 10 }));
    assert.ok(normalizeRules('peluqueria', { custom: many }).error);
  });
});

// ── Stub Supabase para estimateReach / saveRules ────────────
function stubDb({ config = {}, appointments = [], onUpsert } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        const q = {
          _t: table,
          select() { return q; },
          eq() { return q; },
          gte() { return q; },
          order() { return q; },
          limit() { return Promise.resolve({ data: appointments }); },
          maybeSingle() { return Promise.resolve({ data: { config }, error: null }); },
          upsert(row) { if (onUpsert) onUpsert(row); return Promise.resolve({ error: null }); },
        };
        return q;
      },
    },
  };
}

describe('estimateReach', () => {
  test('cuenta clientes cuya próxima visita cae en el horizonte, dedup por teléfono', async () => {
    const iso = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const db = stubDb({
      config: {},
      appointments: [
        { phone: '+34600111222', service: 'corte', date: iso(20), status: 'completed' }, // revision_mensual(28)->+8 in
        { phone: '+34600333444', service: 'corte', date: iso(200), status: 'completed' },// due en el pasado -> fuera
      ],
    });
    const reach = await estimateReach('org1', 'nutricion', { db, horizon: 90 });
    assert.strictEqual(reach.total, 1);
    assert.ok(reach.byRule.revision_mensual >= 1);
  });

  test('sin BD → cero', async () => {
    const reach = await estimateReach('org1', 'nutricion', { db: { enabled: false } });
    assert.strictEqual(reach.total, 0);
  });
});

describe('saveRules', () => {
  test('persiste la config validada vía upsert', async () => {
    let saved = null;
    const db = stubDb({ onUpsert: (row) => { saved = row; } });
    const r = await saveRules('org1', 'peluqueria', { overrides: { corte_pelo: { days: 30 } } }, { db });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(saved.org_id, 'org1');
    assert.deepStrictEqual(saved.config.corte_pelo, { days: 30 });
  });

  test('body inválido → error, no persiste', async () => {
    let saved = null;
    const db = stubDb({ onUpsert: (row) => { saved = row; } });
    const r = await saveRules('org1', 'peluqueria', { overrides: { corte_pelo: { channel: 'x' } } }, { db });
    assert.ok(r.error);
    assert.strictEqual(saved, null);
  });
});
