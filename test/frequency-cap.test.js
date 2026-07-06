// ============================================================
// NodeFlow — Tope de frecuencia de seguimientos (2026-07-06)
// Un cliente no recibe dos avisos dentro de la ventana: se pospone.
// ============================================================
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { resolveCap, nextSlotAfter, holdUntil, getCapDays, DEFAULT_CAP_DAYS, _clearCache } = require('../src/lifecycle/frequency-cap');
const { normalizeRules } = require('../src/lifecycle/followup-rules');

describe('resolveCap (pura)', () => {
  test('default cuando no hay config', () => {
    assert.strictEqual(resolveCap({}), DEFAULT_CAP_DAYS);
    assert.strictEqual(resolveCap({}), 7);
  });
  test('0 = desactivado (respeta al dueño)', () => {
    assert.strictEqual(resolveCap({ _frequencyCapDays: 0 }), 0);
  });
  test('valor explícito', () => {
    assert.strictEqual(resolveCap({ _frequencyCapDays: 14 }), 14);
  });
  test('valor inválido → default', () => {
    assert.strictEqual(resolveCap({ _frequencyCapDays: 'x' }), DEFAULT_CAP_DAYS);
    assert.strictEqual(resolveCap({ _frequencyCapDays: 999 }), DEFAULT_CAP_DAYS);
  });
});

describe('nextSlotAfter (pura)', () => {
  test('sent + cap días', () => {
    const now = new Date('2026-07-06T00:00:00Z');
    const d = nextSlotAfter('2026-07-04T00:00:00Z', 7, now);   // 4 jul + 7 = 11 jul
    assert.strictEqual(d.toISOString().slice(0, 10), '2026-07-11');
  });
  test('nunca en el pasado', () => {
    const now = new Date('2026-07-06T00:00:00Z');
    const d = nextSlotAfter('2020-01-01T00:00:00Z', 7, now);   // sent+7 quedó en el pasado
    assert.ok(d.getTime() > now.getTime());
  });
});

// ── Stub Supabase ───────────────────────────────────────────
function stubDb({ recent = null, config = null, onSelect } = {}) {
  return {
    enabled: true,
    client: {
      from(table) {
        if (onSelect) onSelect(table);
        const q = {
          select() { return q; }, eq() { return q; }, gte() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; },
          maybeSingle() {
            if (table === 'org_reminder_config') return Promise.resolve({ data: config ? { config } : null, error: null });
            return Promise.resolve({ data: recent, error: null });
          },
        };
        return q;
      },
    },
  };
}

describe('holdUntil', () => {
  const reminder = { id: 'r1', org_id: 'o1', contact_id: 'c1' };
  test('con aviso reciente → devuelve nueva fecha', async () => {
    const now = new Date('2026-07-06T00:00:00Z');
    const db = stubDb({ recent: { sent_at: '2026-07-04T00:00:00Z' } });
    const d = await holdUntil(db, reminder, 7, now);
    assert.ok(d);
    assert.strictEqual(d.toISOString().slice(0, 10), '2026-07-11');
  });
  test('sin aviso reciente → null (envía)', async () => {
    const db = stubDb({ recent: null });
    assert.strictEqual(await holdUntil(db, reminder, 7, new Date()), null);
  });
  test('cap 0 → null (desactivado, ni consulta)', async () => {
    let touched = false;
    const db = stubDb({ recent: { sent_at: '2026-07-04T00:00:00Z' }, onSelect: () => { touched = true; } });
    assert.strictEqual(await holdUntil(db, reminder, 0, new Date()), null);
    assert.strictEqual(touched, false);
  });
});

describe('getCapDays — cache', () => {
  beforeEach(() => _clearCache());
  test('lee la config y cachea (una sola lectura en 60s)', async () => {
    let reads = 0;
    const db = stubDb({ config: { _frequencyCapDays: 10 }, onSelect: (t) => { if (t === 'org_reminder_config') reads++; } });
    assert.strictEqual(await getCapDays('o1', { db }), 10);
    assert.strictEqual(await getCapDays('o1', { db }), 10);
    assert.strictEqual(reads, 1);
  });
});

describe('normalizeRules — reservadas + tope', () => {
  test('preserva _dismissedSuggestions al guardar reglas (fix del bug)', () => {
    const existing = { _dismissedSuggestions: ['timing:corte_pelo'] };
    const { config } = normalizeRules('peluqueria', { overrides: { corte_pelo: { days: 30 } } }, existing);
    assert.deepStrictEqual(config._dismissedSuggestions, ['timing:corte_pelo']);
  });
  test('fija el tope desde el body', () => {
    const { config } = normalizeRules('peluqueria', { frequencyCapDays: 14 }, {});
    assert.strictEqual(config._frequencyCapDays, 14);
  });
  test('tope 0 se acepta (desactivar)', () => {
    const { config } = normalizeRules('peluqueria', { frequencyCapDays: 0 }, {});
    assert.strictEqual(config._frequencyCapDays, 0);
  });
  test('tope inválido → error', () => {
    assert.ok(normalizeRules('peluqueria', { frequencyCapDays: 999 }, {}).error);
  });
  test('sin tope en el body → conserva el existente', () => {
    const { config } = normalizeRules('peluqueria', { overrides: {} }, { _frequencyCapDays: 21 });
    assert.strictEqual(config._frequencyCapDays, 21);
  });
});
