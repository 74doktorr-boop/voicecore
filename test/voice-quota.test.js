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
  includedFallbackFor, voiceQuotaSummary, depletePackOnReset,
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

describe('voiceQuotaSummary — lo que ve el portal ("te quedan X min premium")', () => {
  test('voz estándar → no consume cupo (metered:false) pero informa la asignación premium', () => {
    const s = voiceQuotaSummary({ voiceTier: 'estandar', minutesUsed: 10, hasVoiceAddon: false });
    assert.strictEqual(s.metered, false);
    assert.strictEqual(s.quota, 40);
    assert.strictEqual(s.remaining, 30);
    assert.strictEqual(s.downgraded, false);
  });
  test('premium bajo cupo → remaining correcto, sin degradar', () => {
    const s = voiceQuotaSummary({ voiceTier: 'premium', minutesUsed: 12.5, hasVoiceAddon: false });
    assert.strictEqual(s.metered, true);
    assert.strictEqual(s.quota, 40);
    assert.strictEqual(s.used, 12.5);
    assert.strictEqual(s.remaining, 27.5);
    assert.strictEqual(s.downgraded, false);
  });
  test('premium con cupo agotado → remaining 0 y downgraded:true (suena Azure)', () => {
    const s = voiceQuotaSummary({ voiceTier: 'premium', minutesUsed: 55, hasVoiceAddon: false });
    assert.strictEqual(s.remaining, 0);
    assert.strictEqual(s.downgraded, true);
  });
  test('add-on + packs amplían el cupo mostrado', () => {
    const s = voiceQuotaSummary({ voiceTier: 'ultra', minutesUsed: 210, hasVoiceAddon: true, extraMinutes: 100 });
    assert.strictEqual(s.quota, 300);       // 200 add-on + 100 pack
    assert.strictEqual(s.remaining, 90);
    assert.strictEqual(s.extraMinutes, 100);
    assert.strictEqual(s.hasAddon, true);
    assert.strictEqual(s.downgraded, false);
  });
  test('remaining nunca negativo; consistente con shouldDowngradeVoice', () => {
    const s = voiceQuotaSummary({ voiceTier: 'premium', minutesUsed: 999, hasVoiceAddon: false });
    assert.strictEqual(s.remaining, 0);
    assert.strictEqual(
      s.downgraded,
      shouldDowngradeVoice('premium', 999, false, 0),
    );
  });
});

describe('depletePackOnReset — packs "persisten hasta gastarse" (decisión Unai 2026-07-04)', () => {
  test('sin pack → 0 (nada que arrastrar)', () => {
    assert.strictEqual(depletePackOnReset({ minutesUsed: 999, hasVoiceAddon: false, extraMinutes: 0 }), 0);
  });
  test('cupo base no agotado → el pack no se toca (persiste entero)', () => {
    // base 40; usó 30 < 40 → no entró al pack
    assert.strictEqual(depletePackOnReset({ minutesUsed: 30, hasVoiceAddon: false, extraMinutes: 50 }), 50);
  });
  test('desborda el base → gasta solo lo del pack usado', () => {
    // base 40; usó 60 → 20 salieron del pack → quedan 30
    assert.strictEqual(depletePackOnReset({ minutesUsed: 60, hasVoiceAddon: false, extraMinutes: 50 }), 30);
  });
  test('agota base + pack → pack a 0 (el resto ya sonó en Azure, no descuenta de más)', () => {
    // base 40 + pack 50 = techo 90; usó 100 → pack usado 50 → 0
    assert.strictEqual(depletePackOnReset({ minutesUsed: 100, hasVoiceAddon: false, extraMinutes: 50 }), 0);
  });
  test('con add-on el base es 200 (el pack se gasta después)', () => {
    // base 200 + pack 50 = 250; usó 210 → pack usado 10 → quedan 40
    assert.strictEqual(depletePackOnReset({ minutesUsed: 210, hasVoiceAddon: true, extraMinutes: 50 }), 40);
  });
});

describe('azureFallbackFor', () => {
  test('devuelve una voz Azure del mismo género', () => {
    assert.strictEqual(azureFallbackFor('male'), 'alvaro-az');
    assert.strictEqual(azureFallbackFor('female'), 'elvira-az');
    assert.strictEqual(azureFallbackFor(undefined), 'elvira-az'); // default femenina
  });
});

describe('includedFallbackFor — degradación a voz INCLUIDA fiable (Cartesia)', () => {
  test('devuelve una voz incluida del mismo género', () => {
    assert.strictEqual(includedFallbackFor('male'), 'marcos-ca');
    assert.strictEqual(includedFallbackFor('female'), 'blanca-ca');
    assert.strictEqual(includedFallbackFor(undefined), 'blanca-ca');
  });
  test('los ids devueltos EXISTEN en el catálogo como cartesia/estandar (guard anti-drift)', () => {
    const { resolveVoiceEntry } = require('../src/tts/voice-catalog');
    for (const g of ['male', 'female']) {
      const e = resolveVoiceEntry(includedFallbackFor(g));
      assert.ok(e && e.provider === 'cartesia' && e.tier === 'estandar',
        `${includedFallbackFor(g)} debe ser una voz Cartesia incluida vigente`);
    }
  });
});
