// ============================================================
// NodeFlow — Micrositios de cliente (Contenido & SEO, fase 1)
// Página hosteada por negocio en /n/:slug que RANKEA (SEO local: título,
// descripción, LocalBusiness schema) y RESERVA (chat widget embebido → cita).
// Servido dinámico desde la BD (no ficheros/git → multi-tenant, escala).
// Pro-gated + respeta config.micrositeOff. Fase 2 = artículos SEO (nf_content).
//
// GET /n/:slug
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const log = new Logger('MICROSITE');

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderMicrosite(org, base, articles = []) {
  const cfg = org.automation_config?.config || {};
  const name = org.name || 'Tu negocio';
  const city = cfg.city || org.city || '';
  const sector = org.assistant_config?.sector || cfg.sector || '';
  const services = Array.isArray(cfg.serviceList) ? cfg.serviceList.map(s => (s && s.name) || s).filter(Boolean).slice(0, 12) : [];
  const phone = org.phone || cfg.alertPhone || '';
  const title = `${name}${city ? ' · ' + city : ''}${sector ? ' — ' + sector : ''}`;
  const desc = `${name}${city ? ' en ' + city : ''}: ${services.length ? services.slice(0, 4).join(', ') + '. ' : ''}Pide tu cita al instante — te atendemos 24/7.`;
  const url = `${base}/n/${org.slug}`;

  const schema = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness',
    name, url, ...(phone ? { telephone: phone } : {}),
    ...(city ? { address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'ES' } } : {}),
    ...(services.length ? { makesOffer: services.map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } })) } : {}),
  };

  const serviceChips = services.map(s => `<span class="chip">${esc(s)}</span>`).join('');

  return `<!DOCTYPE html><html lang="${esc(org.language || 'es')}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>
<style>
  :root{--bg:#fbfbf9;--ink:#1a1c1a;--ink2:#5b615a;--line:#e6e6e0;--accent:#2f7d5b;--accent2:#eaf5ef}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
  .wrap{max-width:820px;margin:0 auto;padding:0 22px}
  header{padding:64px 0 40px;text-align:center;border-bottom:1px solid var(--line)}
  .eyebrow{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:14px}
  h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;letter-spacing:-.02em;margin-bottom:16px}
  .lead{font-size:1.15rem;color:var(--ink2);max-width:34ch;margin:0 auto 28px}
  .cta{display:inline-block;background:var(--accent);color:#fff;font-weight:700;padding:15px 30px;border-radius:12px;text-decoration:none;font-size:1.05rem;cursor:pointer;border:none}
  .chips{display:flex;flex-wrap:wrap;gap:9px;justify-content:center;margin-top:34px}
  .chip{background:var(--accent2);color:var(--accent);border-radius:20px;padding:7px 15px;font-size:.9rem;font-weight:600}
  section{padding:48px 0;border-bottom:1px solid var(--line)}
  h2{font-size:1.5rem;margin-bottom:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:8px}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px}
  .card b{display:block;color:var(--ink);margin-bottom:6px}
  .card p{color:var(--ink2);font-size:.95rem}
  footer{padding:40px 0;text-align:center;color:var(--ink2);font-size:.85rem}
  footer a{color:var(--accent);text-decoration:none}
  @media(max-width:600px){header{padding:44px 0 32px}}
</style></head>
<body>
  <header><div class="wrap">
    ${sector ? `<div class="eyebrow">${esc(sector)}${city ? ' · ' + esc(city) : ''}</div>` : (city ? `<div class="eyebrow">${esc(city)}</div>` : '')}
    <h1>${esc(name)}</h1>
    <p class="lead">${services.length ? esc(services.slice(0, 3).join(' · ')) : 'Reserva tu cita en segundos.'} Te atendemos al instante.</p>
    <button class="cta" onclick="nfOpenChat()">Pedir cita ahora</button>
    ${serviceChips ? `<div class="chips">${serviceChips}</div>` : ''}
  </div></header>

  <section><div class="wrap">
    <h2>Reserva sin llamar, sin esperas</h2>
    <div class="grid">
      <div class="card"><b>Al instante</b><p>Escribe abajo a la derecha y reserva tu cita en el momento, cualquier día y a cualquier hora.</p></div>
      <div class="card"><b>Sin formularios</b><p>Cuéntanos qué necesitas con tus palabras. El asistente busca el hueco y lo confirma.</p></div>
      <div class="card"><b>24/7</b><p>Aunque estemos cerrados o atendiendo, tu cita queda reservada.</p></div>
    </div>
  </div></section>

  ${articles.length ? `<section><div class="wrap">
    <h2>Guías y consejos</h2>
    <div class="grid">
      ${articles.slice(0, 9).map(a => `<a class="card" href="${esc(url)}/${esc(a.slug)}" style="text-decoration:none;color:inherit"><b>${esc(a.h1 || a.meta_title)}</b><p>${esc(a.meta_description || '')}</p></a>`).join('')}
    </div>
  </div></section>` : ''}

  <footer><div class="wrap">
    ${phone ? `${esc(name)} · <a href="tel:${esc(phone)}">${esc(phone)}</a> · ` : `${esc(name)} · `}
    Reservas con <a href="https://nodeflow.es" target="_blank" rel="noopener">NodeFlow</a>
  </div></footer>

  <script>function nfOpenChat(){var h=document.querySelector('[data-nodeflow-chat]');if(h&&h.shadowRoot){var b=h.shadowRoot.querySelector('.nf-btn');if(b)b.click();}}</script>
  <script src="${esc(base)}/chat.js" data-nodeflow-org="${esc(org.id)}"></script>
</body></html>`;
}

function renderArticle(org, art, base) {
  const cfg = org.automation_config?.config || {};
  const name = org.name || 'Tu negocio';
  const city = cfg.city || org.city || '';
  const home = `${base}/n/${org.slug}`;
  const url = `${home}/${art.slug}`;
  const sections = Array.isArray(art.sections) ? art.sections : [];
  const faqs = Array.isArray(art.faqs) ? art.faqs : [];
  const toc = sections.map((s, i) => `<li><a href="#s${i}">${esc(s.h2)}</a></li>`).join('');
  const body = sections.map((s, i) => `<h2 id="s${i}">${esc(s.h2)}</h2>${String(s.content || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}`).join('');
  const faqHtml = faqs.length ? `<h2>Preguntas frecuentes</h2>${faqs.map(f => `<div class="faq"><b>${esc(f.question)}</b><p>${esc(f.answer)}</p></div>`).join('')}` : '';
  const intro = String(art.intro || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
  const schema = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: art.h1 || art.meta_title, author: { '@type': 'Organization', name }, publisher: { '@type': 'Organization', name }, mainEntityOfPage: url, ...(art.published_at ? { datePublished: art.published_at } : {}) },
    faqs.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) } : null,
  ].filter(Boolean);
  return `<!DOCTYPE html><html lang="${esc(org.language || 'es')}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(art.meta_title || art.h1)}</title>
<meta name="description" content="${esc(art.meta_description || '')}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(art.meta_title || art.h1)}"><meta property="og:description" content="${esc(art.meta_description || '')}"><meta property="og:url" content="${esc(url)}">
${schema.map(s => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`).join('')}
<style>
  :root{--bg:#fbfbf9;--ink:#1a1c1a;--ink2:#4d534c;--line:#e6e6e0;--accent:#2f7d5b;--accent2:#eaf5ef}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.7}
  .wrap{max-width:720px;margin:0 auto;padding:0 22px}
  .top{padding:20px 0;border-bottom:1px solid var(--line)}
  .top a{color:var(--accent);text-decoration:none;font-weight:700;font-size:14px}
  article{padding:40px 0}
  h1{font-size:clamp(1.8rem,4.5vw,2.6rem);line-height:1.15;letter-spacing:-.02em;margin-bottom:18px}
  article p{margin:0 0 16px;color:var(--ink2);font-size:1.06rem}
  h2{font-size:1.5rem;margin:34px 0 12px;letter-spacing:-.01em}
  .toc{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:24px 0}
  .toc b{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:8px}
  .toc ul{margin:0;padding-left:18px}.toc a{color:var(--ink);text-decoration:none}.toc a:hover{color:var(--accent)}
  .faq{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:12px 0}.faq b{display:block;margin-bottom:6px}
  .cta-box{background:var(--accent2);border-radius:16px;padding:26px;text-align:center;margin:40px 0}
  .cta{display:inline-block;background:var(--accent);color:#fff;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;cursor:pointer;border:none;font-size:1.02rem}
  footer{padding:36px 0;text-align:center;color:var(--ink2);font-size:.85rem;border-top:1px solid var(--line)}
  footer a{color:var(--accent);text-decoration:none}
</style></head>
<body>
  <div class="top"><div class="wrap"><a href="${esc(home)}">← ${esc(name)}</a></div></div>
  <article><div class="wrap">
    <h1>${esc(art.h1 || art.meta_title)}</h1>
    ${intro}
    ${toc ? `<nav class="toc"><b>En este artículo</b><ul>${toc}</ul></nav>` : ''}
    ${body}
    <div class="cta-box"><p style="margin-bottom:14px;color:var(--ink)"><b>¿Lo necesitas${city ? ' en ' + esc(city) : ''}?</b> Pide tu cita en ${esc(name)} en un momento.</p><button class="cta" onclick="nfOpenChat()">Pedir cita ahora</button></div>
    ${faqHtml}
  </div></article>
  <footer><div class="wrap">${esc(name)} · Reservas con <a href="https://nodeflow.es" target="_blank" rel="noopener">NodeFlow</a></div></footer>
  <script>function nfOpenChat(){var h=document.querySelector('[data-nodeflow-chat]');if(h&&h.shadowRoot){var b=h.shadowRoot.querySelector('.nf-btn');if(b)b.click();}}</script>
  <script src="${esc(base)}/chat.js" data-nodeflow-org="${esc(org.id)}"></script>
</body></html>`;
}

function setupMicrositeRoutes(app) {
  app.get('/n/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
    if (!slug) return res.status(404).send('No encontrado');
    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).send('No disponible');
      const org = await db.getOrgBySlug(slug);
      if (!org) return res.status(404).send('No encontrado');
      const { hasPro } = require('../billing/plan');
      const cfg = org.automation_config?.config || {};
      if (!hasPro(org) || cfg.micrositeOff === true) return res.status(404).send('No encontrado');
      const base = process.env.PUBLIC_URL || 'https://nodeflow.es';
      const articles = await require('../content/store').listArticles(org.id, 12).catch(() => []);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      return res.send(renderMicrosite(org, base, articles));
    } catch (e) {
      log.warn(`microsite ${slug}: ${e.message}`);
      return res.status(500).send('Error');
    }
  });

  // Artículo dentro del micrositio.
  app.get('/n/:slug/:article', async (req, res) => {
    const slug = String(req.params.slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
    const artSlug = String(req.params.article || '').replace(/[^a-z0-9-]/gi, '').slice(0, 90);
    if (!slug || !artSlug) return res.status(404).send('No encontrado');
    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).send('No disponible');
      const org = await db.getOrgBySlug(slug);
      if (!org) return res.status(404).send('No encontrado');
      const { hasPro } = require('../billing/plan');
      const cfg = org.automation_config?.config || {};
      if (!hasPro(org) || cfg.micrositeOff === true) return res.status(404).send('No encontrado');
      const art = await require('../content/store').getArticle(org.id, artSlug);
      if (!art) return res.status(404).send('No encontrado');
      const base = process.env.PUBLIC_URL || 'https://nodeflow.es';
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=600');
      return res.send(renderArticle(org, art, base));
    } catch (e) {
      log.warn(`microsite article ${slug}/${artSlug}: ${e.message}`);
      return res.status(500).send('Error');
    }
  });

  log.info('Microsite routes configured → GET /n/:slug + /n/:slug/:article');
}

module.exports = { setupMicrositeRoutes, renderMicrosite, renderArticle };
