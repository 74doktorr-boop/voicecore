// ============================================================
// NodeFlow — Tests del filtro de tool calls textualizados
// El bug real (llamada PSTN 2026-07-03): Llama 3.3 en Groq emitió
// '<function=check_availability>{"from_date": "2026-07-06", ...}'
// como TEXTO; el cliente OYÓ el JSON por teléfono y la herramienta
// nunca se ejecutó. Cada caso de aquí reproduce un fragmento real
// del streaming.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { TextualToolFilter, stripTextualToolCalls } = require('../src/llm/textual-tool-filter');

// Helper: pasa los chunks por el filtro y devuelve { emitted, tail }
function run(chunks) {
  const f = new TextualToolFilter();
  let emitted = '';
  for (const c of chunks) emitted += f.push(c);
  const tail = f.finish();
  return { emitted: emitted + tail.text, toolCalls: tail.toolCalls };
}

describe('TextualToolFilter — texto normal pasa intacto', () => {
  test('frase sin marcadores, en varios chunks', () => {
    const { emitted, toolCalls } = run(['Sí, ofrecemos ', 'corte de pelo. ', '¿Qué día te viene bien?']);
    assert.strictEqual(emitted, 'Sí, ofrecemos corte de pelo. ¿Qué día te viene bien?');
    assert.strictEqual(toolCalls.length, 0);
  });

  test('un "<" que no es marker se libera al final', () => {
    const { emitted, toolCalls } = run(['el precio es <', '20 euros']);
    assert.strictEqual(emitted, 'el precio es <20 euros');
    assert.strictEqual(toolCalls.length, 0);
  });

  test('cola "<fun" inocua (no era marker) sale en finish()', () => {
    const { emitted } = run(['esto acaba raro <fun']);
    assert.strictEqual(emitted, 'esto acaba raro <fun');
  });
});

describe('TextualToolFilter — el bug de la llamada real', () => {
  test('tool call textualizado NO se emite y se parsea', () => {
    const { emitted, toolCalls } = run([
      '<function=check_availability>',
      '{"from_date": "2026-07-06", "to_date": "2026-07-08"}',
    ]);
    assert.strictEqual(emitted, '');
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].function.name, 'check_availability');
    const args = JSON.parse(toolCalls[0].function.arguments);
    assert.strictEqual(args.from_date, '2026-07-06');
  });

  test('marker partido entre chunks (streaming real)', () => {
    const { emitted, toolCalls } = run([
      'Un momento, lo miro. <fun',
      'ction=check_availability>{"from_date"',
      ': "2026-07-06"}',
    ]);
    assert.strictEqual(emitted, 'Un momento, lo miro. ');
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].function.name, 'check_availability');
  });

  test('cierre </function> se descarta de los argumentos', () => {
    const { toolCalls } = run(['<function=book_appointment>{"time": "13:30"}</function>']);
    assert.strictEqual(toolCalls.length, 1);
    assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { time: '13:30' });
  });

  test('dos tool calls seguidos', () => {
    const { toolCalls } = run([
      '<function=check_availability>{"d": 1}</function><function=get_services>{}',
    ]);
    assert.strictEqual(toolCalls.length, 2);
    assert.strictEqual(toolCalls[0].function.name, 'check_availability');
    assert.strictEqual(toolCalls[1].function.name, 'get_services');
  });

  test('texto y tool call mezclados: el texto se emite, el tool no', () => {
    const { emitted, toolCalls } = run([
      '¿Qué día te gustaría venir? ',
      '<function=check_availability>{"from_date": "2026-07-06"}',
    ]);
    assert.strictEqual(emitted, '¿Qué día te gustaría venir? ');
    assert.strictEqual(toolCalls.length, 1);
  });

  test('args vacíos → "{}" parseable', () => {
    const { toolCalls } = run(['<function=get_services>']);
    assert.strictEqual(toolCalls[0].function.arguments, '{}');
  });
});

describe('stripTextualToolCalls — red de seguridad del TTS', () => {
  test('corta desde <function hasta el final', () => {
    assert.strictEqual(
      stripTextualToolCalls('Claro. <function=check_availability>{"a":1}'),
      'Claro.'
    );
  });
  test('corta <tool_call también', () => {
    assert.strictEqual(stripTextualToolCalls('Vale <tool_call>{"x":1}'), 'Vale');
  });
  test('texto limpio pasa intacto', () => {
    assert.strictEqual(stripTextualToolCalls('Le esperamos a la una y media.'), 'Le esperamos a la una y media.');
  });
  test('solo tool call → cadena vacía (no se habla nada)', () => {
    assert.strictEqual(stripTextualToolCalls('<function=f>{}'), '');
  });
});

describe('GroqLLM — streaming intercepta tool calls textualizados', () => {
  function sseResponse(deltas) {
    const events = deltas.map(d => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n`);
    events.push('data: [DONE]\n');
    const payload = new TextEncoder().encode(events.join(''));
    let sent = false;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: payload })),
        }),
      },
    };
  }

  test('el JSON del tool call jamás sale como chunk de texto', async () => {
    const { GroqLLM } = require('../src/llm/groq');
    const llm = new GroqLLM('test-key');
    const realFetch = global.fetch;
    global.fetch = async () => sseResponse([
      { content: '¿Qué día te gustaría? ' },
      { content: '<function=check_availability>{"from_date": ' },
      { content: '"2026-07-06"}' },
    ]);
    try {
      const chunks = [];
      for await (const c of llm.streamCompletion({ callId: 't1', messages: [] })) chunks.push(c);

      const textOut = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
      assert.ok(!textOut.includes('<function'), `el texto emitido contiene el tool call: "${textOut}"`);
      assert.strictEqual(textOut, '¿Qué día te gustaría? ');

      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      assert.strictEqual(toolChunks.length, 1);
      assert.strictEqual(toolChunks[0].toolCall.function.name, 'check_availability');

      const done = chunks.find(c => c.type === 'done');
      assert.ok(!done.content.includes('<function'), 'done.content contiene el tool call');
      assert.strictEqual(done.toolCalls.length, 1);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('tool calls nativos siguen funcionando igual', async () => {
    const { GroqLLM } = require('../src/llm/groq');
    const llm = new GroqLLM('test-key');
    const realFetch = global.fetch;
    global.fetch = async () => {
      const events = [
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_services', arguments: '{}' } }] } }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n`,
        'data: [DONE]\n',
      ];
      const payload = new TextEncoder().encode(events.join(''));
      let sent = false;
      return {
        ok: true,
        body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: payload })) }) },
      };
    };
    try {
      const chunks = [];
      for await (const c of llm.streamCompletion({ callId: 't2', messages: [] })) chunks.push(c);
      const toolChunks = chunks.filter(c => c.type === 'tool_call');
      assert.strictEqual(toolChunks.length, 1);
      assert.strictEqual(toolChunks[0].toolCall.function.name, 'get_services');
      const done = chunks.find(c => c.type === 'done');
      assert.strictEqual(done.toolCalls.length, 1);
    } finally {
      global.fetch = realFetch;
    }
  });
});
