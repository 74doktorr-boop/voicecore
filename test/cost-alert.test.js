// ============================================================
// NodeFlow — Alerta de coste variable (2026-07-17)
// Tarea 2 del plan pre-lanzamiento: avisar al dueño al 80%/100% de un umbral
// configurable, para matar el miedo a la "factura sorpresa" (objeción nº1 de
// precio). No corta servicio; idempotente por (org, mes, nivel).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  resolveThreshold, resolveCap, levelFor, alreadyAlerted, monthlyVariableSpend, checkAndAlertOrg,
  isSpendingCapped, DEFAULT_THRESHOLD,
} = require('../src/billing/cost-alert');

const dbWithOrg = (org) => ({ enabled: true, client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: org }) }) }) }) } });
const noMsg = async () => ({ overageEur: 0 });

const fakeDb = { enabled: true, client: { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } };
const noMsgs = async () => ({ overageEur: 0 });

describe('resolveThreshold', () => {
  test('sin config → default', () => {
    assert.strictEqual(resolveThreshold({}), DEFAULT_THRESHOLD);
  });
  test('override por-org', () => {
    assert.strictEqual(resolveThreshold({ automation_config: { config: { costAlertThresholdEur: 40 } } }), 40);
  });
  test('0 = desactivado', () => {
    assert.strictEqual(resolveThreshold({ automation_config: { config: { costAlertThresholdEur: 0 } } }), 0);
  });
});

describe('resolveCap (tope duro, opt-in)', () => {
  test('sin config → 0 (off)', () => assert.strictEqual(resolveCap({}), 0));
  test('0 explícito → 0', () => assert.strictEqual(resolveCap({ automation_config: { config: { costCapEur: 0 } } }), 0));
  test('valor positivo → ese valor', () => assert.strictEqual(resolveCap({ automation_config: { config: { costCapEur: 30 } } }), 30));
});

describe('isSpendingCapped', () => {
  test('capped: gasto ≥ tope', async () => {
    const org = { id: 'o', monthly_minutes_used: 600, monthly_minutes_limit: 500, automation_config: { config: { costCapEur: 5 } } };
    const r = await isSpendingCapped('o', { db: dbWithOrg(org), usageSummary: noMsg, noCache: true });
    assert.strictEqual(r, true);   // 100 min × 0,10 = 10€ ≥ 5€
  });
  test('no capped: por debajo del tope', async () => {
    const org = { id: 'o', monthly_minutes_used: 510, monthly_minutes_limit: 500, automation_config: { config: { costCapEur: 50 } } };
    const r = await isSpendingCapped('o', { db: dbWithOrg(org), usageSummary: noMsg, noCache: true });
    assert.strictEqual(r, false);  // 1€ « 50€
  });
  test('no capped: tope desactivado (0)', async () => {
    const org = { id: 'o', monthly_minutes_used: 9999, monthly_minutes_limit: 0, automation_config: { config: {} } };
    const r = await isSpendingCapped('o', { db: dbWithOrg(org), usageSummary: noMsg, noCache: true });
    assert.strictEqual(r, false);
  });
});

describe('levelFor', () => {
  test('por debajo del 80% → 0', () => assert.strictEqual(levelFor(15, 25), 0));
  test('al 80% → 80', () => assert.strictEqual(levelFor(20, 25), 80));
  test('al 100% → 100', () => assert.strictEqual(levelFor(25, 25), 100));
  test('umbral 0 → 0 (desactivado)', () => assert.strictEqual(levelFor(999, 0), 0));
});

describe('monthlyVariableSpend', () => {
  test('suma overage de voz (min > incluidos) × 0,10 + mensajes', async () => {
    const org = { id: 'o1', monthly_minutes_used: 560, monthly_minutes_limit: 500 };
    const s = await monthlyVariableSpend(org, { db: fakeDb, usageSummary: async () => ({ overageEur: 3 }) });
    assert.strictEqual(s.overageMin, 60);
    assert.strictEqual(s.voiceOverageEur, 6);   // 60 × 0,10
    assert.strictEqual(s.messageOverageEur, 3);
    assert.strictEqual(s.totalEur, 9);
  });
  test('sin pasar de los minutos incluidos → 0 de voz', async () => {
    const org = { id: 'o1', monthly_minutes_used: 100, monthly_minutes_limit: 500 };
    const s = await monthlyVariableSpend(org, { db: fakeDb, usageSummary: noMsgs });
    assert.strictEqual(s.voiceOverageEur, 0);
    assert.strictEqual(s.totalEur, 0);
  });
});

describe('alreadyAlerted', () => {
  const org = { automation_config: { config: { _costAlert: { month: '2026-07', level: 80 } } } };
  test('mismo mes y nivel → true', () => assert.strictEqual(alreadyAlerted(org, '2026-07', 80), true));
  test('nivel superior no avisado aún → false', () => assert.strictEqual(alreadyAlerted(org, '2026-07', 100), false));
  test('mes distinto → false', () => assert.strictEqual(alreadyAlerted(org, '2026-08', 80), false));
});

describe('checkAndAlertOrg', () => {
  test('cruza el umbral → envía email al dueño y marca', async () => {
    let sent = null, marked = false;
    const db = { enabled: true, client: { from: () => ({ update: (patch) => { marked = !!(patch.automation_config.config._costAlert); return { eq: async () => ({}) }; } }) } };
    const org = { id: 'o1', name: 'Clínica X', owner_email: 'x@x.com', monthly_minutes_used: 560, monthly_minutes_limit: 500 };
    const r = await checkAndAlertOrg(org, {
      db, now: '2026-07-01', usageSummary: async () => ({ overageEur: 20 }),
      sendEmail: async (m) => { sent = m; },
    });
    assert.strictEqual(r.alerted, true);
    assert.strictEqual(r.level, 100);         // 6€ voz + 20€ msgs = 26€ ≥ 25
    assert.ok(sent && /x@x\.com/.test(sent.to));
    assert.ok(marked);
  });

  test('umbral desactivado (0) → no avisa', async () => {
    let sent = false;
    const org = { id: 'o1', owner_email: 'x@x.com', monthly_minutes_used: 9999, monthly_minutes_limit: 0,
      automation_config: { config: { costAlertThresholdEur: 0 } } };
    const r = await checkAndAlertOrg(org, { db: fakeDb, sendEmail: async () => { sent = true; }, usageSummary: noMsgs });
    assert.strictEqual(r.alerted, false);
    assert.strictEqual(r.reason, 'disabled');
    assert.strictEqual(sent, false);
  });

  test('ya avisado este mes al mismo nivel → no reenvía', async () => {
    let sent = false;
    const org = { id: 'o1', owner_email: 'x@x.com', monthly_minutes_used: 560, monthly_minutes_limit: 500,
      automation_config: { config: { _costAlert: { month: '2026-07', level: 100 } } } };
    const r = await checkAndAlertOrg(org, {
      db: fakeDb, now: '2026-07-15', usageSummary: async () => ({ overageEur: 20 }),
      sendEmail: async () => { sent = true; },
    });
    assert.strictEqual(r.alerted, false);
    assert.strictEqual(r.reason, 'ya avisado');
    assert.strictEqual(sent, false);
  });

  test('por debajo del umbral → no avisa', async () => {
    let sent = false;
    const org = { id: 'o1', owner_email: 'x@x.com', monthly_minutes_used: 505, monthly_minutes_limit: 500 };
    const r = await checkAndAlertOrg(org, { db: fakeDb, usageSummary: noMsgs, sendEmail: async () => { sent = true; } });
    assert.strictEqual(r.alerted, false);  // 5 min × 0,10 = 0,50€ « 25€
    assert.strictEqual(sent, false);
  });
});
