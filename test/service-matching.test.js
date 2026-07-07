// ============================================================
// NodeFlow — Reglas ligadas a los SERVICIOS del negocio (2026-07-07)
// Requisito Unai: "no todas las clínicas ofrecen psicotécnicos, ojo ahí".
// Una regla ligada a servicio solo aplica si el negocio ofrece algo que
// case; el enabled explícito del dueño siempre gana.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { appliesToServices } = require('../src/lifecycle/sector-catalog');
const { buildRulesView } = require('../src/lifecycle/followup-rules');
const { getOrgReminderConfig } = require('../src/lifecycle/reminder-engine');

const PSICO = { serviceMatch: ['psicotecnico', 'psicotécnico', 'reconocimiento', 'carnet'] };

describe('appliesToServices (pura)', () => {
  test('regla genérica (sin palabras clave) → aplica siempre', () => {
    assert.strictEqual(appliesToServices({}, [{ name: 'Fisioterapia' }]), true);
  });
  test('sin serviceList configurada → aplica (no castigar la falta de datos)', () => {
    assert.strictEqual(appliesToServices(PSICO, null), true);
    assert.strictEqual(appliesToServices(PSICO, []), true);
  });
  test('clínica SIN psicotécnicos → la regla NO aplica', () => {
    assert.strictEqual(appliesToServices(PSICO, [{ name: 'Fisioterapia' }, { name: 'Nutrición' }]), false);
  });
  test('clínica CON psicotécnicos → aplica (acentos y contención toleradas)', () => {
    assert.strictEqual(appliesToServices(PSICO, [{ name: 'Psicotécnicos carnet B/C' }]), true);
    assert.strictEqual(appliesToServices(PSICO, [{ name: 'Reconocimiento médico' }]), true);
  });
  test('serviceFilter también sirve de matching (peluquería sin permanente)', () => {
    const perm = { serviceFilter: ['permanente'] };
    assert.strictEqual(appliesToServices(perm, [{ name: 'Corte' }, { name: 'Tinte' }]), false);
    assert.strictEqual(appliesToServices(perm, [{ name: 'Permanente y moldeado' }]), true);
  });
});

describe('buildRulesView con servicios', () => {
  test('la regla que no aplica sale apagada y marcada', () => {
    const rules = buildRulesView('clinica', {}, [{ name: 'Fisioterapia' }]);
    const psico = rules.find(r => r.key === 'renovacion_psicotecnico');
    assert.strictEqual(psico.applies, false);
    assert.strictEqual(psico.enabled, false);
  });
  test('el enabled explícito del dueño GANA al matching', () => {
    const rules = buildRulesView('clinica', { renovacion_psicotecnico: { enabled: true } }, [{ name: 'Fisioterapia' }]);
    const psico = rules.find(r => r.key === 'renovacion_psicotecnico');
    assert.strictEqual(psico.enabled, true);
  });
  test('sin serviceList → todo como antes (aplica)', () => {
    const rules = buildRulesView('clinica', {});
    assert.ok(rules.every(r => r.applies !== false));
  });
});

describe('getOrgReminderConfig con servicios (el motor no dispara lo que no aplica)', () => {
  const stubDb = { enabled: true, client: { from: () => ({ select: function(){return this;}, eq: function(){return this;}, maybeSingle: async () => ({ data: null }) }) } };
  test('clínica sin psicotécnicos → regla deshabilitada en el motor', async () => {
    const cfg = await getOrgReminderConfig('org1', 'clinica', { db: stubDb, serviceList: [{ name: 'Fisioterapia' }] });
    assert.strictEqual(cfg.renovacion_psicotecnico.enabled, false);
    assert.strictEqual(cfg.revision_anual.enabled, false);   // tampoco lista 'revisión'
  });
  test('con el servicio listado → habilitada', async () => {
    const cfg = await getOrgReminderConfig('org1', 'clinica', { db: stubDb, serviceList: [{ name: 'Psicotécnico carnet' }] });
    assert.strictEqual(cfg.renovacion_psicotecnico.enabled, true);
  });
});
