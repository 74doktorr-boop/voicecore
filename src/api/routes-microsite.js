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

function renderMicrosite(org, base) {
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

  <footer><div class="wrap">
    ${phone ? `${esc(name)} · <a href="tel:${esc(phone)}">${esc(phone)}</a> · ` : `${esc(name)} · `}
    Reservas con <a href="https://nodeflow.es" target="_blank" rel="noopener">NodeFlow</a>
  </div></footer>

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
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      return res.send(renderMicrosite(org, base));
    } catch (e) {
      log.warn(`microsite ${slug}: ${e.message}`);
      return res.status(500).send('Error');
    }
  });

  log.info('Microsite routes configured → GET /n/:slug');
}

module.exports = { setupMicrositeRoutes, renderMicrosite };
