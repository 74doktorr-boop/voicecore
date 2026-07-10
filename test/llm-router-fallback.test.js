// ============================================================
// NodeFlow — Router LLM: fallback robusto (fix 2026-07)
// Bug real (llamada fisioterapia unai): el usuario decía "Sí, por favor"
// (STT 0.999) y el asistente respondía "no te he escuchado". Causa: Groq
// devolvía VACÍO (o erroraba) y el router NO recuperaba:
//   1) solo hacía fallback ante un chunk 'error', no ante respuesta vacía.
//   2) el fallbackModel de la org apuntaba al MISMO Groq → reintentaba el
//      proveedor que acababa de fallar.
// Este test fija el contrato: una respuesta vacía o con error del primario
// SIEMPRE cae a OTRO proveedor con contenido, y nunca se reintenta el mismo.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { LLMRouter } = require('../src/llm/router');

// Provider falso: un generador que emite lo que le digamos.
function fakeProvider(script) {
  return {
    async *streamCompletion() {
      for (const chunk of script) yield chunk;
    },
  };
}
const textStream = (t) => [
  { type: 'text', content: t },
  { type: 'done', content: t, toolCalls: [] },
];
const emptyStream = () => [{ type: 'done', content: '', toolCalls: [] }];
const errorStream = () => [{ type: 'error', message: 'Groq 429 rate limit' }];

// Construye un router con dos proveedores falsos inyectados a mano.
function routerWith(groqScript, openaiScript) {
  const r = new LLMRouter({}); // sin claves → sin proveedores reales
  r.providers.set('groq', { instance: fakeProvider(groqScript), models: ['llama-3.3-70b-versatile'] });
  r.providers.set('openai', { instance: fakeProvider(openaiScript), models: ['gpt-4o-mini'] });
  return r;
}

async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('LLMRouter — fallback robusto ante vacío/error', () => {
  test('Groq VACÍO → cae a OpenAI con contenido', async () => {
    const r = routerWith(emptyStream(), textStream('Perfecto, le avisaremos.'));
    const chunks = await collect(r.streamCompletion({ callId: 'c', messages: [] }));
    const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    assert.match(text, /Perfecto, le avisaremos/);
    const done = chunks.find(c => c.type === 'done');
    assert.ok(done, 'hay un done');
    assert.strictEqual(done.metrics.provider, 'openai');
    assert.strictEqual(done.metrics.viaFallback, true);
  });

  test('Groq ERROR → cae a OpenAI con contenido', async () => {
    const r = routerWith(errorStream(), textStream('Hola, dígame.'));
    const chunks = await collect(r.streamCompletion({ callId: 'c', messages: [] }));
    const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    assert.match(text, /Hola, dígame/);
  });

  test('fallbackModel apuntando al MISMO Groq no impide caer a OpenAI', async () => {
    // Reproduce la config real de la org: fallbackModel = groq (el que falla).
    const r = routerWith(emptyStream(), textStream('Respondo yo, OpenAI.'));
    const chunks = await collect(r.streamCompletion({
      callId: 'c', messages: [], fallbackModel: 'groq/llama-3.3-70b-versatile',
    }));
    const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    assert.match(text, /Respondo yo, OpenAI/, 'no se queda atascado reintentando Groq');
  });

  test('Groq con contenido → NO cae a fallback (no duplica)', async () => {
    const r = routerWith(textStream('Bien, Groq responde.'), textStream('NO deberia salir'));
    const chunks = await collect(r.streamCompletion({ callId: 'c', messages: [] }));
    const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('');
    assert.strictEqual(text, 'Bien, Groq responde.');
    assert.ok(!/NO deberia salir/.test(text));
    const done = chunks.find(c => c.type === 'done');
    assert.strictEqual(done.metrics.provider, 'groq');
  });

  test('un tool_call cuenta como respuesta válida (no es vacío)', async () => {
    const r = routerWith(
      [{ type: 'tool_call', toolCall: { id: 't1', function: { name: 'register_lead', arguments: '{}' } } },
       { type: 'done', content: '', toolCalls: [{ id: 't1', function: { name: 'register_lead', arguments: '{}' } }] }],
      textStream('no debería'),
    );
    const chunks = await collect(r.streamCompletion({ callId: 'c', messages: [] }));
    assert.ok(chunks.some(c => c.type === 'tool_call'), 'pasa el tool_call');
    assert.ok(!chunks.some(c => c.type === 'text' && /no debería/.test(c.content)), 'no cae a fallback');
  });

  test('todos vacíos → error final (último recurso honesto)', async () => {
    const r = routerWith(emptyStream(), emptyStream());
    const chunks = await collect(r.streamCompletion({ callId: 'c', messages: [] }));
    assert.ok(chunks.some(c => c.type === 'error'), 'emite error cuando todo falla');
  });
});
