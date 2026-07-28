'use strict';
// ============================================================
// NodeFlow — Contenido & SEO: store de artículos (nf_content)
// Persistencia multi-tenant. Fail-open (si la tabla no existe aún, no rompe).
// ============================================================
const { getDatabase } = require('../db/database');
const { Logger } = require('../utils/logger');
const log = new Logger('CONTENT-STORE');

function monthStartISO(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function saveArticle(orgId, a) {
  const db = getDatabase();
  if (!db.enabled || !orgId || !a || !a.slug) return { ok: false };
  const row = {
    org_id: orgId, slug: a.slug, meta_title: a.meta_title, meta_description: a.meta_description,
    h1: a.h1, intro: a.intro, sections: a.sections || [], conclusion: a.conclusion,
    faqs: a.faqs || [], keywords: a.keywords || [], reading_minutes: a.reading_minutes || null,
    status: 'published',
  };
  const { error } = await db.client.from('nf_content').upsert(row, { onConflict: 'org_id,slug' });
  if (error) { log.warn(`saveArticle ${orgId}/${a.slug}: ${error.message}`); return { ok: false, error: error.message }; }
  return { ok: true, slug: a.slug };
}

async function listArticles(orgId, limit = 50) {
  const db = getDatabase();
  if (!db.enabled || !orgId) return [];
  try {
    const { data } = await db.client.from('nf_content')
      .select('slug, meta_title, h1, meta_description, reading_minutes, published_at')
      .eq('org_id', orgId).eq('status', 'published')
      .order('published_at', { ascending: false }).limit(limit);
    return data || [];
  } catch (_) { return []; }
}

async function getArticle(orgId, slug) {
  const db = getDatabase();
  if (!db.enabled || !orgId || !slug) return null;
  try {
    const { data } = await db.client.from('nf_content')
      .select('*').eq('org_id', orgId).eq('slug', slug).eq('status', 'published').maybeSingle();
    return data || null;
  } catch (_) { return null; }
}

// Artículos generados este mes (para el tope de coste de generación).
async function countThisMonth(orgId, now = Date.now()) {
  const db = getDatabase();
  if (!db.enabled || !orgId) return 0;
  try {
    const { count } = await db.client.from('nf_content')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).gte('created_at', monthStartISO(now));
    return count || 0;
  } catch (_) { return 0; }
}

module.exports = { saveArticle, listArticles, getArticle, countThisMonth, monthStartISO };
