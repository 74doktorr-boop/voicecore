// ============================================================
// NodeFlow — Contenido & SEO fase 2 (2026-07-28)
// Generación multi-tenant: temas del negocio (puro) + artículo con GPT
// (mockeado, sin gastar) + render SEO del artículo. Guardarraíl de coste.
// ============================================================
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { topicsForOrg, generateArticle, slugify } = require('../src/content/generator');
const { renderArticle } = require('../src/api/routes-microsite');

const org = {
  id: 'o1', slug: 'clinica-norte', name: 'Clínica Norte', language: 'es',
  assistant_config: { sector: 'dental' },
  automation_config: { config: { city: 'Donostia', serviceList: [{ name: 'Limpieza' }, { name: 'Ortodoncia' }] } },
};

describe('topicsForOrg — temas del negocio (puro)', () => {
  const t = topicsForOrg(org);
  test('genera temas (por servicio + genéricos) con slugs únicos', () => {
    assert.ok(t.length >= 4);
    assert.strictEqual(new Set(t.map(x => x.slug)).size, t.length);
  });
  test('long-tail local: incluye ciudad y servicio', () => {
    assert.ok(t.some(x => /Limpieza/.test(x.title) && /Donostia/.test(x.title)));
    assert.ok(t.every(x => x.city === 'Donostia'));
  });
  test('sin ciudad no rompe (degradación)', () => {
    const t2 = topicsForOrg({ id: 'o2', name: 'Bar X', automation_config: { config: { serviceList: [{ name: 'Menú' }] } } });
    assert.ok(t2.length >= 1);
    assert.ok(!t2.some(x => /undefined/.test(x.title)));
  });
});

describe('generateArticle — GPT mockeado (sin gastar)', () => {
  const goodJson = JSON.stringify({
    metaTitle: 'Limpieza dental en Donostia', metaDescription: 'Guía. Pide cita.', h1: 'Limpieza dental',
    intro: 'a\nb', sections: [{ h2: 'Qué es', content: 'x' }], conclusion: 'Pide cita en Clínica Norte.',
    faqs: [{ question: '¿Duele?', answer: 'No.' }], readingMinutes: 5,
  });
  const openai = (json) => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: json } }] }) } } });

  test('devuelve artículo estructurado', async () => {
    const r = await generateArticle({ org, topic: topicsForOrg(org)[0] }, { openai: openai(goodJson) });
    assert.strictEqual(r.ok, true);
    assert.ok(r.article.slug && r.article.h1 && r.article.sections.length);
  });
  test('output inválido (sin secciones) → no ok, no revienta', async () => {
    const r = await generateArticle({ org, topic: topicsForOrg(org)[0] }, { openai: openai(JSON.stringify({ h1: 'x', sections: [] })) });
    assert.strictEqual(r.ok, false);
  });
  test('sin openai → no_openai (no intenta gastar)', async () => {
    const r = await generateArticle({ org, topic: topicsForOrg(org)[0] }, { openai: null });
    assert.strictEqual(r.ok, false);
  });
});

describe('renderArticle — SEO', () => {
  test('Article + FAQPage schema, chat embebido, CTA, sin undefined', () => {
    const art = { slug: 's', meta_title: 'T', h1: 'H1', intro: 'p1\np2', sections: [{ h2: 'A', content: 'x' }], conclusion: 'c', faqs: [{ question: 'q', answer: 'a' }], published_at: '2026-07-28' };
    const h = renderArticle(org, art, 'https://nodeflow.es');
    assert.match(h, /"@type":"Article"/);
    assert.match(h, /"@type":"FAQPage"/);
    assert.match(h, /data-nodeflow-org="o1"/);
    assert.match(h, /Pedir cita/);
    assert.ok(!/undefined/.test(h));
    assert.match(h, /rel="canonical" href="https:\/\/nodeflow\.es\/n\/clinica-norte\/s"/);
  });
});

describe('slugify', () => {
  test('normaliza acentos y espacios', () => {
    assert.strictEqual(slugify('Limpieza en Donostia: precios'), 'limpieza-en-donostia-precios');
  });
});
