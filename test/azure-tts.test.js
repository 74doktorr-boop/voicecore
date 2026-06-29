// ============================================================
// NodeFlow — Azure Neural TTS tests
// Ejecutar: npm test  (node --test test/)
//
// Verifica el proveedor Azure (SSML, selección de voz por idioma/
// preset, mulaw 8kHz, velocidad, escape XML) y su registro en el
// router — sin llamadas reales a la API (fetch mockeado).
// ============================================================

'use strict';

process.env.NODE_ENV = 'test';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { AzureTTS } = require('../src/tts/azure-tts');
const { TTSRouter } = require('../src/tts/router');

let lastReq = null;
const realFetch = global.fetch;

function mockFetch({ ok = true, status = 200, body = Buffer.from([0xff, 0x7f, 0x00]) } = {}) {
  global.fetch = async (url, opts) => {
    lastReq = { url, opts };
    return {
      ok, status,
      async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
      async text() { return ok ? '' : 'error detail'; },
    };
  };
}

describe('AzureTTS', () => {
  beforeEach(() => { lastReq = null; mockFetch(); });
  afterEach(() => { global.fetch = realFetch; });

  test('texto vacío → buffer vacío sin llamar a la API', async () => {
    const tts = new AzureTTS('key', 'westeurope');
    const buf = await tts.synthesize({ callId: 'c', text: '   ' });
    assert.strictEqual(buf.length, 0);
    assert.strictEqual(lastReq, null);
  });

  test('castellano por defecto → voz Elvira + mulaw 8kHz', async () => {
    const tts = new AzureTTS('key', 'westeurope');
    const buf = await tts.synthesize({ callId: 'c', text: 'Hola, ¿en qué puedo ayudarte?' });
    assert.ok(buf.length > 0, 'devuelve audio');
    assert.match(lastReq.opts.body, /es-ES-ElviraNeural/);
    assert.match(lastReq.opts.body, /xml:lang='es-ES'/);
    assert.strictEqual(lastReq.opts.headers['X-Microsoft-OutputFormat'], 'raw-8khz-8bit-mono-mulaw');
    assert.strictEqual(lastReq.opts.headers['Ocp-Apim-Subscription-Key'], 'key');
  });

  test('endpoint usa la región', async () => {
    const tts = new AzureTTS('key', 'francecentral');
    await tts.synthesize({ callId: 'c', text: 'hola' });
    assert.match(lastReq.url, /francecentral\.tts\.speech\.microsoft\.com/);
  });

  test('idioma gl/eu eligen voz nativa', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'ola', language: 'gl' });
    assert.match(lastReq.opts.body, /gl-ES-SabelaNeural/);
    await tts.synthesize({ callId: 'c', text: 'kaixo', language: 'eu' });
    assert.match(lastReq.opts.body, /eu-ES-AinhoaNeural/);
  });

  test('preset de voz se resuelve (alvaro → AlvaroNeural)', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'hola', voice: 'alvaro' });
    assert.match(lastReq.opts.body, /es-ES-AlvaroNeural/);
  });

  test('velocidad se traduce a prosody rate', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'hola', speed: 1.1 });
    assert.match(lastReq.opts.body, /rate='10%'/);
  });

  test('escapa XML en el texto', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'Tú & yo <test>' });
    assert.match(lastReq.opts.body, /Tú &amp; yo &lt;test&gt;/);
    assert.doesNotMatch(lastReq.opts.body.replace(/<speak[\s\S]*?<prosody[^>]*>/, '').replace(/<\/prosody>[\s\S]*/, ''), /<test>/);
  });

  test('format mp3 pide salida mp3 (reproducible en navegador)', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'hola', format: 'mp3' });
    assert.match(lastReq.opts.headers['X-Microsoft-OutputFormat'], /mp3/);
  });

  test('por defecto pide mulaw (telefonía)', async () => {
    const tts = new AzureTTS('key');
    await tts.synthesize({ callId: 'c', text: 'hola' });
    assert.strictEqual(lastReq.opts.headers['X-Microsoft-OutputFormat'], 'raw-8khz-8bit-mono-mulaw');
  });

  test('error HTTP lanza', async () => {
    mockFetch({ ok: false, status: 401 });
    const tts = new AzureTTS('key');
    await assert.rejects(() => tts.synthesize({ callId: 'c', text: 'hola' }), /Azure TTS 401/);
  });

  test('sin key lanza', async () => {
    const tts = new AzureTTS('');
    await assert.rejects(() => tts.synthesize({ callId: 'c', text: 'hola' }), /key no configurada/);
  });
});

describe('TTSRouter — registro de Azure', () => {
  test('registra azure cuando hay key y aparece en voces', () => {
    const router = new TTSRouter({ azureSpeechKey: 'k', azureSpeechRegion: 'westeurope' });
    const names = router.listAvailableVoices().map(v => v.provider);
    assert.ok(names.includes('azure'), 'azure registrado');
    const azure = router.listAvailableVoices().find(v => v.provider === 'azure');
    assert.ok(azure.languages.includes('es'));
    assert.ok(azure.costPerMinute <= 0.02, 'coste bajo (margen)');
  });

  test('no registra azure sin key', () => {
    const router = new TTSRouter({});
    assert.ok(!router.listAvailableVoices().some(v => v.provider === 'azure'));
  });
});
