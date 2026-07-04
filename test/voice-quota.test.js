// ============================================================
// NodeFlow — Cupo de voz Premium/Ultra (decisión Unai 2026-07-04)
// El plan básico incluye TODAS las voces, pero las caras (ElevenLabs
// Premium, Cartesia Ultra) solo hasta un cupo de minutos/mes; superado
// el cupo, el asistente sigue hablando pero con voz Estándar (Azure).
// El add-on voice_premium sube el cupo. Extra comprado lo amplía más.
// Determinista y server-side: protege el margen sin depender del LLM.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  QUOTA_BASIC, QUOTA_ADDON, premiumQuota, shouldDowngradeVoice, azureFallbackFor,
} = require('../src/tts/voice-quota');

describe('premiumQuota', () => {
  test('sin add-on → cupo básico; con add-on → cupo ampliado', () => {
    assert.strictEqual(premiumQuota(false), QUOTA_BASIC);
    assert.strictEqual(premiumQuota(true), QUOTA_ADDON);
    assert.strictEqual(QUOTA_BASIC, 40);
    assert.strictEqual(QUOTA_ADDON, 200);
  });
  test('minutos extra comprados amplían el cupo', () => {
    assert.strictEqual(premiumQuota(false, 60), 100);
    assert.strictEqual(premiumQuota(true, 100), 300);
  });
});

describe('shouldDowngradeVoice', () => {
  test('voz estándar NUNCA degrada (Azure/local no gastan cupo)', () => {
    assert.strictEqual(shouldDowngradeVoice('estandar', 999, false), false);
    assert.strictEqual(shouldDowngradeVoice(null, 999, false), false);
  });
  test('premium bajo cupo → no degrada; en o sobre cupo → degrada', () => {
    assert.strictEqual(shouldDowngradeVoice('premium', 30, false), false); // 30 < 40
    assert.strictEqual(shouldDowngradeVoice('premium', 40, false), true);  // 40 >= 40
    assert.strictEqual(shouldDowngradeVoice('premium', 55, false), true);
  });
  test('ultra igual que premium (mismo cupo)', () => {
    assert.strictEqual(shouldDowngradeVoice('ultra', 39, false), false);
    assert.strictEqual(shouldDowngradeVoice('ultra', 41, false), true);
  });
  test('con add-on el cupo es 200', () => {
    assert.strictEqual(shouldDowngradeVoice('premium', 150, true), false);
    assert.strictEqual(shouldDowngradeVoice('premium', 200, true), true);
  });
  test('minutos extra comprados evitan la degradación', () => {
    assert.strictEqual(shouldDowngradeVoice('premium', 55, false, 30), false); // cupo 40+30=70
    assert.strictEqual(shouldDowngradeVoice('premium', 75, false, 30), true);  // 75 >= 70
  });
});

describe('azureFallbackFor', () => {
  test('devuelve una voz Azure del mismo género', () => {
    assert.strictEqual(azureFallbackFor('male'), 'alvaro-az');
    assert.strictEqual(azureFallbackFor('female'), 'elvira-az');
    assert.strictEqual(azureFallbackFor(undefined), 'elvira-az'); // default femenina
  });
});
