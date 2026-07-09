// ============================================================
// NodeFlow — Anti-bucle de recuperación unificado (fix 2026-07)
// Fija el contrato del método extraído _takeMessageAndNotify: la salida
// de gracia que rompe el bucle de "¿me lo puede repetir?" cuando el LLM
// no responde varias veces seguidas (antes esa rama quedaba fuera del
// anti-bucle de la escalera de STT y podía repetir sin fin).
// Se prueba el método en aislamiento (prototype.call) para no construir
// los routers de voz.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

function makeSession() {
  const said = [];
  return {
    businessId: 'org-x',
    callerNumber: '+34600111222',
    metrics: {},
    _said: said,
    addAssistantMessage: (m) => said.push(m),
  };
}

describe('_takeMessageAndNotify (salida de gracia)', () => {
  test('toma recado, lo dice, y marca la escalada (una vez)', async () => {
    const spoken = [];
    const fakeThis = { _speakText: async (_id, text) => { spoken.push(text); } };
    const s = makeSession();
    const tm = {};

    await VoicePipeline.prototype._takeMessageAndNotify.call(fakeThis, 'c1', s, tm, 'test');

    assert.strictEqual(s._escalatedTakeMessage, true, 'marca la escalada en la sesión');
    assert.strictEqual(s.metrics.escalatedTakeMessage, true, 'lo registra en métricas');
    assert.strictEqual(tm.escalatedTakeMessage, true, 'lo registra en el turno');
    assert.ok(/Tomo nota de su llamada/i.test(spoken[0] || ''), 'dice el recado en voz');
    assert.ok(/Tomo nota/i.test(s._said[0] || ''), 'lo añade al transcript');
  });

  test('no lanza aunque no haya turnMetrics ni BD', async () => {
    const fakeThis = { _speakText: async () => {} };
    const s = makeSession();
    await assert.doesNotReject(
      VoicePipeline.prototype._takeMessageAndNotify.call(fakeThis, 'c2', s, null, 'sin metrics')
    );
    assert.strictEqual(s._escalatedTakeMessage, true);
  });

  test('el guard de "una vez por llamada" es responsabilidad del llamante', async () => {
    // El método SIEMPRE marca; los sitios que lo invocan comprueban
    // !session._escalatedTakeMessage antes de llamar. Verificamos que, una
    // vez marcado, ese guard impediría una segunda escalada.
    const fakeThis = { _speakText: async () => {} };
    const s = makeSession();
    await VoicePipeline.prototype._takeMessageAndNotify.call(fakeThis, 'c3', s, {}, 'primera');
    const guardAllowsSecond = !s._escalatedTakeMessage; // lo que evalúan los llamantes
    assert.strictEqual(guardAllowsSecond, false, 'tras escalar, el guard bloquea repetir');
  });
});
