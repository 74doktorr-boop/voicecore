#!/usr/bin/env node
// ============================================================
// NodeFlow — Blog Post Generator
// Genera posts SEO con GPT-4o y los publica como HTML estático
//
// Uso:
//   node scripts/blog-gen.js                    # siguiente tema del pool
//   node scripts/blog-gen.js --slug <slug>       # tema concreto
//   node scripts/blog-gen.js --list              # ver temas pendientes
//   node scripts/blog-gen.js --dry-run           # solo muestra el contenido
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const ROOT       = path.join(__dirname, '..');
const BLOG_DIR   = path.join(ROOT, 'public', 'blog');
const TOPICS_FILE = path.join(BLOG_DIR, 'topics.json');
const MANIFEST   = path.join(BLOG_DIR, 'manifest.json');
const SITEMAP    = path.join(ROOT, 'public', 'sitemap.xml');

// ── Args ───────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const dryRun     = args.includes('--dry-run');
const listOnly   = args.includes('--list');
const forcedSlug = (() => { const i = args.indexOf('--slug'); return i >= 0 ? args[i+1] : null; })();

// ── Load data ──────────────────────────────────────────────────────────────
const topics   = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { published: [] };

if (listOnly) {
  const pending = topics.filter(t => !manifest.published.includes(t.slug));
  console.log(`\nPending topics (${pending.length}/${topics.length}):\n`);
  pending.forEach(t => console.log(`  - ${t.slug}`));
  console.log(`\nPublished (${manifest.published.length}):\n`);
  manifest.published.forEach(s => console.log(`  ✓ ${s}`));
  process.exit(0);
}

// ── Pick topic ─────────────────────────────────────────────────────────────
let topic;
if (forcedSlug) {
  topic = topics.find(t => t.slug === forcedSlug);
  if (!topic) { console.error(`Topic not found: ${forcedSlug}`); process.exit(1); }
} else {
  const pending = topics.filter(t => !manifest.published.includes(t.slug));
  if (!pending.length) {
    console.log('All topics published. Add more to topics.json');
    process.exit(0);
  }
  topic = pending[0];
}

console.log(`\n📝 Generating: ${topic.slug}\n`);

// ── OpenAI ──────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TODAY = new Date().toISOString().split('T')[0];
const YEAR  = new Date().getFullYear();

async function generatePost(topic) {
  const systemPrompt = `Eres un copywriter SEO experto en marketing digital para pymes españolas.
Escribes en español de España, informal pero profesional.
Siempre menciones NodeFlow como la solución (nodeflow.es) al final.
Nunca uses formato Markdown — devuelves solo el JSON que se te pide.`;

  const userPrompt = `Genera un artículo de blog SEO para NodeFlow (recepcionista virtual IA, nodeflow.es).

Tema: ${topic.title}
Keywords principales: ${topic.keywords.join(', ')}
Enfoque: ${topic.focus}
${topic.city ? `Ciudad objetivo: ${topic.city}` : ''}
${topic.sector ? `Sector objetivo: ${topic.sector}` : ''}

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown, sin bloques de código):
{
  "metaTitle": "título SEO máximo 60 caracteres",
  "metaDescription": "descripción SEO máximo 155 caracteres, incluye keyword principal",
  "h1": "título H1 atractivo",
  "intro": "2-3 párrafos de introducción (texto plano, sin HTML)",
  "sections": [
    {
      "h2": "título de sección",
      "content": "2-3 párrafos de contenido rico (texto plano)"
    }
  ],
  "conclusion": "párrafo de conclusión con CTA hacia NodeFlow",
  "readingMinutes": número entero estimado de minutos de lectura
}

Requisitos:
- 3-4 secciones H2
- Mínimo 800 palabras en total
- Incluye keyword principal en H1, primer párrafo y al menos 2 H2
- Menciona NodeFlow y nodeflow.es de forma natural en la conclusión
- Tono cercano, como un experto explicando a un empresario local`;

  const res = await openai.chat.completions.create({
    model:       'gpt-4o',
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0].message.content);
}

function sectionsToHtml(sections) {
  return sections.map(s => `
    <div class="post-section">
      <h2>${s.h2}</h2>
      ${s.content.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('\n      ')}
    </div>`).join('\n');
}

function buildHtml(topic, post) {
  const url         = `https://nodeflow.es/blog/${topic.slug}`;
  const sectionsHtml = sectionsToHtml(post.sections);
  const introHtml    = post.intro.split('\n').filter(Boolean).map(p => `<p>${p}</p>`).join('\n      ');

  // Build keyword tags for display
  const tagHtml = topic.keywords.slice(0,3).map(k =>
    `<span class="tag">${k}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.metaTitle} | NodeFlow Blog</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="${post.metaDescription}">
  <meta name="keywords" content="${topic.keywords.join(', ')}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="NodeFlow">
  <link rel="canonical" href="${url}">

  <meta property="og:type" content="article">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${post.metaTitle}">
  <meta property="og:description" content="${post.metaDescription}">
  <meta property="og:image" content="https://nodeflow.es/og-image.png">
  <meta property="og:site_name" content="NodeFlow">
  <meta property="article:published_time" content="${TODAY}T10:00:00+01:00">
  <meta property="article:author" content="NodeFlow">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${post.metaTitle}">
  <meta name="twitter:description" content="${post.metaDescription}">
  <meta name="twitter:image" content="https://nodeflow.es/og-image.png">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": "${url}#article",
        "headline": "${post.h1.replace(/"/g, '\\"')}",
        "description": "${post.metaDescription.replace(/"/g, '\\"')}",
        "url": "${url}",
        "datePublished": "${TODAY}",
        "dateModified": "${TODAY}",
        "author": {"@type": "Organization", "name": "NodeFlow", "url": "https://nodeflow.es"},
        "publisher": {
          "@type": "Organization",
          "name": "NodeFlow",
          "url": "https://nodeflow.es",
          "logo": {"@type": "ImageObject", "url": "https://nodeflow.es/favicon.svg"}
        },
        "image": {"@type": "ImageObject", "url": "https://nodeflow.es/og-image.png", "width": 1200, "height": 630},
        "keywords": "${topic.keywords.join(', ')}"
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          {"@type": "ListItem", "position": 1, "name": "NodeFlow", "item": "https://nodeflow.es"},
          {"@type": "ListItem", "position": 2, "name": "Blog", "item": "https://nodeflow.es/blog"},
          {"@type": "ListItem", "position": 3, "name": "${post.h1.replace(/"/g, '\\"')}", "item": "${url}"}
        ]
      }
    ]
  }
  </script>

  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZPKHPG2BLC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZPKHPG2BLC');</script>
  <!-- Plausible -->
  <script defer data-domain="nodeflow.es" src="https://plausible.io/js/script.js"></script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">

  <style>
    :root{--bg:#07070e;--card:#14141e;--accent:#6c5ce7;--accent-l:#a29bfe;--glow:rgba(108,92,231,0.3);--green:#00cec9;--text:#e8e8f0;--dim:#8888a8;--muted:#3a3a52;--border:rgba(255,255,255,0.07);--border-accent:rgba(108,92,231,0.3)}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;overflow-x:hidden}
    .container{max-width:760px;margin:0 auto;padding:0 24px}
    .container-wide{max-width:1100px;margin:0 auto;padding:0 24px}
    a{text-decoration:none;color:inherit}
    .noise{position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025;animation:grain .4s steps(1) infinite}
    @keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-3%,-2%)}40%{transform:translate(2%,3%)}60%{transform:translate(-1%,2%)}80%{transform:translate(3%,-1%)}}
    .orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
    .orb-1{width:600px;height:600px;top:-200px;left:-150px;background:radial-gradient(circle,rgba(108,92,231,0.25) 0%,transparent 70%)}
    nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0;transition:all .4s}
    nav::before{content:'';position:absolute;inset:0;background:rgba(7,7,14,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border)}
    .nav-inner{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}
    .logo{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}
    .logo em{color:var(--accent-l);font-style:normal}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:9px 20px;border-radius:10px;font-size:13px;font-weight:600;transition:all .25s;cursor:pointer;border:none}
    .btn-primary{background:var(--accent);color:#fff;box-shadow:0 4px 20px var(--glow)}
    .btn-primary:hover{background:#7c6cf7;transform:translateY(-1px)}
    .breadcrumb{padding:90px 0 0;position:relative;z-index:2}
    .bc-list{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);flex-wrap:wrap}
    .bc-list a{color:var(--accent-l);transition:color .2s}
    .bc-list a:hover{color:#fff}
    .post-header{padding:32px 0 48px;position:relative;z-index:2}
    .post-tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
    .tag{font-size:11px;padding:4px 10px;border-radius:100px;background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.3);color:var(--accent-l);font-weight:500}
    .post-header h1{font-size:clamp(28px,5vw,52px);font-weight:900;letter-spacing:-2px;line-height:1.1;margin-bottom:18px;color:#fff}
    .post-meta{display:flex;gap:20px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--muted)}
    .post-meta .dot{width:4px;height:4px;border-radius:50%;background:var(--muted)}
    .post-body{padding:0 0 80px;position:relative;z-index:2}
    .post-body p{font-size:17px;line-height:1.8;color:#c8c8d8;margin-bottom:20px}
    .post-body h2{font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-0.8px;margin:44px 0 18px;color:#fff;padding-top:8px;border-top:1px solid var(--border)}
    .post-body h2:first-of-type{border-top:none}
    .post-section{margin-bottom:8px}
    .post-divider{border:none;border-top:1px solid var(--border);margin:48px 0}
    .cta-box{background:linear-gradient(135deg,rgba(108,92,231,0.14),rgba(0,206,201,0.07));border:1px solid var(--border-accent);border-radius:20px;padding:40px;text-align:center;margin:48px 0}
    .cta-box h3{font-size:22px;font-weight:800;margin-bottom:12px}
    .cta-box p{color:var(--dim);margin-bottom:24px;font-size:15px}
    .btn-lg{padding:14px 32px;font-size:15px;border-radius:12px}
    .wa-float{position:fixed;bottom:24px;right:24px;z-index:200;width:56px;height:56px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:28px;text-decoration:none;box-shadow:0 4px 24px rgba(37,211,102,0.5);transition:transform .2s}
    .wa-float:hover{transform:scale(1.1)}
    footer{border-top:1px solid var(--border);padding:32px 0}
    .footer-inner{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center}
    .footer-links{display:flex;gap:16px;flex-wrap:wrap}
    .footer-links a{font-size:13px;color:var(--dim)}
    .footer-links a:hover{color:var(--text)}
    .footer-copy{font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
<div class="noise"></div>
<div class="orb orb-1"></div>

<nav>
  <div class="container-wide">
    <div class="nav-inner">
      <a href="https://nodeflow.es" class="logo">Node<em>Flow</em></a>
      <div style="display:flex;gap:12px;align-items:center">
        <a href="/blog" style="font-size:14px;color:var(--dim)">Blog</a>
        <a href="https://nodeflow.es/#contacto" class="btn btn-primary">Empezar gratis →</a>
      </div>
    </div>
  </div>
</nav>

<div class="breadcrumb">
  <div class="container">
    <nav aria-label="breadcrumb">
      <ol class="bc-list">
        <li><a href="https://nodeflow.es">NodeFlow</a></li>
        <li style="color:var(--muted)">›</li>
        <li><a href="/blog">Blog</a></li>
        <li style="color:var(--muted)">›</li>
        <li aria-current="page" style="color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">${post.h1}</li>
      </ol>
    </nav>
  </div>
</div>

<header class="post-header">
  <div class="container">
    <div class="post-tags">${tagHtml}</div>
    <h1>${post.h1}</h1>
    <div class="post-meta">
      <span>NodeFlow Blog</span>
      <span class="dot"></span>
      <span>${TODAY}</span>
      <span class="dot"></span>
      <span>${post.readingMinutes} min de lectura</span>
    </div>
  </div>
</header>

<article class="post-body">
  <div class="container">
    ${introHtml}
    ${sectionsHtml}

    <hr class="post-divider">

    <div class="cta-box">
      <h3>¿Listo para automatizar tu negocio?</h3>
      <p>NodeFlow configura tu asistente de voz en menos de 24 horas. Sin hardware, sin cambiar tu número de teléfono.</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a href="https://nodeflow.es/#contacto" class="btn btn-primary btn-lg">Empezar gratis 14 días →</a>
        <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20vi%20el%20blog%20de%20NodeFlow%20y%20quiero%20más%20información" class="btn btn-lg" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text)">💬 WhatsApp</a>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-top:14px;margin-bottom:0">Desde 49€/mes · Sin permanencia · Alta en &lt;24h</p>
    </div>
  </div>
</article>

<footer>
  <div class="container-wide">
    <div class="footer-inner">
      <div style="font-weight:700;font-size:15px">⚡ Node<span style="color:var(--accent-l)">Flow</span></div>
      <div class="footer-links">
        <a href="https://nodeflow.es">Inicio</a>
        <a href="/blog">Blog</a>
        <a href="https://nodeflow.es/bilbao">Bilbao</a>
        <a href="https://nodeflow.es/donostia">Donostia</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
      </div>
      <div class="footer-copy">© ${YEAR} NodeFlow · unai@nodeflow.es</div>
    </div>
  </div>
</footer>

<a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20vi%20el%20blog%20de%20NodeFlow" class="wa-float" target="_blank" title="WhatsApp">💬</a>
</body>
</html>`;
}

function addToSitemap(slug) {
  const url     = `https://nodeflow.es/blog/${slug}`;
  const entry   = `
  <url>
    <loc>${url}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.7</priority>
  </url>`;

  let sitemap = fs.readFileSync(SITEMAP, 'utf8');
  if (sitemap.includes(url)) return; // already present

  // Insert before </urlset>
  sitemap = sitemap.replace('</urlset>', `${entry}\n</urlset>`);
  fs.writeFileSync(SITEMAP, sitemap, 'utf8');
  console.log(`✓ Sitemap updated`);
}

function updateManifest(topic, post) {
  if (!manifest.published.includes(topic.slug)) {
    manifest.published.push(topic.slug);
  }
  // Also keep a posts list for the blog index
  if (!manifest.posts) manifest.posts = [];
  const existing = manifest.posts.findIndex(p => p.slug === topic.slug);
  const entry = {
    slug:        topic.slug,
    title:       post.h1,
    metaTitle:   post.metaTitle,
    description: post.metaDescription,
    date:        TODAY,
    keywords:    topic.keywords,
    sector:      topic.sector || null,
    city:        topic.city || null,
    readingMinutes: post.readingMinutes,
  };
  if (existing >= 0) manifest.posts[existing] = entry;
  else manifest.posts.unshift(entry);

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✓ Manifest updated`);
}

function buildBlogIndex() {
  if (!manifest.posts || !manifest.posts.length) return;

  const postsHtml = manifest.posts.map(p => `
      <a href="/blog/${p.slug}" class="post-card">
        <div class="post-card-meta">
          ${p.city ? `<span class="tag">${p.city}</span>` : ''}
          ${p.sector ? `<span class="tag">${p.sector}</span>` : ''}
          <span style="margin-left:auto;color:var(--muted);font-size:12px">${p.date}</span>
        </div>
        <h2>${p.title}</h2>
        <p>${p.description}</p>
        <span class="read-more">Leer artículo → <span style="color:var(--muted);font-size:12px">${p.readingMinutes} min</span></span>
      </a>`).join('');

  const YEAR = new Date().getFullYear();
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog NodeFlow — IA para negocios del País Vasco y Galicia</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="Guías y artículos sobre IA para negocios: recepcionistas virtuales, automatización de llamadas, citas automáticas. Para pymes del País Vasco y Galicia.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://nodeflow.es/blog">
  <meta property="og:title" content="Blog NodeFlow — IA para negocios">
  <meta property="og:description" content="Guías sobre recepcionistas virtuales, automatización de llamadas y IA para pymes.">
  <meta property="og:url" content="https://nodeflow.es/blog">
  <meta property="og:image" content="https://nodeflow.es/og-image.png">
  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZPKHPG2BLC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZPKHPG2BLC');</script>
  <!-- Plausible -->
  <script defer data-domain="nodeflow.es" src="https://plausible.io/js/script.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#07070e;--card:#14141e;--card-hover:#1c1c28;--accent:#6c5ce7;--accent-l:#a29bfe;--glow:rgba(108,92,231,0.3);--green:#00cec9;--text:#e8e8f0;--dim:#8888a8;--muted:#3a3a52;--border:rgba(255,255,255,0.07);--border-accent:rgba(108,92,231,0.3)}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden}
    .container{max-width:1100px;margin:0 auto;padding:0 24px}
    a{text-decoration:none;color:inherit}
    .noise{position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025;animation:grain .4s steps(1) infinite}
    @keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-3%,-2%)}40%{transform:translate(2%,3%)}60%{transform:translate(-1%,2%)}80%{transform:translate(3%,-1%)}}
    .orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}
    .orb-1{width:700px;height:700px;top:-250px;left:-200px;background:radial-gradient(circle,rgba(108,92,231,0.25) 0%,transparent 70%)}
    nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0}
    nav::before{content:'';position:absolute;inset:0;background:rgba(7,7,14,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border)}
    .nav-inner{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}
    .logo{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}
    .logo em{color:var(--accent-l);font-style:normal}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:9px 20px;border-radius:10px;font-size:13px;font-weight:600;transition:all .25s;border:none}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-primary:hover{background:#7c6cf7;transform:translateY(-1px)}
    .hero{padding:110px 0 60px;position:relative;z-index:2;text-align:center}
    .hero h1{font-size:clamp(32px,5vw,56px);font-weight:900;letter-spacing:-2px;margin-bottom:14px}
    .hero p{color:var(--dim);font-size:17px;max-width:520px;margin:0 auto}
    .posts-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;padding:40px 0 80px;position:relative;z-index:2}
    @media(max-width:600px){.posts-grid{grid-template-columns:1fr}}
    .post-card{background:var(--card);border:1px solid var(--border);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:12px;transition:all .3s;color:var(--text)}
    .post-card:hover{border-color:var(--border-accent);transform:translateY(-4px);background:var(--card-hover)}
    .post-card-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .tag{font-size:11px;padding:3px 9px;border-radius:100px;background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.3);color:var(--accent-l);font-weight:500}
    .post-card h2{font-size:18px;font-weight:700;letter-spacing:-0.4px;line-height:1.3}
    .post-card p{font-size:14px;color:var(--dim);line-height:1.65;flex:1}
    .read-more{font-size:13px;font-weight:600;color:var(--accent-l)}
    footer{border-top:1px solid var(--border);padding:32px 0}
    .footer-inner{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center}
    .footer-links{display:flex;gap:16px;flex-wrap:wrap}
    .footer-links a{font-size:13px;color:var(--dim)}
    .footer-links a:hover{color:var(--text)}
    .footer-copy{font-size:12px;color:var(--muted)}
  </style>
</head>
<body>
<div class="noise"></div>
<div class="orb orb-1"></div>
<nav>
  <div class="container">
    <div class="nav-inner">
      <a href="https://nodeflow.es" class="logo">Node<em>Flow</em></a>
      <a href="https://nodeflow.es/#contacto" class="btn btn-primary">Empezar gratis →</a>
    </div>
  </div>
</nav>
<section class="hero">
  <div class="container">
    <h1>Blog <span style="color:var(--accent-l)">NodeFlow</span></h1>
    <p>Guías prácticas sobre IA para negocios: recepcionistas virtuales, automatización de llamadas y más.</p>
  </div>
</section>
<main>
  <div class="container">
    <div class="posts-grid">
      ${postsHtml}
    </div>
  </div>
</main>
<footer>
  <div class="container">
    <div class="footer-inner">
      <div style="font-weight:700;font-size:15px">⚡ Node<span style="color:var(--accent-l)">Flow</span></div>
      <div class="footer-links">
        <a href="https://nodeflow.es">Inicio</a>
        <a href="https://nodeflow.es/bilbao">Bilbao</a>
        <a href="https://nodeflow.es/donostia">Donostia</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
      </div>
      <div class="footer-copy">© ${YEAR} NodeFlow · unai@nodeflow.es</div>
    </div>
  </div>
</footer>
</body>
</html>`;

  fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), html, 'utf8');
  console.log(`✓ Blog index updated (${manifest.posts.length} posts)`);
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(`Calling OpenAI for "${topic.title}"...`);
    const post = await generatePost(topic);

    if (dryRun) {
      console.log('\n─── DRY RUN OUTPUT ───\n');
      console.log(JSON.stringify(post, null, 2));
      process.exit(0);
    }

    // Create post directory
    const postDir = path.join(BLOG_DIR, topic.slug);
    if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });

    // Write HTML
    const html = buildHtml(topic, post);
    fs.writeFileSync(path.join(postDir, 'index.html'), html, 'utf8');
    console.log(`✓ Written: public/blog/${topic.slug}/index.html`);

    // Update sitemap
    addToSitemap(topic.slug);

    // Update manifest + blog index
    updateManifest(topic, post);
    buildBlogIndex();

    console.log(`\n✅ Published: https://nodeflow.es/blog/${topic.slug}\n`);
  } catch (e) {
    console.error('Generation failed:', e.message);
    process.exit(1);
  }
})();
