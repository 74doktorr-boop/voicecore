// ============================================================
// NodeFlow — El STT se reconecta en vuelo (V3, auditoría 2026-07-29)
//
// EL BUG: cuando Deepgram cerraba el socket a mitad de llamada —timeouts de red,
// despliegues suyos, un keepAlive perdido—, su handler de Close borraba la
// sesión del Map y `sendAudio` dejaba de encontrarla. Y no hacía NADA: un
// `return` mudo, sin log, sin métrica, sin excepción. El audio del cliente se
// tiraba al suelo el resto de la llamada y la IA se quedaba sorda EN SILENCIO.
// El único que se enteraba era el salvavidas, 75 segundos después; el negocio
// veía "llamada de 8 minutos, 3 turnos, abandonada" y culpaba al cliente.
//
// El failover que existía solo cubría la APERTURA (un watchdog de un disparo que
// se desarma en cuanto la conexión abre): protegía el primer segundo y nada más.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { STTRouter } = require('../src/stt/router');

// Proveedor falso con el mismo contrato que Deepgram: un Map `connections`,
// createSession/sendAudio/closeSession. `kill()` simula que el socket se muere.
function fakeProvider(name) {
  const p = {
    name,
    connections: new Map(),
    creadas: 0,
    audio: [],
    createSession(callId, options) {
      p.creadas++;
      const s = { callId, options, isOpen: true, _fake: name };
      p.connections.set(callId, s);
      return s;
    },
    sendAudio(callId, data) { p.audio.push({ callId, data }); },
    closeSession(callId) { p.connections.delete(callId); },
    resetTranscript() {},
    kill(callId) { p.connections.delete(callId); },   // el socket se muere solo
  };
  return p;
}

function routerCon(...proveedores) {
  const r = new STTRouter({});
  r.providers.clear();
  proveedores.forEach((p, i) => r.providers.set(p.name, { instance: p, priority: i + 1, models: [], languages: [], features: [] }));
  r.openTimeoutMs = 999999;   // el watchdog de apertura no interfiere en estos tests
  return r;
}

describe('V3 — reconexión del STT en mitad de la llamada', () => {
  test('EL BUG: el socket se muere y el audio deja de llegar a ninguna parte', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    r.createSession('c1', { language: 'es' });

    r.sendAudio('c1', 'audio-1');
    assert.strictEqual(dg.audio.length, 1, 'con la conexión viva, el audio pasa');

    dg.kill('c1');                       // Deepgram cierra el socket
    r.sendAudio('c1', 'audio-2');        // llega el siguiente frame (cada 20 ms)

    assert.strictEqual(dg.creadas, 2, 'debe haberse abierto una conexión NUEVA');
    r.sendAudio('c1', 'audio-3');
    assert.ok(dg.audio.some(a => a.data === 'audio-3'), 'y el audio vuelve a fluir');
  });

  test('recablea los callbacks: sin eso la conexión nueva transcribiría al vacío', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    const s = r.createSession('c1', {});
    // Lo que hace el pipeline DESPUÉS de createSession:
    const onTranscript = () => {}; const onUtteranceEnd = () => {}; const onSpeechStart = () => {};
    s.onTranscript = onTranscript; s.onUtteranceEnd = onUtteranceEnd; s.onSpeechStart = onSpeechStart;

    dg.kill('c1');
    r.sendAudio('c1', 'x');

    const nueva = dg.connections.get('c1');
    assert.strictEqual(nueva.onTranscript, onTranscript);
    assert.strictEqual(nueva.onUtteranceEnd, onUtteranceEnd);
    assert.strictEqual(nueva.onSpeechStart, onSpeechStart);
  });

  test('una llamada que YA COLGÓ no se reconecta (no se paga audio de una conversación que no existe)', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    r.createSession('c1', {});
    r.closeSession('c1');

    r.sendAudio('c1', 'audio-tardio');
    assert.strictEqual(dg.creadas, 1, 'colgar es el final normal, no una avería');
    assert.strictEqual(r.getMetrics()._reconnects, 0);
  });

  test('NO martillea: llega un frame cada 20 ms y solo se intenta con espera creciente', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    r.createSession('c1', {});
    dg.kill('c1');

    // Ráfaga de 50 frames sin que avance el reloj (2,5 s reales de audio).
    for (let i = 0; i < 50; i++) r.sendAudio('c1', 'f' + i);

    assert.strictEqual(dg.creadas, 2, 'un solo intento pese a 50 frames');
    assert.ok(r.getMetrics()._droppedFrames >= 1);
  });

  test('se rinde tras el tope de intentos y AVISA una vez (no calla como antes)', () => {
    const dg = fakeProvider('deepgram');
    // createSession que "funciona" pero cuya conexión nace ya muerta.
    dg.createSession = (callId, options) => { dg.creadas++; return { callId, options, isOpen: false }; };
    const r = routerCon(dg);
    r.maxReconnects = 3;
    r._live.set('c1', { options: {}, order: ['deepgram'], session: null, attempts: 0, nextAttemptAt: 0, reconnecting: false, dropped: 0, gaveUp: false });

    let t = 0;
    for (let i = 0; i < 10; i++) { r._reconnect('c1', r._live.get('c1'), t); t += 5000; }

    const live = r._live.get('c1');
    assert.strictEqual(live.attempts, 3, 'no intenta indefinidamente');
    assert.strictEqual(live.gaveUp, true, 'se rinde de forma explícita, no en silencio');
  });

  test('si el proveedor de origen tiene el breaker abierto, reconecta en el siguiente sano', () => {
    const dg = fakeProvider('deepgram');
    const aai = fakeProvider('assemblyai');
    const r = routerCon(dg, aai);
    r.createSession('c1', {});

    r._health.set('deepgram', { failures: 0, openUntil: Date.now() + 60000 });  // breaker abierto
    dg.kill('c1');
    r.sendAudio('c1', 'x');

    assert.strictEqual(aai.creadas, 1, 'reconectar contra un servicio caído es repetir el problema');
    assert.strictEqual(aai.connections.get('c1')._sttProviderName, 'assemblyai');
  });

  test('las métricas dejan constancia (antes no quedaba ni rastro)', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    r.createSession('c1', {});
    dg.kill('c1');
    r.sendAudio('c1', 'x');

    const m = r.getMetrics();
    assert.strictEqual(m._reconnects, 1);
    assert.ok(m._droppedFrames >= 1);
    assert.strictEqual(m._liveCalls, 1);
  });

  test('cerrar la sesión limpia el registro de la llamada viva (sin fugas)', () => {
    const dg = fakeProvider('deepgram');
    const r = routerCon(dg);
    r.createSession('c1', {});
    assert.strictEqual(r.getMetrics()._liveCalls, 1);
    r.closeSession('c1');
    assert.strictEqual(r.getMetrics()._liveCalls, 0);
  });
});
