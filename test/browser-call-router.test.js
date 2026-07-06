// ============================================================
// VoiceCore — browser-call por el router LLM (2026-07-07)
// La demo del navegador iba con el SDK de OpenAI directo y
// gpt-4o-mini horneado (+ un "probe" que duplicaba la llamada
// cuando había tools). Ahora: router (groq>openai) en streaming,
// una sola pasada, tools desde el propio stream.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const BrowserCallHandler = require('../src/browser/browser-call');

function fakeWs() {
  const sent = [];
  return {
    sent, readyState: 1,
    send(x) { sent.push(typeof x === 'string' ? JSON.parse(x) : { binary: true, bytes: x.length }); },
  };
}

function makeHandler({ chunks, onStream, toolResult } = {}) {
  const streams = [];
  const llmRouter = {
    async *streamCompletion(params) {
      streams.push(params);
      if (onStream) { yield* onStream(streams.length, params); return; }
      yield* chunks;
    },
  };
  const toolExecutor = { execute: async (name, args) => (toolResult ? toolResult(name, args) : { ok: true }) };
  const h = new BrowserCallHandler({ get: () => null }, { llmRouter, toolExecutor });
  h._ttsCalls = [];
  h.synthesizeAndSend = async (ws, text) => { h._ttsCalls.push(text); };
  return { h, streams };
}

const session = (over = {}) => ({
  assistantId: 'demo-x', assistant: { language: 'es' }, conversation: [], isProcessing: false, ...over,
});

describe('browser-call vía router', () => {
  test('streaming de texto: frases al TTS en orden + transcript final + listening', async () => {
    const { h, streams } = makeHandler({
      chunks: [
        { type: 'text', content: 'Hola, buenos días. ' },
        { type: 'text', content: 'Tenemos hueco mañana. ' },
        { type: 'done', content: 'Hola, buenos días. Tenemos hueco mañana.', toolCalls: [] },
      ],
    });
    const ws = fakeWs();
    const s = session();
    await h.streamResponse(ws, s, []);

    assert.deepStrictEqual(h._ttsCalls, ['Hola, buenos días.', 'Tenemos hueco mañana.']);
    assert.strictEqual(streams[0].model, null);                     // sin modelo horneado → router elige
    assert.strictEqual(s.conversation.at(-1).role, 'assistant');
    const types = ws.sent.map(m => m.type);
    assert.ok(types.includes('speaking'));
    assert.strictEqual(types.at(-1), 'listening');
    const final = ws.sent.find(m => m.type === 'transcript' && m.final);
    assert.strictEqual(final.content, 'Hola, buenos días. Tenemos hueco mañana.');
  });

  test('tool call: ejecuta la tool y hace segunda pasada SIN tools', async () => {
    const executed = [];
    const { h, streams } = makeHandler({
      onStream: (n) => (async function* () {
        if (n === 1) {
          yield { type: 'tool_call', toolCall: { id: 'tc1', function: { name: 'get_services', arguments: '{}' } } };
          yield { type: 'done', content: '', toolCalls: [{ id: 'tc1', function: { name: 'get_services', arguments: '{}' } }] };
        } else {
          yield { type: 'text', content: 'Tenemos corte y color. ' };
          yield { type: 'done', content: 'Tenemos corte y color.', toolCalls: [] };
        }
      })(),
      toolResult: (name) => { executed.push(name); return { services: ['corte'] }; },
    });
    const ws = fakeWs();
    const s = session();
    await h.streamResponse(ws, s, [{ type: 'function', function: { name: 'get_services' } }]);

    assert.deepStrictEqual(executed, ['get_services']);
    assert.strictEqual(streams.length, 2, 'una pasada con tools + una de narración');
    assert.strictEqual(streams[1].tools, undefined, 'la segunda pasada va sin tools');
    // La conversación registra assistant(tool_calls) → tool → assistant final
    const roles = s.conversation.map(m => m.role);
    assert.deepStrictEqual(roles, ['assistant', 'tool', 'assistant']);
    assert.strictEqual(ws.sent.map(m => m.type).at(-1), 'listening');
    assert.deepStrictEqual(h._ttsCalls, ['Tenemos corte y color.']);
  });

  test('chunk de error: no lanza y devuelve el control (listening)', async () => {
    const { h } = makeHandler({ chunks: [{ type: 'error', message: 'boom' }] });
    const ws = fakeWs();
    await h.streamResponse(ws, session(), []);
    assert.strictEqual(ws.sent.map(m => m.type).at(-1), 'listening');
  });
});
