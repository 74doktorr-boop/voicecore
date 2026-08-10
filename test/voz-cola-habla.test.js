// ============================================================
// NodeFlow — El LLM deja de esperar al TTS (F10, auditoría 2026-07-29)
//
// EL BUG: el bucle que consume el stream del LLM hacía
// `await this._speakText(frase)` DENTRO del `for await`. Eso SUSPENDE el
// generador: mientras se sintetiza la frase 1, el LLM no genera la frase 2. La
// síntesis estaba en el camino crítico de CADA frase, no solo de la primera.
//
// Cuando el audio de la frase 1 dura menos que (generar + sintetizar la frase
// 2), el teléfono se queda mudo a media respuesta. Eso es literalmente lo que
// cuenta `fragmentGaps` en call-session.js, y lo que el cliente describe como
// "se entrecorta" o "se traba diciendo…".
//
// EL RIESGO DEL ARREGLO, y por eso estos tests: si al desacoplar se pierde el
// ORDEN, la asistente dice las frases desordenadas. Eso es mucho peor que un
// hueco. El orden es la propiedad que no se puede romper.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Pipeline falso: registra en qué ORDEN se completa cada frase y cuánto tarda
// cada síntesis. `demoras` mapea texto → ms que tarda su "síntesis".
function fakePipeline(demoras = {}, session = {}) {
  const dichas = [];
  const s = { interrupted: false, _speechChain: null, ...session };
  const p = {
    activeCalls: new Map([['c1', s]]),
    dichas,
    session: s,
    async _speakText(callId, text) {
      await sleep(demoras[text] ?? 0);
      if (s.interrupted) return;          // igual que el _speakText real
      dichas.push(text);
    },
    _speakQueued: VoicePipeline.prototype._speakQueued,
    _drainSpeech: VoicePipeline.prototype._drainSpeech,
    // Desde el 06/08, _speakQueued es el cuello de botella por donde pasa TODO
    // lo que dice el LLM, así que aplica también el tope de insistencia. Este
    // doble tiene que traerlo: sin él probaría un _speakQueued que no existe.
    _limitarInsistencia: VoicePipeline.prototype._limitarInsistencia,
  };
  return p;
}

describe('F10 — orden del habla (lo que NO se puede romper)', () => {
  test('la frase lenta no deja pasar a la rápida por delante', async () => {
    // Sin cadena, "dos" (5ms) terminaría antes que "uno" (60ms) y la asistente
    // diría la respuesta al revés.
    const p = fakePipeline({ uno: 60, dos: 5, tres: 5 });
    p._speakQueued('c1', 'uno');
    p._speakQueued('c1', 'dos');
    p._speakQueued('c1', 'tres');
    await p._drainSpeech('c1');
    assert.deepStrictEqual(p.dichas, ['uno', 'dos', 'tres']);
  });

  test('con demoras decrecientes tampoco se desordena', async () => {
    const p = fakePipeline({ a: 40, b: 25, c: 10, d: 1 });
    for (const t of ['a', 'b', 'c', 'd']) p._speakQueued('c1', t);
    await p._drainSpeech('c1');
    assert.deepStrictEqual(p.dichas, ['a', 'b', 'c', 'd']);
  });
});

describe('F10 — encolar NO bloquea a quien llama (que es todo el objetivo)', () => {
  test('encolar 4 frases de 50ms cada una devuelve el control al instante', async () => {
    const p = fakePipeline({ f1: 50, f2: 50, f3: 50, f4: 50 });
    const t0 = Date.now();
    for (const t of ['f1', 'f2', 'f3', 'f4']) p._speakQueued('c1', t);
    const encolar = Date.now() - t0;

    assert.ok(encolar < 25, `encolar tardó ${encolar}ms: el generador del LLM seguiría bloqueado`);
    assert.strictEqual(p.dichas.length, 0, 'todavía no ha sonado nada, pero el LLM ya puede seguir');

    await p._drainSpeech('c1');
    assert.strictEqual(p.dichas.length, 4);
  });

  test('la síntesis sigue siendo UNA petición a la vez (mismo coste que antes)', async () => {
    let enVuelo = 0, maxEnVuelo = 0;
    const p = fakePipeline();
    p._speakText = async (callId, text) => {
      enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await sleep(10);
      enVuelo--; p.dichas.push(text);
    };
    for (const t of ['a', 'b', 'c', 'd', 'e']) p._speakQueued('c1', t);
    await p._drainSpeech('c1');

    assert.strictEqual(maxEnVuelo, 1, 'no se disparan N peticiones de TTS en paralelo');
    assert.strictEqual(p.dichas.length, 5);
  });
});

describe('F10 — robustez', () => {
  test('una frase que falla no rompe la cadena: las siguientes suenan igual', async () => {
    const p = fakePipeline();
    p._speakText = async (callId, text) => {
      if (text === 'mala') throw new Error('TTS caído');
      p.dichas.push(text);
    };
    p._speakQueued('c1', 'buena1');
    p._speakQueued('c1', 'mala');
    p._speakQueued('c1', 'buena2');
    await p._drainSpeech('c1');
    assert.deepStrictEqual(p.dichas, ['buena1', 'buena2']);
  });

  test('tras interrumpir, lo que quedaba en cola NO se dice', async () => {
    const p = fakePipeline({ uno: 20, dos: 20, tres: 20 });
    p._speakQueued('c1', 'uno');
    p._speakQueued('c1', 'dos');
    p._speakQueued('c1', 'tres');
    await sleep(30);
    p.session.interrupted = true;        // barge-in a mitad
    await p._drainSpeech('c1');
    assert.ok(p.dichas.length < 3, `se dijeron ${p.dichas.length}/3 pese a la interrupción`);
    assert.strictEqual(p.dichas[0], 'uno', 'lo ya emitido se respeta');
  });

  test('llamada que ya no existe → no revienta', async () => {
    const p = fakePipeline();
    p.activeCalls.delete('c1');
    await assert.doesNotReject(() => p._speakQueued('c1', 'x'));
    await assert.doesNotReject(() => p._drainSpeech('c1'));
  });

  test('drenar sin nada encolado es inmediato y no lanza', async () => {
    const p = fakePipeline();
    await assert.doesNotReject(() => p._drainSpeech('c1'));
  });

  test('_drainSpeech espera de verdad: al volver, ya ha sonado todo', async () => {
    const p = fakePipeline({ larga: 60 });
    p._speakQueued('c1', 'larga');
    assert.strictEqual(p.dichas.length, 0);
    await p._drainSpeech('c1');
    assert.deepStrictEqual(p.dichas, ['larga'], 'el turno no puede continuar antes de que suene');
  });
});
