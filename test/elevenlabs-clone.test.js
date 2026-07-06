// ============================================================
// NodeFlow — Clonado de voz (Instant Voice Cloning) 2026-07-06
// "Tu negocio contesta con TU voz". Estos tests fijan la llamada a
// ElevenLabs /v1/voices/add (multipart) sin tocar la red.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { ElevenLabsTTS } = require('../src/tts/elevenlabs');

const eleven = new ElevenLabsTTS('test-key');

describe('cloneVoice', () => {
  test('clona y devuelve voiceId; usa multipart y la api-key', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ voice_id: 'v_clone_123' }) }; };
    const r = await eleven.cloneVoice({ name: 'Mi negocio', audioBuffer: Buffer.alloc(50000), mimeType: 'audio/webm' }, { fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.voiceId, 'v_clone_123');
    assert.match(captured.url, /\/voices\/add$/);
    assert.ok(captured.opts.body instanceof FormData, 'body es FormData');
    assert.strictEqual(captured.opts.headers['xi-api-key'], 'test-key');
    assert.ok(!captured.opts.headers['Content-Type'], 'no fija Content-Type (lo pone FormData con su boundary)');
  });

  test('audio vacío → ok:false sin llamar a la red', async () => {
    let called = false;
    const r = await eleven.cloneVoice({ name: 'x', audioBuffer: Buffer.alloc(0) }, { fetchImpl: async () => { called = true; return {}; } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(called, false);
  });

  test('error de ElevenLabs → ok:false con mensaje legible', async () => {
    const fetchImpl = async () => ({ ok: false, status: 422, json: async () => ({ detail: { message: 'audio too short' } }) });
    const r = await eleven.cloneVoice({ name: 'x', audioBuffer: Buffer.alloc(50000) }, { fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /too short/);
  });

  test('deleteVoice pega al endpoint correcto', async () => {
    let url = null;
    const r = await eleven.deleteVoice('v_x', { fetchImpl: async (u) => { url = u; return { ok: true }; } });
    assert.strictEqual(r.ok, true);
    assert.match(url, /\/voices\/v_x$/);
  });
});
