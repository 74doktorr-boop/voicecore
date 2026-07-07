// ============================================================
// VoiceCore — Detección de HUECOS entre fragmentos (2026-07-07)
// El "se traba diciendo…" que reportó Unai NO era el pacer
// (pacerStalls=0): era silencio a media frase porque el siguiente
// fragmento de TTS llega DESPUÉS de que el anterior terminó de sonar.
// pacerStalls no lo capta; fragmentGaps sí.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { CallSession } = require('../src/core/call-session');

function mkSession() {
  const s = new CallSession({ callId: 'c1', assistant: { voice: 'x' }, callerNumber: '1', calledNumber: '2' });
  // Mock del WS: no envía de verdad; el pacer se para solo al vaciar la cola.
  s.twilioWs = { send() {} };
  s.streamSid = 'sid';
  if (s._pacer) { clearInterval(s._pacer); s._pacer = null; } // no dejar timers en el test
  // Neutralizamos el arranque del pacer para controlar el reloj a mano.
  s._startPacer = () => {};
  return s;
}

describe('detección de huecos entre fragmentos', () => {
  test('audio nuevo mientras aún suena el anterior → SIN hueco', () => {
    const s = mkSession();
    s.sendAudioToTwilio(Buffer.alloc(1600)); // 10 frames = 200ms de audio
    // llega el siguiente fragmento enseguida (la cola aún no se vació)
    s.outQueue.length = 5; // simulamos que quedan frames por sonar
    s.sendAudioToTwilio(Buffer.alloc(800));
    assert.strictEqual(s.metrics.fragmentGaps || 0, 0);
  });

  test('audio nuevo DESPUÉS de que la reproducción terminó → cuenta un hueco', () => {
    const s = mkSession();
    s.sendAudioToTwilio(Buffer.alloc(1600)); // playbackEndsAt = ahora + 200ms
    // Forzamos: cola vacía y playbackEndsAt ya pasado (silencio de 300ms)
    s.outQueue.length = 0;
    s.playbackEndsAt = Date.now() - 300;
    s.sendAudioToTwilio(Buffer.alloc(800));
    assert.strictEqual(s.metrics.fragmentGaps, 1);
    assert.ok(s.metrics.worstFragmentGapMs >= 300, 'registra el peor hueco');
  });

  test('hueco imperceptible (<80ms) NO cuenta', () => {
    const s = mkSession();
    s.sendAudioToTwilio(Buffer.alloc(1600));
    s.outQueue.length = 0;
    s.playbackEndsAt = Date.now() - 40; // 40ms, imperceptible
    s.sendAudioToTwilio(Buffer.alloc(800));
    assert.strictEqual(s.metrics.fragmentGaps || 0, 0);
  });

  test('varios huecos → se acumulan y se guarda el peor', () => {
    const s = mkSession();
    s.sendAudioToTwilio(Buffer.alloc(800));
    s.outQueue.length = 0; s.playbackEndsAt = Date.now() - 150;
    s.sendAudioToTwilio(Buffer.alloc(800));
    s.outQueue.length = 0; s.playbackEndsAt = Date.now() - 500;
    s.sendAudioToTwilio(Buffer.alloc(800));
    assert.strictEqual(s.metrics.fragmentGaps, 2);
    assert.ok(s.metrics.worstFragmentGapMs >= 500);
  });
});
