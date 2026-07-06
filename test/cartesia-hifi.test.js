// ============================================================
// NodeFlow — Preview hi-fi de Cartesia (2026-07-06)
// La demo servía 8 kHz telefónicos ("microondas"); el preview del
// navegador debe pedir PCM 44.1 kHz a Cartesia.
// ============================================================
'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const { CartesiaTTS } = require('../src/tts/cartesia');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('CartesiaTTS.synthesizeHiFi', () => {
  test('pide 44100 Hz pcm_s16le y devuelve el PCM con su sampleRate', async () => {
    let captured = null;
    global.fetch = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    };
    const tts = new CartesiaTTS({ apiKey: 'test' });
    const out = await tts.synthesizeHiFi({ callId: 't', text: 'Hola', voice: 'v1', language: 'es' });
    assert.strictEqual(captured.body.output_format.sample_rate, 44100);
    assert.strictEqual(captured.body.output_format.encoding, 'pcm_s16le');
    assert.strictEqual(captured.body.voice.id, 'v1');
    assert.strictEqual(out.sampleRate, 44100);
    assert.strictEqual(out.pcm.length, 4);
  });

  test('texto vacío → buffer vacío sin llamar a la API', async () => {
    let called = false;
    global.fetch = async () => { called = true; };
    const tts = new CartesiaTTS({ apiKey: 'test' });
    const out = await tts.synthesizeHiFi({ callId: 't', text: '  ' });
    assert.strictEqual(out.pcm.length, 0);
    assert.strictEqual(called, false);
  });

  test('error de la API → lanza (la demo tiene su fallback)', async () => {
    global.fetch = async () => ({ ok: false, status: 402, text: async () => 'quota' });
    const tts = new CartesiaTTS({ apiKey: 'test' });
    await assert.rejects(() => tts.synthesizeHiFi({ callId: 't', text: 'Hola' }), /402/);
  });
});
