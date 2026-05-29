#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate 13 pending blog articles for NodeFlow SEO sprint."""
import os, json

BASE = r"C:\Users\unais\.gemini\antigravity\scratch\voicecore\public\blog"

def html(a):
    slug = a['slug']
    title = a['title']
    h1 = a['h1']
    meta_desc = a['meta_desc']
    keywords = a['keywords']
    section = a['section']
    s1_id, s1_h = a['s1']
    s2_id, s2_h = a['s2']
    s3_id, s3_h = a['s3']
    s4_id, s4_h = a['s4']
    s5_id, s5_h = a['s5']
    intro = a['intro']
    cta_title = a['cta_title']
    cta_body = a['cta_body']
    fq1, fa1 = a['faq'][0]
    fq2, fa2 = a['faq'][1]
    fq3, fa3 = a['faq'][2]
    fq4, fa4 = a['faq'][3]
    rels = a['related']
    kw_tags = ''.join(f'<span class="tag">{k.strip()}</span>' for k in keywords.split(','))

    # Build related links HTML
    rel_links = '\n'.join(f'        <a href="{r[0]}" class="related-link">{r[1]}</a>' for r in rels)

    # Short title for OG (strip " | NodeFlow Blog")
    og_title = title.replace(' | NodeFlow Blog', '')

    return f'''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="{meta_desc}">
  <meta name="keywords" content="{keywords}">
  <meta name="robots" content="index, follow">
  <meta name="author" content="NodeFlow">
  <link rel="canonical" href="https://nodeflow.es/blog/{slug}">

  <meta property="og:type" content="article">
  <meta property="og:url" content="https://nodeflow.es/blog/{slug}">
  <meta property="og:title" content="{og_title}">
  <meta property="og:description" content="{meta_desc}">
  <meta property="og:image" content="https://nodeflow.es/og-image.png">
  <meta property="og:site_name" content="NodeFlow">
  <meta property="article:published_time" content="2026-05-29T09:00:00+02:00">
  <meta property="article:author" content="NodeFlow">
  <meta property="article:section" content="{section}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{og_title}">
  <meta name="twitter:description" content="{meta_desc}">
  <meta name="twitter:image" content="https://nodeflow.es/og-image.png">

  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@graph": [
      {{
        "@type": "Article",
        "@id": "https://nodeflow.es/blog/{slug}#article",
        "headline": "{og_title}",
        "description": "{meta_desc}",
        "url": "https://nodeflow.es/blog/{slug}",
        "datePublished": "2026-05-29",
        "dateModified": "2026-05-29",
        "author": {{"@type": "Organization", "name": "NodeFlow", "url": "https://nodeflow.es"}},
        "publisher": {{
          "@type": "Organization",
          "name": "NodeFlow",
          "url": "https://nodeflow.es",
          "logo": {{"@type": "ImageObject", "url": "https://nodeflow.es/favicon.svg"}}
        }},
        "image": {{"@type": "ImageObject", "url": "https://nodeflow.es/og-image.png", "width": 1200, "height": 630}},
        "keywords": "{keywords}",
        "wordCount": 1100,
        "timeRequired": "PT5M"
      }},
      {{
        "@type": "BreadcrumbList",
        "itemListElement": [
          {{"@type": "ListItem", "position": 1, "name": "NodeFlow", "item": "https://nodeflow.es"}},
          {{"@type": "ListItem", "position": 2, "name": "Blog", "item": "https://nodeflow.es/blog"}},
          {{"@type": "ListItem", "position": 3, "name": "{og_title}", "item": "https://nodeflow.es/blog/{slug}"}}
        ]
      }},
      {{
        "@type": "FAQPage",
        "mainEntity": [
          {{
            "@type": "Question",
            "name": "{fq1}",
            "acceptedAnswer": {{"@type": "Answer", "text": "{fa1}"}}
          }},
          {{
            "@type": "Question",
            "name": "{fq2}",
            "acceptedAnswer": {{"@type": "Answer", "text": "{fa2}"}}
          }},
          {{
            "@type": "Question",
            "name": "{fq3}",
            "acceptedAnswer": {{"@type": "Answer", "text": "{fa3}"}}
          }},
          {{
            "@type": "Question",
            "name": "{fq4}",
            "acceptedAnswer": {{"@type": "Answer", "text": "{fa4}"}}
          }}
        ]
      }}
    ]
  }}
  </script>

  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZPKHPG2BLC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-ZPKHPG2BLC');</script>
  <!-- Plausible -->
  <script defer data-domain="nodeflow.es" src="https://plausible.io/js/script.js"></script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">

  <style>
    :root{{--bg:#07070e;--card:#14141e;--accent:#6c5ce7;--accent-l:#a29bfe;--glow:rgba(108,92,231,0.3);--green:#00cec9;--text:#e8e8f0;--dim:#8888a8;--muted:#3a3a52;--border:rgba(255,255,255,0.07);--border-accent:rgba(108,92,231,0.3)}}
    *,*::before,*::after{{margin:0;padding:0;box-sizing:border-box}}
    html{{scroll-behavior:smooth}}
    body{{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;overflow-x:hidden}}
    .container{{max-width:760px;margin:0 auto;padding:0 24px}}
    .container-wide{{max-width:1100px;margin:0 auto;padding:0 24px}}
    a{{text-decoration:none;color:inherit}}
    .progress-bar{{position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,var(--accent),var(--green));z-index:9999;transition:width .1s linear;width:0%}}
    .noise{{position:fixed;inset:0;z-index:9998;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025;animation:grain .4s steps(1) infinite}}
    @keyframes grain{{0%{{transform:translate(0,0)}}20%{{transform:translate(-3%,-2%)}}40%{{transform:translate(2%,3%)}}60%{{transform:translate(-1%,2%)}}80%{{transform:translate(3%,-1%)}}}}
    .orb{{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0}}
    .orb-1{{width:600px;height:600px;top:-200px;left:-150px;background:radial-gradient(circle,rgba(108,92,231,0.25) 0%,transparent 70%)}}
    nav{{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0;transition:all .4s}}
    nav::before{{content:'';position:absolute;inset:0;background:rgba(7,7,14,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border)}}
    .nav-inner{{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}}
    .logo{{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}}
    .logo em{{color:var(--accent-l);font-style:normal}}
    .btn{{display:inline-flex;align-items:center;gap:8px;padding:9px 20px;border-radius:10px;font-size:13px;font-weight:600;transition:all .25s;cursor:pointer;border:none}}
    .btn-primary{{background:var(--accent);color:#fff;box-shadow:0 4px 20px var(--glow)}}
    .btn-primary:hover{{background:#7c6cf7;transform:translateY(-1px)}}
    .breadcrumb{{padding:90px 0 0;position:relative;z-index:2}}
    .bc-list{{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);flex-wrap:wrap;list-style:none}}
    .bc-list a{{color:var(--accent-l);transition:color .2s}}
    .bc-list a:hover{{color:#fff}}
    .post-header{{padding:32px 0 40px;position:relative;z-index:2}}
    .post-tags{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}}
    .tag{{font-size:11px;padding:4px 10px;border-radius:100px;background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.3);color:var(--accent-l);font-weight:500}}
    .post-header h1{{font-size:clamp(26px,5vw,50px);font-weight:900;letter-spacing:-2px;line-height:1.1;margin-bottom:18px;color:#fff}}
    .post-meta{{display:flex;gap:20px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--muted)}}
    .post-meta .dot{{width:4px;height:4px;border-radius:50%;background:var(--muted);flex-shrink:0}}
    .toc{{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 26px;margin:0 0 40px}}
    .toc-title{{font-weight:700;font-size:13px;color:var(--accent-l);letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px}}
    .toc ol{{padding-left:20px;display:flex;flex-direction:column;gap:6px}}
    .toc li{{font-size:14px}}
    .toc a{{color:var(--dim);transition:color .2s}}
    .toc a:hover{{color:var(--accent-l)}}
    .post-body{{padding:0 0 80px;position:relative;z-index:2}}
    .post-body p{{font-size:17px;line-height:1.85;color:#c8c8d8;margin-bottom:22px}}
    .post-body h2{{font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-0.8px;margin:52px 0 18px;color:#fff;padding-top:8px;border-top:1px solid var(--border);scroll-margin-top:90px}}
    .post-body h2:first-of-type{{border-top:none}}
    .post-section{{margin-bottom:8px}}
    .post-divider{{border:none;border-top:1px solid var(--border);margin:48px 0}}
    .cta-mid{{background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.2);border-radius:14px;padding:24px 28px;margin:40px 0;display:flex;align-items:center;gap:20px;flex-wrap:wrap}}
    .cta-mid p{{color:var(--dim);font-size:14px;flex:1;min-width:200px;margin:0}}
    .cta-mid strong{{color:var(--text);display:block;margin-bottom:4px;font-size:15px}}
    .cta-box{{background:linear-gradient(135deg,rgba(108,92,231,0.14),rgba(0,206,201,0.07));border:1px solid var(--border-accent);border-radius:20px;padding:44px 40px;text-align:center;margin:48px 0}}
    .cta-box h3{{font-size:24px;font-weight:900;margin-bottom:12px;letter-spacing:-0.5px}}
    .cta-box p{{color:var(--dim);margin-bottom:24px;font-size:15px}}
    .btn-lg{{padding:14px 32px;font-size:15px;border-radius:12px}}
    .faq-section{{margin:48px 0}}
    .faq-section>h2{{font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-0.8px;margin-bottom:24px;color:#fff;padding-top:8px;border-top:1px solid var(--border);scroll-margin-top:90px}}
    .faq-list{{display:flex;flex-direction:column;gap:8px}}
    .faq-item{{border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s}}
    .faq-item:hover{{border-color:rgba(108,92,231,0.3)}}
    .faq-q{{width:100%;background:var(--card);border:none;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;cursor:pointer;text-align:left;color:var(--text);font-size:15px;font-weight:600;font-family:inherit;transition:background .2s}}
    .faq-q:hover{{background:#1c1c28}}
    .faq-icon{{color:var(--accent-l);font-size:20px;font-weight:300;flex-shrink:0;transition:transform .3s}}
    .faq-a{{max-height:0;overflow:hidden;transition:max-height .35s ease,padding .3s}}
    .faq-a.open{{max-height:300px;padding:4px 22px 18px}}
    .faq-a p{{font-size:15px;color:var(--dim);line-height:1.7;margin:0}}
    .related-links{{margin:40px 0;padding:24px;background:var(--card);border:1px solid var(--border);border-radius:14px}}
    .related-grid{{display:flex;flex-wrap:wrap;gap:10px}}
    .related-link{{font-size:13px;padding:8px 16px;border:1px solid var(--border);border-radius:8px;color:var(--accent-l);transition:all .2s;background:rgba(108,92,231,0.05)}}
    .related-link:hover{{border-color:var(--border-accent);background:rgba(108,92,231,0.12)}}
    .wa-float{{position:fixed;bottom:24px;right:24px;z-index:200;width:56px;height:56px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:28px;text-decoration:none;box-shadow:0 4px 24px rgba(37,211,102,0.5);transition:transform .2s}}
    .wa-float:hover{{transform:scale(1.1)}}
    footer{{border-top:1px solid var(--border);padding:32px 0}}
    .footer-inner{{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center}}
    .footer-links{{display:flex;gap:16px;flex-wrap:wrap}}
    .footer-links a{{font-size:13px;color:var(--dim)}}
    .footer-links a:hover{{color:var(--text)}}
    .footer-copy{{font-size:12px;color:var(--muted)}}
  </style>
</head>
<body>
<div class="progress-bar" id="pb"></div>
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
        <li aria-hidden="true" style="color:var(--muted)">›</li>
        <li><a href="/blog">Blog</a></li>
        <li aria-hidden="true" style="color:var(--muted)">›</li>
        <li aria-current="page" style="color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">{og_title}</li>
      </ol>
    </nav>
  </div>
</div>

<header class="post-header">
  <div class="container">
    <div class="post-tags">{kw_tags}</div>
    <h1>{h1}</h1>
    <div class="post-meta">
      <span>NodeFlow Blog</span>
      <span class="dot"></span>
      <time datetime="2026-05-29">2026-05-29</time>
      <span class="dot"></span>
      <span>5 min de lectura</span>
    </div>
  </div>
</header>

<article class="post-body" itemscope itemtype="https://schema.org/Article">
  <div class="container">

    <nav class="toc" aria-label="Tabla de contenidos">
      <div class="toc-title">📋 En este artículo</div>
      <ol>
        <li><a href="#{s1_id}">{s1_h}</a></li>
        <li><a href="#{s2_id}">{s2_h}</a></li>
        <li><a href="#{s3_id}">{s3_h}</a></li>
        <li><a href="#{s4_id}">{s4_h}</a></li>
        <li><a href="#{s5_id}">{s5_h}</a></li>
        <li><a href="#faq">Preguntas frecuentes</a></li>
      </ol>
    </nav>

    <p>{intro}</p>

    <div class="cta-mid">
      <div>
        <strong>{cta_title}</strong>
        <p>{cta_body}</p>
      </div>
      <a href="https://nodeflow.es/#contacto" class="btn btn-primary" style="white-space:nowrap">Ver planes →</a>
    </div>

    <div class="post-section" id="{s1_id}">
      <h2>{s1_h}</h2>
      <p>La gestión telefónica es uno de los principales cuellos de botella para negocios como el tuyo. Cada llamada no atendida puede significar un cliente perdido, y la acumulación de estas pérdidas tiene un impacto real en la facturación mensual. La tecnología de IA de voz permite resolver este problema de forma definitiva, sin contratar más personal.</p>
      <p>Con un asistente de voz IA, cada llamada se atiende al instante, independientemente del horario o la carga de trabajo del equipo. El asistente gestiona las consultas más frecuentes, agenda citas y recoge información de los clientes, todo de forma automática y en el idioma que el cliente prefiera.</p>
    </div>

    <div class="post-section" id="{s2_id}">
      <h2>{s2_h}</h2>
      <p>La implementación de IA en la gestión de llamadas no requiere cambios en la infraestructura actual. NodeFlow se configura como un desvío de llamadas desde tu número existente, por lo que el cliente sigue llamando al mismo número de siempre. La diferencia es que ahora siempre hay alguien disponible para atender.</p>
      <p>El asistente aprende de los documentos e información que tú le proporcionas: horarios, servicios, precios, preguntas frecuentes. Cuanto más específica es la información, más precisas son las respuestas. La base de conocimiento se actualiza sin programación, simplemente subiendo o editando documentos en el portal.</p>
    </div>

    <div class="post-section" id="{s3_id}">
      <h2>{s3_h}</h2>
      <p>Los recordatorios automáticos son uno de los retornos de inversión más rápidos de cualquier sistema de automatización. Un cliente que recibe un recordatorio 24 horas antes de su cita tiene entre un 40 y un 60% menos de probabilidades de no presentarse. En sectores donde una cita perdida supone entre 30 y 120 minutos de tiempo no facturado, el impacto es inmediato.</p>
      <p>Más allá de los recordatorios de cita, el sistema puede configurarse para enviar recordatorios de renovación, revisión periódica o seguimiento post-servicio. Esto transforma la relación con el cliente de transaccional a continua, generando fidelización sin esfuerzo adicional del equipo.</p>
    </div>

    <div class="post-section" id="{s4_id}">
      <h2>{s4_h}</h2>
      <p>La integración del asistente IA con los flujos de trabajo existentes es más sencilla de lo que parece. El punto de partida más habitual es la integración con Google Calendar para la gestión de agenda, que se configura en menos de una hora y permite al asistente consultar disponibilidad real y reservar citas directamente.</p>
      <p>Para negocios con requisitos más específicos, NodeFlow ofrece integraciones adicionales con software de gestión sectorial, CRMs y sistemas de notificación por WhatsApp o email. Cada integración se evalúa caso por caso para garantizar que encaja con los procesos actuales del negocio.</p>
    </div>

    <div class="post-section" id="{s5_id}">
      <h2>{s5_h}</h2>
      <p>El retorno de inversión de un asistente IA de voz se calcula en base a tres factores: llamadas recuperadas, no-shows reducidos y tiempo de personal liberado. En la mayoría de los negocios, la combinación de estos tres factores genera un ROI positivo en el primer mes de uso.</p>
      <p>El plan Negocio de NodeFlow cuesta 49€/mes. Si el asistente recupera una sola venta o cita perdida al mes que de otra forma se habría ido a la competencia, el coste queda cubierto. La realidad es que la mayoría de los negocios recuperan entre 5 y 20 oportunidades adicionales cada mes, lo que supone un retorno muy superior al coste de la solución.</p>
    </div>

    <hr class="post-divider">

    <section class="faq-section" id="faq" itemscope itemtype="https://schema.org/FAQPage">
      <h2>Preguntas frecuentes</h2>
      <div class="faq-list">
        <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
          <button class="faq-q" onclick="toggleFaq(0)" aria-expanded="false" aria-controls="faq-a-0">
            <span itemprop="name">{fq1}</span>
            <span class="faq-icon" id="faq-icon-0">+</span>
          </button>
          <div class="faq-a" id="faq-a-0" role="region" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
            <p itemprop="text">{fa1}</p>
          </div>
        </div>
        <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
          <button class="faq-q" onclick="toggleFaq(1)" aria-expanded="false" aria-controls="faq-a-1">
            <span itemprop="name">{fq2}</span>
            <span class="faq-icon" id="faq-icon-1">+</span>
          </button>
          <div class="faq-a" id="faq-a-1" role="region" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
            <p itemprop="text">{fa2}</p>
          </div>
        </div>
        <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
          <button class="faq-q" onclick="toggleFaq(2)" aria-expanded="false" aria-controls="faq-a-2">
            <span itemprop="name">{fq3}</span>
            <span class="faq-icon" id="faq-icon-2">+</span>
          </button>
          <div class="faq-a" id="faq-a-2" role="region" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
            <p itemprop="text">{fa3}</p>
          </div>
        </div>
        <div class="faq-item" itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
          <button class="faq-q" onclick="toggleFaq(3)" aria-expanded="false" aria-controls="faq-a-3">
            <span itemprop="name">{fq4}</span>
            <span class="faq-icon" id="faq-icon-3">+</span>
          </button>
          <div class="faq-a" id="faq-a-3" role="region" itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">
            <p itemprop="text">{fa4}</p>
          </div>
        </div>
      </div>
    </section>

    <div class="related-links">
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600">Páginas relacionadas</p>
      <div class="related-grid">
{rel_links}
        <a href="/blog" class="related-link">Más artículos en el blog →</a>
      </div>
    </div>

    <div class="cta-box">
      <h3>¿Listo para no perder ni una llamada más?</h3>
      <p>NodeFlow configura tu asistente de voz IA en menos de 24 horas. Sin hardware, sin cambiar tu número de teléfono. Desde 49€/mes.</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
        <a href="https://nodeflow.es/#contacto" class="btn btn-primary btn-lg">Empezar gratis 14 días →</a>
        <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20vi%20el%20blog%20de%20NodeFlow%20y%20quiero%20m%C3%A1s%20informaci%C3%B3n" class="btn btn-lg" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:var(--text)">💬 WhatsApp</a>
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
        <a href="https://nodeflow.es/vitoria">Vitoria</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
      </div>
      <div class="footer-copy">© 2026 NodeFlow · unai@nodeflow.es</div>
    </div>
  </div>
</footer>

<a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20vi%20el%20blog%20de%20NodeFlow" class="wa-float" target="_blank" rel="noopener" title="WhatsApp NodeFlow">💬</a>

<script>
(function(){{
  var pb=document.getElementById('pb');
  if(!pb)return;
  function upd(){{
    var s=document.documentElement,b=document.body;
    var st=s.scrollTop||b.scrollTop;
    var sh=s.scrollHeight||b.scrollHeight;
    var ch=s.clientHeight||b.clientHeight;
    var pct=sh-ch>0?(st/(sh-ch)*100):100;
    pb.style.width=Math.min(pct,100)+'%';
  }}
  window.addEventListener('scroll',upd,{{passive:true}});
  upd();
}})();

function toggleFaq(i){{
  var a=document.getElementById('faq-a-'+i);
  var ic=document.getElementById('faq-icon-'+i);
  var btn=a.previousElementSibling;
  var isOpen=a.classList.contains('open');
  document.querySelectorAll('.faq-a').forEach(function(el,idx){{
    el.classList.remove('open');
    var icon=document.getElementById('faq-icon-'+idx);
    if(icon)icon.style.transform='';
    el.previousElementSibling.setAttribute('aria-expanded','false');
  }});
  if(!isOpen){{
    a.classList.add('open');
    if(ic)ic.style.transform='rotate(45deg)';
    btn.setAttribute('aria-expanded','true');
  }}
}}
</script>
</body>
</html>'''

ARTICLES = [
    {
        'slug': 'asistente-ia-clinica-dental-donostia',
        'title': 'Asistente IA para clínicas dentales en Donostia-San Sebastián | NodeFlow Blog',
        'h1': 'Asistente IA para clínicas dentales en Donostia-San Sebastián',
        'meta_desc': 'Cómo las clínicas dentales de Donostia automatizan citas, recordatorios y consultas sobre seguros con IA. Sin perder una llamada.',
        'keywords': 'asistente IA clínica dental Donostia, recepcionista virtual dental San Sebastián, automatizar citas dentista IA',
        'section': 'clinicas',
        's1': ('s1', 'Las clínicas dentales de Donostia pierden citas por teléfono no atendido'),
        's2': ('s2', 'IA que agenda en castellano y euskera: la realidad de Donostia-San Sebastián'),
        's3': ('s3', 'Recordatorios automáticos de revisiones y limpiezas dentales'),
        's4': ('s4', 'Gestión de urgencias dentales fuera de horario'),
        's5': ('s5', 'Integración con seguros: Adeslas, Sanitas, DKV en una clínica donostiarra'),
        'intro': 'Donostia-San Sebastián concentra una de las mayores densidades de clínicas dentales del País Vasco. La competencia es alta y la diferencia entre conseguir un nuevo paciente o perderlo a la clínica del barrio suele reducirse a quién contesta el teléfono más rápido. El problema es que el dentista, el higienista y el auxiliar están siempre ocupados cuando suena el teléfono.',
        'cta_title': '¿Tu clínica dental en Donostia pierde llamadas?',
        'cta_body': 'NodeFlow atiende al instante en castellano y euskera, agenda citas y gestiona recordatorios. Alta en menos de 24 horas.',
        'faq': [
            ('¿El asistente habla en euskera con naturalidad?', 'Sí. NodeFlow atiende en castellano y euskera de forma nativa, detectando automáticamente el idioma del paciente. Las voces son de locutores vascos reales, no síntesis genérica. Esencial para clínicas en Donostia donde muchos pacientes prefieren el euskera.'),
            ('¿Puede gestionar urgencias dentales a las 11 de la noche?', 'El asistente está activo 24/7. Fuera de horario, informa al paciente de las opciones disponibles, recoge sus datos y notifica al dentista de guardia por WhatsApp. Si la urgencia requiere atención inmediata, puede facilitar el número de urgencias.'),
            ('¿Funciona con seguros como Adeslas o Sanitas?', 'Sí. Configuras los seguros con los que trabajas y el asistente responde automáticamente sobre coberturas, copagos y si necesitan volante previo. Para casos específicos o autorizaciones, deriva al personal de la clínica.'),
            ('¿Cuánto tiempo lleva la configuración inicial?', 'El alta estándar tarda menos de 24 horas. Se necesita información básica: nombre de la clínica, horarios, servicios y seguros aceptados. Sin hardware adicional, sin cambiar tu número de teléfono.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas dentales →'),
            ('/blog/recepcionista-ia-clinica-dental-bilbao', 'IA dental en Bilbao →'),
            ('/blog/asistente-voz-clinica-dental-pais-vasco', 'IA dental en el País Vasco →'),
        ],
    },
    {
        'slug': 'recepcionista-ia-clinica-dental-vitoria',
        'title': 'Recepcionista IA para clínicas dentales en Vitoria-Gasteiz | NodeFlow Blog',
        'h1': 'Recepcionista IA para clínicas dentales en Vitoria-Gasteiz',
        'meta_desc': 'Las clínicas dentales de Vitoria-Gasteiz automatizan la recepción de llamadas, citas y recordatorios con IA. Solución local sin cambiar tu número.',
        'keywords': 'recepcionista IA clínica dental Vitoria, asistente virtual dentista Gasteiz, automatizar llamadas dental Álava',
        'section': 'clinicas',
        's1': ('s1', 'El reto de la clínica dental en Vitoria: atender sin interrumpir al dentista'),
        's2': ('s2', 'Atención bilingüe en Vitoria: castellano y euskera desde el primer segundo'),
        's3': ('s3', 'Recordatorios automáticos que reducen no-shows en clínicas vitorianas'),
        's4': ('s4', 'Gestión de primeras consultas y presupuestos por teléfono'),
        's5': ('s5', 'ROI mensual para una clínica dental mediana en Álava'),
        'intro': 'Vitoria-Gasteiz tiene una de las tasas más altas de clínicas dentales por habitante de Euskadi. Para una clínica mediana con 3-4 dentistas, gestionar el teléfono sin interrumpir las sesiones clínicas es uno de los principales cuellos de botella operativos. Un paciente que no puede reservar en el primer intento rara vez llama una segunda vez.',
        'cta_title': '¿Tu clínica dental en Vitoria necesita recepcionista IA?',
        'cta_body': 'NodeFlow gestiona todas las llamadas de tu clínica dental en Vitoria, en castellano y euskera. Configúralo en menos de 24 horas.',
        'faq': [
            ('¿Puede el asistente gestionar la agenda de varios dentistas?', 'Sí. En la configuración puedes asignar servicios a dentistas específicos y definir su disponibilidad por separado. El asistente prioriza al dentista habitual del paciente y solo busca alternativas si no hay disponibilidad.'),
            ('¿Cómo se integra con nuestro software de gestión dental?', 'NodeFlow se integra con Google Calendar para la agenda. Para integraciones con software específico de gestión dental (Gesden, Clinicdent, etc.), consúltanos — estudiamos cada caso y solemos tener solución en pocas semanas.'),
            ('¿El asistente informa sobre tratamientos y precios?', 'El asistente puede responder sobre los tratamientos que ofreces y los precios orientativos que configures. Para presupuestos personalizados, recoge los datos del paciente y programa una llamada con el dentista o la coordinadora de tratamientos.'),
            ('¿Cuánto cuesta para una clínica dental en Vitoria?', 'El plan Negocio cuesta 49€/mes e incluye 500 minutos de llamadas, atención en castellano y euskera, y todas las automatizaciones de recordatorios y rebooking. Sin permanencia, con 14 días de prueba gratuita.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas dentales →'),
            ('/blog/recepcionista-ia-clinica-dental-bilbao', 'IA dental en Bilbao →'),
            ('/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia', 'IA con seguros privados →'),
        ],
    },
    {
        'slug': 'recepcionista-ia-farmacia-bilbao',
        'title': 'Recepcionista IA para farmacias en Bilbao: turnos, horarios y consultas | NodeFlow Blog',
        'h1': 'Recepcionista IA para farmacias en Bilbao: turnos, horarios y consultas',
        'meta_desc': 'Las farmacias de Bilbao usan IA para informar de turnos de guardia, horarios, disponibilidad de medicamentos y consultas básicas. Sin espera, 24/7.',
        'keywords': 'recepcionista IA farmacia Bilbao, asistente virtual farmacia Bizkaia, farmacia guardia IA Bilbao',
        'section': 'farmacias',
        's1': ('s1', 'Las farmacias de Bilbao reciben decenas de llamadas repetitivas al día'),
        's2': ('s2', 'IA que informa de turnos de guardia y horarios en tiempo real'),
        's3': ('s3', 'Consultas sobre disponibilidad de medicamentos sin molestar al farmacéutico'),
        's4': ('s4', 'Atención en euskera: esencial en los barrios de Bilbao'),
        's5': ('s5', 'Cómo implantar un asistente IA en una farmacia bilbaína'),
        'intro': 'Una farmacia media en Bilbao recibe entre 20 y 50 llamadas diarias. La mayoría preguntan lo mismo: si están de guardia esta noche, si tienen tal medicamento, o a qué hora cierran. Son preguntas que consumen tiempo del farmacéutico cuando está atendiendo en mostrador, preparando pedidos o asesorando sobre interacciones medicamentosas.',
        'cta_title': '¿Tu farmacia en Bilbao recibe demasiadas llamadas repetitivas?',
        'cta_body': 'NodeFlow responde automáticamente sobre turnos, horarios y disponibilidad. El farmacéutico solo interviene cuando de verdad hace falta.',
        'faq': [
            ('¿Puede actualizar los turnos de guardia automáticamente?', 'Los turnos de guardia se configuran en el portal de NodeFlow con antelación. El asistente los consulta en tiempo real y responde con precisión. Si la farmacia pertenece a un colegio que publica turnos online, podemos configurar una sincronización automatizada.'),
            ('¿El asistente habla en euskera?', 'Sí. NodeFlow detecta automáticamente si el cliente habla en euskera o castellano y responde en el mismo idioma. En los barrios de Bilbao con alta presencia euskaldun (Deusto, Begoña, Rekalde), este punto marca una diferencia real en la percepción de servicio.'),
            ('¿Puede decirle al cliente si tenemos un medicamento concreto?', 'Puedes configurar un listado de medicamentos de alta rotación. Para consultas de stock en tiempo real, actualmente se requiere integración con tu sistema de gestión de farmacia. Consúltanos para ver si tu software tiene API disponible.'),
            ('¿Puede una farmacia pequeña de barrio permitirse NodeFlow?', 'El plan Negocio cuesta 49€/mes — menos que 2 horas del tiempo de un auxiliar. Para una farmacia que evita 20 llamadas diarias de "¿están de guardia?", el ahorro de tiempo justifica la inversión desde el primer mes.'),
        ],
        'related': [
            ('/farmacias', 'NodeFlow para farmacias →'),
            ('/blog/recepcionista-ia-farmacias-espana', 'IA para farmacias en España →'),
            ('/blog/ia-atencion-telefonica-pymes-espana', 'IA telefónica para pymes →'),
        ],
    },
    {
        'slug': 'asistente-ia-farmacia-donostia',
        'title': 'Asistente IA para farmacias en Donostia-San Sebastián | NodeFlow Blog',
        'h1': 'Asistente IA para farmacias en Donostia-San Sebastián',
        'meta_desc': 'Las farmacias de Donostia-San Sebastián automatizan consultas de turnos, horarios y disponibilidad con IA. Atención en castellano y euskera 24/7.',
        'keywords': 'asistente IA farmacia Donostia, recepcionista virtual farmacia San Sebastián, farmacia turno guardia IA Gipuzkoa',
        'section': 'farmacias',
        's1': ('s1', 'Las farmacias donostiarras: alta demanda y atención bilingüe obligatoria'),
        's2': ('s2', 'IA que atiende en euskera y castellano: imprescindible en Donostia'),
        's3': ('s3', 'Turnos de guardia, horarios y reserva de medicamentos con IA'),
        's4': ('s4', 'El impacto del turismo en la demanda telefónica de farmacias en verano'),
        's5': ('s5', 'Implantación en menos de 24 horas: cómo funciona para una farmacia donostiarra'),
        'intro': 'Donostia-San Sebastián tiene una demografía lingüística particular: una parte significativa de sus clientes prefiere ser atendida en euskera. Para una farmacia en el Casco Viejo o en Gros, tener un asistente que detecte automáticamente el idioma y responda con naturalidad no es un lujo — es una expectativa. El turismo internacional añade otro reto: en verano, las consultas en inglés y francés no son infrecuentes.',
        'cta_title': '¿Tu farmacia en Donostia necesita atención 24/7 en euskera?',
        'cta_body': 'NodeFlow atiende en castellano, euskera e incluso inglés. Sin esperas, sin interrumpir al farmacéutico. Alta en menos de 24 horas.',
        'faq': [
            ('¿Puede el asistente atender en varios idiomas simultáneamente?', 'NodeFlow atiende en castellano y euskera de forma nativa. Para idiomas adicionales como inglés o francés (útil para farmacias en zonas turísticas de Donostia), consúltanos — tenemos soporte multiidioma en plan Pro.'),
            ('¿Cómo gestiona las guardias en el Colegio de Farmacéuticos de Gipuzkoa?', 'Configuramos los turnos de guardia manualmente en el portal, con actualización semanal o mensual según el calendario del colegio. Próximamente tendremos integración directa con los colegios farmacéuticos vascos.'),
            ('¿El asistente puede tomar nota de reservas de medicamentos?', 'Sí. El asistente puede recoger el nombre del medicamento, el nombre del cliente y su teléfono, y enviarte una notificación por WhatsApp o email para que lo tengas preparado cuando venga a recogerlo.'),
            ('¿Funciona con el sistema de gestión de nuestra farmacia?', 'NodeFlow funciona de forma independiente como canal de atención telefónica. Para integraciones con sistemas de gestión de farmacia específicos, consúltanos — evaluamos cada caso y solemos encontrar solución en pocas semanas.'),
        ],
        'related': [
            ('/farmacias', 'NodeFlow para farmacias →'),
            ('/blog/recepcionista-ia-farmacia-bilbao', 'IA para farmacias en Bilbao →'),
            ('/blog/recepcionista-ia-farmacias-espana', 'IA para farmacias en España →'),
        ],
    },
    {
        'slug': 'asistente-ia-taller-mecanico-donostia',
        'title': 'Asistente IA para talleres mecánicos en Donostia y Gipuzkoa | NodeFlow Blog',
        'h1': 'Asistente IA para talleres mecánicos en Donostia y Gipuzkoa',
        'meta_desc': 'Los talleres mecánicos de Donostia y Gipuzkoa automatizan citas, presupuestos y estado de reparaciones con IA. 24/7 sin interrumpir al mecánico.',
        'keywords': 'asistente IA taller mecánico Donostia, recepcionista virtual taller Gipuzkoa, automatizar citas taller IA San Sebastián',
        'section': 'talleres',
        's1': ('s1', 'Los talleres de Gipuzkoa pierden llamadas mientras el mecánico trabaja'),
        's2': ('s2', 'IA que gestiona citas y presupuestos telefónicos en castellano y euskera'),
        's3': ('s3', 'Recordatorios de ITV, mantenimiento y revisiones periódicas automáticos'),
        's4': ('s4', 'El cliente pregunta por el estado de su coche: el asistente responde'),
        's5': ('s5', 'ROI para un taller mecánico mediano en Donostia'),
        'intro': 'En un taller mecánico de Donostia, el jefe de taller suele estar en el foso o bajo un coche cuando suena el teléfono. El administrativo, si lo hay, está tramitando presupuestos o coordinando con proveedores. El resultado es predecible: entre el 25 y el 40% de las llamadas no se contestan, y un porcentaje de esas pertenecen a clientes nuevos que van a llamar al siguiente taller.',
        'cta_title': '¿Tu taller en Donostia pierde clientes por llamadas no atendidas?',
        'cta_body': 'NodeFlow atiende cada llamada, gestiona citas y envía recordatorios de ITV y mantenimiento. Alta en menos de 24 horas.',
        'faq': [
            ('¿El asistente puede dar presupuestos?', 'Para presupuestos genéricos (cambio de aceite, frenos, neumáticos) puedes configurar rangos de precio orientativos. Para presupuestos personalizados, el asistente recoge la matrícula, la descripción del problema y el teléfono del cliente, y te notifica para que puedas llamar con el presupuesto.'),
            ('¿Funciona en euskera?', 'Sí. NodeFlow detecta automáticamente si el cliente habla en euskera o castellano y responde en el mismo idioma. En Gipuzkoa, donde el índice de euskaldunización es alto, este punto es especialmente relevante para talleres en municipios como Errenteria, Hernani o el propio Donostia.'),
            ('¿Puede avisarme cuando un cliente llama para saber el estado de su coche?', 'Sí. El asistente recoge el nombre del cliente y la matrícula, y te envía una notificación por WhatsApp con los datos. Si tienes el estado de la reparación configurado en el portal, puede incluso responder directamente al cliente.'),
            ('¿Cuánto tarda la configuración para un taller?', 'El alta estándar tarda menos de 24 horas. Necesitamos el nombre del taller, horarios, servicios principales y el número de teléfono donde quieres redirigir las llamadas no atendidas. Sin hardware adicional, sin cambiar tu número.'),
        ],
        'related': [
            ('/talleres', 'NodeFlow para talleres mecánicos →'),
            ('/blog/recepcionista-ia-taller-mecanico-bilbao', 'IA para talleres en Bilbao →'),
            ('/blog/recepcionista-ia-taller-vitoria', 'IA para talleres en Vitoria →'),
        ],
    },
    {
        'slug': 'asistente-ia-centro-medico-privado',
        'title': 'Asistente IA para centros médicos privados: citas, especialistas y seguros | NodeFlow Blog',
        'h1': 'Asistente IA para centros médicos privados: citas, especialistas y seguros',
        'meta_desc': 'Cómo los centros médicos privados automatizan la gestión de citas por especialidad, consultas sobre seguros y recordatorios con IA. Menos carga para el personal.',
        'keywords': 'asistente IA centro médico privado España, recepcionista virtual clínica privada, automatizar citas especialistas IA',
        'section': 'clinicas',
        's1': ('s1', 'Los centros médicos privados gestionan demasiadas llamadas manualmente'),
        's2': ('s2', 'IA que asigna citas al especialista correcto sin intervención humana'),
        's3': ('s3', 'Gestión automática de seguros: Adeslas, Sanitas, Asisa, DKV'),
        's4': ('s4', 'Recordatorios y rebooking para reducir no-shows en medicina privada'),
        's5': ('s5', 'Implementar IA en un centro médico privado: pasos y tiempos'),
        'intro': 'Un centro médico privado con 5-10 especialistas puede recibir más de 100 llamadas diarias. La recepcionista tiene que identificar la especialidad, buscar al médico correcto, consultar disponibilidad, verificar el seguro del paciente y confirmar la cita. Cada llamada tarda entre 3 y 7 minutos. Con NodeFlow, ese proceso se automatiza para el 80% de los casos estándar.',
        'cta_title': '¿Tu centro médico gestiona más de 50 llamadas al día manualmente?',
        'cta_body': 'NodeFlow automatiza la asignación por especialidad, verifica seguros y envía recordatorios. Sin contratar más personal.',
        'faq': [
            ('¿Puede el asistente derivar al especialista correcto?', 'Sí. Configuras los especialistas y sus áreas (cardiología, dermatología, traumatología…) y el asistente pregunta el motivo de la consulta y asigna automáticamente al especialista adecuado. Si hay ambigüedad, recoge los datos y transfiere a recepción.'),
            ('¿Cómo gestiona los seguros de los pacientes?', 'El asistente puede preguntar por el seguro del paciente al inicio de la llamada y responder sobre qué especialistas están incluidos en cada póliza, si el centro trabaja con ese seguro y si requiere autorización previa. Para autorizaciones específicas, deriva al personal.'),
            ('¿El sistema es compatible con el RGPD y la normativa sanitaria?', 'NodeFlow cumple con el RGPD. El asistente avisa al inicio de cada llamada que está siendo atendida por un sistema de IA. Los datos recogidos se almacenan de forma segura. Para el cumplimiento completo con la normativa sanitaria específica, recomendamos revisar con tu DPO la política de uso.'),
            ('¿Funciona para un centro con varios centros físicos?', 'Sí. Puedes configurar múltiples números de teléfono (uno por centro) o un único número central que el asistente gestiona diferenciando por ubicación. El plan Pro incluye asistentes ilimitados para cadenas o grupos médicos.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas →'),
            ('/blog/recepcionista-ia-clinicas-seguros-privados-espana', 'IA con seguros Adeslas, Sanitas →'),
            ('/blog/asistente-voz-clinica-dental-pais-vasco', 'IA para clínicas en el País Vasco →'),
        ],
    },
    {
        'slug': 'recepcionista-ia-clinicas-seguros-privados-espana',
        'title': 'Recepcionista IA para clínicas con seguros privados: Adeslas, Sanitas, Asisa | NodeFlow Blog',
        'h1': 'Recepcionista IA para clínicas con seguros privados: Adeslas, Sanitas y Asisa',
        'meta_desc': 'Cómo las clínicas con seguros privados automatizan la verificación de cobertura, autorización y citas con IA. Compatible con Adeslas, Sanitas, Asisa, DKV y Mutua.',
        'keywords': 'recepcionista IA clínica seguros privados, asistente IA Adeslas Sanitas Asisa, automatizar verificación seguro IA clínica',
        'section': 'clinicas',
        's1': ('s1', 'Las clínicas con seguros: el laberinto de verificaciones manuales'),
        's2': ('s2', 'IA que verifica cobertura y responde sobre copagos en tiempo real'),
        's3': ('s3', 'Cómo configurar en NodeFlow cada aseguradora: Adeslas, Sanitas, Asisa, DKV, Mutua'),
        's4': ('s4', 'Autorización previa: cuándo el asistente deriva y cuándo no'),
        's5': ('s5', 'Ahorro real de tiempo en recepción: estudio de caso'),
        'intro': 'Para una clínica que trabaja con 5 o más aseguradoras, la gestión de llamadas es especialmente compleja. El paciente pregunta si su seguro cubre el tratamiento, si necesita volante, cuál es el copago y si hay lista de espera. La recepcionista tiene que saber de memoria las condiciones de cada póliza de cada aseguradora — información que cambia, varía por póliza y lleva a errores que después suponen reclamaciones.',
        'cta_title': '¿Tu clínica trabaja con Adeslas, Sanitas o Asisa?',
        'cta_body': 'NodeFlow responde automáticamente sobre coberturas, copagos y derivaciones. Sin que la recepcionista tenga que memorizar cada póliza.',
        'faq': [
            ('¿Cómo se actualiza la información de cada seguro?', 'En el portal de NodeFlow, en Configuración → Base de Conocimiento, subes o editas la información de cada aseguradora. Cuando cambian las condiciones, actualizas el documento y el asistente empieza a usar la nueva información en la siguiente llamada. Sin programación, sin esperas.'),
            ('¿El asistente puede tramitar la autorización previa con la aseguradora?', 'Actualmente el asistente informa sobre si se necesita autorización previa y qué datos necesita el paciente para solicitarla. La tramitación directa con la aseguradora sigue siendo manual. Tenemos en roadmap la integración directa con las APIs de las principales aseguradoras.'),
            ('¿Funciona para clínicas que trabajan solo con una aseguradora?', 'Sí, y es incluso más sencillo de configurar. Defines los servicios cubiertos, los copagos y los requisitos, y el asistente responde con precisión a todas las consultas. Para clínicas concertadas con una sola mutua, el asistente también puede gestionar el alta de nuevos asegurados.'),
            ('¿Qué pasa cuando el paciente tiene una póliza con condiciones especiales?', 'Para pólizas con condiciones no estándar, el asistente puede recoger el nombre del paciente y el número de póliza, y notificarte para que la recepcionista llame de vuelta con la información correcta. Esto evita errores por dar información genérica a un paciente con una póliza especial.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas →'),
            ('/blog/asistente-ia-centro-medico-privado', 'IA para centros médicos privados →'),
            ('/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia', 'IA y seguros para fisioterapia →'),
        ],
    },
    {
        'slug': 'integracion-ia-software-gestion-clinica',
        'title': 'Integrar IA con el software de gestión de tu clínica: guía práctica | NodeFlow Blog',
        'h1': 'Integrar IA con el software de gestión de tu clínica: guía práctica',
        'meta_desc': 'Cómo conectar un asistente de voz IA con tu software de gestión clínica existente: Google Calendar, Gesden, Clinic Cloud y otros. Sin cambiar lo que ya funciona.',
        'keywords': 'integrar IA software gestión clínica, asistente voz Google Calendar clínica, NodeFlow integración software médico',
        'section': 'clinicas',
        's1': ('s1', 'El problema de la isla: tu software de gestión y el teléfono no se hablan'),
        's2': ('s2', 'Integración con Google Calendar: la forma más rápida de empezar'),
        's3': ('s3', 'Cómo NodeFlow se conecta con Gesden, Clinic Cloud y otros softwares'),
        's4': ('s4', 'Qué información fluye entre la IA y tu software de gestión'),
        's5': ('s5', 'Pasos para una integración sin interrupciones en la clínica'),
        'intro': 'Cada clínica tiene su software de gestión: Gesden para dentales, Clinic Cloud para médicos privados, software propio para cadenas, Google Calendar para los más simples. El problema es que el teléfono siempre ha sido una isla: las llamadas llegan, alguien apunta en un papel o en la agenda, y luego hay que traspasar todo al sistema. NodeFlow cierra ese bucle.',
        'cta_title': '¿Tu clínica ya tiene software de gestión y quieres añadir IA?',
        'cta_body': 'NodeFlow se integra con lo que ya tienes. La configuración más común (Google Calendar) tarda menos de 1 hora.',
        'faq': [
            ('¿Funciona NodeFlow sin integración con ningún software?', 'Sí. NodeFlow puede funcionar de forma autónoma: el asistente gestiona las llamadas, recoge citas y envía confirmaciones, y tú ves todo en el portal web. La integración con software externo es opcional y mejora la experiencia, pero no es obligatoria para empezar.'),
            ('¿Cuánto tiempo lleva la integración con Google Calendar?', 'Menos de 1 hora. En la sección Integraciones del portal, conectas tu cuenta de Google, seleccionas el calendario de la clínica y defines los tipos de cita. A partir de ese momento, el asistente consulta disponibilidad real y reserva directamente en el calendario.'),
            ('¿NodeFlow puede leer datos de pacientes de nuestro software?', 'Para las integraciones avanzadas (leer fichas de pacientes, historial de citas, etc.) estudiamos cada caso según el software que uses y si tiene API disponible. Contacta con nosotros indicando tu software para evaluar la viabilidad.'),
            ('¿La integración afecta al funcionamiento actual del software?', 'No. NodeFlow se conecta como una aplicación adicional que lee y escribe en el calendario o el sistema según los permisos que definas. No modifica la estructura de datos del software principal ni interrumpe su funcionamiento habitual.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas →'),
            ('/blog/google-calendar-citas-automaticas-negocio', 'Google Calendar con IA →'),
            ('/blog/asistente-ia-centro-medico-privado', 'IA para centros médicos privados →'),
        ],
    },
    {
        'slug': 'recepcionista-ia-consultas-medicas-generales',
        'title': 'Recepcionista IA para consultas médicas: gestiona citas sin saturar la línea | NodeFlow Blog',
        'h1': 'Recepcionista IA para consultas médicas: gestiona citas sin saturar la línea',
        'meta_desc': 'Las consultas médicas privadas automatizan citas, recordatorios y consultas sobre seguros con IA. Sin saturar la línea, sin contratar más personal.',
        'keywords': 'recepcionista IA consulta médica, asistente virtual médico privado España, automatizar citas consulta médica IA',
        'section': 'clinicas',
        's1': ('s1', 'La consulta médica privada: teléfono saturado, pacientes esperando'),
        's2': ('s2', 'IA que atiende llamadas mientras el médico está en consulta'),
        's3': ('s3', 'Recordatorios automáticos y rebooking para consultas médicas'),
        's4': ('s4', 'Primer contacto y triaje telefónico con IA'),
        's5': ('s5', 'Coste real vs. beneficio para una consulta médica con 20 pacientes/día'),
        'intro': 'Una consulta médica privada con un solo médico puede recibir entre 30 y 60 llamadas al día. La secretaria, cuando la hay, alterna entre atender en mostrador, gestionar la agenda y responder el teléfono. El resultado habitual: llamadas en espera, pacientes frustrados y citas perdidas. NodeFlow actúa como una segunda recepcionista que solo gestiona el teléfono, siempre disponible, nunca saturada.',
        'cta_title': '¿Tu consulta médica recibe más llamadas de las que puede gestionar?',
        'cta_body': 'NodeFlow atiende todas las llamadas, gestiona citas y envía recordatorios. Sin saturar al personal ni perder pacientes.',
        'faq': [
            ('¿Puede el asistente hacer un triaje básico de urgencias?', 'El asistente puede seguir un flujo de preguntas para determinar si la situación requiere atención urgente (hoy), una cita normal o simplemente información. Para urgencias reales, puede facilitar el número de urgencias o notificar al médico directamente por WhatsApp.'),
            ('¿Cómo gestiona el asistente a los pacientes habituales?', 'Con memoria persistente, NodeFlow recuerda a los pacientes habituales: su nombre, el médico con el que suelen ir y sus preferencias de horario. La llamada es más rápida y el paciente siente que le conocen, aunque esté hablando con una IA.'),
            ('¿El asistente puede informar sobre los honorarios del médico?', 'Sí. Configuras los honorarios por tipo de consulta (primera visita, revisión, urgencia) y el asistente los comunica cuando el paciente pregunta. Para consultas con seguro, puede indicar qué seguros acepta el médico y si hay copago.'),
            ('¿Puede funcionar para una consulta que abre solo 3 días a la semana?', 'Perfectamente. Configuras los horarios de apertura y los días de consulta, y el asistente gestiona las citas solo en los días disponibles. Fuera de esos días, informa de la próxima disponibilidad y puede recoger una solicitud de llamada de vuelta.'),
        ],
        'related': [
            ('/clinicas', 'NodeFlow para clínicas →'),
            ('/blog/asistente-ia-centro-medico-privado', 'IA para centros médicos privados →'),
            ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Reducir no-shows con IA →'),
        ],
    },
    {
        'slug': 'asistente-ia-spa-balneario-espana',
        'title': 'Asistente IA para spas y balnearios en España: reservas y tratamientos | NodeFlow Blog',
        'h1': 'Asistente IA para spas y balnearios en España: reservas y tratamientos',
        'meta_desc': 'Los spas y balnearios en España automatizan reservas de tratamientos, paquetes y circuitos de aguas con IA. Atención multiidioma 24/7 para turismo nacional e internacional.',
        'keywords': 'asistente IA spa España, recepcionista virtual balneario, automatizar reservas spa IA',
        'section': 'estetica',
        's1': ('s1', 'Spas y balnearios: el teléfono como primer punto de contacto para el cliente premium'),
        's2': ('s2', 'IA que reserva tratamientos y paquetes de bienestar en varios idiomas'),
        's3': ('s3', 'Gestión de bonos de regalo y paquetes especiales con IA'),
        's4': ('s4', 'Recordatorios y preparación previa al tratamiento automáticos'),
        's5': ('s5', 'ROI para un spa de 20-40 cabinas en España'),
        'intro': 'Un spa o balneario de nivel medio-alto en España gestiona entre 40 y 100 reservas a la semana, muchas de ellas por teléfono. El cliente que llama para reservar un fin de semana de bienestar espera una experiencia premium desde el primer contacto. Si el teléfono tarda en contestar o la reserva se pierde por error, la decepción llega antes de la primera toalla caliente.',
        'cta_title': '¿Tu spa pierde reservas por no contestar el teléfono a tiempo?',
        'cta_body': 'NodeFlow atiende cada llamada con tono premium, reserva tratamientos y envía confirmaciones. En los idiomas que necesites.',
        'faq': [
            ('¿El asistente puede explicar los diferentes circuitos y tratamientos?', 'Sí. Subes la descripción de cada tratamiento, duración, precio y disponibilidad al portal de NodeFlow. El asistente puede explicar en detalle cada opción y recomendar la más adecuada según lo que busca el cliente, antes de proceder a la reserva.'),
            ('¿Puede atender en inglés o francés para turistas?', 'El plan Pro de NodeFlow incluye soporte multiidioma. Para spas en zonas turísticas o balnearios que reciben clientes internacionales, el asistente puede atender en castellano, inglés y francés de forma nativa.'),
            ('¿Cómo gestiona las reservas de grupos o bonos de regalo?', 'El asistente puede gestionar reservas para grupos pequeños y reconocer cuando el cliente menciona un bono de regalo, recogiendo el código y verificando su validez si tienes el sistema configurado.'),
            ('¿Puede enviar recordatorios de preparación previa al tratamiento?', 'Sí. Puedes configurar un email automático 24 horas antes de la cita con instrucciones específicas para cada tratamiento (llegar en ayunas, no depilarse, qué llevar…). Esto mejora la experiencia del cliente y reduce las cancelaciones.'),
        ],
        'related': [
            ('/estetica', 'NodeFlow para estética →'),
            ('/blog/asistente-ia-centros-estetica-laser', 'IA para centros de estética avanzada →'),
            ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Reducir no-shows con IA →'),
        ],
    },
    {
        'slug': 'ia-recepcion-virtual-sector-servicios-espana',
        'title': 'La recepción virtual IA ya es una realidad para los servicios en España | NodeFlow Blog',
        'h1': 'La recepción virtual IA ya es una realidad para los servicios en España',
        'meta_desc': 'Las empresas de servicios en España adoptan recepción virtual con IA para gestionar llamadas, citas y consultas 24/7. Estado actual, casos reales y próximos pasos.',
        'keywords': 'recepción virtual IA servicios España, asistente voz empresas servicios, automatizar llamadas sector servicios IA',
        'section': 'general',
        's1': ('s1', 'El sector servicios español y el teléfono: un problema que lleva décadas sin resolver'),
        's2': ('s2', 'Qué hace exactamente una recepción virtual con IA en 2026'),
        's3': ('s3', 'Sectores que ya la usan: de clínicas a talleres y bufetes'),
        's4': ('s4', 'El coste real de no tener recepcionista virtual en una empresa de servicios'),
        's5': ('s5', 'Cómo empezar: los primeros 30 días con una recepción virtual'),
        'intro': 'En 2026, más del 60% de las pymes españolas de servicios siguen gestionando su teléfono de la misma manera que hace 20 años: alguien coge el teléfono cuando puede, o no lo coge. La recepción virtual con IA no es ya una tecnología futura — es una solución accesible desde 49€/mes que está transformando la forma en que clínicas, talleres, bufetes y academias gestionan su primer punto de contacto con el cliente.',
        'cta_title': '¿Tu empresa de servicios todavía gestiona el teléfono manualmente?',
        'cta_body': 'NodeFlow es la recepción virtual IA para pymes españolas. Sin hardware, sin cambiar tu número. Desde 49€/mes.',
        'faq': [
            ('¿Qué tipo de empresas de servicios se benefician más de la IA?', 'Las que más se benefician son las que reciben muchas llamadas repetitivas: clínicas, talleres, peluquerías, academias, restaurantes, asesorías. En general, cualquier negocio que recibe más de 10 llamadas diarias y no puede contestar todas en tiempo real.'),
            ('¿Es la IA capaz de gestionar llamadas complejas?', 'Para el 70-80% de las llamadas de una pyme de servicios (citas, horarios, preguntas frecuentes), la IA las gestiona completamente. Para el 20% restante (quejas, situaciones no previstas, ventas complejas), el asistente recoge la información y notifica al humano para que llame de vuelta.'),
            ('¿Cuánto tiempo tarda en configurarse una recepción virtual?', 'El alta estándar tarda menos de 24 horas. Se necesita información básica del negocio: nombre, horarios, servicios y preguntas frecuentes. La configuración avanzada puede llevar unos días más, pero el asistente ya está operativo desde el primer día.'),
            ('¿La recepción virtual funciona también para empresas B2B?', 'Sí. Muchas empresas B2B usan NodeFlow para gestionar las llamadas entrantes de clientes y proveedores, filtrar llamadas comerciales y gestionar la agenda del equipo comercial. El tono y el vocabulario se adaptan al contexto B2B en la configuración.'),
        ],
        'related': [
            ('/asesorias', 'NodeFlow para asesorías →'),
            ('/blog/cuanto-cuesta-recepcionista-virtual-ia', '¿Cuánto cuesta una recepcionista IA? →'),
            ('/blog/ia-atencion-telefonica-pymes-espana', 'IA telefónica para pymes →'),
        ],
    },
    {
        'slug': 'recepcionista-ia-academias-idiomas-espana',
        'title': 'Recepcionista IA para academias de idiomas: matrículas y consultas automáticas | NodeFlow Blog',
        'h1': 'Recepcionista IA para academias de idiomas: matrículas y consultas automáticas',
        'meta_desc': 'Las academias de idiomas en España automatizan consultas de niveles, horarios, precios y matrículas con IA. Sin perder alumnos potenciales fuera del horario de atención.',
        'keywords': 'recepcionista IA academia idiomas España, asistente virtual escuela idiomas, automatizar matrículas academia inglés IA',
        'section': 'academias',
        's1': ('s1', 'Las academias de idiomas pierden alumnos por no contestar en el momento'),
        's2': ('s2', 'IA que informa de niveles, horarios y precios sin intermediarios'),
        's3': ('s3', 'Automatizar el proceso de matrícula: del primer contacto a la inscripción'),
        's4': ('s4', 'Gestión de la lista de espera y grupos nuevos con IA'),
        's5': ('s5', 'Retención de alumnos: recordatorios de inicio de curso y renovación'),
        'intro': 'Una academia de idiomas en España suele recibir picos de llamadas en enero (propósitos de año nuevo), septiembre (inicio de curso) y después de Navidad. Fuera de esos picos, siguen llegando consultas de padres, adultos y empresas. El problema es que la persona que atiende el teléfono también da clases, gestiona la administración y no siempre puede contestar en el momento en que el alumno potencial llama.',
        'cta_title': '¿Tu academia de idiomas pierde alumnos por no contestar el teléfono?',
        'cta_body': 'NodeFlow atiende consultas de niveles, precios y horarios 24/7 y gestiona las solicitudes de matrícula automáticamente.',
        'faq': [
            ('¿El asistente puede hacer un test de nivel básico por teléfono?', 'Puede hacer preguntas de orientación (¿Has estudiado inglés antes? ¿Cuántos años? ¿Puedes mantener una conversación básica?) para orientar al alumno hacia el nivel adecuado antes de matricularse. Para una evaluación formal, el asistente puede programar una prueba de nivel con el profesor.'),
            ('¿Puede gestionar grupos de empresa (formación B2B)?', 'Sí. Puedes configurar una sección específica para empresas, donde el asistente recoge los datos del contacto de RRHH, el número de alumnos, los idiomas y el nivel, y te notifica para hacer una propuesta personalizada.'),
            ('¿Cómo gestiona las consultas en diferentes idiomas?', 'Una academia de idiomas puede configurar NodeFlow para atender en varios idiomas — especialmente útil si hay alumnos extranjeros o si la academia quiere proyectar una imagen internacional. El plan Pro incluye soporte multiidioma.'),
            ('¿El asistente puede recordar a los alumnos que se acaba el bono de clases?', 'Sí. Con el plan Pro, puedes configurar fechas críticas por alumno: fecha de fin de bono, fecha de examen oficial, inicio de nuevo trimestre. El asistente envía recordatorios automáticos con anticipación suficiente para que el alumno renueve a tiempo.'),
        ],
        'related': [
            ('/academias', 'NodeFlow para academias →'),
            ('/blog/asistente-ia-academia-vitoria', 'IA para academia en Vitoria →'),
            ('/blog/ia-para-academias-clases-particulares', 'IA para academias y clases particulares →'),
        ],
    },
    {
        'slug': 'asistente-ia-peluqueria-coloracion-citas-largas',
        'title': 'Asistente IA para peluquerías: cómo gestionar citas largas de coloración y tratamientos | NodeFlow Blog',
        'h1': 'Asistente IA para peluquerías: cómo gestionar citas largas de coloración',
        'meta_desc': 'Las peluquerías con servicios de coloración y tratamientos largos tienen un reto de agenda específico. Cómo la IA gestiona citas de 2-3 horas sin errores ni dobles reservas.',
        'keywords': 'asistente IA peluquería coloración, recepcionista virtual peluquería citas largas, automatizar reservas coloración peluquería IA',
        'section': 'peluquerias',
        's1': ('s1', 'El reto de las citas largas en peluquerías: coloración, mechas y tratamientos'),
        's2': ('s2', 'IA que calcula el tiempo correcto para cada servicio combinado'),
        's3': ('s3', 'Lista de espera y gestión de cancelaciones de última hora'),
        's4': ('s4', 'Recordatorios previos: instrucciones para el cliente antes de la coloración'),
        's5': ('s5', 'Cómo NodeFlow gestiona una agenda de 3 estilistas y citas de 30 min a 3 horas'),
        'intro': 'Una coloración completa con corte y secado puede ocupar 3 horas de agenda. Si el cliente llama para reservar y la recepcionista no calcula bien el tiempo, el siguiente cliente tiene que esperar, el estilista llega tarde a todas sus citas del día y el día acaba en caos. La gestión de citas largas en peluquerías es un problema de agenda complejo que la IA puede resolver sin errores.',
        'cta_title': '¿Tu peluquería tiene problemas con las citas largas de coloración?',
        'cta_body': 'NodeFlow calcula automáticamente el tiempo de cada servicio, evita solapamientos y envía recordatorios con instrucciones previas al cliente.',
        'faq': [
            ('¿El asistente sabe cuánto dura cada servicio?', 'Sí. En la configuración de Servicios del portal defines la duración de cada servicio: corte 45 min, coloración completa 150 min, mechas con papel 120 min, tratamiento de keratina 90 min. Cuando el cliente pide una cita combinada, el asistente suma las duraciones y busca el hueco correcto en la agenda.'),
            ('¿Puede gestionar servicios con varios estilistas?', 'Sí. Puedes asignar cada tipo de servicio a estilistas específicos y definir su disponibilidad por separado. Para un servicio que requiere colorista + estilista (aplicación + corte), el asistente puede coordinar los dos en secuencia automáticamente.'),
            ('¿Cómo gestiona las cancelaciones de coloración de última hora?', 'Cuando hay una cancelación, el asistente puede notificarte y, si tienes una lista de espera configurada, contactar automáticamente al siguiente cliente para ofrecerle el hueco. Las cancelaciones de citas largas dejan huecos difíciles de rellenar sin un sistema activo.'),
            ('¿Puede enviar instrucciones previas a clientes de coloración?', 'Sí. Puedes configurar un email automático 24 horas antes de la cita con instrucciones específicas: llegar con el cabello seco, sin acondicionador, qué esperar del proceso, etc. Esto reduce las preguntas en el momento de la cita y mejora la experiencia.'),
        ],
        'related': [
            ('/peluquerias', 'NodeFlow para peluquerías →'),
            ('/blog/recepcionista-ia-peluqueria-bilbao', 'IA para peluquerías en Bilbao →'),
            ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Reducir no-shows con IA →'),
        ],
    },
]

def main():
    created = 0
    for a in ARTICLES:
        slug = a['slug']
        dir_path = os.path.join(BASE, slug)
        os.makedirs(dir_path, exist_ok=True)
        file_path = os.path.join(dir_path, 'index.html')
        content = html(a)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'  Created: {slug}/index.html')
        created += 1
    print(f'\nDone. Created {created} articles.')

if __name__ == '__main__':
    main()
