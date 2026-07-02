// ============================================================
// NodeFlow — Voice mapping tests
// Verifica que cualquier valor del selector (nombres OpenAI, IDs de
// catálogo, IDs nativos) se traduce a un voiceId VÁLIDO de ElevenLabs,
// para que la demo y las llamadas suenen siempre a ElevenLabs.
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { resolveElevenVoice, ELEVEN_VOICES } = require('../src/tts/voice-map');
const { TTSRouter } = require('../src/tts/router');

describe('resolveElevenVoice', () => {
  test('nombres de OpenAI del selector → IDs de ElevenLabs por género', () => {
    assert.strictEqual(resolveElevenVoice('nova'),    ELEVEN_VOICES.FEM_1); // Sofía
    assert.strictEqual(resolveElevenVoice('shimmer'), ELEVEN_VOICES.FEM_2); // Lucía
    assert.strictEqual(resolveElevenVoice('echo'),    ELEVEN_VOICES.MAS_1); // Carlos
    assert.strictEqual(resolveElevenVoice('onyx'),    ELEVEN_VOICES.MAS_2); // Pablo
  });

  test('IDs nativos de ElevenLabs pasan tal cual', () => {
    for (const id of Object.values(ELEVEN_VOICES)) {
      assert.strictEqual(resolveElevenVoice(id), id);
    }
  });

  test('IDs del catálogo config/voices.json se mapean', () => {
    assert.strictEqual(resolveElevenVoice('lucia-es'), ELEVEN_VOICES.FEM_2);
    assert.strictEqual(resolveElevenVoice('carlos-es'), ELEVEN_VOICES.MAS_1);
  });

  test('un ID de ElevenLabs arbitrario (20 alfanum) se respeta', () => {
    const rachel = '21m00Tcm4TlvDq8ikWAM'; // Andrea (ElevenLabs) en el catálogo
    assert.strictEqual(resolveElevenVoice(rachel), rachel);
  });

  test('valores desconocidos / vacíos → default seguro (Femenina 1)', () => {
    assert.strictEqual(resolveElevenVoice(undefined),          ELEVEN_VOICES.FEM_1);
    assert.strictEqual(resolveElevenVoice(''),                 ELEVEN_VOICES.FEM_1);
    assert.strictEqual(resolveElevenVoice('studio-female-es'), ELEVEN_VOICES.FEM_1);
    assert.strictEqual(resolveElevenVoice('a0e99841-438c-4a64-b679-ae501e7d6091'), ELEVEN_VOICES.FEM_1);
  });
});

describe('TTSRouter._buildParams — elevenlabs traduce el voice', () => {
  test('voice="nova" del selector → voiceId real de ElevenLabs (no "nova")', () => {
    const r = new TTSRouter({ elevenlabsApiKey: 'x' });
    const params = r._buildParams('elevenlabs', 'nova', 1.0, 'es');
    assert.strictEqual(params.voiceId, ELEVEN_VOICES.FEM_1);
    assert.notStrictEqual(params.voiceId, 'nova');
  });
});
