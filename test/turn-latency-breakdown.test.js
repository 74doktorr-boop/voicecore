// ============================================================
// NodeFlow — En qué se va el primer audio (2026-07-30)
//
// `firstAudioMs` dice CUÁNTO se tarda en contestar (p50 medido: 974 ms contra
// un objetivo de <700), pero no en QUÉ se va ese tiempo. Y el cambio grande que
// queda pendiente —hacer el TTS en streaming— toca los cuatro proveedores y
// solo merece la pena si el que manda es el TTS. Si manda el LLM, no arregla
// nada. Charter: instrumentar antes de tocar.
//
// `_processTurn` tiene TRES salidas y cada una copiaba a mano lo que guardaba.
// Con un solo campo era tolerable; con tres, la salida que se olvide de copiar
// uno miente por omisión — y sería justo el turno lento el que no se pudiera
// diagnosticar. De ahí `_sealTurnLatency`.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

// Pipeline con routers simulados — aquí no se sintetiza ni se transcribe nada;
// solo se comprueba la contabilidad de la latencia.
const p = new VoicePipeline({
  sttRouter: { getProvider: () => ({ createSession: () => ({}) }), createSession: () => ({}), closeSession: () => {}, sendAudio: () => {}, resetTranscript: () => {} },
  ttsRouter: {},
  llmRouter: {},
});

describe('_sealTurnLatency', () => {
  test('copia los tres componentes del turno', () => {
    const m = p._sealTurnLatency(
      { _turnFirstAudioMs: 900, _turnFirstTokenMs: 310, _turnFirstTtsMs: 420 },
      {},
    );
    assert.strictEqual(m.firstAudioMs, 900);
    assert.strictEqual(m.llmFirstTokenMs, 310);
    assert.strictEqual(m.firstFragmentTtsMs, 420);
  });

  test('un cero es un dato, no un hueco: caché de TTS son ~0 ms', () => {
    // El saludo cacheado sintetiza en ~0 ms. Si se filtrara por falsy, los
    // turnos MÁS rápidos desaparecerían de la muestra y el p50 saldría alto.
    const m = p._sealTurnLatency({ _turnFirstTtsMs: 0, _turnFirstAudioMs: 0 }, {});
    assert.strictEqual(m.firstFragmentTtsMs, 0);
    assert.strictEqual(m.firstAudioMs, 0);
  });

  test('lo que no se midió no se inventa', () => {
    // Un turno interrumpido antes de hablar no tiene TTS. Escribir un 0 ahí
    // sería mentir: no es "instantáneo", es "no ocurrió".
    const m = p._sealTurnLatency({ _turnFirstTokenMs: 280 }, {});
    assert.strictEqual(m.llmFirstTokenMs, 280);
    assert.ok(!('firstAudioMs' in m));
    assert.ok(!('firstFragmentTtsMs' in m));
  });

  test('no pisa lo que el turno ya había puesto', () => {
    const m = p._sealTurnLatency({ _turnFirstAudioMs: 900 }, { llmFirstFragmentMs: 505, totalTime: 3000 });
    assert.strictEqual(m.llmFirstFragmentMs, 505);
    assert.strictEqual(m.totalTime, 3000);
    assert.strictEqual(m.firstAudioMs, 900);
  });

  test('entrada vacía no revienta ni una llamada en curso', () => {
    assert.doesNotThrow(() => p._sealTurnLatency(null, {}));
    assert.doesNotThrow(() => p._sealTurnLatency({}, null));
    assert.deepStrictEqual(p._sealTurnLatency({}, {}), {});
  });
});

describe('el desglose llega al resumen de calidad', () => {
  const turnos = [
    { firstAudioMs: 950, llmFirstTokenMs: 300, firstFragmentTtsMs: 430, totalTime: 3000 },
    { firstAudioMs: 810, llmFirstTokenMs: 280, firstFragmentTtsMs: 380, totalTime: 2600 },
    { firstAudioMs: 1400, llmFirstTokenMs: 320, firstFragmentTtsMs: 900, totalTime: 4100 },
  ];
  // Los turnos viven en session.metrics.turns (donde los deja recordTurn).
  const sesion = {
    turnCount: 3, outcome: null,
    metrics: { turns: turnos, clarifications: 0, recoveries: 0, interruptions: 0 },
  };

  test('publica percentiles de LLM y de TTS por separado', () => {
    const q = p._computeQuality(sesion, 120);
    assert.ok(q.llmFirstToken, 'falta el desglose del LLM');
    assert.ok(q.firstFragmentTts, 'falta el desglose del TTS');
    assert.strictEqual(q.llmFirstToken.p50, 300);
    assert.strictEqual(q.firstFragmentTts.p50, 430);
  });

  test('con estos datos el TTS manda — que es justo la pregunta a responder', () => {
    const q = p._computeQuality(sesion, 120);
    assert.ok(q.firstFragmentTts.p50 > q.llmFirstToken.p50,
      'si el TTS domina, hacerlo en streaming SÍ merece la pena');
  });

  test('sin desglose (llamadas viejas) no rompe el resumen', () => {
    const viejo = { ...sesion, metrics: { ...sesion.metrics, turns: [{ firstAudioMs: 900, totalTime: 3000 }] } };
    const q = p._computeQuality(viejo, 120);
    assert.strictEqual(q.llmFirstToken.p50, null);
    assert.strictEqual(q.llmFirstToken.n, 0);
    assert.strictEqual(q.p50FirstAudioMs, 900);
  });
});
