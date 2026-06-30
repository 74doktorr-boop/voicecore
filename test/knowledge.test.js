// ============================================================
// VoiceCore — Knowledge Base (RAG) por negocio.
// Prueba la ruta EN MEMORIA (sin Supabase) con embeddings simulados
// deterministas (bag-of-words) para verificar ingest/query/stats/clear
// y el ranking por similitud. No llama a OpenAI.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { KnowledgeBase } = require('../src/knowledge/base');

// Embedding simulado: vector de presencia sobre un vocabulario fijo.
const VOCAB = ['aparcamiento', 'parking', 'gratis', 'blanqueamiento', 'dental', 'martes', 'horario', 'urgencias'];
function fakeEmbed(text) {
  const t = text.toLowerCase();
  return VOCAB.map(w => (t.includes(w) ? 1 : 0));
}

function makeKb() {
  const kb = new KnowledgeBase({ openaiApiKey: 'test' });
  kb._getEmbeddings = async (texts) => texts.map(fakeEmbed); // sin red
  kb.minScore = 0; // no filtrar por umbral en el test
  return kb;
}

describe('KnowledgeBase (RAG en memoria)', () => {
  test('ingesta texto y cuenta chunks', async () => {
    const kb = makeKb();
    const r = await kb.ingestText('org1', 'El aparcamiento es gratis. Hacemos blanqueamiento dental los martes.', 'faq');
    assert.ok(r.chunksAdded >= 1);
    const s = await kb.stats('org1');
    assert.equal(s.chunks, r.chunksAdded);
    assert.deepEqual(s.sources, ['faq']);
  });

  test('query devuelve el chunk más relevante primero', async () => {
    const kb = makeKb();
    await kb.ingestText('org2', 'Tenemos aparcamiento parking gratis para clientes.', 'parking');
    await kb.ingestText('org2', 'Atendemos urgencias dentales fuera de horario.', 'urgencias');
    const res = await kb.query('org2', '¿hay aparcamiento gratis?');
    assert.ok(res.length >= 1);
    assert.match(res[0].text.toLowerCase(), /aparcamiento/);
  });

  test('getContext es fail-open y devuelve cadena inyectable', async () => {
    const kb = makeKb();
    await kb.ingestText('org3', 'El horario es de lunes a viernes.', 'horario');
    const ctx = await kb.getContext('org3', '¿qué horario tenéis?');
    assert.match(ctx, /INFORMACIÓN DEL NEGOCIO/);
    // Sin KB → cadena vacía (no rompe la llamada)
    const empty = await kb.getContext('sin-kb', 'hola');
    assert.equal(empty, '');
  });

  test('clear vacía la KB de la org', async () => {
    const kb = makeKb();
    await kb.ingestText('org4', 'Texto de prueba para borrar luego.', 'tmp');
    await kb.clear('org4');
    const s = await kb.stats('org4');
    assert.equal(s.chunks, 0);
  });

  test('aislamiento entre orgs', async () => {
    const kb = makeKb();
    await kb.ingestText('orgA', 'Datos de la empresa A parking gratis.', 'a');
    await kb.ingestText('orgB', 'Datos de la empresa B urgencias.', 'b');
    const sa = await kb.stats('orgA');
    const sb = await kb.stats('orgB');
    assert.equal(sa.chunks, 1);
    assert.equal(sb.chunks, 1);
    const resA = await kb.query('orgA', 'parking');
    assert.match(resA[0].text, /empresa A/);
  });
});
