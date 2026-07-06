// ============================================================
// VoiceCore — Arranque temprano del primer audio (2026-07-07)
// El primer fragmento del turno no espera al punto: una cláusula
// con coma (≥24 chars) ya se habla mientras el resto se genera.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

function makePipeline(chunks, spoken) {
  const sttRouter = {
    getProvider: () => ({ createSession: () => ({}) }),
    closeSession: () => {}, sendAudio: () => {}, resetTranscript: () => {},
  };
  const ttsRouter = { synthesize: async ({ text }) => { spoken.push(text); return Buffer.alloc(160); } };
  const llmRouter = { async *streamCompletion() { yield* chunks; } };
  return new VoicePipeline({ sttRouter, ttsRouter, llmRouter });
}

describe('arranque temprano del primer fragmento', () => {
  test('la primera cláusula con coma se habla sin esperar al punto', async () => {
    const spoken = [];
    const p = makePipeline([
      { type: 'text', content: 'Hola de nuevo Raúl encantado, ' },        // coma → fragmento temprano
      { type: 'text', content: 'nos alegra tenerte de vuelta. ' },        // completa la frase
      { type: 'done', content: 'Hola de nuevo Raúl encantado, nos alegra tenerte de vuelta.', toolCalls: [] },
    ], spoken);
    const s = await p.startCall({ callId: 'ff1', assistant: { id: 'a1', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('ff1', 'Hola, quiero información.');
    assert.ok(spoken.length >= 2, 'debería trocear en fragmento + resto');
    assert.strictEqual(spoken[0], 'Hola de nuevo Raúl encantado,');
    assert.ok(s.metrics.turns[0].firstAudioMs != null, 'firstAudioMs medido');
  });

  test('fragmentos cortos (<24 chars) NO se trocean (evita "Hola," suelto)', async () => {
    const spoken = [];
    const p = makePipeline([
      { type: 'text', content: 'Hola, ' },
      { type: 'text', content: 'buenos días señor García. ' },
      { type: 'done', content: 'Hola, buenos días señor García.', toolCalls: [] },
    ], spoken);
    await p.startCall({ callId: 'ff2', assistant: { id: 'a2', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('ff2', 'Hola.');
    assert.strictEqual(spoken[0], 'Hola, buenos días señor García.');
  });

  test('el arranque temprano solo aplica al PRIMER fragmento (el resto va por frases)', async () => {
    const spoken = [];
    const p = makePipeline([
      { type: 'text', content: 'Tenemos varias opciones disponibles, se lo cuento. ' },
      { type: 'text', content: 'La primera es fisioterapia general, con bono de cinco sesiones. ' },
      { type: 'done', content: '', toolCalls: [] },
    ], spoken);
    await p.startCall({ callId: 'ff3', assistant: { id: 'a3', language: 'es' }, callerNumber: 'x', calledNumber: 'y', direction: 'inbound' });
    await p._processTurn('ff3', '¿Qué ofrecéis?');
    // 1º: frase completa directa (llegó con punto antes de valorar coma);
    // las comas de la 2ª frase NO la trocean.
    assert.ok(spoken.some(t => t === 'La primera es fisioterapia general, con bono de cinco sesiones.'),
      `la segunda frase va entera: ${JSON.stringify(spoken)}`);
  });
});
