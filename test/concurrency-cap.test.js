// ============================================================
// VoiceCore — Cap de llamadas concurrentes por asistente
// El pipeline rechaza llamadas por encima del límite del negocio
// (assistantId = identidad de negocio aquí). Control de coste/abuso.
// ============================================================

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

// Pipeline con routers simulados — no toca STT/TTS/LLM reales.
function makePipeline(opts = {}) {
  const sttRouter = {
    getProvider: () => ({ createSession: () => ({}) }),
    closeSession: () => {},
    sendAudio: () => {},
    resetTranscript: () => {},
  };
  return new VoicePipeline({ sttRouter, ttsRouter: {}, llmRouter: {}, ...opts });
}

// Asistente mínimo SIN firstMessage (evita el path de TTS en startCall).
const assistant = (id, extra = {}) => ({ id, name: id, language: 'es', ...extra });

const start = (p, callId, a) =>
  p.startCall({ callId, assistant: a, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });

describe('cap de llamadas concurrentes por asistente', () => {
  test('permite hasta el cap por defecto y luego rechaza', async () => {
    const p = makePipeline({ maxConcurrentPerAssistant: 2 });
    const a = assistant('biz-1');
    const s1 = await start(p, 'c1', a);
    const s2 = await start(p, 'c2', a);
    const s3 = await start(p, 'c3', a);
    assert.ok(s1, 'primera permitida');
    assert.ok(s2, 'segunda permitida');
    assert.strictEqual(s3, null, 'tercera rechazada en cap=2');
  });

  test('el override del asistente gana al default', async () => {
    const p = makePipeline({ maxConcurrentPerAssistant: 1 });
    const a = assistant('biz-2', { concurrentCalls: 3 });
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await start(p, 'o' + i, a));
    assert.ok(r[0] && r[1] && r[2], 'tres permitidas por override');
    assert.strictEqual(r[3], null, 'cuarta rechazada');
  });

  test('asistentes distintos tienen caps independientes', async () => {
    const p = makePipeline({ maxConcurrentPerAssistant: 1 });
    const s1 = await start(p, 'a1', assistant('A'));
    const s2 = await start(p, 'b1', assistant('B'));
    assert.ok(s1 && s2, 'cada asistente tiene su propio slot');
  });

  test('terminar una llamada libera un slot', async () => {
    const p = makePipeline({ maxConcurrentPerAssistant: 1 });
    const a = assistant('biz-3');
    const s1 = await start(p, 'f1', a);
    assert.ok(s1);
    assert.strictEqual(await start(p, 'f2', a), null, 'bloqueada con el slot ocupado');
    p.endCall('f1');
    const s2 = await start(p, 'f3', a);
    assert.ok(s2, 'slot liberado tras endCall');
  });
});
