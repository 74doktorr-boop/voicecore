// ============================================================
// NodeFlow — Replay gate (#5, último eslabón del bucle de mejora)
// Antes de desplegar una regla de prompt aprobada, se RE-JUEGAN
// llamadas reales contra el prompt candidato y el auditor puntúa
// las conversaciones sintéticas. La regla solo pasa si no empeora
// la media (tolerancia configurable). Es el gate que convierte
// "aprende de uno, aplica a todos" en algo que no puede degradar
// los asistentes de golpe.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { replayConversation, gateVerdict, runReplayGate } = require('../src/lifecycle/replay-gate');

const TRANSCRIPT = [
  { role: 'assistant', content: 'Bienvenido a NodeFlow, ¿qué necesita?' },
  { role: 'user', content: 'Quiero información de precios.' },
  { role: 'assistant', content: 'Registro su interés y le llamarán.' },
  { role: 'user', content: 'Vale, gracias.' },
  { role: 'assistant', content: 'Hasta luego.' },
];

function seqOpenAI(replies) {
  let i = 0;
  const seen = [];
  return {
    _seen: seen,
    chat: { completions: { create: async (args) => { seen.push(args); return { choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }] }; } } },
  };
}

describe('replayConversation — reconstruye la llamada con el prompt candidato', () => {
  test('genera una respuesta del asistente por cada turno del cliente', async () => {
    const openai = seqOpenAI(['El plan cuesta cuarenta y nueve euros al mes.', 'Gracias por llamar.']);
    const out = await replayConversation('PROMPT CANDIDATO', TRANSCRIPT, { openai });
    // 2 turnos de cliente → 2 llamadas al LLM y transcript sintético de 4 mensajes
    assert.strictEqual(openai._seen.length, 2);
    assert.strictEqual(out.length, 4);
    assert.strictEqual(out[0].role, 'user');
    assert.match(out[1].content, /cuarenta y nueve/);
    // el system del replay es el prompt candidato
    assert.strictEqual(openai._seen[0].messages[0].role, 'system');
    assert.match(openai._seen[0].messages[0].content, /PROMPT CANDIDATO/);
  });

  test('sin turnos de cliente → transcript vacío sin llamar al LLM', async () => {
    const openai = seqOpenAI(['x']);
    const out = await replayConversation('P', [{ role: 'assistant', content: 'hola' }], { openai });
    assert.deepStrictEqual(out, []);
    assert.strictEqual(openai._seen.length, 0);
  });
});

describe('gateVerdict — determinista', () => {
  test('pasa si la media replay no cae más que la tolerancia', () => {
    assert.strictEqual(gateVerdict(80, 78, 5).pass, true);
    assert.strictEqual(gateVerdict(80, 74, 5).pass, false);
    assert.strictEqual(gateVerdict(80, 90, 5).pass, true);
  });

  test('sin datos suficientes → NO pasa (gate honesto)', () => {
    assert.strictEqual(gateVerdict(null, 80, 5).pass, false);
    assert.strictEqual(gateVerdict(80, null, 5).pass, false);
  });
});

describe('runReplayGate — el ciclo completo con fakes', () => {
  test('re-juega, audita y compara contra la media original', async () => {
    const calls = [
      { id: 'c1', transcript: TRANSCRIPT, assistantMode: 'contacto',
        serviceList: [{ name: 'Plan', price: '49€/mes' }],
        metrics: { audit: { score: 70 } } },
    ];
    const out = await runReplayGate({
      candidatePrompt: 'PROMPT NUEVO',
      calls,
      tolerance: 5,
    }, {
      openai: seqOpenAI(['Cuesta cuarenta y nueve euros.', 'Adiós.']),
      audit: async () => ({ score: 85 }),
    });
    assert.strictEqual(out.replayed, 1);
    assert.strictEqual(out.originalAvg, 70);
    assert.strictEqual(out.replayAvg, 85);
    assert.strictEqual(out.pass, true);
  });

  test('si el replay empeora más que la tolerancia → NO pasa', async () => {
    const calls = [
      { id: 'c1', transcript: TRANSCRIPT, metrics: { audit: { score: 90 } } },
    ];
    const out = await runReplayGate({ candidatePrompt: 'P', calls, tolerance: 5 }, {
      openai: seqOpenAI(['meh', 'meh']),
      audit: async () => ({ score: 60 }),
    });
    assert.strictEqual(out.pass, false);
  });

  test('llamadas sin transcript o sin audit se saltan sin romper', async () => {
    const out = await runReplayGate({ candidatePrompt: 'P', calls: [{ id: 'x', transcript: [] }], tolerance: 5 }, {
      openai: seqOpenAI(['x']),
      audit: async () => ({ score: 50 }),
    });
    assert.strictEqual(out.replayed, 0);
    assert.strictEqual(out.pass, false);
  });
});

describe('runReplayGate — filtro por SECTOR (2026-07-04)', () => {
  const mk = (id, sector, score) => ({ id, transcript: TRANSCRIPT, metrics: { audit: { score, sector } } });
  const calls = [mk('r1', 'restaurante', 60), mk('r2', 'restaurante', 60), mk('d1', 'dental', 80)];

  test('valida SOLO contra llamadas del sector pedido y re-audita con su rúbrica', async () => {
    const seenSectors = [];
    const out = await runReplayGate(
      { candidatePrompt: 'P', calls, tolerance: 5, sector: 'restaurante' },
      { openai: seqOpenAI(['a', 'b']), audit: async (cd) => { seenSectors.push(cd.sector); return { score: 62 }; } },
    );
    assert.strictEqual(out.replayed, 2);            // solo r1, r2 (no dental)
    assert.strictEqual(out.sector, 'restaurante');
    assert.ok(seenSectors.length && seenSectors.every(s => s === 'restaurante'));
  });

  test('un ALIAS de sector resuelve al canónico y filtra', async () => {
    const out = await runReplayGate(
      { candidatePrompt: 'P', calls, tolerance: 5, sector: 'dentista' }, // alias → dental
      { openai: seqOpenAI(['a']), audit: async () => ({ score: 82 }) },
    );
    assert.strictEqual(out.replayed, 1);            // solo d1
    assert.strictEqual(out.sector, 'dental');
  });

  test('sector sin llamadas → no aprueba a ciegas', async () => {
    const out = await runReplayGate(
      { candidatePrompt: 'P', calls, tolerance: 5, sector: 'taller' },
      { openai: seqOpenAI(['a']), audit: async () => ({ score: 90 }) },
    );
    assert.strictEqual(out.replayed, 0);
    assert.strictEqual(out.pass, false);
  });

  test('sin sector → valida contra TODAS (global, compat)', async () => {
    const out = await runReplayGate(
      { candidatePrompt: 'P', calls, tolerance: 5 },
      { openai: seqOpenAI(['a']), audit: async () => ({ score: 70 }) },
    );
    assert.strictEqual(out.replayed, 3);
    assert.strictEqual(out.sector, null);
  });
});
