// ============================================================
// NodeFlow — TTS router: un audio VACÍO no es éxito (fix 2026-07)
// Bug latente (misma familia que el del router LLM): si un proveedor
// devuelve un buffer vacío SIN lanzar (API 200 sin cuerpo), el router lo
// daba por bueno Y lo cacheaba. Como el saludo/recuperación/despedida son
// frases FIJAS cacheadas, un vacío transitorio quedaba cacheado como
// SILENCIO PERMANENTE → todos los que llaman oyen nada al descolgar.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { TTSRouter } = require('../src/tts/router');

function prov(instance, extra = {}) {
  return { instance, priority: 1, avgLatency: 100, costPerMinute: 1, languages: ['es'], languageAffinity: [], ...extra };
}

describe('TTSRouter — audio vacío', () => {
  test('vacío de un proveedor → cae al siguiente con audio', async () => {
    const r = new TTSRouter({});
    r.providers.set('a', prov({ async synthesize() { return Buffer.alloc(0); } }, { priority: 1 }));
    r.providers.set('b', prov({ async synthesize() { return Buffer.from('audio-b'); } }, { priority: 2 }));
    const out = await r.synthesize({ callId: 'c', text: 'hola', language: 'es' });
    assert.strictEqual(out.toString(), 'audio-b');
  });

  test('NUNCA cachea un audio vacío (no deja una frase fija muda para siempre)', async () => {
    const r = new TTSRouter({});
    const script = ['empty', 'recuperado']; // 1ª vez vacío, 2ª vez audio
    let i = 0;
    r.providers.set('a', prov({
      async synthesize() { const v = script[i++]; return v === 'empty' ? Buffer.alloc(0) : Buffer.from(v); },
    }));
    const first = await r.synthesize({ callId: 'c', text: 'saludo', language: 'es' });
    assert.strictEqual(first.length, 0, 'sin fallback, la 1ª devuelve vacío');
    const second = await r.synthesize({ callId: 'c', text: 'saludo', language: 'es' });
    // Si hubiera cacheado el vacío, la 2ª también sería vacía. Debe reintentar.
    assert.strictEqual(second.toString(), 'recuperado', 'la 2ª NO sirve un vacío cacheado');
  });

  test('audio bueno SÍ se cachea (2ª llamada = hit, no re-sintetiza)', async () => {
    const r = new TTSRouter({});
    let calls = 0;
    r.providers.set('a', prov({ async synthesize() { calls++; return Buffer.from('audio'); } }));
    await r.synthesize({ callId: 'c', text: 'x', language: 'es' });
    await r.synthesize({ callId: 'c', text: 'x', language: 'es' });
    assert.strictEqual(calls, 1, 'la 2ª sale de caché');
  });
});
