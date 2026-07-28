// ============================================================
// NodeFlow — Fase 0 de voz (auditoría 2026-07-29)
//
// Dos fallos que cuestan llamadas ENTERAS y que ningún test cubría:
//
//   V1  `interrupted` solo se reseteaba dentro de _processTurn, y _speakText
//       devuelve pronto si está a true. Los dos sitios que hablan CUANDO NO HAY
//       TURNO —el re-enganche tras interrupción sin continuación y la despedida
//       del salvavidas— se disparan justo en ese caso: no podían sonar nunca.
//       Síntoma real: falso positivo de barge-in → 75 s de silencio → cuelgue.
//
//   V2  Si el cliente interrumpía durante la frase-puente, el historial se
//       quedaba con un `tool_call` sin su `role:'tool'`. Eso es un 400 de la
//       API en TODAS las peticiones restantes de la llamada (el historial vive
//       en la sesión), así que la llamada entera acababa en "le devolveremos la
//       llamada". Se disparaba en el momento más frecuente: el cliente hablando
//       mientras la IA va a consultar la agenda.
// ============================================================
'use strict';

const { test, describe, mock } = require('node:test');
const assert = require('node:assert');
const { VoicePipeline } = require('../src/core/voice-pipeline');
const { CallSession } = require('../src/core/call-session');
const { findOrphanToolCalls, repairToolCallPairing, cancelledToolResult } = require('../src/llm/message-integrity');

const assistant = { id: 'a1', language: 'es', name: 'Test' };
const newSession = () => new CallSession({
  callId: 'c1', assistant, callerNumber: '+34600000000', calledNumber: '+34843700849',
});

// ── V1 ────────────────────────────────────────────────────────────────────────
describe('V1 — el asistente puede volver a hablar tras una interrupción', () => {
  test('clearInterruption cierra el episodio (y es idempotente)', () => {
    const s = newSession();
    s.handleInterruption();
    assert.strictEqual(s.interrupted, true);
    s.clearInterruption();
    assert.strictEqual(s.interrupted, false);
    s.clearInterruption();
    assert.strictEqual(s.interrupted, false);
  });

  test('EL BUG: el re-enganche se dispara CON interrupted=true y aun así habla', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const spoken = [];
    const session = {
      interrupted: true,                 // ← estado real tras el barge-in
      isProcessing: false,
      pendingUtterance: null,
      isSpeakingNow: () => false,
      clearInterruption() { this.interrupted = false; },
    };
    const pipeline = {
      activeCalls: new Map([['c1', session]]),
      _speakText(callId, text) {
        // Réplica de la primera línea real de _speakText: es la que devolvía
        // en vacío y hacía el re-enganche inalcanzable.
        const s = this.activeCalls.get(callId);
        if (!s || s.interrupted) return Promise.resolve();
        spoken.push(text);
        return Promise.resolve();
      },
    };

    VoicePipeline.prototype._armInterruptWatchdog.call(pipeline, 'c1');
    t.mock.timers.tick(2600);

    assert.deepStrictEqual(spoken, ['¿Sí? Dígame.'], 'el cliente NO puede quedarse en silencio');
    assert.strictEqual(session.interrupted, false, 'el episodio de interrupción queda cerrado');
  });

  test('no se re-engancha si hay un turno en curso, si ya está hablando o si hay frase pendiente', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const estado of [
      { isProcessing: true,  isSpeakingNow: () => false, pendingUtterance: null },
      { isProcessing: false, isSpeakingNow: () => true,  pendingUtterance: null },
      { isProcessing: false, isSpeakingNow: () => false, pendingUtterance: 'quiero cita' },
    ]) {
      const spoken = [];
      const session = { interrupted: true, clearInterruption() { this.interrupted = false; }, ...estado };
      const pipeline = {
        activeCalls: new Map([['c1', session]]),
        _speakText: (id, t2) => { spoken.push(t2); return Promise.resolve(); },
      };
      VoicePipeline.prototype._armInterruptWatchdog.call(pipeline, 'c1');
      t.mock.timers.tick(2600);
      assert.deepStrictEqual(spoken, [], `no debe pisar al cliente: ${JSON.stringify(Object.keys(estado))}`);
      assert.strictEqual(session.interrupted, true, 'y no toca el estado si no habla');
    }
  });

  test('si la llamada ya no existe, no revienta', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pipeline = { activeCalls: new Map(), _speakText: () => Promise.resolve() };
    // Arma sobre una sesión que luego desaparece (cuelgue durante los 2,5 s).
    pipeline.activeCalls.set('c1', { isProcessing: false, isSpeakingNow: () => false });
    VoicePipeline.prototype._armInterruptWatchdog.call(pipeline, 'c1');
    pipeline.activeCalls.delete('c1');
    assert.doesNotThrow(() => t.mock.timers.tick(2600));
  });
});

// ── V2 ────────────────────────────────────────────────────────────────────────
describe('V2 — invariante del historial: ningún tool_call sin respuesta', () => {
  test('findOrphanToolCalls detecta el historial que rompe la llamada entera', () => {
    const roto = [
      { role: 'user', content: '¿tenéis hueco el martes?' },
      { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'check_availability', arguments: '{}' } }] },
      // ← aquí faltaba el role:'tool'. A partir de este punto, 400 en todo.
    ];
    assert.deepStrictEqual(findOrphanToolCalls(roto), ['call_1']);
  });

  test('historial correcto → sin huérfanos', () => {
    const ok = [
      { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"success":true}' },
    ];
    assert.deepStrictEqual(findOrphanToolCalls(ok), []);
    assert.strictEqual(repairToolCallPairing(ok), ok, 'sin huérfanos devuelve el mismo array, sin copiar');
  });

  test('repairToolCallPairing inserta el resultado JUSTO detrás (el orden importa para la API)', () => {
    const roto = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', tool_calls: [{ id: 'a' }, { id: 'b' }] },
      { role: 'user', content: 'perdona' },
    ];
    const fixed = repairToolCallPairing(roto);
    assert.deepStrictEqual(findOrphanToolCalls(fixed), []);
    assert.strictEqual(fixed[2].role, 'tool');
    assert.strictEqual(fixed[2].tool_call_id, 'a');
    assert.strictEqual(fixed[3].tool_call_id, 'b');
    assert.strictEqual(fixed[4].content, 'perdona', 'no se altera el resto');
    assert.deepStrictEqual(findOrphanToolCalls(roto), ['a', 'b'], 'no muta la entrada');
  });

  test('el resultado sintético es honesto: dice que se canceló', () => {
    const parsed = JSON.parse(cancelledToolResult('interrupted_by_customer'));
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error, 'cancelled');
    assert.strictEqual(parsed.reason, 'interrupted_by_customer');
  });

  test('entradas raras no revientan', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) assert.deepStrictEqual(findOrphanToolCalls(bad), []);
    assert.deepStrictEqual(findOrphanToolCalls([null, { role: 'assistant' }, { role: 'tool' }]), []);
  });

  test('EL ESCENARIO REAL: interrupción antes de ejecutar → historial VÁLIDO', async () => {
    const session = newSession();
    session.interrupted = true;   // el cliente habló encima de "Un momento, por favor…"
    const toolCalls = [
      { id: 'call_1', function: { name: 'check_availability', arguments: '{}' } },
      { id: 'call_2', function: { name: 'book_appointment', arguments: '{}' } },
    ];
    const pipeline = {
      toolExecutor: { execute: async () => ({ success: true }) },
      llmRouter: { streamCompletion: async function* () {} },
      activeCalls: new Map([['c1', session]]),
      _speakText: async () => {},
      _extractCompleteSentences: () => ({ complete: [], remaining: '' }),
    };

    await VoicePipeline.prototype._handleToolCalls.call(pipeline, 'c1', session, toolCalls, {});

    assert.deepStrictEqual(findOrphanToolCalls(session.messages), [],
      'ni un solo tool_call puede quedarse sin respuesta: es un 400 en TODO el resto de la llamada');
    const tools = session.messages.filter(m => m.role === 'tool');
    assert.strictEqual(tools.length, 2);
    assert.strictEqual(JSON.parse(tools[0].content).reason, 'interrupted_by_customer');
  });

  test('interrupción a MEDIAS: la 1ª herramienta se ejecutó, la 2ª no', async () => {
    const session = newSession();
    const toolCalls = [
      { id: 'call_1', function: { name: 'check_availability', arguments: '{}' } },
      { id: 'call_2', function: { name: 'book_appointment', arguments: '{}' } },
    ];
    const pipeline = {
      // El cliente interrumpe DURANTE la primera herramienta.
      toolExecutor: { execute: async () => { session.interrupted = true; return { success: true, slots: ['10:00'] }; } },
      llmRouter: { streamCompletion: async function* () {} },
      activeCalls: new Map([['c1', session]]),
      _speakText: async () => {},
      _extractCompleteSentences: () => ({ complete: [], remaining: '' }),
    };

    await VoicePipeline.prototype._handleToolCalls.call(pipeline, 'c1', session, toolCalls, {});

    assert.deepStrictEqual(findOrphanToolCalls(session.messages), []);
    const tools = session.messages.filter(m => m.role === 'tool');
    assert.strictEqual(tools.length, 2);
    assert.ok(tools[0].content.includes('10:00'), 'el resultado real de la 1ª se conserva');
    assert.strictEqual(JSON.parse(tools[1].content).error, 'cancelled', 'la 2ª queda marcada como cancelada');
  });

  test('si el ejecutor LANZA, el historial tampoco queda roto', async () => {
    const session = newSession();
    const toolCalls = [{ id: 'call_1', function: { name: 'book_appointment', arguments: '{}' } }];
    const pipeline = {
      toolExecutor: { execute: async () => { throw new Error('kaboom'); } },
      llmRouter: { streamCompletion: async function* () {} },
      activeCalls: new Map([['c1', session]]),
      _speakText: async () => {},
      _extractCompleteSentences: () => ({ complete: [], remaining: '' }),
    };

    await assert.rejects(
      () => VoicePipeline.prototype._handleToolCalls.call(pipeline, 'c1', session, toolCalls, {}),
      /kaboom/,
    );
    assert.deepStrictEqual(findOrphanToolCalls(session.messages), [],
      'la excepción se propaga, pero el historial queda utilizable');
  });
});
