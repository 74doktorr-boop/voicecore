// ============================================================
// NodeFlow — El catálogo de voces es HONESTO
// Bug real (2026-07-03, reportado 3 veces por Unai): el catálogo
// pintaba variedad (voces "de Google", "Cartesia"...) pero todo
// colapsaba a 4 IDs reales de ElevenLabs — el cliente oía la misma
// voz con distinto nombre. Estos tests hacen imposible la regresión:
// cada voz del catálogo debe resolver a un voice_id REAL y ÚNICO.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveElevenVoice } = require('../src/tts/voice-map');

const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'voices.json'), 'utf8')
);

const castellano = catalog.voices.filter(v => v.language === 'es-ES' && !v.isClone);

describe('catálogo de voces honesto', () => {
  test('cada voz castellana tiene un providerVoiceId ÚNICO (nada de repetidas)', () => {
    const ids = castellano.map(v => v.providerVoiceId);
    const unicos = new Set(ids);
    assert.strictEqual(unicos.size, ids.length,
      `hay voces compartiendo ID real: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
  });

  test('el traductor voice-map también resuelve cada id de catálogo a un ID único', () => {
    const resueltos = castellano.map(v => resolveElevenVoice(v.id));
    const unicos = new Set(resueltos);
    assert.strictEqual(unicos.size, resueltos.length,
      'voice-map colapsa varias voces del catálogo al mismo ID real');
  });

  test('catálogo y voice-map están alineados (mismo ID real por voz)', () => {
    for (const v of castellano) {
      assert.strictEqual(resolveElevenVoice(v.id), v.providerVoiceId,
        `${v.id}: catálogo dice ${v.providerVoiceId} pero voice-map resuelve ${resolveElevenVoice(v.id)}`);
    }
  });

  test('ningún proveedor fantasma: las voces es-ES son elevenlabs de verdad', () => {
    for (const v of castellano) {
      assert.strictEqual(v.provider, 'elevenlabs', `${v.id} declara proveedor "${v.provider}"`);
      assert.match(v.providerVoiceId, /^[A-Za-z0-9]{20}$/, `${v.id}: providerVoiceId no parece un ID real de ElevenLabs`);
    }
  });

  test('los alias del catálogo antiguo siguen sonando (y distintos entre sí)', () => {
    const legacy = ['marta-studio', 'jorge-studio', 'carmen-journey', 'isabel-cartesia', 'andrea-11labs'];
    const resueltos = legacy.map(resolveElevenVoice);
    assert.strictEqual(new Set(resueltos).size, legacy.length);
  });

  test('hay variedad de verdad: al menos 10 voces castellanas distintas', () => {
    assert.ok(castellano.length >= 10, `solo ${castellano.length} voces castellanas`);
  });
});
