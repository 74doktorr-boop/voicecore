// ============================================================
// NodeFlow — ElevenLabs TTS + routing tests
// Ejecutar: npm test  (node --test test/)
//
// Verifica que ElevenLabs usa Flash v2.5, puede dar mp3 (demo) y
// es preferente para castellano en el router, sin tocar euskera/galego.
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { ElevenLabsTTS } = require('../src/tts/elevenlabs');
const { TTSRouter } = require('../src/tts/router');

let lastReq = null;
const realFetch = global.fetch;
function mockFetch(body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])) {
  global.fetch = async (url, opts) => {
    lastReq = { url, opts, payload: JSON.parse(opts.body) };
    return { ok: true, status: 200, statusText: 'OK', async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); } };
  };
}

describe('ElevenLabsTTS', () => {
  beforeEach(() => { lastReq = null; mockFetch(); });
  afterEach(() => { global.fetch = realFetch; });

  test('usa el modelo Flash v2.5 por defecto', async () => {
    await new ElevenLabsTTS('key').synthesize({ callId: 'c', text: 'hola' });
    assert.strictEqual(lastReq.payload.model_id, 'eleven_flash_v2_5');
  });

  test('format mp3 → pide mp3 y devuelve los bytes tal cual (navegador)', async () => {
    const mp3 = Buffer.from([9, 9, 9, 9]);
    mockFetch(mp3);
    const out = await new ElevenLabsTTS('key').synthesize({ callId: 'c', text: 'hola', format: 'mp3' });
    assert.match(lastReq.url, /output_format=mp3_44100_128/);
    assert.deepStrictEqual(out, mp3); // mp3 directo, sin convertir a mulaw
  });

  test('por defecto (telefonía) pide ulaw_8000 nativo y devuelve los bytes tal cual', async () => {
    const ulaw = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    mockFetch(ulaw);
    const out = await new ElevenLabsTTS('key').synthesize({ callId: 'c', text: 'hola' });
    assert.match(lastReq.url, /output_format=ulaw_8000/);
    assert.deepStrictEqual(out, ulaw); // formato del teléfono directo, sin transcodificar
  });

  test('si ElevenLabs rechaza ulaw_8000 → reintenta con pcm_24000 y transcodifica', async () => {
    const reqs = [];
    global.fetch = async (url, opts) => {
      reqs.push(url);
      if (url.includes('ulaw_8000')) return { ok: false, status: 400, statusText: 'Bad Request' };
      const body = Buffer.alloc(48); // PCM válido para el resampleo
      return { ok: true, status: 200, statusText: 'OK', async arrayBuffer() { return body.buffer.slice(0, 48); } };
    };
    const out = await new ElevenLabsTTS('key').synthesize({ callId: 'c', text: 'hola' });
    assert.strictEqual(reqs.length, 2);
    assert.match(reqs[0], /ulaw_8000/);
    assert.match(reqs[1], /pcm_24000/);
    assert.ok(Buffer.isBuffer(out));
  });

  test('texto vacío → buffer vacío sin llamar a la API', async () => {
    const out = await new ElevenLabsTTS('key').synthesize({ callId: 'c', text: '  ' });
    assert.strictEqual(out.length, 0);
    assert.strictEqual(lastReq, null);
  });
});

describe('TTSRouter — ElevenLabs preferente para castellano', () => {
  test('registra elevenlabs con afinidad [es]', () => {
    const r = new TTSRouter({ elevenlabsApiKey: 'x' });
    const el = r.listAvailableVoices().find(v => v.provider === 'elevenlabs');
    assert.ok(el, 'elevenlabs registrado');
    assert.deepStrictEqual(el.languageAffinity, ['es']);
  });

  test('para "es": elevenlabs va primero, cartesia de fallback', () => {
    const r = new TTSRouter({ elevenlabsApiKey: 'x', cartesiaApiKey: 'c' });
    const chain = r._buildProviderChain(null, null, 'latency', 'es');
    assert.strictEqual(chain[0], 'elevenlabs');
    assert.ok(chain.includes('cartesia'), 'cartesia sigue en la cadena como fallback');
  });

  test('para "eu": elevenlabs NO entra (lo sirve el modelo local), no se usa para euskera', () => {
    const r = new TTSRouter({ elevenlabsApiKey: 'x', localTtsUrl: 'http://local' });
    const chain = r._buildProviderChain(null, null, 'latency', 'eu');
    assert.ok(!chain.includes('elevenlabs'));
  });
});
