// ============================================================
// NodeFlow — Presupuesto de tiempo del turno de voz (V4, auditoría 2026-07-29)
//
// Ni el LLM ni el TTS tenían timeout. Un proveedor COLGADO —que no es lo mismo
// que uno que falla: fallar dispara el failover, colgarse no— bloqueaba el turno
// hasta el salvavidas, 75 segundos. El cliente esperando en silencio al
// teléfono. El charter fija <700 ms por turno.
//
// Estos tests simulan exactamente eso: un fetch que NUNCA resuelve.
// ============================================================
'use strict';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { newTimeoutSignal, isAbortError, timeoutMessage, llmTimeoutMs, ttsTimeoutMs, DEFAULTS } = require('../src/utils/fetch-timeout');

// Un fetch que se queda colgado para siempre y solo termina si lo abortan.
// Es el escenario real: TCP abierto, sin respuesta, sin error.
function hangingFetch(seen = {}) {
  return (url, opts = {}) => new Promise((_resolve, reject) => {
    seen.url = url;
    seen.signal = opts.signal;
    if (!opts.signal) return; // sin señal: colgado para siempre (el bug)
    opts.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

describe('newTimeoutSignal', () => {
  test('aborta al vencer el plazo', async () => {
    const t = newTimeoutSignal(20);
    assert.strictEqual(t.signal.aborted, false);
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(t.signal.aborted, true);
    assert.strictEqual(t.timedOut(), true);
  });

  test('clear() lo desarma: una respuesta sana no se aborta', async () => {
    const t = newTimeoutSignal(20);
    t.clear();
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(t.signal.aborted, false, 'una generación larga pero viva NO debe abortarse');
    assert.strictEqual(t.timedOut(), false);
  });

  test('el temporizador se limpia SIEMPRE (no queda pendiente al terminar)', () => {
    // Antes este test exigía `.unref()` en el temporizador. Era un error: con
    // unref, si el plazo es lo único pendiente, Node drena la cola y el aborto
    // NUNCA se dispara — el timeout deja de existir justo cuando hace falta.
    // Lo que de verdad protege la salida del proceso es que el llamante limpie,
    // y eso es lo que hay que fijar aquí.
    let limpiado = false;
    const fakeTimer = { unref() { assert.fail('no debe usar unref: haría el plazo saltable'); } };
    const t = newTimeoutSignal(999999, {
      setTimeout: () => fakeTimer,
      clearTimeout: (x) => { limpiado = (x === fakeTimer); },
    });
    t.clear();
    assert.strictEqual(limpiado, true, 'clear() debe limpiar el temporizador que creó');
  });

  test('isAbortError distingue nuestro vencimiento de un fallo del proveedor', () => {
    const abort = new Error('x'); abort.name = 'AbortError';
    const code = new Error('y'); code.code = 'ABORT_ERR';
    assert.strictEqual(isAbortError(abort), true);
    assert.strictEqual(isAbortError(code), true);
    assert.strictEqual(isAbortError(new Error('500 Internal Server Error')), false);
    assert.strictEqual(isAbortError(null), false);
  });

  test('el mensaje deja claro de quién es el timeout', () => {
    assert.match(timeoutMessage('Groq', 8000), /Groq no respondió en 8000ms.*NodeFlow, no del proveedor/);
  });
});

describe('presupuestos configurables por entorno', () => {
  const prev = { llm: process.env.LLM_TIMEOUT_MS, tts: process.env.TTS_TIMEOUT_MS };
  afterEach(() => {
    if (prev.llm === undefined) delete process.env.LLM_TIMEOUT_MS; else process.env.LLM_TIMEOUT_MS = prev.llm;
    if (prev.tts === undefined) delete process.env.TTS_TIMEOUT_MS; else process.env.TTS_TIMEOUT_MS = prev.tts;
  });

  test('sin env → valores por defecto', () => {
    delete process.env.LLM_TIMEOUT_MS; delete process.env.TTS_TIMEOUT_MS;
    assert.strictEqual(llmTimeoutMs(), DEFAULTS.llm);
    assert.strictEqual(ttsTimeoutMs(), DEFAULTS.tts);
  });

  test('env válida → manda la env', () => {
    process.env.LLM_TIMEOUT_MS = '1234';
    assert.strictEqual(llmTimeoutMs(), 1234);
  });

  test('env basura o absurda → se ignora, nunca deja el turno sin techo', () => {
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.LLM_TIMEOUT_MS = bad;
      assert.strictEqual(llmTimeoutMs(), DEFAULTS.llm, `no debe aceptar "${bad}"`);
    }
  });
});

describe('EL BUG: un proveedor colgado ya no bloquea el turno', () => {
  const realFetch = global.fetch;
  const prevLlm = process.env.LLM_TIMEOUT_MS;
  const prevTts = process.env.TTS_TIMEOUT_MS;

  beforeEach(() => { process.env.LLM_TIMEOUT_MS = '60'; process.env.TTS_TIMEOUT_MS = '60'; });
  afterEach(() => {
    global.fetch = realFetch;
    if (prevLlm === undefined) delete process.env.LLM_TIMEOUT_MS; else process.env.LLM_TIMEOUT_MS = prevLlm;
    if (prevTts === undefined) delete process.env.TTS_TIMEOUT_MS; else process.env.TTS_TIMEOUT_MS = prevTts;
  });

  test('Groq colgado → el turno recibe un error en ~60ms, no a los 75s', async () => {
    const seen = {};
    global.fetch = hangingFetch(seen);
    const { GroqLLM } = require('../src/llm/groq');

    const t0 = Date.now();
    const chunks = [];
    for await (const c of new GroqLLM('k').streamCompletion({ callId: 'c1', messages: [{ role: 'user', content: 'hola' }] })) {
      chunks.push(c);
    }
    const elapsed = Date.now() - t0;

    assert.ok(seen.signal, 'la petición DEBE llevar señal de aborto');
    assert.ok(elapsed < 3000, `cortó en ${elapsed}ms (antes: hasta 75000ms)`);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].type, 'error', 'el router necesita el error para saltar de proveedor');
    assert.match(chunks[0].message, /Groq no respondió en 60ms/);
  });

  test('ElevenLabs colgado → la síntesis falla rápido con un mensaje honesto', async () => {
    const seen = {};
    global.fetch = hangingFetch(seen);
    const { ElevenLabsTTS } = require('../src/tts/elevenlabs');

    const t0 = Date.now();
    await assert.rejects(
      () => new ElevenLabsTTS('k').synthesize({ callId: 'c1', text: 'hola', voiceId: 'v' }),
      /ElevenLabs no respondió en 60ms/,
    );
    assert.ok(Date.now() - t0 < 3000);
    assert.ok(seen.signal, 'la petición DEBE llevar señal de aborto');
  });

  test('Google TTS colgado → idem', async () => {
    global.fetch = hangingFetch();
    const { GoogleTTS } = require('../src/tts/google-tts');
    await assert.rejects(
      () => new GoogleTTS('k').synthesize({ callId: 'c1', text: 'hola' }),
      /Google TTS no respondió en 60ms/,
    );
  });

  test('Cartesia colgado → idem', async () => {
    global.fetch = hangingFetch();
    const { CartesiaTTS } = require('../src/tts/cartesia');
    await assert.rejects(
      () => new CartesiaTTS('k').synthesize({ callId: 'c1', text: 'hola', voice: 'v' }),
      /Cartesia no respondió en 60ms/,
    );
  });
});

// ── E3 ────────────────────────────────────────────────────────────────────────
// Anthropic era un fallback ROTO: el turno post-herramienta no pasa `tools`,
// pero el historial sí lleva bloques tool_use/tool_result → 400 SIEMPRE. Como
// es el último proveedor del failover, el turno moría justo después de consultar
// la agenda, gastando además segundos de la llamada en intentarlo.
describe('E3 — Anthropic deja de romperse en el turno post-herramienta', () => {
  const { flattenToolBlocks, hasToolBlocks } = require('../src/llm/anthropic');

  const historial = [
    { role: 'user', content: '¿tenéis hueco el martes?' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'check_availability', input: { date: '2026-08-04' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"slots":["10:00","17:00"]}' }] },
  ];

  test('detecta que el historial lleva bloques de herramienta', () => {
    assert.strictEqual(hasToolBlocks(historial), true);
    assert.strictEqual(hasToolBlocks([{ role: 'user', content: 'hola' }]), false);
  });

  test('aplanar deja SOLO texto (petición válida sin definición de tools)', () => {
    const flat = flattenToolBlocks(historial);
    assert.strictEqual(hasToolBlocks(flat), false);
    for (const m of flat) assert.strictEqual(typeof m.content, 'string');
  });

  test('y CONSERVA el contexto: qué se consultó y qué se obtuvo', () => {
    const flat = flattenToolBlocks(historial);
    assert.match(flat[1].content, /check_availability/);
    assert.match(flat[1].content, /2026-08-04/);
    assert.match(flat[2].content, /10:00/);
  });

  test('no toca los mensajes que ya eran texto', () => {
    const simple = [{ role: 'user', content: 'hola' }];
    assert.deepStrictEqual(flattenToolBlocks(simple), simple);
  });

  test('un bloque vacío no produce contenido vacío (la API lo rechaza)', () => {
    const flat = flattenToolBlocks([{ role: 'assistant', content: [] }]);
    assert.strictEqual(flat[0].content, '(sin contenido)');
  });
});
