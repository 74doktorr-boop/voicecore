// ============================================================
// NodeFlow — Contenido: piloto automático (opt-in + tope de coste) 2026-07-28
// Gasta GPT, así que: solo orgs que lo activaron (contentAuto) + Pro + micrositio
// on, respetando el tope mensual y un límite de lote por corrida.
// ============================================================
'use strict';

process.env.NODE_ENV = 'test';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { runAutoContent } = require('../src/content/auto');

// Org helper: Pro por defecto (sin tier); auto/micrositeOff configurables.
const org = (id, over = {}) => ({
  id, name: 'N' + id, slug: 's' + id, is_active: true,
  assistant_config: { sector: 'dental' },
  automation_config: { config: Object.assign({ contentAuto: true, city: 'Bilbao', serviceList: [{ name: 'Limpieza' }] }, over) },
});

function deps(orgs, over = {}) {
  return Object.assign({
    db: { enabled: true, client: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: orgs }) }) }) }) } },
    countThisMonth: async () => 0,
    listArticles: async () => [],
    saveArticle: async () => ({ ok: true }),
    generateArticle: async ({ topic }) => ({ ok: true, article: { slug: topic.slug, h1: topic.title, sections: [{}], faqs: [] } }),
  }, over);
}

describe('runAutoContent — opt-in y gating', () => {
  test('solo genera para orgs con contentAuto=true', async () => {
    const orgs = [org(1), org(2, { contentAuto: false }), org(3)];
    const r = await runAutoContent(deps(orgs));
    assert.strictEqual(r.candidates, 2);       // 1 y 3 (no el 2)
    assert.strictEqual(r.generated, 2);
  });

  test('respeta el TOPE mensual (no genera si used>=cap)', async () => {
    const r = await runAutoContent(deps([org(1, { contentMonthlyCap: 5 })], { countThisMonth: async () => 5 }));
    assert.strictEqual(r.generated, 0);
    assert.strictEqual(r.skipped, 1);
  });

  test('salta si no quedan temas nuevos', async () => {
    // listArticles devuelve TODOS los slugs posibles → topicsForOrg no encuentra nuevo
    const o = org(1);
    const { topicsForOrg } = require('../src/content/generator');
    const allSlugs = topicsForOrg(o).map(t => ({ slug: t.slug }));
    const r = await runAutoContent(deps([o], { listArticles: async () => allSlugs }));
    assert.strictEqual(r.generated, 0);
  });

  test('límite de lote por corrida (control de gasto)', async () => {
    const orgs = [org(1), org(2), org(3), org(4)];
    const r = await runAutoContent(deps(orgs, { batch: 2 }));
    assert.strictEqual(r.generated, 2);        // corta en el lote aunque haya 4
  });

  test('org Básico (tier:basico) no genera aunque tenga contentAuto', async () => {
    const o = org(1); o.automation_config.config.tier = 'basico';
    const r = await runAutoContent(deps([o]));
    assert.strictEqual(r.candidates, 0);
  });

  test('micrositeOff → no genera', async () => {
    const r = await runAutoContent(deps([org(1, { micrositeOff: true })]));
    assert.strictEqual(r.candidates, 0);
  });

  test('sin BD → no revienta', async () => {
    const r = await runAutoContent({ db: { enabled: false } });
    assert.deepStrictEqual(r, { generated: 0, skipped: 0, candidates: 0 });
  });
});
