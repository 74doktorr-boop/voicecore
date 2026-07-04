// ============================================================
// NodeFlow — Voice mapping tests
// Verifica que cualquier valor del selector (ids de catálogo, nombres
// OpenAI legacy, ids nativos) se traduce a un voiceId VÁLIDO de ElevenLabs.
// Fuente de verdad: config/voices.json (voice-map deriva de ahí, 2026-07-04).
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { resolveElevenVoice, clearCache, DEFAULT_ELEVEN_ID } = require('../src/tts/voice-map');
const { TTSRouter } = require('../src/tts/router');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'voices.json'), 'utf8'));
const elevenVoices = catalog.voices.filter(v => v.provider === 'elevenlabs' && v.providerVoiceId !== 'custom');

describe('resolveElevenVoice (catálogo = fuente de verdad)', () => {
  clearCache();

  test('cada id de catálogo ElevenLabs → su voice_id REAL', () => {
    for (const v of elevenVoices) {
      assert.strictEqual(resolveElevenVoice(v.id), v.providerVoiceId, `${v.id} mal mapeada`);
    }
  });

  test('los voice_id reales del catálogo pasan tal cual', () => {
    for (const v of elevenVoices) {
      assert.strictEqual(resolveElevenVoice(v.providerVoiceId), v.providerVoiceId);
    }
  });

  test('nombres OpenAI legacy → voz vigente por género (nunca "nova" crudo)', () => {
    const byId = Object.fromEntries(elevenVoices.map(v => [v.id, v.providerVoiceId]));
    assert.strictEqual(resolveElevenVoice('nova'),  byId['cristina-es']);
    assert.strictEqual(resolveElevenVoice('echo'),  byId['carlos-es']);
    assert.strictEqual(resolveElevenVoice('onyx'),  byId['tony-es']);
    assert.notStrictEqual(resolveElevenVoice('nova'), 'nova');
  });

  test('alias del catálogo retirado siguen sonando (org de prod: sofia-es intacta)', () => {
    const byId = Object.fromEntries(elevenVoices.map(v => [v.id, v.providerVoiceId]));
    // sofia-es tenía el MISMO voice_id que cristina-es → la org no cambia de voz
    assert.strictEqual(resolveElevenVoice('sofia-es'), byId['cristina-es']);
    assert.strictEqual(resolveElevenVoice('sofia-es'), DEFAULT_ELEVEN_ID);
  });

  test('un voice_id arbitrario (20 alfanum) se respeta', () => {
    const raw = '21m00Tcm4TlvDq8ikWAM';
    assert.strictEqual(resolveElevenVoice(raw), raw);
  });

  test('desconocido / vacío → default seguro', () => {
    assert.strictEqual(resolveElevenVoice(undefined),          DEFAULT_ELEVEN_ID);
    assert.strictEqual(resolveElevenVoice(''),                 DEFAULT_ELEVEN_ID);
    assert.strictEqual(resolveElevenVoice('studio-female-es'), DEFAULT_ELEVEN_ID);
    assert.strictEqual(resolveElevenVoice('a0e99841-438c-4a64-b679-ae501e7d6091'), DEFAULT_ELEVEN_ID);
  });
});

describe('TTSRouter._buildParams — elevenlabs traduce el voice', () => {
  test('voice="nova" del selector → voiceId real de ElevenLabs (no "nova")', () => {
    const r = new TTSRouter({ elevenlabsApiKey: 'x' });
    const params = r._buildParams('elevenlabs', 'nova', 1.0, 'es');
    assert.strictEqual(params.voiceId, DEFAULT_ELEVEN_ID);
    assert.notStrictEqual(params.voiceId, 'nova');
  });
});
