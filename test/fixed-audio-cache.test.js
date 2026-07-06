// ============================================================
// VoiceCore — Caché de audio de frases fijas (2026-07-07)
// El saludo de cada negocio es idéntico en cada llamada: se sintetiza
// UNA vez y las siguientes llamadas arrancan al instante. También mide
// totalTtsTime y firstAudioMs (la latencia que percibe el cliente).
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

function makePipeline(synthCounter) {
  const sttRouter = {
    getProvider: () => ({ createSession: () => ({}) }),
    closeSession: () => {}, sendAudio: () => {}, resetTranscript: () => {},
  };
  const ttsRouter = {
    synthesize: async () => { synthCounter.n++; return Buffer.alloc(1600); }, // ~200ms de mulaw
  };
  return new VoicePipeline({ sttRouter, ttsRouter, llmRouter: {} });
}

// El saludo debe llevar texto ÚNICO por test: la caché es a nivel de módulo.
const assistant = (id, greeting) => ({ id, name: id, language: 'es', voice: 'blanca', firstMessage: greeting });

describe('caché de frases fijas', () => {
  test('el saludo se sintetiza UNA vez para N llamadas (misma voz+texto)', async () => {
    const counter = { n: 0 };
    const p = makePipeline(counter);
    const a = assistant('biz-cache-1', 'Hola, soy la peluquería test cache uno.');
    await p.startCall({ callId: 'cc1', assistant: a, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    const after1 = counter.n;
    await p.startCall({ callId: 'cc2', assistant: a, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p.startCall({ callId: 'cc3', assistant: a, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    assert.strictEqual(after1, 1, 'primera llamada sintetiza');
    assert.strictEqual(counter.n, 1, 'segunda y tercera salen de caché');
  });

  test('voz distinta = entrada distinta (no se mezclan audios)', async () => {
    const counter = { n: 0 };
    const p = makePipeline(counter);
    const texto = 'Hola, soy el negocio test cache dos.';
    await p.startCall({ callId: 'cd1', assistant: assistant('b1', texto), callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    const otherVoice = { ...assistant('b2', texto), voice: 'brais-gl' };
    await p.startCall({ callId: 'cd2', assistant: otherVoice, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    assert.strictEqual(counter.n, 2, 'cada voz sintetiza la suya');
  });

  test('el saludo acumula totalTtsTime en las métricas de la sesión', async () => {
    const counter = { n: 0 };
    const p = makePipeline(counter);
    const s = await p.startCall({ callId: 'cm1', assistant: assistant('b3', 'Saludo métricas test tres.'), callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    assert.ok(s.metrics.totalTtsTime >= 0, 'totalTtsTime instrumentado');
    assert.strictEqual(typeof s.metrics.totalTtsTime, 'number');
  });
});
