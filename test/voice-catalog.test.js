'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { listVoices, normalizeEleven, staticCatalog, clearCache } = require('../src/tts/voice-catalog');

const FAKE = {
  voices: [
    { voice_id: 'aaa', name: 'Bella', category: 'premade', preview_url: 'http://x/bella.mp3',
      labels: { gender: 'Female', accent: 'spanish', age: 'young', use_case: 'narration' } },
    { voice_id: 'bbb', name: 'Mateo', category: 'professional', preview_url: 'http://x/mateo.mp3',
      labels: { gender: 'male', accent: 'castilian' } },
  ],
};
const okFetch = async () => ({ ok: true, json: async () => FAKE });
const failFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

describe('voice-catalog', () => {
  beforeEach(() => clearCache());

  test('normalizeEleven extrae nombre, género, accent, preview y labels', () => {
    const v = normalizeEleven(FAKE.voices[0]);
    assert.strictEqual(v.id, 'aaa');
    assert.strictEqual(v.name, 'Bella');
    assert.strictEqual(v.provider, 'elevenlabs');
    assert.strictEqual(v.gender, 'female');
    assert.strictEqual(v.accent, 'spanish');
    assert.strictEqual(v.previewUrl, 'http://x/bella.mp3');
    assert.ok(v.labels.includes('narration'));
  });

  test('listVoices con API ok → estático curado + SOLO las clonadas/profesionales añadidas', async () => {
    const voices = await listVoices({ apiKey: 'k', fetch: okFetch, force: true });
    // 'Mateo' (professional) se añade delante; 'Bella' (premade de cuenta)
    // NO entra: el catálogo curado ya trae las premade con tier/honestidad.
    assert.strictEqual(voices[0].name, 'Mateo');
    assert.strictEqual(voices[0].tier, 'premium');
    assert.ok(!voices.some(v => v.name === 'Bella'), 'las premade de la API no sustituyen al catálogo curado');
    assert.ok(voices.some(v => v.id === 'sofia-es'), 'el catálogo curado está presente');
  });

  test('sin apiKey → catálogo estático (config/voices.json)', async () => {
    const voices = await listVoices({ apiKey: null, fetch: okFetch, force: true });
    assert.ok(voices.length >= 1);
    assert.ok(voices.every(v => v.id && v.name));        // bien formadas
    // Marcador del catálogo estático: las voces euskera locales solo viven ahí
    assert.ok(voices.some(v => v.id === 'ane-eu'));
  });

  test('API falla (401) → fallback estático, no lanza', async () => {
    const voices = await listVoices({ apiKey: 'k', fetch: failFetch, force: true });
    assert.ok(Array.isArray(voices));
    assert.ok(voices.length >= 1);
  });

  test('cachea entre llamadas (no re-fetch si no force)', async () => {
    let calls = 0;
    const counting = async () => { calls++; return { ok: true, json: async () => FAKE }; };
    await listVoices({ apiKey: 'k', fetch: counting, force: true });
    await listVoices({ apiKey: 'k', fetch: counting }); // sin force → cache
    assert.strictEqual(calls, 1);
  });

  test('staticCatalog devuelve voces con id y name', () => {
    const s = staticCatalog();
    assert.ok(s.length >= 1);
    assert.ok(s[0].id && s[0].name);
  });
});
