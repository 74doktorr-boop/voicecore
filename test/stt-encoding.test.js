// ============================================================
// NodeFlow — Selección del códec de entrada del STT
// Causa raíz REAL (2026-07-03, llamada b05147a2): Telnyx entrega el
// audio en PCMA (A-law, estándar europeo) y el pipeline lo declaraba
// PCMU (mu-law) a Deepgram. La voz seguía sonando "a voz" pero la
// precisión se hundía: "corte de pelo" → "cortador de vuelo",
// confidence 0.78. Los MISMOS bytes decodificados como alaw: 0.995 y
// transcripción perfecta (verificado con Deepgram y Whisper).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

function makePipeline(captured) {
  const sttRouter = {
    getProvider: () => ({ createSession: (id, opts) => { captured.push(opts); return {}; } }),
    createSession: (id, opts) => { captured.push(opts); return {}; },
    closeSession: () => {},
    sendAudio: () => {},
    resetTranscript: () => {},
  };
  return new VoicePipeline({ sttRouter, ttsRouter: {}, llmRouter: {}, callStore: { saveCallStart: async () => {}, saveCallEnd: async () => {} } });
}

async function encodingFor({ provider, mediaEncoding }) {
  const captured = [];
  const p = makePipeline(captured);
  await p.startCall({
    callId: `enc-${provider}-${mediaEncoding || 'none'}`,
    assistant: { id: 'biz-e', name: 'B', language: 'es' },
    callerNumber: 'x', calledNumber: 'y', direction: 'inbound',
    provider, mediaEncoding,
  });
  return { encoding: captured[0].encoding, sampleRate: captured[0].sample_rate };
}

describe('códec de entrada del STT por proveedor', () => {
  test('telnyx anuncia PCMA → alaw (el caso real de España)', async () => {
    assert.deepStrictEqual(await encodingFor({ provider: 'telnyx', mediaEncoding: 'alaw' }), { encoding: 'alaw', sampleRate: 8000 });
  });

  test('telnyx SIN anuncio → alaw por defecto (despliegue europeo)', async () => {
    assert.deepStrictEqual(await encodingFor({ provider: 'telnyx', mediaEncoding: null }), { encoding: 'alaw', sampleRate: 8000 });
  });

  test('telnyx anuncia PCMU → mulaw (rutas no europeas)', async () => {
    assert.deepStrictEqual(await encodingFor({ provider: 'telnyx', mediaEncoding: 'mulaw' }), { encoding: 'mulaw', sampleRate: 8000 });
  });

  test('twilio → mulaw 8k (sin cambios)', async () => {
    assert.deepStrictEqual(await encodingFor({ provider: 'twilio' }), { encoding: 'mulaw', sampleRate: 8000 });
  });

  test('vonage → linear16 16k (sin cambios)', async () => {
    assert.deepStrictEqual(await encodingFor({ provider: 'vonage' }), { encoding: 'linear16', sampleRate: 16000 });
  });
});
