'use strict';
// ============================================================
// NodeFlow — Contenido & SEO: piloto automático (opt-in)
// Genera un artículo/día para los negocios que lo activaron (config.contentAuto),
// respetando el TOPE de coste mensual. Coste = GPT-4o, así que:
//  · OPT-IN (defecto OFF) — nadie genera sin activarlo.
//  · Tope mensual por org (contentMonthlyCap).
//  · Límite de lote por corrida (control de gasto global).
//  · Un artículo por org y corrida (no ráfagas).
// Lo llama el cron (leader-gated, una vez al día). deps.generateArticle mockeable.
// ============================================================
const { getDatabase } = require('../db/database');
const { Logger } = require('../utils/logger');
const log = new Logger('CONTENT-AUTO');

function _cap(cfg) {
  const c = Number(cfg && cfg.contentMonthlyCap);
  return (Number.isFinite(c) && c >= 0) ? c : (Number(process.env.CONTENT_MONTHLY_CAP_DEFAULT) || 8);
}

/**
 * Genera hasta `batch` artículos entre las orgs con piloto automático activo.
 * @returns {Promise<{generated, skipped, candidates}>}
 */
async function runAutoContent(deps = {}) {
  const db = deps.db || getDatabase();
  if (!db.enabled) return { generated: 0, skipped: 0, candidates: 0 };
  const { hasPro } = require('../billing/plan');
  const { topicsForOrg, generateArticle } = require('./generator');
  const store = require('./store');
  const gen = deps.generateArticle || generateArticle;
  const countThisMonth = deps.countThisMonth || store.countThisMonth;
  const listArticles = deps.listArticles || store.listArticles;
  const saveArticle = deps.saveArticle || store.saveArticle;
  const BATCH = deps.batch || Number(process.env.CONTENT_AUTO_BATCH) || 8;

  let orgs = [];
  try {
    const { data } = await db.client.from('organizations')
      .select('id, name, slug, assistant_config, automation_config, is_active')
      .eq('is_active', true).limit(3000);
    orgs = data || [];
  } catch (e) { log.warn(`runAutoContent orgs: ${e.message}`); return { generated: 0, skipped: 0, candidates: 0 }; }

  const optIn = orgs.filter(o => o.slug
    && o.automation_config?.config?.contentAuto === true
    && hasPro(o)
    && o.automation_config?.config?.micrositeOff !== true);

  let generated = 0, skipped = 0;
  for (const org of optIn) {
    if (generated >= BATCH) break;
    try {
      const cfg = org.automation_config?.config || {};
      if (await countThisMonth(org.id) >= _cap(cfg)) { skipped++; continue; }         // tope mensual
      const existing = new Set((await listArticles(org.id, 200)).map(a => a.slug));
      const topic = topicsForOrg(org).find(t => !existing.has(t.slug));
      if (!topic) { skipped++; continue; }                                            // sin temas nuevos
      const r = await gen({ org, topic });
      if (!r.ok) { skipped++; continue; }
      const s = await saveArticle(org.id, r.article);
      if (s.ok) { generated++; log.info(`auto-contenido (${org.id}): ${r.article.slug}`); }
      else skipped++;
    } catch (e) { skipped++; log.warn(`auto-contenido ${org.id}: ${e.message}`); }
  }
  if (generated || skipped) log.info(`Piloto de contenido: ${generated} generados, ${skipped} saltados (${optIn.length} activos)`);
  return { generated, skipped, candidates: optIn.length };
}

module.exports = { runAutoContent };
