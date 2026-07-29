// ============================================================
// NodeFlow — Percentiles de latencia (F2/F3/F4, auditoría 2026-07-29)
//
// En TODO el repo no había ni un p50, ni un p95, ni una mediana: solo medias.
// En voz la media miente de forma sistemática, y encima el umbral de alerta se
// aplicaba sobre ella, así que solo saltaba con la degradación ya masiva.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { percentile, latencySummary } = require('../src/analytics/percentiles');
const { CallSession } = require('../src/core/call-session');

describe('percentile', () => {
  test('casos conocidos (interpolación lineal, como numpy)', () => {
    const xs = [1, 2, 3, 4, 5];
    assert.strictEqual(percentile(xs, 0), 1);
    assert.strictEqual(percentile(xs, 50), 3);
    assert.strictEqual(percentile(xs, 100), 5);
    assert.strictEqual(percentile(xs, 25), 2);
  });

  test('no le importa el orden de entrada', () => {
    assert.strictEqual(percentile([5, 1, 3, 2, 4], 50), 3);
  });

  test('un solo valor y lista vacía', () => {
    assert.strictEqual(percentile([42], 95), 42);
    assert.strictEqual(percentile([], 50), null);
    assert.strictEqual(percentile(null, 50), null);
  });

  test('descarta basura sin romper', () => {
    assert.strictEqual(percentile([1, null, 'x', undefined, NaN, 3], 50), 2);
  });

  test('percentil fuera de rango se recorta', () => {
    assert.strictEqual(percentile([1, 2, 3], -5), 1);
    assert.strictEqual(percentile([1, 2, 3], 500), 3);
  });
});

describe('latencySummary — EL CASO QUE MOTIVA TODO ESTO', () => {
  test('9 turnos rápidos y uno malísimo: la media dice "verde", el p95 no', () => {
    const turnos = [400, 400, 400, 400, 400, 400, 400, 400, 400, 6000];
    const s = latencySummary(turnos);

    assert.strictEqual(s.avg, 960, 'la media queda por debajo del umbral de 1500ms → "todo bien"');
    assert.ok(s.avg < 1500, 'exactamente el punto ciego que teníamos');
    assert.ok(s.p95 > 2000, `el p95 (${s.p95}ms) SÍ delata la cola que el cliente nota`);
    assert.strictEqual(s.max, 6000);
    assert.strictEqual(s.p50, 400, 'y la mediana enseña que la mayoría van finas');
  });

  test('incluye n para que un p95 con 3 muestras no se lea como un hecho', () => {
    assert.strictEqual(latencySummary([100, 200, 300]).n, 3);
    assert.strictEqual(latencySummary([]).n, 0);
  });

  test('sin datos → todo null, nunca 0 (0 se leería como "instantáneo")', () => {
    const s = latencySummary([]);
    for (const k of ['p50', 'p90', 'p95', 'p99', 'avg', 'max']) {
      assert.strictEqual(s[k], null, `${k} debe ser null`);
    }
  });

  test('devuelve enteros (son milisegundos)', () => {
    const s = latencySummary([100, 201, 302]);
    for (const k of ['p50', 'p90', 'p95', 'p99', 'avg']) assert.ok(Number.isInteger(s[k]));
  });
});

// ── F4 ────────────────────────────────────────────────────────────────────────
describe('F4 — el turno atribuye de verdad su TTS', () => {
  const mk = () => new CallSession({ callId: 'c1', assistant: { id: 'a1' }, callerNumber: '+34600000000', calledNumber: '+34843700849' });

  test('recordTurn rellena ttsTime desde lo medido en el turno', () => {
    const s = mk();
    s._turnTtsMs = 320;
    s.recordTurn({ llmTime: 500 });
    assert.strictEqual(s.metrics.turns[0].ttsTime, 320,
      'antes NADIE asignaba ttsTime: no se podía saber qué turno fue lento por el TTS');
  });

  test('recordTurn rellena firstAudioMs (la métrica que percibe el cliente)', () => {
    const s = mk();
    s._turnFirstAudioMs = 640;
    s.recordTurn({});
    assert.strictEqual(s.metrics.turns[0].firstAudioMs, 640);
  });

  test('un valor explícito manda sobre el automático', () => {
    const s = mk();
    s._turnTtsMs = 320;
    s.recordTurn({ ttsTime: 999 });
    assert.strictEqual(s.metrics.turns[0].ttsTime, 999);
  });

  test('NO duplica totalTtsTime (ya lo acumula _speakText por fragmento)', () => {
    const s = mk();
    s.metrics.totalTtsTime = 320;   // lo que ya sumó _speakText
    s._turnTtsMs = 320;
    s.recordTurn({});
    assert.strictEqual(s.metrics.totalTtsTime, 320, 'sumarlo otra vez inflaría el TTS al doble');
  });

  test('sin TTS en el turno, no inventa un 0 que ensucie las estadísticas', () => {
    const s = mk();
    s.recordTurn({ llmTime: 100 });
    assert.strictEqual(s.metrics.turns[0].ttsTime, undefined);
  });
});
