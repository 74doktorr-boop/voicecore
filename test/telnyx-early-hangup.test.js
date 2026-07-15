// ============================================================
// NodeFlow — Fuga de sesión por CUELGUE TEMPRANO (auditoría 2026-07-16).
// Si el cliente cuelga durante los ~2s que tarda startCall (BD+RAG+saludo),
// la sesión quedaba registrada en activeCalls sin que nadie la limpiara →
// a ~10 fantasmas el asistente alcanza el cap y rechaza llamadas reales.
// Este test reproduce la carrera: 'start' → (startCall lento) → 'stop' antes
// de que resuelva, y verifica que la sesión se cierra.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { setupTelnyxStreams } = require('../src/telephony/telnyx-handler');

function fakeWs() {
  const ws = new EventEmitter();
  ws.closed = false;
  ws.close = () => { ws.closed = true; };
  ws.send = () => {};
  return ws;
}

const nap = (ms) => new Promise(r => setTimeout(r, ms));

describe('telnyx — cuelgue durante el arranque no deja sesión fantasma', () => {
  test('start + stop (antes de que startCall resuelva) → la sesión se limpia', async () => {
    const active = new Map();
    let startResolve;
    const pipeline = {
      activeCalls: active,
      // startCall LENTO: resuelve cuando lo soltemos, registrando la sesión.
      startCall: async ({ callId }) => {
        await new Promise(r => { startResolve = () => { active.set(callId, { id: callId }); r(); }; });
        return true;
      },
      endCall: (callId) => { active.delete(callId); },
      handleAudio: () => {}, handleMark: () => {},
      _resolveOrgId: async () => null,
    };
    const assistant = { id: 'org-x', name: 'Test', ttsProvider: 'openai', tools: [] };
    const assistantManager = { get: () => assistant, getByPhoneNumber: () => assistant, getDefault: () => assistant };

    const wss = new EventEmitter();
    setupTelnyxStreams(wss, pipeline, assistantManager);

    const ws = fakeWs();
    wss.emit('connection', ws, { url: '/telnyx-stream', headers: {} });

    // 1) start → el handler entra en startCall y se queda esperando
    ws.emit('message', JSON.stringify({ event: 'start', start: {
      streamSid: 'S1', callSid: 'C1',
      customParameters: { from: '+34600', to: '+34843700849', assistantId: 'org-x' },
      media_format: { encoding: 'PCMA' },
    }}));
    await nap(30);
    assert.strictEqual(active.size, 0, 'aún no registrada (startCall en vuelo)');

    // 2) stop ANTES de que startCall resuelva (el cliente colgó)
    ws.emit('message', JSON.stringify({ event: 'stop' }));
    await nap(10);

    // 3) ahora startCall resuelve y registra la sesión…
    startResolve();
    await nap(30);

    // …y el chequeo wsEnded la cierra: cero sesiones fantasma.
    assert.strictEqual(active.size, 0, 'la sesión NO queda colgada tras el cuelgue temprano');
    assert.strictEqual(ws.closed, true, 'el WS se cierra');
  });

  test('camino normal (sin cuelgue) → la sesión queda activa', async () => {
    const active = new Map();
    const pipeline = {
      activeCalls: active,
      startCall: async ({ callId }) => { active.set(callId, { id: callId }); return true; },
      endCall: (callId) => { active.delete(callId); },
      handleAudio: () => {}, handleMark: () => {}, _resolveOrgId: async () => null,
    };
    const assistant = { id: 'org-y', name: 'Test', ttsProvider: 'openai', tools: [] };
    const assistantManager = { get: () => assistant, getByPhoneNumber: () => assistant, getDefault: () => assistant };
    const wss = new EventEmitter();
    setupTelnyxStreams(wss, pipeline, assistantManager);
    const ws = fakeWs();
    wss.emit('connection', ws, { url: '/telnyx-stream', headers: {} });
    ws.emit('message', JSON.stringify({ event: 'start', start: {
      streamSid: 'S2', callSid: 'C2',
      customParameters: { from: '+34600', to: '+34843700849', assistantId: 'org-y' },
      media_format: { encoding: 'PCMA' },
    }}));
    await nap(40);
    assert.strictEqual(active.size, 1, 'sesión activa en el camino normal');
  });
});
