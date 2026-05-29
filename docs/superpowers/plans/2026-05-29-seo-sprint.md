# SEO Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs in the landing page, generate 13 pending blog articles, update the blog index, create /guias/index.html, add related-links to 29 sector pages, and update the sitemap to 124 URLs.

**Architecture:** All changes are static HTML. No backend changes. Base template for blog articles is `public/blog/asistente-ia-opticas-espana/index.html` — use it as reference for exact CSS/JS/structure. Sector pages follow `public/fisioterapia/index.html` pattern.

**Tech Stack:** Static HTML, CSS variables, inline JS, Schema JSON-LD, GA4 + Plausible

---

## File Map

| File | Action |
|------|--------|
| `public/index.html` | Modify: footer links, FAQ schema, sectors grid, nav |
| `public/blog/topics.json` | Modify: set `generated:true` for 65 existing articles |
| `public/blog/index.html` | Modify: add 40 missing articles to listing |
| `public/guias/index.html` | Create: new page listing 5 guides |
| `public/blog/<13-slugs>/index.html` | Create: 13 new blog articles |
| `public/<29-sectors>/index.html` | Modify: add related-blog section before `<!-- CTA -->` |
| `public/sitemap.xml` | Modify: add 15 new URLs |

---

## Task 1: Fix 4 bugs in public/index.html

**Files:** Modify `public/index.html`

- [ ] **Step 1: Fix footer links (3 broken hrefs)**

Find (around line 1469):
```html
<a href="/privacy">Política de privacidad</a>
<a href="/terms">Términos de uso</a>
<a href="/terms">Aviso legal</a>
```
Replace with:
```html
<a href="/privacidad">Política de privacidad</a>
<a href="/terminos">Términos de uso</a>
<a href="/aviso-legal">Aviso legal</a>
```

- [ ] **Step 2: Expand FAQ Schema JSON-LD from 4 to 8 questions**

Find the FAQPage JSON-LD in `<head>` (line ~33). It currently has 4 questions. Add these 4 after the last existing one (before the closing `]}`):
```json
,{"@type":"Question","name":"¿Qué es la memoria persistente?","acceptedAnswer":{"@type":"Answer","text":"La IA recuerda las conversaciones anteriores de cada llamante. Sabe su nombre, preferencias y qué pidió la última vez. Cada interacción es más personalizada."}}
,{"@type":"Question","name":"¿Cómo funciona la base de conocimiento?","acceptedAnswer":{"@type":"Answer","text":"Subes tus documentos (menú, precios, FAQ) y la IA los consulta en tiempo real durante las llamadas para dar información real y actualizada de tu negocio."}}
,{"@type":"Question","name":"¿Qué pasa si el cliente quiere hablar con un humano?","acceptedAnswer":{"@type":"Answer","text":"La IA detecta automáticamente cuando el cliente necesita atención humana y te envía una notificación inmediata por WhatsApp con el resumen de la conversación."}}
,{"@type":"Question","name":"¿Puedo cancelar en cualquier momento?","acceptedAnswer":{"@type":"Answer","text":"Sí, sin permanencia ni letra pequeña. Puedes cancelar tu suscripción cuando quieras desde tu panel de control. Sin preguntas, sin penalizaciones."}}
```

- [ ] **Step 3: Expand sectors grid from 7 to 29 sectors**

Find the `<!-- ══ SECTORS ══ -->` section. Replace the entire `<div class="sectors-grid reveal">...</div>` with:
```html
<div class="sectors-grid reveal" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;">
  <a class="sector-card" href="/fisioterapia"><span class="sc-icon">🏥</span><h3>Fisioterapia</h3><p>Citas, seguimiento y tratamientos.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/clinicas"><span class="sc-icon">🦷</span><h3>Clínicas dentales</h3><p>Gestión de citas y urgencias.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/veterinarias"><span class="sc-icon">🐾</span><h3>Veterinarias</h3><p>Citas, vacunaciones 24/7.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/psicologia"><span class="sc-icon">🧠</span><h3>Psicología</h3><p>Consultas y seguimiento.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/nutricion"><span class="sc-icon">🥗</span><h3>Nutrición</h3><p>Consultas y planes.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/podologia"><span class="sc-icon">🦶</span><h3>Podología</h3><p>Citas y tratamientos.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/optica"><span class="sc-icon">👓</span><h3>Ópticas</h3><p>Revisiones y seguros.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/peluquerias"><span class="sc-icon">✂️</span><h3>Peluquerías</h3><p>Reservas y estilistas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/estetica"><span class="sc-icon">💆</span><h3>Estética</h3><p>Tratamientos y horarios.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/estetica-avanzada"><span class="sc-icon">✨</span><h3>Estética avanzada</h3><p>Láser, hifu, rellenos.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/yoga"><span class="sc-icon">🧘</span><h3>Yoga</h3><p>Clases y reservas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/pilates"><span class="sc-icon">🤸</span><h3>Pilates</h3><p>Clases y reservas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/restaurantes"><span class="sc-icon">🍽️</span><h3>Restaurantes</h3><p>Reservas y menú del día.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/hoteles"><span class="sc-icon">🏨</span><h3>Hoteles</h3><p>Reservas y atención.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/gimnasios"><span class="sc-icon">💪</span><h3>Gimnasios</h3><p>Altas, clases, consultas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/talleres"><span class="sc-icon">🔧</span><h3>Talleres</h3><p>Presupuestos y estado.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/reformas"><span class="sc-icon">🏗️</span><h3>Reformas</h3><p>Presupuestos e inicio.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/autoescuela"><span class="sc-icon">🚗</span><h3>Autoescuelas</h3><p>Clases y exámenes.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/agencia-viajes"><span class="sc-icon">✈️</span><h3>Agencias de viajes</h3><p>Consultas y reservas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/abogados"><span class="sc-icon">⚖️</span><h3>Abogados</h3><p>Consultas y plazos.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/asesorias"><span class="sc-icon">📊</span><h3>Asesorías</h3><p>Consultas fiscales.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/notaria"><span class="sc-icon">📋</span><h3>Notarías</h3><p>Citas y documentos.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/coaching"><span class="sc-icon">🎯</span><h3>Coaching</h3><p>Sesiones y seguimiento.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/farmacias"><span class="sc-icon">💊</span><h3>Farmacias</h3><p>Turnos y consultas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/academias"><span class="sc-icon">📚</span><h3>Academias</h3><p>Matrículas y horarios.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/inmobiliarias"><span class="sc-icon">🏠</span><h3>Inmobiliarias</h3><p>Visitas y consultas.</p><span class="sector-price">Desde 49€/mes →</span></a>
  <a class="sector-card" href="/guarderia-canina"><span class="sc-icon">🐕</span><h3>Guarderías caninas</h3><p>Reservas y cuidados.</p><span class="sector-price">Desde 49€/mes →</span></a>
</div>
```

- [ ] **Step 4: Add Blog and Guías to nav**

Find (around line 698):
```html
<ul class="nav-links">
  <li><a href="#funciones">Funciones</a></li>
```
Add after the opening `<ul>`:
```html
  <li><a href="/blog">Blog</a></li>
  <li><a href="/guias">Guías</a></li>
```

Also add in `.mobile-nav` (around line 717, same pattern — add two `<a>` elements):
```html
<a href="/blog" onclick="closeMobileNav()">Blog</a>
<a href="/guias" onclick="closeMobileNav()">Guías</a>
```

- [ ] **Step 5: Add Recursos + Ciudades columns to footer**

Find the footer grid (around line 1454). The current grid has 4 columns: brand + Producto + Legal + Contacto.

Change footer grid CSS to 6 columns: find `.footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;` and change to `grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;`

Also update the responsive breakpoints: find `.footer-grid{grid-template-columns:1fr 1fr;}` (tablet) and change to `grid-template-columns:repeat(3,1fr);`. The mobile `1fr` stays.

Then add these two columns after the existing Contacto column:
```html
<div class="footer-col">
  <h4>Recursos</h4>
  <a href="/blog">Blog</a>
  <a href="/guias">Guías de uso</a>
  <a href="/admin/playground.html">Demo IA</a>
</div>
<div class="footer-col">
  <h4>Ciudades</h4>
  <a href="/bilbao">Bilbao</a>
  <a href="/donostia">Donostia</a>
  <a href="/vitoria">Vitoria</a>
  <a href="/andoain">Andoain</a>
</div>
```

- [ ] **Step 6: Verify changes visually**

Open `public/index.html` in a browser or check HTML structure. Confirm:
- Footer links point to `/privacidad`, `/terminos`, `/aviso-legal` (not `/privacy`, `/terms`)
- FAQ schema has 8 questions (count `@type":"Question"` in head)
- Sectors grid shows 27 sector cards
- Nav has Blog and Guías links

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "fix: footer links 404, expand FAQ schema to 8q, sectors grid 7→27, add Blog/Guías to nav+footer"
```

---

## Task 2: Sync topics.json

**Files:** Modify `public/blog/topics.json`

- [ ] **Step 1: Run sync script**

```bash
cd public/blog
python3 -c "
import json, os
with open('topics.json') as f:
    topics = json.load(f)
dirs = set(os.listdir('.'))
updated = 0
for t in topics:
    if t['slug'] in dirs:
        t['generated'] = True
        updated += 1
with open('topics.json', 'w', encoding='utf-8') as f:
    json.dump(topics, f, ensure_ascii=False, indent=2)
print(f'Marked {updated} articles as generated')
"
```

Expected output: `Marked 65 articles as generated` (or similar — the count of directories that match slugs).

- [ ] **Step 2: Verify**

```bash
python3 -c "
import json
with open('public/blog/topics.json') as f:
    t = json.load(f)
gen = [x for x in t if x.get('generated')]
pend = [x for x in t if not x.get('generated')]
print(f'Generated: {len(gen)}, Pending: {len(pend)}')
print('Pending slugs:')
for p in pend: print(' ', p['slug'])
"
```

Expected: 65 generated, 13 pending (the 13 slugs from Task 3).

- [ ] **Step 3: Commit**

```bash
git add public/blog/topics.json
git commit -m "chore: sync topics.json — mark 65 existing articles as generated"
```

---

## Task 3: Generate 13 new blog articles

**Files:** Create `public/blog/<slug>/index.html` for each of 13 slugs.

**Template reference:** Copy structure from `public/blog/asistente-ia-opticas-espana/index.html` exactly. Replace only the unique fields shown in the table below.

**Template variables to replace per article:**

| Variable | Where it appears |
|----------|-----------------|
| `SLUG` | canonical URL, og:url, JSON-LD ids, breadcrumb item |
| `TITLE` | `<title>`, og:title, twitter:title, JSON-LD headline |
| `H1` | `<h1>` in post-header |
| `META_DESC` | meta description, og:description, twitter:description, JSON-LD description |
| `KEYWORDS` | meta keywords, JSON-LD keywords, `.post-tags` spans |
| `SECTION` | `article:section` meta, breadcrumb tag |
| `S1`–`S5` | 5 section IDs + headings in ToC and article body |
| `INTRO` | opening paragraph before first cta-mid |
| `CTA_TITLE` | bold title in `.cta-mid` |
| `CTA_BODY` | paragraph in `.cta-mid` |
| `FAQ_Q1`–`FAQ_Q4` | 4 FAQ questions |
| `FAQ_A1`–`FAQ_A4` | 4 FAQ answers |
| `RELATED_1`–`RELATED_3` | related links in `.related-links` |
| `SECTOR_LINK` | link to sector page e.g. `/clinicas` |
| `SECTOR_LABEL` | label for sector link e.g. `NodeFlow para clínicas →` |

**Content for each article:**

### 3.1 — `asistente-ia-clinica-dental-donostia`

- **TITLE:** `Asistente IA para clínicas dentales en Donostia-San Sebastián | NodeFlow Blog`
- **H1:** `Asistente IA para clínicas dentales en Donostia-San Sebastián`
- **META_DESC:** `Cómo las clínicas dentales de Donostia automatizan citas, recordatorios y consultas sobre seguros con IA. Sin perder una llamada.`
- **KEYWORDS:** `asistente IA clínica dental Donostia, recepcionista virtual dental San Sebastián, automatizar citas dentista IA`
- **SECTION:** `clinicas`
- **S1:** `id="s1"` — `Las clínicas dentales de Donostia pierden citas por teléfono no atendido`
- **S2:** `id="s2"` — `IA que agenda en castellano y euskera: la realidad de Donostia-San Sebastián`
- **S3:** `id="s3"` — `Recordatorios automáticos de revisiones y limpiezas dentales`
- **S4:** `id="s4"` — `Gestión de urgencias dentales fuera de horario`
- **S5:** `id="s5"` — `Integración con seguros: Adeslas, Sanitas, DKV en una clínica donostiarra`
- **INTRO:** `Donostia-San Sebastián concentra una de las mayores densidades de clínicas dentales del País Vasco. La competencia es alta y la diferencia entre conseguir un nuevo paciente o perderlo a la clínica del barrio suele reducirse a quién contesta el teléfono más rápido. El problema es que el dentista, el higienista y el auxiliar están siempre ocupados cuando suena el teléfono.`
- **CTA_TITLE:** `¿Tu clínica dental en Donostia pierde llamadas?`
- **CTA_BODY:** `NodeFlow atiende al instante en castellano y euskera, agenda citas y gestiona recordatorios. Alta en menos de 24 horas.`
- **FAQ_Q1:** `¿El asistente habla en euskera con naturalidad?` — **FAQ_A1:** `Sí. NodeFlow atiende en castellano y euskera de forma nativa, detectando automáticamente el idioma del paciente. Las voces son de locutores vascos reales, no síntesis genérica. Esencial para clínicas en Donostia donde muchos pacientes prefieren el euskera.`
- **FAQ_Q2:** `¿Puede gestionar urgencias dentales a las 11 de la noche?` — **FAQ_A2:** `El asistente está activo 24/7. Fuera de horario, informa al paciente de las opciones disponibles, recoge sus datos y notifica al dentista de guardia por WhatsApp. Si la urgencia requiere atención inmediata, puede facilitar el número de urgencias.`
- **FAQ_Q3:** `¿Funciona con seguros como Adeslas o Sanitas?` — **FAQ_A3:** `Sí. Configuras los seguros con los que trabajas y el asistente responde automáticamente sobre coberturas, copagos y si necesitan volante previo. Para casos específicos o autorizaciones, deriva al personal de la clínica.`
- **FAQ_Q4:** `¿Cuánto tiempo lleva la configuración inicial?` — **FAQ_A4:** `El alta estándar tarda menos de 24 horas. Se necesita información básica: nombre de la clínica, horarios, servicios y seguros aceptados. Sin hardware adicional, sin cambiar tu número de teléfono.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas dentales →`
- **RELATED_2:** `/blog/recepcionista-ia-clinica-dental-bilbao` — `IA dental en Bilbao →`
- **RELATED_3:** `/blog/asistente-voz-clinica-dental-pais-vasco` — `IA dental en el País Vasco →`

### 3.2 — `recepcionista-ia-clinica-dental-vitoria`

- **TITLE:** `Recepcionista IA para clínicas dentales en Vitoria-Gasteiz | NodeFlow Blog`
- **H1:** `Recepcionista IA para clínicas dentales en Vitoria-Gasteiz`
- **META_DESC:** `Las clínicas dentales de Vitoria-Gasteiz automatizan la recepción de llamadas, citas y recordatorios con IA. Solución local sin cambiar tu número.`
- **KEYWORDS:** `recepcionista IA clínica dental Vitoria, asistente virtual dentista Gasteiz, automatizar llamadas dental Álava`
- **SECTION:** `clinicas`
- **S1:** `El reto de la clínica dental en Vitoria: atender sin interrumpir al dentista`
- **S2:** `Atención bilingüe en Vitoria: castellano y euskera desde el primer segundo`
- **S3:** `Recordatorios automáticos que reducen no-shows en clínicas vitorianass`
- **S4:** `Gestión de primeras consultas y presupuestos por teléfono`
- **S5:** `ROI mensual para una clínica dental mediana en Álava`
- **INTRO:** `Vitoria-Gasteiz tiene una de las tasas más altas de clínicas dentales por habitante de Euskadi. Para una clínica mediana con 3-4 dentistas, gestionar el teléfono sin interrumpir las sesiones clínicas es uno de los principales cuellos de botella operativos. Un paciente que no puede reservar en el primer intento rara vez llama una segunda vez.`
- **CTA_TITLE:** `¿Tu clínica dental en Vitoria necesita recepcionista IA?`
- **CTA_BODY:** `NodeFlow gestiona todas las llamadas de tu clínica dental en Vitoria, en castellano y euskera. Configúralo en menos de 24 horas.`
- **FAQ_Q1:** `¿Puede el asistente gestionar la agenda de varios dentistas?` — **FAQ_A1:** `Sí. En la configuración puedes asignar servicios a dentistas específicos y definir su disponibilidad por separado. El asistente prioriza al dentista habitual del paciente y solo busca alternativas si no hay disponibilidad.`
- **FAQ_Q2:** `¿Cómo se integra con nuestro software de gestión dental?` — **FAQ_A2:** `NodeFlow se integra con Google Calendar para la agenda. Para integraciones con software específico de gestión dental (Gesden, Clinicdent, etc.), consúltanos — estudiamos cada caso y solemos tener solución en pocas semanas.`
- **FAQ_Q3:** `¿El asistente informa sobre tratamientos y precios?` — **FAQ_A3:** `El asistente puede responder sobre los tratamientos que ofreces y los precios orientativos que configures. Para presupuestos personalizados, recoge los datos del paciente y programa una llamada con el dentista o la coordinadora de tratamientos.`
- **FAQ_Q4:** `¿Cuánto cuesta para una clínica dental en Vitoria?` — **FAQ_A4:** `El plan Negocio cuesta 49€/mes e incluye 500 minutos de llamadas, atención en castellano y euskera, y todas las automatizaciones de recordatorios y rebooking. Sin permanencia, con 14 días de prueba gratuita.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas dentales →`
- **RELATED_2:** `/blog/recepcionista-ia-clinica-dental-bilbao` — `IA dental en Bilbao →`
- **RELATED_3:** `/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia` — `IA con seguros privados →`

### 3.3 — `recepcionista-ia-farmacia-bilbao`

- **TITLE:** `Recepcionista IA para farmacias en Bilbao: turnos, horarios y consultas | NodeFlow Blog`
- **H1:** `Recepcionista IA para farmacias en Bilbao: turnos, horarios y consultas`
- **META_DESC:** `Las farmacias de Bilbao usan IA para informar de turnos de guardia, horarios, disponibilidad de medicamentos y consultas básicas. Sin espera, 24/7.`
- **KEYWORDS:** `recepcionista IA farmacia Bilbao, asistente virtual farmacia Bizkaia, farmacia guardia IA Bilbao`
- **SECTION:** `farmacias`
- **S1:** `Las farmacias de Bilbao reciben decenas de llamadas repetitivas al día`
- **S2:** `IA que informa de turnos de guardia y horarios en tiempo real`
- **S3:** `Consultas sobre disponibilidad de medicamentos sin molestar al farmacéutico`
- **S4:** `Atención en euskera: esencial en los barrios de Bilbao`
- **S5:** `Cómo implantar un asistente IA en una farmacia bilbaína`
- **INTRO:** `Una farmacia media en Bilbao recibe entre 20 y 50 llamadas diarias. La mayoría preguntan lo mismo: si están de guardia esta noche, si tienen tal medicamento, o a qué hora cierran. Son preguntas que consumen tiempo del farmacéutico cuando está atendiendo en mostrador, preparando pedidos o asesorando sobre interacciones medicamentosas.`
- **CTA_TITLE:** `¿Tu farmacia en Bilbao recibe demasiadas llamadas repetitivas?`
- **CTA_BODY:** `NodeFlow responde automáticamente sobre turnos, horarios y disponibilidad. El farmacéutico solo interviene cuando de verdad hace falta.`
- **FAQ_Q1:** `¿Puede actualizar los turnos de guardia automáticamente?` — **FAQ_A1:** `Los turnos de guardia se configuran en el portal de NodeFlow con antelación. El asistente los consulta en tiempo real y responde con precisión. Si la farmacia pertenece a un colegio que publica turnos online, podemos configurar una sincronización automatizada.`
- **FAQ_Q2:** `¿El asistente habla en euskera?` — **FAQ_A2:** `Sí. NodeFlow detecta automáticamente si el cliente habla en euskera o castellano y responde en el mismo idioma. En los barrios de Bilbao con alta presencia euskaldun (Deusto, Begoña, Rekalde), este punto marca una diferencia real en la percepción de servicio.`
- **FAQ_Q3:** `¿Puede decirle al cliente si tenemos un medicamento concreto?` — **FAQ_A3:** `Puedes configurar un listado de medicamentos de alta rotación. Para consultas de stock en tiempo real, actualmente se requiere integración con tu sistema de gestión de farmacia. Consúltanos para ver si tu software tiene API disponible.`
- **FAQ_Q4:** `¿Puede una farmacia pequeña de barrio permitirse NodeFlow?` — **FAQ_A4:** `El plan Negocio cuesta 49€/mes — menos que 2 horas del tiempo de un auxiliar. Para una farmacia que evita 20 llamadas diarias de "¿están de guardia?", el ahorro de tiempo justifica la inversión desde el primer mes.`
- **RELATED_1:** `/farmacias` — `NodeFlow para farmacias →`
- **RELATED_2:** `/blog/recepcionista-ia-farmacias-espana` — `IA para farmacias en España →`
- **RELATED_3:** `/blog/ia-atencion-telefonica-pymes-espana` — `IA telefónica para pymes →`

### 3.4 — `asistente-ia-farmacia-donostia`

- **TITLE:** `Asistente IA para farmacias en Donostia-San Sebastián | NodeFlow Blog`
- **H1:** `Asistente IA para farmacias en Donostia-San Sebastián`
- **META_DESC:** `Las farmacias de Donostia-San Sebastián automatizan consultas de turnos, horarios y disponibilidad con IA. Atención en castellano y euskera 24/7.`
- **KEYWORDS:** `asistente IA farmacia Donostia, recepcionista virtual farmacia San Sebastián, farmacia turno guardia IA Gipuzkoa`
- **SECTION:** `farmacias`
- **S1:** `Las farmacias donostiarras: alta demanda y atención bilingüe obligatoria`
- **S2:** `IA que atiende en euskera y castellano: imprescindible en Donostia`
- **S3:** `Turnos de guardia, horarios y reserva de medicamentos con IA`
- **S4:** `El impacto del turismo en la demanda telefónica de farmacias en verano`
- **S5:** `Implantación en menos de 24 horas: cómo funciona para una farmacia donostiarra`
- **INTRO:** `Donostia-San Sebastián tiene una demografía lingüística particular: una parte significativa de sus clientes prefiere ser atendida en euskera. Para una farmacia en el Casco Viejo o en Gros, tener un asistente que detecte automáticamente el idioma y responda con naturalidad no es un lujo — es una expectativa. El turismo internacional añade otro reto: en verano, las consultas en inglés y francés no son infrecuentes.`
- **CTA_TITLE:** `¿Tu farmacia en Donostia necesita atención 24/7 en euskera?`
- **CTA_BODY:** `NodeFlow atiende en castellano, euskera e incluso inglés. Sin esperas, sin interrumpir al farmacéutico. Alta en menos de 24 horas.`
- **FAQ_Q1:** `¿Puede el asistente atender en varios idiomas simultáneamente?` — **FAQ_A1:** `NodeFlow atiende en castellano y euskera de forma nativa. Para idiomas adicionales como inglés o francés (útil para farmacias en zonas turísticas de Donostia), consúltanos — tenemos soporte multiidioma en plan Pro.`
- **FAQ_Q2:** `¿Cómo gestiona las guardias en el Colegio de Farmacéuticos de Gipuzkoa?` — **FAQ_A2:** `Configuramos los turnos de guardia manualmente en el portal, con actualización semanal o mensual según el calendario del colegio. Próximamente tendremos integración directa con los colegios farmacéuticos vascos.`
- **FAQ_Q3:** `¿El asistente puede tomar nota de reservas de medicamentos?` — **FAQ_A3:** `Sí. El asistente puede recoger el nombre del medicamento, el nombre del cliente y su teléfono, y enviarte una notificación por WhatsApp o email para que lo tengas preparado cuando venga a recogerlo.`
- **FAQ_Q4:** `¿Funciona con el sistema de gestión de nuestra farmacia?` — **FAQ_A4:** `NodeFlow funciona de forma independiente como canal de atención telefónica. Para integraciones con sistemas de gestión de farmacia específicos, consúltanos — evaluamos cada caso y solemos encontrar solución en pocas semanas.`
- **RELATED_1:** `/farmacias` — `NodeFlow para farmacias →`
- **RELATED_2:** `/blog/recepcionista-ia-farmacia-bilbao` — `IA para farmacias en Bilbao →`
- **RELATED_3:** `/blog/recepcionista-ia-farmacia-bilbao` — `Turnos y guardias con IA →`

### 3.5 — `asistente-ia-taller-mecanico-donostia`

- **TITLE:** `Asistente IA para talleres mecánicos en Donostia y Gipuzkoa | NodeFlow Blog`
- **H1:** `Asistente IA para talleres mecánicos en Donostia y Gipuzkoa`
- **META_DESC:** `Los talleres mecánicos de Donostia y Gipuzkoa automatizan citas, presupuestos y estado de reparaciones con IA. 24/7 sin interrumpir al mecánico.`
- **KEYWORDS:** `asistente IA taller mecánico Donostia, recepcionista virtual taller Gipuzkoa, automatizar citas taller IA San Sebastián`
- **SECTION:** `talleres`
- **S1:** `Los talleres de Gipuzkoa pierden llamadas mientras el mecánico trabaja`
- **S2:** `IA que gestiona citas y presupuestos telefónicos en castellano y euskera`
- **S3:** `Recordatorios de ITV, mantenimiento y revisiones periódicas automáticos`
- **S4:** `El cliente pregunta por el estado de su coche: el asistente responde`
- **S5:** `ROI para un taller mecánico mediano en Donostia`
- **INTRO:** `En un taller mecánico de Donostia, el jefe de taller suele estar en el foso o bajo un coche cuando suena el teléfono. El administrativo, si lo hay, está tramitando presupuestos o coordnando con proveedores. El resultado es predecible: entre el 25 y el 40% de las llamadas no se contestan, y un porcentaje de esas pertenecen a clientes nuevos que van a llamar al siguiente taller.`
- **CTA_TITLE:** `¿Tu taller en Donostia pierde clientes por llamadas no atendidas?`
- **CTA_BODY:** `NodeFlow atiende cada llamada, gestiona citas y envía recordatorios de ITV y mantenimiento. Alta en menos de 24 horas.`
- **FAQ_Q1:** `¿El asistente puede dar presupuestos?` — **FAQ_A1:** `Para presupuestos genéricos (cambio de aceite, frenos, neumáticos) puedes configurar rangos de precio orientativos. Para presupuestos personalizados, el asistente recoge la matrícula, la descripción del problema y el teléfono del cliente, y te notifica para que puedas llamar con el presupuesto.`
- **FAQ_Q2:** `¿Funciona en euskera?` — **FAQ_A2:** `Sí. NodeFlow detecta automáticamente si el cliente habla en euskera o castellano y responde en el mismo idioma. En Gipuzkoa, donde el índice de euskaldunización es alto, este punto es especialmente relevante para talleres en municipios como Errenteria, Hernani o el propio Donostia.`
- **FAQ_Q3:** `¿Puede avisarme cuando un cliente llama para saber el estado de su coche?` — **FAQ_A3:** `Sí. El asistente recoge el nombre del cliente y la matrícula, y te envía una notificación por WhatsApp con los datos. Si tienes el estado de la reparación configurado en el portal, puede incluso responder directamente al cliente.`
- **FAQ_Q4:** `¿Cuánto tarda la configuración para un taller?` — **FAQ_A4:** `El alta estándar tarda menos de 24 horas. Necesitamos el nombre del taller, horarios, servicios principales y el número de teléfono donde quieres redirigir las llamadas no atendidas. Sin hardware adicional, sin cambiar tu número.`
- **RELATED_1:** `/talleres` — `NodeFlow para talleres mecánicos →`
- **RELATED_2:** `/blog/recepcionista-ia-taller-mecanico-bilbao` — `IA para talleres en Bilbao →`
- **RELATED_3:** `/blog/recepcionista-ia-taller-vitoria` — `IA para talleres en Vitoria →`

### 3.6 — `asistente-ia-centro-medico-privado`

- **TITLE:** `Asistente IA para centros médicos privados: citas, especialistas y seguros | NodeFlow Blog`
- **H1:** `Asistente IA para centros médicos privados: citas, especialistas y seguros`
- **META_DESC:** `Cómo los centros médicos privados automatizan la gestión de citas por especialidad, consultas sobre seguros y recordatorios con IA. Menos carga para el personal.`
- **KEYWORDS:** `asistente IA centro médico privado España, recepcionista virtual clínica privada, automatizar citas especialistas IA`
- **SECTION:** `clinicas`
- **S1:** `Los centros médicos privados gestionan demasiadas llamadas manualmente`
- **S2:** `IA que asigna citas al especialista correcto sin intervención humana`
- **S3:** `Gestión automática de seguros: Adeslas, Sanitas, Asisa, DKV`
- **S4:** `Recordatorios y rebooking para reducir no-shows en medicina privada`
- **S5:** `Implementar IA en un centro médico privado: pasos y tiempos`
- **INTRO:** `Un centro médico privado con 5-10 especialistas puede recibir más de 100 llamadas diarias. La recepcionista tiene que identificar la especialidad, buscar al médico correcto, consultar disponibilidad, verificar el seguro del paciente y confirmar la cita. Cada llamada tarda entre 3 y 7 minutos. Con NodeFlow, ese proceso se automatiza para el 80% de los casos estándar.`
- **CTA_TITLE:** `¿Tu centro médico gestiona más de 50 llamadas al día manualmente?`
- **CTA_BODY:** `NodeFlow automatiza la asignación por especialidad, verifica seguros y envía recordatorios. Sin contratar más personal.`
- **FAQ_Q1:** `¿Puede el asistente derivar al especialista correcto?` — **FAQ_A1:** `Sí. Configuras los especialistas y sus áreas (cardiología, dermatología, traumatología…) y el asistente pregunta el motivo de la consulta y asigna automáticamente al especialista adecuado. Si hay ambigüedad, recoge los datos y transfiere a recepción.`
- **FAQ_Q2:** `¿Cómo gestiona los seguros de los pacientes?` — **FAQ_A2:** `El asistente puede preguntar por el seguro del paciente al inicio de la llamada y responder sobre qué especialistas están incluidos en cada póliza, si el centro trabaja con ese seguro y si requiere autorización previa. Para autorizaciones específicas, deriva al personal.`
- **FAQ_Q3:** `¿El sistema es compatible con el RGPD y la normativa sanitaria?` — **FAQ_A3:** `NodeFlow cumple con el RGPD. El asistente avisa al inicio de cada llamada que está siendo atendida por un sistema de IA. Los datos recogidos se almacenan de forma segura. Para el cumplimiento completo con la normativa sanitaria específica, recomendamos revisar con tu DPO la política de uso.`
- **FAQ_Q4:** `¿Funciona para un centro con varios centros físicos?` — **FAQ_A4:** `Sí. Puedes configurar múltiples números de teléfono (uno por centro) o un único número central que el asistente gestiona diferenciando por ubicación. El plan Pro incluye asistentes ilimitados para cadenas o grupos médicos.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas →`
- **RELATED_2:** `/blog/recepcionista-ia-clinicas-seguros-privados-espana` — `IA con seguros Adeslas, Sanitas →`
- **RELATED_3:** `/blog/asistente-voz-clinica-dental-pais-vasco` — `IA para clínicas en el País Vasco →`

### 3.7 — `recepcionista-ia-clinicas-seguros-privados-espana`

- **TITLE:** `Recepcionista IA para clínicas con seguros privados: Adeslas, Sanitas, Asisa | NodeFlow Blog`
- **H1:** `Recepcionista IA para clínicas con seguros privados: Adeslas, Sanitas y Asisa`
- **META_DESC:** `Cómo las clínicas con seguros privados automatizan la verificación de cobertura, autorización y citas con IA. Compatible con Adeslas, Sanitas, Asisa, DKV y Mutua.`
- **KEYWORDS:** `recepcionista IA clínica seguros privados, asistente IA Adeslas Sanitas Asisa, automatizar verificación seguro IA clínica`
- **SECTION:** `clinicas`
- **S1:** `Las clínicas con seguros: el laberinto de verificaciones manuales`
- **S2:** `IA que verifica cobertura y responde sobre copagos en tiempo real`
- **S3:** `Cómo configurar en NodeFlow cada aseguradora: Adeslas, Sanitas, Asisa, DKV, Mutua`
- **S4:** `Autorización previa: cuándo el asistente deriva y cuándo no`
- **S5:** `Ahorro real de tiempo en recepción: estudio de caso`
- **INTRO:** `Para una clínica que trabaja con 5 o más aseguradoras, la gestión de llamadas es especialmente compleja. El paciente pregunta si su seguro cubre el tratamiento, si necesita volante, cuál es el copago y si hay lista de espera. La recepcionista tiene que saber de memoria las condiciones de cada póliza de cada aseguradora. Es información que cambia, que varía por póliza y que lleva a errores que después suponen reclamaciones.`
- **CTA_TITLE:** `¿Tu clínica trabaja con Adeslas, Sanitas o Asisa?`
- **CTA_BODY:** `NodeFlow responde automáticamente sobre coberturas, copagos y derivaciones. Sin que la recepcionista tenga que memorizar cada póliza.`
- **FAQ_Q1:** `¿Cómo se actualiza la información de cada seguro?` — **FAQ_A1:** `En el portal de NodeFlow, en Configuración → Base de Conocimiento, subes o editas la información de cada aseguradora. Cuando cambian las condiciones, actualizas el documento y el asistente empieza a usar la nueva información en la siguiente llamada. Sin programación, sin esperas.`
- **FAQ_Q2:** `¿El asistente puede tramitar la autorización previa con la aseguradora?` — **FAQ_A2:** `Actualmente el asistente informa sobre si se necesita autorización previa y qué datos necesita el paciente para solicitarla. La tramitación directa con la aseguradora (llamada o portal propio) sigue siendo manual. Tenemos en roadmap la integración directa con las APIs de las principales aseguradoras.`
- **FAQ_Q3:** `¿Funciona para clínicas que trabajan solo con una aseguradora?` — **FAQ_A3:** `Sí, y es incluso más sencillo de configurar. Defines los servicios cubiertos, los copagos y los requisitos, y el asistente responde con precisión a todas las consultas. Para clínicas concertadas con una sola mutua, el asistente también puede gestionar el alta de nuevos asegurados.`
- **FAQ_Q4:** `¿Qué pasa cuando el paciente tiene una póliza con condiciones especiales?` — **FAQ_A4:** `Para pólizas con condiciones no estándar, el asistente puede recoger el nombre del paciente y el número de póliza, y notificarte para que la recepcionista llame de vuelta con la información correcta. Esto evita errores por dar información genérica a un paciente con una póliza especial.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas →`
- **RELATED_2:** `/blog/asistente-ia-centro-medico-privado` — `IA para centros médicos privados →`
- **RELATED_3:** `/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia` — `IA y seguros para fisioterapia →`

### 3.8 — `integracion-ia-software-gestion-clinica`

- **TITLE:** `Integrar IA con el software de gestión de tu clínica: guía práctica | NodeFlow Blog`
- **H1:** `Integrar IA con el software de gestión de tu clínica: guía práctica`
- **META_DESC:** `Cómo conectar un asistente de voz IA con tu software de gestión clínica existente: Google Calendar, Gesden, Clinic Cloud y otros. Sin cambiar lo que ya funciona.`
- **KEYWORDS:** `integrar IA software gestión clínica, asistente voz Google Calendar clínica, NodeFlow integración software médico`
- **SECTION:** `clinicas`
- **S1:** `El problema de la isla: tu software de gestión y el teléfono no se hablan`
- **S2:** `Integración con Google Calendar: la forma más rápida de empezar`
- **S3:** `Cómo NodeFlow se conecta con Gesden, Clinic Cloud y otros softwares`
- **S4:** `Qué información fluye entre la IA y tu software de gestión`
- **S5:** `Pasos para una integración sin interrupciones en la clínica`
- **INTRO:** `Cada clínica tiene su software de gestión: Gesden para dentales, Clinic Cloud para médicos privados, software propio para cadenas, Google Calendar para los más simples. El problema es que el teléfono siempre ha sido una isla: las llamadas llegan, alguien apunta en un papel o en la agenda, y luego hay que traspasar todo al sistema. NodeFlow cierra ese bucle.`
- **CTA_TITLE:** `¿Tu clínica ya tiene software de gestión y quieres añadir IA?`
- **CTA_BODY:** `NodeFlow se integra con lo que ya tienes. La configuración más común (Google Calendar) tarda menos de 1 hora.`
- **FAQ_Q1:** `¿Funciona NodeFlow sin integración con ningún software?` — **FAQ_A1:** `Sí. NodeFlow puede funcionar de forma autónoma: el asistente gestiona las llamadas, recoge citas y envía confirmaciones, y tú ves todo en el portal web. La integración con software externo es opcional y mejora la experiencia, pero no es obligatoria para empezar.`
- **FAQ_Q2:** `¿Cuánto tiempo lleva la integración con Google Calendar?` — **FAQ_A2:** `Menos de 1 hora. En la sección Integraciones del portal, conectas tu cuenta de Google, seleccionas el calendario de la clínica y defines los tipos de cita. A partir de ese momento, el asistente consulta disponibilidad real y reserva directamente en el calendario.`
- **FAQ_Q3:** `¿NodeFlow puede leer datos de pacientes de nuestro software?` — **FAQ_A3:** `Para las integraciones avanzadas (leer fichas de pacientes, historial de citas, etc.) estudiamos cada caso según el software que uses y si tiene API disponible. Contacta con nosotros indicando tu software para evaluar la viabilidad.`
- **FAQ_Q4:** `¿La integración afecta al funcionamiento actual del software?` — **FAQ_A4:** `No. NodeFlow se conecta como una aplicación adicional que lee y escribe en el calendario o el sistema según los permisos que definas. No modifica la estructura de datos del software principal ni interrumpe su funcionamiento habitual.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas →`
- **RELATED_2:** `/blog/google-calendar-citas-automaticas-negocio` — `Google Calendar con IA →`
- **RELATED_3:** `/blog/asistente-ia-centro-medico-privado` — `IA para centros médicos privados →`

### 3.9 — `recepcionista-ia-consultas-medicas-generales`

- **TITLE:** `Recepcionista IA para consultas médicas: gestiona citas sin saturar la línea | NodeFlow Blog`
- **H1:** `Recepcionista IA para consultas médicas: gestiona citas sin saturar la línea`
- **META_DESC:** `Las consultas médicas privadas automatizan citas, recordatorios y consultas sobre seguros con IA. Sin saturar la línea, sin contratar más personal.`
- **KEYWORDS:** `recepcionista IA consulta médica, asistente virtual médico privado España, automatizar citas consulta médica IA`
- **SECTION:** `clinicas`
- **S1:** `La consulta médica privada: teléfono saturado, pacientes esperando`
- **S2:** `IA que atiende llamadas mientras el médico está en consulta`
- **S3:** `Recordatorios automáticos y rebooking para consultas médicas`
- **S4:** `Primer contacto y triaje telefónico con IA`
- **S5:** `Coste real vs. beneficio para una consulta médica con 20 pacientes/día`
- **INTRO:** `Una consulta médica privada con un solo médico puede recibir entre 30 y 60 llamadas al día. La secretaria, cuando la hay, alterna entre atender en mostrador, gestionar la agenda y responder el teléfono. El resultado habitual: llamadas en espera, pacientes frustrados y citas perdidas. NodeFlow actúa como una segunda recepcionista que solo gestiona el teléfono, siempre disponible, nunca saturada.`
- **CTA_TITLE:** `¿Tu consulta médica recibe más llamadas de las que puede gestionar?`
- **CTA_BODY:** `NodeFlow atiende todas las llamadas, gestiona citas y envía recordatorios. Sin saturar al personal ni perder pacientes.`
- **FAQ_Q1:** `¿Puede el asistente hacer un triaje básico de urgencias?` — **FAQ_A1:** `El asistente puede seguir un flujo de preguntas para determinar si la situación requiere atención urgente (hoy), una cita normal o simplemente información. Para urgencias reales, puede facilitar el número de urgencias o notificar al médico directamente por WhatsApp.`
- **FAQ_Q2:** `¿Cómo gestiona el asistente a los pacientes habituales?` — **FAQ_A2:** `Con memoria persistente, NodeFlow recuerda a los pacientes habituales: su nombre, el médico con el que suelen ir y sus preferencias de horario. La llamada es más rápida y el paciente siente que le conocen, aunque esté hablando con una IA.`
- **FAQ_Q3:** `¿El asistente puede informar sobre los honorarios del médico?` — **FAQ_A3:** `Sí. Configuras los honorarios por tipo de consulta (primera visita, revisión, urgencia) y el asistente los comunica cuando el paciente pregunta. Para consultas con seguro, puede indicar qué seguros acepta el médico y si hay copago.`
- **FAQ_Q4:** `¿Puede funcionar para una consulta que abre solo 3 días a la semana?` — **FAQ_A4:** `Perfectamente. Configuras los horarios de apertura y los días de consulta, y el asistente gestiona las citas solo en los días disponibles. Fuera de esos días, informa de la próxima disponibilidad y puede recoger una solicitud de llamada de vuelta.`
- **RELATED_1:** `/clinicas` — `NodeFlow para clínicas →`
- **RELATED_2:** `/blog/asistente-ia-centro-medico-privado` — `IA para centros médicos privados →`
- **RELATED_3:** `/blog/automatizar-recordatorios-citas-reducir-no-shows` — `Reducir no-shows con IA →`

### 3.10 — `asistente-ia-spa-balneario-espana`

- **TITLE:** `Asistente IA para spas y balnearios en España: reservas y tratamientos | NodeFlow Blog`
- **H1:** `Asistente IA para spas y balnearios en España: reservas y tratamientos`
- **META_DESC:** `Los spas y balnearios en España automatizan reservas de tratamientos, paquetes y circuitos de aguas con IA. Atención multiidioma 24/7 para turismo nacional e internacional.`
- **KEYWORDS:** `asistente IA spa España, recepcionista virtual balneario, automatizar reservas spa IA`
- **SECTION:** `estetica`
- **S1:** `Spas y balnearios: el teléfono como primer punto de contacto para el cliente premium`
- **S2:** `IA que reserva tratamientos y paquetes de bienestar en varios idiomas`
- **S3:** `Gestión de bonos de regalo y paquetes especiales con IA`
- **S4:** `Recordatorios y preparación previa al tratamiento automáticos`
- **S5:** `ROI para un spa de 20-40 cabinas en España`
- **INTRO:** `Un spa o balneario de nivel medio-alto en España gestiona entre 40 y 100 reservas a la semana, muchas de ellas por teléfono. El cliente que llama para reservar un fin de semana de bienestar espera una experiencia premium desde el primer contacto. Si el teléfono tarda en contestar, si quien atiende no conoce bien los tratamientos o si la reserva se pierde por error, la decepción llega antes de la primera toalla caliente.`
- **CTA_TITLE:** `¿Tu spa pierde reservas por no contestar el teléfono a tiempo?`
- **CTA_BODY:** `NodeFlow atiende cada llamada con tono premium, reserva tratamientos y envía confirmaciones. En los idiomas que necesites.`
- **FAQ_Q1:** `¿El asistente puede explicar los diferentes circuitos y tratamientos?` — **FAQ_A1:** `Sí. Subes la descripción de cada tratamiento, duración, precio y disponibilidad al portal de NodeFlow. El asistente puede explicar en detalle cada opción y recomendar la más adecuada según lo que busca el cliente, antes de proceder a la reserva.`
- **FAQ_Q2:** `¿Puede atender en inglés o francés para turistas?` — **FAQ_A2:** `El plan Pro de NodeFlow incluye soporte multiidioma. Para spas en zonas turísticas o balnearios que reciben clientes internacionales, el asistente puede atender en castellano, inglés y francés de forma nativa.`
- **FAQ_Q3:** `¿Cómo gestiona las reservas de grupos o bonos de regalo?` — **FAQ_A3:** `El asistente puede gestionar reservas para grupos pequeños (configurado con número máximo de personas por tipo de reserva) y reconocer cuando el cliente menciona un bono de regalo, recogiendo el código y verificando su validez si tienes el sistema configurado.`
- **FAQ_Q4:** `¿Puede enviar recordatorios de preparación previa al tratamiento?` — **FAQ_A4:** `Sí. Puedes configurar un email automático 24 horas antes de la cita con instrucciones específicas para cada tratamiento (llegar en ayunas, no depilarse, qué llevar…). Esto mejora la experiencia del cliente y reduce las cancelaciones por no saber qué esperar.`
- **RELATED_1:** `/estetica` — `NodeFlow para estética →`
- **RELATED_2:** `/blog/asistente-ia-centros-estetica-laser` — `IA para centros de estética avanzada →`
- **RELATED_3:** `/blog/automatizar-recordatorios-citas-reducir-no-shows` — `Reducir no-shows con IA →`

### 3.11 — `ia-recepcion-virtual-sector-servicios-espana`

- **TITLE:** `La recepción virtual IA ya es una realidad para los servicios en España | NodeFlow Blog`
- **H1:** `La recepción virtual IA ya es una realidad para los servicios en España`
- **META_DESC:** `Las empresas de servicios en España adoptan recepción virtual con IA para gestionar llamadas, citas y consultas 24/7. Estado actual, casos reales y próximos pasos.`
- **KEYWORDS:** `recepción virtual IA servicios España, asistente voz empresas servicios, automatizar llamadas sector servicios IA`
- **SECTION:** `general`
- **S1:** `El sector servicios español y el teléfono: un problema que lleva décadas sin resolver`
- **S2:** `Qué hace exactamente una recepción virtual con IA en 2026`
- **S3:** `Sectores que ya la usan: de clínicas a talleres y bufetes`
- **S4:** `El coste real de no tener recepcionista virtual en una empresa de servicios`
- **S5:** `Cómo empezar: los primeros 30 días con una recepción virtual`
- **INTRO:** `En 2026, más del 60% de las pymes españolas de servicios siguen gestionando su teléfono de la misma manera que hace 20 años: alguien coge el teléfono cuando puede, o no lo coge. La recepción virtual con IA no es ya una tecnología futura — es una solución accesible desde 49€/mes que está transformando la forma en que clínicas, talleres, bufetes y academias gestionan su primer punto de contacto con el cliente.`
- **CTA_TITLE:** `¿Tu empresa de servicios todavía gestiona el teléfono manualmente?`
- **CTA_BODY:** `NodeFlow es la recepción virtual IA para pymes españolas. Sin hardware, sin cambiar tu número. Desde 49€/mes.`
- **FAQ_Q1:** `¿Qué tipo de empresas de servicios se benefician más de la IA?` — **FAQ_A1:** `Las que más se benefician son las que reciben muchas llamadas repetitivas: clínicas, talleres, peluquerías, academias, restaurantes, asesorías. En general, cualquier negocio que recibe más de 10 llamadas diarias y no puede contestar todas en tiempo real.`
- **FAQ_Q2:** `¿Es la IA capaz de gestionar llamadas complejas?` — **FAQ_A2:** `Para el 70-80% de las llamadas de una pyme de servicios (citas, horarios, preguntas frecuentes), la IA las gestiona completamente. Para el 20% restante (quejas, situaciones no previstas, ventas complejas), el asistente recoge la información y notifica al humano para que llame de vuelta.`
- **FAQ_Q3:** `¿Cuánto tiempo tarda en configurarse una recepción virtual?` — **FAQ_A3:** `El alta estándar tarda menos de 24 horas. Se necesita información básica del negocio: nombre, horarios, servicios y preguntas frecuentes. La configuración avanzada (integraciones, múltiples especialistas, idiomas) puede llevar unos días más, pero el asistente ya está operativo desde el primer día.`
- **FAQ_Q4:** `¿La recepción virtual funciona también para empresas B2B?` — **FAQ_A4:** `Sí. Muchas empresas B2B usan NodeFlow para gestionar las llamadas entrantes de clientes y proveedores, filtrar llamadas comerciales y gestionar la agenda del equipo comercial. El tono y el vocabulario se adaptan al contexto B2B en la configuración.`
- **RELATED_1:** `/asesorias` — `NodeFlow para asesorías →`
- **RELATED_2:** `/blog/cuanto-cuesta-recepcionista-virtual-ia` — `¿Cuánto cuesta una recepcionista IA? →`
- **RELATED_3:** `/blog/ia-atencion-telefonica-pymes-espana` — `IA telefónica para pymes →`

### 3.12 — `recepcionista-ia-academias-idiomas-espana`

- **TITLE:** `Recepcionista IA para academias de idiomas: matrículas y consultas automáticas | NodeFlow Blog`
- **H1:** `Recepcionista IA para academias de idiomas: matrículas y consultas automáticas`
- **META_DESC:** `Las academias de idiomas en España automatizan consultas de niveles, horarios, precios y matrículas con IA. Sin perder alumnos potenciales fuera del horario de atención.`
- **KEYWORDS:** `recepcionista IA academia idiomas España, asistente virtual escuela idiomas, automatizar matrículas academia inglés IA`
- **SECTION:** `academias`
- **S1:** `Las academias de idiomas pierden alumnos por no contestar en el momento`
- **S2:** `IA que informa de niveles, horarios y precios sin intermediarios`
- **S3:** `Automatizar el proceso de matrícula: del primer contacto a la inscripción`
- **S4:** `Gestión de la lista de espera y grupos nuevos con IA`
- **S5:** `Retención de alumnos: recordatorios de inicio de curso y renovación`
- **INTRO:** `Una academia de idiomas en España suele recibir picos de llamadas en enero (propósitos de año nuevo), septiembre (inicio de curso) y después de Navidad. Fuera de esos picos, siguen llegando consultas de padres, adultos y empresas. El problema es que la persona que atiende el teléfono también da clases, gestiona la administración y no siempre puede contestar en el momento en que el alumno potencial llama.`
- **CTA_TITLE:** `¿Tu academia de idiomas pierde alumnos por no contestar el teléfono?`
- **CTA_BODY:** `NodeFlow atiende consultas de niveles, precios y horarios 24/7 y gestiona las solicitudes de matrícula automáticamente.`
- **FAQ_Q1:** `¿El asistente puede hacer un test de nivel básico por teléfono?` — **FAQ_A1:** `Puede hacer preguntas de orientación (¿Has estudiado inglés antes? ¿Cuántos años? ¿Puedes mantener una conversación básica?) para orientar al alumno hacia el nivel adecuado antes de matricularse. Para una evaluación formal, el asistente puede programar una prueba de nivel con el profesor.`
- **FAQ_Q2:** `¿Puede gestionar grupos de empresa (formación B2B)?` — **FAQ_A2:** `Sí. Puedes configurar una sección específica para empresas, donde el asistente recoge los datos del contacto de RRHH, el número de alumnos, los idiomas y el nivel, y te notifica para hacer una propuesta personalizada.`
- **FAQ_Q3:** `¿Cómo gestiona las consultas en diferentes idiomas?` — **FAQ_A3:** `Una academia de idiomas puede configurar NodeFlow para atender en varios idiomas (castellano, inglés, francés, euskera) — especialmente útil si hay alumnos extranjeros o si la academia quiere proyectar una imagen internacional. El plan Pro incluye soporte multiidioma.`
- **FAQ_Q4:** `¿El asistente puede recordar a los alumnos que se acaba el bono de clases?` — **FAQ_A4:** `Sí. Con el plan Pro, puedes configurar fechas críticas por alumno: fecha de fin de bono, fecha de examen oficial, inicio de nuevo trimestre. El asistente envía recordatorios automáticos con anticipación suficiente para que el alumno renueve o reserve el examen a tiempo.`
- **RELATED_1:** `/academias` — `NodeFlow para academias →`
- **RELATED_2:** `/blog/asistente-ia-academia-vitoria` — `IA para academia en Vitoria →`
- **RELATED_3:** `/blog/ia-para-academias-clases-particulares` — `IA para academias y clases particulares →`

### 3.13 — `asistente-ia-peluqueria-coloracion-citas-largas`

- **TITLE:** `Asistente IA para peluquerías: cómo gestionar citas largas de coloración y tratamientos | NodeFlow Blog`
- **H1:** `Asistente IA para peluquerías: cómo gestionar citas largas de coloración`
- **META_DESC:** `Las peluquerías con servicios de coloración y tratamientos largos tienen un reto de agenda específico. Cómo la IA gestiona citas de 2-3 horas sin errores ni dobles reservas.`
- **KEYWORDS:** `asistente IA peluquería coloración, recepcionista virtual peluquería citas largas, automatizar reservas coloración peluquería IA`
- **SECTION:** `peluquerias`
- **S1:** `El reto de las citas largas en peluquerías: coloración, mechas y tratamientos`
- **S2:** `IA que calcula el tiempo correcto para cada servicio combinado`
- **S3:** `Lista de espera y gestión de cancelaciones de última hora`
- **S4:** `Recordatorios previos: instrucciones para el cliente antes de la coloración`
- **S5:** `Cómo NodeFlow gestiona una agenda de 3 estilistas y citas de 30 min a 3 horas`
- **INTRO:** `Una coloración completa con corte y secado puede ocupar 3 horas de agenda. Si el cliente llama para reservar y la recepcionista no calcula bien el tiempo, el siguiente cliente tiene que esperar, el estilista llega tarde a todas sus citas del día y el día acaba en caos. La gestión de citas largas en peluquerías es un problema de agenda complejo que la IA puede resolver sin errores.`
- **CTA_TITLE:** `¿Tu peluquería tiene problemas con las citas largas de coloración?`
- **CTA_BODY:** `NodeFlow calcula automáticamente el tiempo de cada servicio, evita solapamientos y envía recordatorios con instrucciones previas al cliente.`
- **FAQ_Q1:** `¿El asistente sabe cuánto dura cada servicio?` — **FAQ_A1:** `Sí. En la configuración de Servicios del portal defines la duración de cada servicio: corte 45 min, coloración completa 150 min, mechas con papel 120 min, tratamiento de keratina 90 min. Cuando el cliente pide una cita combinada, el asistente suma las duraciones y busca el hueco correcto en la agenda.`
- **FAQ_Q2:** `¿Puede gestionar servicios con varios estilistas?` — **FAQ_A2:** `Sí. Puedes asignar cada tipo de servicio a estilistas específicos y definir su disponibilidad por separado. Para un servicio que requiere colorista + estilista (aplicación + corte), el asistente puede coordinar los dos en secuencia automáticamente.`
- **FAQ_Q3:** `¿Cómo gestiona las cancelaciones de coloración de última hora?` — **FAQ_A3:** `Cuando hay una cancelación, el asistente puede notificarte y, si tienes una lista de espera configurada, contactar automáticamente al siguiente cliente para ofrecerle el hueco. Las cancelaciones de citas largas dejan huecos que son difíciles de rellenar sin un sistema activo.`
- **FAQ_Q4:** `¿Puede enviar instrucciones previas a clientes de coloración?` — **FAQ_A4:** `Sí. Puedes configurar un email automático 24 horas antes de la cita con instrucciones específicas para coloración: llegar con el cabello seco, sin acondicionador, qué esperar del proceso, etc. Esto reduce las preguntas en el momento de la cita y mejora la experiencia.`
- **RELATED_1:** `/peluquerias` — `NodeFlow para peluquerías →`
- **RELATED_2:** `/blog/recepcionista-ia-peluqueria-bilbao` — `IA para peluquerías en Bilbao →`
- **RELATED_3:** `/blog/automatizar-recordatorios-citas-reducir-no-shows` — `Reducir no-shows con IA →`

- [ ] **Step for all 13 articles: Create directories and write HTML**

For each article, run:
```bash
mkdir -p public/blog/<SLUG>
```
Then create `public/blog/<SLUG>/index.html` using the template from `public/blog/asistente-ia-opticas-espana/index.html` with the unique content from the table above substituted in.

- [ ] **Step: Commit all 13 articles**

```bash
git add public/blog/asistente-ia-clinica-dental-donostia \
        public/blog/recepcionista-ia-clinica-dental-vitoria \
        public/blog/recepcionista-ia-farmacia-bilbao \
        public/blog/asistente-ia-farmacia-donostia \
        public/blog/asistente-ia-taller-mecanico-donostia \
        public/blog/asistente-ia-centro-medico-privado \
        public/blog/recepcionista-ia-clinicas-seguros-privados-espana \
        public/blog/integracion-ia-software-gestion-clinica \
        public/blog/recepcionista-ia-consultas-medicas-generales \
        public/blog/asistente-ia-spa-balneario-espana \
        public/blog/ia-recepcion-virtual-sector-servicios-espana \
        public/blog/recepcionista-ia-academias-idiomas-espana \
        public/blog/asistente-ia-peluqueria-coloracion-citas-largas
git commit -m "feat: add 13 remaining blog articles — dental, farmacias, talleres, centros médicos, spa, servicios, academias, peluquería"
```

---

## Task 4: Update blog index with missing articles

**Files:** Modify `public/blog/index.html`

The blog index currently lists 39 articles. There are 65 + 13 new = 78 total articles, so ~39 are missing.

- [ ] **Step 1: Identify missing articles**

The articles currently in the index are listed above. The ones NOT in the index are:
`asistente-ia-agencias-viajes-espana`, `asistente-ia-centros-estetica-laser`, `asistente-ia-centros-yoga-pilates`, `asistente-ia-coaches-terapeutas`, `asistente-ia-empresas-reformas-espana`, `asistente-ia-fisioterapia-donostia`, `asistente-ia-gimnasio-donostia`, `asistente-ia-guarderias-caninas`, `asistente-ia-opticas-espana`, `como-configurar-bienvenida-asistente-ia-negocio`, `como-reducir-tiempo-gestion-telefonica-negocio`, `diferencia-chatbot-asistente-voz-ia`, `fisioterapia-seguros-adeslas-sanitas-asistente-ia`, `ia-multiidioma-turismo-pais-vasco`, `ia-voz-para-negocios-espana-tendencias-2026`, `recepcionista-ia-autoescuelas-espana`, `recepcionista-ia-despachos-abogados`, `recepcionista-ia-fisioterapia-bilbao`, `recepcionista-ia-fisioterapia-vitoria`, `recepcionista-ia-notarias-espana`, `recepcionista-ia-nutricionistas-espana`, `recepcionista-ia-peluqueria-vitoria`, `recepcionista-ia-podologos-espana`, `recepcionista-ia-psicologos-terapeutas-espana`, `recepcionista-ia-veterinaria-bilbao` (25 existing) + 13 new = 38 total to add.

- [ ] **Step 2: Add missing post-cards to blog index**

In `public/blog/index.html`, find the `.posts-grid` div. Append the following `<a>` cards (copy the exact pattern of existing cards — each is an `<a class="post-card" href="/blog/SLUG">`).

Template for each card:
```html
<a class="post-card" href="/blog/SLUG">
  <div class="post-card-meta">
    <span class="tag">CATEGORY_TAG</span>
    <span style="font-size:12px;color:var(--muted)">2026-05-29</span>
  </div>
  <h3 style="font-size:18px;font-weight:800;letter-spacing:-0.5px;line-height:1.25;color:#fff">TITLE</h3>
  <p style="font-size:14px;color:var(--dim);line-height:1.6;flex:1">EXCERPT</p>
  <span style="font-size:13px;color:var(--accent-l);font-weight:600">Leer más →</span>
</a>
```

Add these 38 cards (27 existing missing + 13 new) after the last existing card in `.posts-grid`:

| SLUG | CATEGORY_TAG | TITLE | EXCERPT |
|------|-------------|-------|---------|
| asistente-ia-agencias-viajes-espana | agencias de viajes | Asistente IA para agencias de viajes en España | Cómo las agencias automatizan consultas de destinos, presupuestos y reservas. |
| asistente-ia-centros-estetica-laser | estética avanzada | Asistente IA para centros de estética con láser | IA para gestionar citas de láser, hifu y tratamientos de alta duración. |
| asistente-ia-centros-yoga-pilates | yoga y pilates | Asistente IA para centros de yoga y pilates | Automatiza reservas de clases, bonos y consultas de horarios. |
| asistente-ia-coaches-terapeutas | coaching | Asistente IA para coaches y terapeutas | Gestiona sesiones, recordatorios y primeros contactos de forma automática. |
| asistente-ia-empresas-reformas-espana | reformas | Asistente IA para empresas de reformas | Automatiza solicitudes de presupuesto y seguimiento de obras. |
| asistente-ia-fisioterapia-donostia | fisioterapia | Asistente IA para fisioterapia en Donostia | IA para clínicas de fisioterapia en Donostia-San Sebastián. |
| asistente-ia-gimnasio-donostia | gimnasios | Asistente IA para gimnasios en Donostia | Altas, bajas, horarios de clases y consultas en Donostia. |
| asistente-ia-guarderias-caninas | guardería canina | Asistente IA para guarderías caninas | Reservas de estancias, servicios y consultas de cuidados. |
| asistente-ia-opticas-espana | ópticas | Asistente IA para ópticas en España | Automatiza citas de revisión, renovaciones y consultas de seguros ópticos. |
| como-configurar-bienvenida-asistente-ia-negocio | configuración | Cómo configurar el saludo de tu asistente IA | Guía práctica para configurar la bienvenida perfecta para tu negocio. |
| como-reducir-tiempo-gestion-telefonica-negocio | productividad | Cómo reducir el tiempo de gestión telefónica en tu negocio | 5 formas de recuperar horas semanales con automatización de llamadas. |
| diferencia-chatbot-asistente-voz-ia | IA general | Chatbot vs. asistente de voz IA: diferencias clave | Cuándo usar un chatbot y cuándo un asistente de voz para tu negocio. |
| fisioterapia-seguros-adeslas-sanitas-asistente-ia | fisioterapia | IA para fisioterapia con seguros Adeslas y Sanitas | Gestiona coberturas y autorizaciones de seguros en clínicas de fisio. |
| ia-multiidioma-turismo-pais-vasco | turismo | IA multiidioma para el turismo en el País Vasco | Atención en castellano, euskera e inglés para el sector turístico vasco. |
| ia-voz-para-negocios-espana-tendencias-2026 | tendencias | IA de voz para negocios en España: tendencias 2026 | Las principales tendencias de IA de voz que impactarán a las pymes en 2026. |
| recepcionista-ia-autoescuelas-espana | autoescuelas | Recepcionista IA para autoescuelas en España | Automatiza consultas de precios, fechas de examen y reservas de clases. |
| recepcionista-ia-despachos-abogados | abogados | Recepcionista IA para despachos de abogados | Gestiona consultas iniciales, citas y plazos legales con IA. |
| recepcionista-ia-fisioterapia-bilbao | fisioterapia | Recepcionista IA para fisioterapia en Bilbao | Solución específica para clínicas de fisioterapia en Bilbao y Bizkaia. |
| recepcionista-ia-fisioterapia-vitoria | fisioterapia | Recepcionista IA para fisioterapia en Vitoria-Gasteiz | IA para clínicas de fisio en Vitoria: citas, recordatorios y seguros. |
| recepcionista-ia-notarias-espana | notarías | Recepcionista IA para notarías en España | Gestiona citas, consultas de documentos y plazos notariales con IA. |
| recepcionista-ia-nutricionistas-espana | nutrición | Recepcionista IA para nutricionistas en España | Automatiza consultas iniciales, seguimiento y recordatorios de revisión. |
| recepcionista-ia-peluqueria-vitoria | peluquerías | Recepcionista IA para peluquerías en Vitoria-Gasteiz | Gestión de citas, estilistas y servicios en peluquerías vitorianas. |
| recepcionista-ia-podologos-espana | podología | Recepcionista IA para podólogos en España | Automatiza citas, recordatorios y consultas de seguros para podólogos. |
| recepcionista-ia-psicologos-terapeutas-espana | psicología | Recepcionista IA para psicólogos y terapeutas | Gestiona primeras consultas, recordatorios y seguimiento con privacidad. |
| recepcionista-ia-veterinaria-bilbao | veterinarias | Recepcionista IA para veterinarias en Bilbao | Citas, vacunaciones y urgencias en clínicas veterinarias de Bilbao. |
| asistente-ia-clinica-dental-donostia | clínicas dentales | Asistente IA para clínicas dentales en Donostia | Automatiza citas, seguros y urgencias en clínicas dentales donostiarras. |
| recepcionista-ia-clinica-dental-vitoria | clínicas dentales | Recepcionista IA para clínicas dentales en Vitoria | IA para clínicas dentales en Vitoria-Gasteiz con atención bilingüe. |
| recepcionista-ia-farmacia-bilbao | farmacias | Recepcionista IA para farmacias en Bilbao | Turnos, horarios y consultas automatizadas para farmacias bilbaínas. |
| asistente-ia-farmacia-donostia | farmacias | Asistente IA para farmacias en Donostia | Atención 24/7 en euskera y castellano para farmacias donostiarras. |
| asistente-ia-taller-mecanico-donostia | talleres | Asistente IA para talleres mecánicos en Donostia | Citas, presupuestos y recordatorios de ITV en talleres de Gipuzkoa. |
| asistente-ia-centro-medico-privado | clínicas | Asistente IA para centros médicos privados | Automatiza citas por especialidad, seguros y recordatorios en centros médicos. |
| recepcionista-ia-clinicas-seguros-privados-espana | clínicas | IA para clínicas con seguros Adeslas, Sanitas y Asisa | Verifica coberturas y gestiona autorizaciones de seguros privados con IA. |
| integracion-ia-software-gestion-clinica | configuración | Integrar IA con el software de gestión de tu clínica | Guía para conectar NodeFlow con Google Calendar, Gesden y otros. |
| recepcionista-ia-consultas-medicas-generales | clínicas | Recepcionista IA para consultas médicas privadas | Gestiona citas, triaje básico y recordatorios en consultas médicas. |
| asistente-ia-spa-balneario-espana | estética | Asistente IA para spas y balnearios en España | Reservas de tratamientos, bonos de regalo y atención multiidioma. |
| ia-recepcion-virtual-sector-servicios-espana | IA general | La recepción virtual IA en el sector servicios español | Estado actual y casos reales de recepción virtual con IA en pymes. |
| recepcionista-ia-academias-idiomas-espana | academias | Recepcionista IA para academias de idiomas | Matrículas, niveles y horarios automatizados en academias de idiomas. |
| asistente-ia-peluqueria-coloracion-citas-largas | peluquerías | IA para peluquerías: gestiona citas largas de coloración | Cómo la IA gestiona servicios de 2-3 horas sin dobles reservas. |

- [ ] **Step 3: Update hero count in blog index**

Find `<span class="hero-count">` and update the number to `78 artículos`.

- [ ] **Step 4: Commit**

```bash
git add public/blog/index.html
git commit -m "feat: update blog index — add 38 missing articles, total 78"
```

---

## Task 5: Create /guias/index.html

**Files:** Create `public/guias/index.html`

- [ ] **Step 1: Create the file**

```bash
mkdir -p public/guias
```

Create `public/guias/index.html` with this content:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Guías de uso NodeFlow — Para tu sector | NodeFlow</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="Guías de uso NodeFlow para cada sector: fisioterapia, restaurantes, belleza, servicios profesionales y talleres. Descarga en PDF.">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://nodeflow.es/guias">
  <meta property="og:title" content="Guías de uso NodeFlow — Para tu sector">
  <meta property="og:description" content="Guías prácticas de NodeFlow para cada sector de negocio. Incluidas en tu plan.">
  <meta property="og:url" content="https://nodeflow.es/guias">
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
    .container{max-width:900px;margin:0 auto;padding:0 24px}
    a{text-decoration:none;color:inherit}
    .noise{position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025}
    .orb{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0;width:600px;height:600px;top:-200px;left:-150px;background:radial-gradient(circle,rgba(108,92,231,0.2) 0%,transparent 70%)}
    nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:16px 0}
    nav::before{content:'';position:absolute;inset:0;background:rgba(7,7,14,0.9);backdrop-filter:blur(24px);border-bottom:1px solid var(--border)}
    .nav-inner{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;max-width:900px;margin:0 auto;padding:0 24px}
    .logo{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--text)}
    .logo em{color:var(--accent-l);font-style:normal}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:9px 20px;border-radius:10px;font-size:13px;font-weight:600;transition:all .25s;border:none;cursor:pointer}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-primary:hover{background:#7c6cf7;transform:translateY(-1px)}
    .hero{padding:110px 0 48px;position:relative;z-index:2;text-align:center}
    .hero h1{font-size:clamp(28px,5vw,52px);font-weight:900;letter-spacing:-2px;margin-bottom:14px}
    .hero p{color:var(--dim);font-size:17px;max-width:520px;margin:0 auto 16px}
    .info-note{display:inline-block;font-size:13px;color:var(--accent-l);background:rgba(108,92,231,0.1);border:1px solid rgba(108,92,231,0.2);padding:8px 18px;border-radius:100px;margin-top:8px}
    .guides-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px;padding:32px 0 80px;position:relative;z-index:2}
    @media(max-width:600px){.guides-grid{grid-template-columns:1fr}}
    .guide-card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:32px;display:flex;flex-direction:column;gap:16px;transition:all .3s}
    .guide-card:hover{border-color:var(--border-accent);transform:translateY(-4px);background:var(--card-hover);box-shadow:0 16px 48px rgba(0,0,0,0.4)}
    .guide-icon{font-size:40px;display:block}
    .guide-card h3{font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#fff}
    .guide-card p{font-size:15px;color:var(--dim);line-height:1.6;flex:1}
    .guide-badges{display:flex;gap:8px;flex-wrap:wrap}
    .badge{font-size:11px;padding:4px 10px;border-radius:100px;font-weight:600}
    .badge-negocio{background:rgba(108,92,231,0.15);border:1px solid rgba(108,92,231,0.3);color:var(--accent-l)}
    .badge-pro{background:rgba(0,206,201,0.12);border:1px solid rgba(0,206,201,0.3);color:#00cec9}
    .guide-actions{display:flex;gap:10px;flex-wrap:wrap}
    .btn-guide{padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;transition:all .25s;border:1px solid var(--border-accent);color:var(--accent-l);background:rgba(108,92,231,0.08)}
    .btn-guide:hover{background:rgba(108,92,231,0.18);transform:translateY(-1px)}
    .btn-print{padding:10px 16px;border-radius:10px;font-size:14px;font-weight:600;transition:all .25s;border:1px solid var(--border);color:var(--dim);background:transparent;cursor:pointer}
    .btn-print:hover{border-color:var(--border-accent);color:var(--text)}
    .cta-bottom{background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.2);border-radius:20px;padding:40px;text-align:center;margin:0 0 80px;position:relative;z-index:2}
    .cta-bottom h2{font-size:24px;font-weight:800;margin-bottom:10px;color:#fff}
    .cta-bottom p{color:var(--dim);margin-bottom:20px}
    footer{border-top:1px solid var(--border);padding:32px 0}
    .footer-inner{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center}
    .footer-links{display:flex;gap:16px;flex-wrap:wrap}
    .footer-links a{font-size:13px;color:var(--dim)}
    .footer-copy{font-size:12px;color:var(--muted)}
    .wa-float{position:fixed;bottom:24px;right:24px;z-index:200;width:56px;height:56px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:28px;text-decoration:none;box-shadow:0 4px 24px rgba(37,211,102,0.5);transition:transform .2s}
    .wa-float:hover{transform:scale(1.1)}
  </style>
</head>
<body>
<div class="noise"></div>
<div class="orb"></div>

<nav>
  <div class="nav-inner">
    <a href="https://nodeflow.es" class="logo">Node<em>Flow</em></a>
    <div style="display:flex;gap:12px;align-items:center">
      <a href="/blog" style="font-size:14px;color:var(--dim)">Blog</a>
      <a href="https://nodeflow.es/#contacto" class="btn btn-primary">Empezar gratis →</a>
    </div>
  </div>
</nav>

<div class="hero">
  <div class="container">
    <h1>Guías de uso <span style="background:linear-gradient(90deg,#a29bfe,#00cec9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">NodeFlow</span></h1>
    <p>Todo lo que necesitas saber para sacar el máximo partido a tu asistente de voz. Adapta cada guía a tu sector.</p>
    <span class="info-note">📎 Incluidas en tu plan · Versión imprimible disponible</span>
  </div>
</div>

<div class="container">
  <div class="guides-grid">

    <div class="guide-card">
      <span class="guide-icon">🏥</span>
      <h3>Salud y Fisioterapia</h3>
      <p>Configura citas, recordatorios de pacientes, seguimiento de tratamientos y gestión de seguros médicos. Automazioni incluidas: recordatorio 24h, rebooking 30 días, no-show recovery.</p>
      <div class="guide-badges">
        <span class="badge badge-negocio">Plan Negocio</span>
        <span class="badge badge-pro">Plan Pro</span>
      </div>
      <div class="guide-actions">
        <a href="/guias/salud-fisioterapia/" class="btn-guide">📖 Ver guía →</a>
        <a href="/guias/salud-fisioterapia/" onclick="setTimeout(()=>window.print(),500)" class="btn-print">🖨️ Imprimir</a>
      </div>
    </div>

    <div class="guide-card">
      <span class="guide-icon">💆</span>
      <h3>Belleza y Estética</h3>
      <p>Reservas de tratamientos, recordatorios de cita, rebooking automático y gestión de bonos. Incluye automaciones específicas para peluquerías, centros de estética y nail art.</p>
      <div class="guide-badges">
        <span class="badge badge-negocio">Plan Negocio</span>
        <span class="badge badge-pro">Plan Pro</span>
      </div>
      <div class="guide-actions">
        <a href="/guias/belleza-estetica/" class="btn-guide">📖 Ver guía →</a>
        <a href="/guias/belleza-estetica/" onclick="setTimeout(()=>window.print(),500)" class="btn-print">🖨️ Imprimir</a>
      </div>
    </div>

    <div class="guide-card">
      <span class="guide-icon">🍽️</span>
      <h3>Restaurantes y Hostelería</h3>
      <p>Reservas, menú del día, recordatorios y gestión de no-shows para restaurantes y hostelería. Soporte multiidioma para turismo. Automaciones en castellano, euskera e inglés.</p>
      <div class="guide-badges">
        <span class="badge badge-negocio">Plan Negocio</span>
        <span class="badge badge-pro">Plan Pro</span>
      </div>
      <div class="guide-actions">
        <a href="/guias/restaurantes-hosteleria/" class="btn-guide">📖 Ver guía →</a>
        <a href="/guias/restaurantes-hosteleria/" onclick="setTimeout(()=>window.print(),500)" class="btn-print">🖨️ Imprimir</a>
      </div>
    </div>

    <div class="guide-card">
      <span class="guide-icon">⚖️</span>
      <h3>Servicios Profesionales</h3>
      <p>Citas, plazos legales, rebooking a 90 días y gestión de fechas críticas para despachos de abogados, asesorías, notarías y consultoras. Tono profesional garantizado.</p>
      <div class="guide-badges">
        <span class="badge badge-negocio">Plan Negocio</span>
        <span class="badge badge-pro">Plan Pro</span>
      </div>
      <div class="guide-actions">
        <a href="/guias/servicios-profesionales/" class="btn-guide">📖 Ver guía →</a>
        <a href="/guias/servicios-profesionales/" onclick="setTimeout(()=>window.print(),500)" class="btn-print">🖨️ Imprimir</a>
      </div>
    </div>

    <div class="guide-card">
      <span class="guide-icon">🔧</span>
      <h3>Talleres y Veterinarias</h3>
      <p>Recordatorios de mantenimiento, ITV, vacunas de mascotas y citas periódicas. Para talleres mecánicos y clínicas veterinarias que quieren clientes que vuelven solos.</p>
      <div class="guide-badges">
        <span class="badge badge-negocio">Plan Negocio</span>
        <span class="badge badge-pro">Plan Pro</span>
      </div>
      <div class="guide-actions">
        <a href="/guias/talleres-veterinarias/" class="btn-guide">📖 Ver guía →</a>
        <a href="/guias/talleres-veterinarias/" onclick="setTimeout(()=>window.print(),500)" class="btn-print">🖨️ Imprimir</a>
      </div>
    </div>

  </div>

  <div class="cta-bottom">
    <h2>¿No encuentras tu sector?</h2>
    <p>Todas las guías están incluidas en tu plan y se actualizan continuamente. Si necesitas una guía específica para tu sector, escríbenos.</p>
    <a href="mailto:hola@nodeflow.es" class="btn btn-primary" style="display:inline-flex">Solicitar guía personalizada →</a>
  </div>
</div>

<footer>
  <div class="container">
    <div class="footer-inner">
      <div style="font-weight:700;font-size:15px">⚡ Node<span style="color:var(--accent-l)">Flow</span></div>
      <div class="footer-links">
        <a href="https://nodeflow.es">Inicio</a>
        <a href="/blog">Blog</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
        <a href="https://nodeflow.es/terminos">Términos</a>
      </div>
      <div class="footer-copy">© 2026 NodeFlow · hola@nodeflow.es</div>
    </div>
  </div>
</footer>

<a href="https://wa.me/34666351319" class="wa-float" target="_blank" rel="noopener" title="WhatsApp NodeFlow">💬</a>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/guias/index.html
git commit -m "feat: add /guias/index.html — listing page for 5 sector usage guides"
```

---

## Task 6: Add related-blog sections to 29 sector pages

**Files:** Modify each of the 29 sector `index.html` files.

**Pattern:** In each sector page, find `<!-- CTA -->` and insert the following block immediately before it:

```html
<!-- RELATED BLOG -->
<section style="padding:48px 0;background:var(--bg);">
  <div class="container">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:20px;color:var(--white)">📚 Artículos relacionados</h2>
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      LINKS
    </div>
  </div>
</section>
```

Where `LINKS` = 2-3 `<a>` tags:
```html
<a href="/blog/SLUG" style="font-size:14px;padding:10px 18px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--accent-l);background:rgba(124,58,237,0.06);transition:all .2s;text-decoration:none">LINK_TEXT →</a>
```

**Mapping — sector → related blog links:**

| Sector file | Links to add |
|------------|-------------|
| `fisioterapia/index.html` | `/blog/automatizar-recordatorios-citas-reducir-no-shows` "Cómo reducir no-shows con IA", `/blog/asistente-ia-fisioterapia-donostia` "IA para fisio en Donostia", `/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia` "IA con seguros Adeslas/Sanitas" |
| `clinicas/index.html` | `/blog/asistente-voz-clinica-dental-pais-vasco` "IA dental en el País Vasco", `/blog/recepcionista-ia-clinica-dental-bilbao` "IA dental en Bilbao", `/blog/recepcionista-ia-clinicas-seguros-privados-espana` "IA con seguros privados" |
| `peluquerias/index.html` | `/blog/recepcionista-ia-peluqueria-bilbao` "IA para peluquerías en Bilbao", `/blog/recepcionista-ia-peluqueria-donostia` "IA peluquería Donostia", `/blog/asistente-ia-peluqueria-coloracion-citas-largas` "IA para citas de coloración" |
| `veterinarias/index.html` | `/blog/recepcionista-virtual-para-veterinarias-espana` "IA para veterinarias", `/blog/recepcionista-ia-veterinaria-bilbao` "IA veterinaria Bilbao", `/blog/recepcionista-ia-veterinaria-donostia` "IA veterinaria Donostia" |
| `talleres/index.html` | `/blog/recepcionista-ia-taller-mecanico-bilbao` "IA para talleres en Bilbao", `/blog/recepcionista-ia-taller-vitoria` "IA taller Vitoria", `/blog/asistente-ia-taller-mecanico-donostia` "IA taller Donostia" |
| `estetica/index.html` | `/blog/asistente-ia-centros-estetica-laser` "IA para estética avanzada", `/blog/asistente-ia-estetica-vitoria-gasteiz` "IA estética Vitoria", `/blog/asistente-ia-clinica-estetica-donostia` "IA estética Donostia" |
| `gimnasios/index.html` | `/blog/asistente-ia-para-gimnasios-centros-deportivos` "IA para gimnasios", `/blog/asistente-ia-gimnasio-bilbao` "IA gimnasio Bilbao", `/blog/asistente-ia-gimnasio-donostia` "IA gimnasio Donostia" |
| `restaurantes/index.html` | `/blog/automatizar-reservas-restaurante-donostia` "Reservas automáticas Donostia", `/blog/asistente-ia-restaurante-vitoria` "IA restaurante Vitoria", `/blog/recepcionista-ia-restaurante-bilbao` "IA restaurante Bilbao" |
| `hoteles/index.html` | `/blog/asistente-virtual-hoteles-rurales-espana` "IA para hoteles rurales", `/blog/ia-multiidioma-turismo-pais-vasco` "IA multiidioma turismo vasco" |
| `academias/index.html` | `/blog/asistente-ia-academia-vitoria` "IA academia Vitoria", `/blog/ia-para-academias-clases-particulares` "IA para academias", `/blog/recepcionista-ia-academias-idiomas-espana` "IA academias idiomas" |
| `farmacias/index.html` | `/blog/recepcionista-ia-farmacias-espana` "IA para farmacias", `/blog/recepcionista-ia-farmacia-bilbao` "IA farmacia Bilbao", `/blog/asistente-ia-farmacia-donostia` "IA farmacia Donostia" |
| `asesorias/index.html` | `/blog/recepcionista-ia-asesorias-gestoras-espana` "IA para asesorías", `/blog/ia-recepcion-virtual-sector-servicios-espana` "Recepción virtual sector servicios" |
| `inmobiliarias/index.html` | `/blog/ia-para-inmobiliarias-gestion-llamadas` "IA para inmobiliarias", `/blog/ia-recepcion-virtual-sector-servicios-espana` "Recepción virtual sector servicios" |
| `optica/index.html` | `/blog/asistente-ia-opticas-espana` "IA para ópticas en España", `/blog/recepcionista-ia-clinicas-seguros-privados-espana` "IA con seguros ópticos" |
| `psicologia/index.html` | `/blog/recepcionista-ia-psicologos-terapeutas-espana` "IA para psicólogos", `/blog/asistente-ia-coaches-terapeutas` "IA para coaches y terapeutas" |
| `nutricion/index.html` | `/blog/recepcionista-ia-nutricionistas-espana` "IA para nutricionistas", `/blog/automatizar-recordatorios-citas-reducir-no-shows` "Reducir no-shows con IA" |
| `podologia/index.html` | `/blog/recepcionista-ia-podologos-espana` "IA para podólogos", `/blog/automatizar-recordatorios-citas-reducir-no-shows` "Reducir no-shows con IA" |
| `autoescuela/index.html` | `/blog/recepcionista-ia-autoescuelas-espana` "IA para autoescuelas", `/blog/ia-atencion-telefonica-pymes-espana` "IA telefónica para pymes" |
| `estetica-avanzada/index.html` | `/blog/asistente-ia-centros-estetica-laser` "IA centros estética láser", `/blog/asistente-ia-estetica-vitoria-gasteiz` "IA estética en Vitoria", `/blog/asistente-ia-spa-balneario-espana` "IA para spas" |
| `yoga/index.html` | `/blog/asistente-ia-centros-yoga-pilates` "IA para yoga y pilates", `/blog/automatizar-recordatorios-citas-reducir-no-shows` "Automatizar recordatorios de clase" |
| `pilates/index.html` | `/blog/asistente-ia-centros-yoga-pilates` "IA para yoga y pilates", `/blog/automatizar-recordatorios-citas-reducir-no-shows` "Automatizar recordatorios de clase" |
| `guarderia-canina/index.html` | `/blog/asistente-ia-guarderias-caninas` "IA para guarderías caninas", `/blog/recepcionista-virtual-para-veterinarias-espana` "IA veterinaria y cuidado animal" |
| `abogados/index.html` | `/blog/recepcionista-ia-despachos-abogados` "IA para despachos de abogados", `/blog/ia-recepcion-virtual-sector-servicios-espana` "Recepción virtual sector servicios" |
| `notaria/index.html` | `/blog/recepcionista-ia-notarias-espana` "IA para notarías", `/blog/ia-recepcion-virtual-sector-servicios-espana` "Recepción virtual servicios profesionales" |
| `agencia-viajes/index.html` | `/blog/asistente-ia-agencias-viajes-espana` "IA para agencias de viajes", `/blog/ia-multiidioma-turismo-pais-vasco` "IA multiidioma turismo" |
| `reformas/index.html` | `/blog/asistente-ia-empresas-reformas-espana` "IA para empresas de reformas", `/blog/ia-atencion-telefonica-pymes-espana` "IA telefónica para pymes" |
| `coaching/index.html` | `/blog/asistente-ia-coaches-terapeutas` "IA para coaches y terapeutas", `/blog/recepcionista-ia-psicologos-terapeutas-espana` "IA para psicólogos" |

**Note:** Some sector pages (`estetica-avanzada`, `yoga`, `pilates`, `guarderia-canina`, `abogados`, `notaria`, `agencia-viajes`, `reformas`, `coaching`, `optica`, `psicologia`, `nutricion`, `podologia`, `autoescuela`) were created in the last sprint. Their structure may differ slightly — check if they have `<!-- CTA -->` or `<!-- cta -->` (case matters). If neither exists, insert before `<footer>`.

- [ ] **Step: Commit all sector page changes**

```bash
git add public/fisioterapia public/clinicas public/peluquerias public/veterinarias \
        public/talleres public/estetica public/gimnasios public/restaurantes \
        public/hoteles public/academias public/farmacias public/asesorias \
        public/inmobiliarias public/optica public/psicologia public/nutricion \
        public/podologia public/autoescuela public/estetica-avanzada public/yoga \
        public/pilates public/guarderia-canina public/abogados public/notaria \
        public/agencia-viajes public/reformas public/coaching
git commit -m "feat: add related-blog sections to all 27 sector pages — internal linking"
```

---

## Task 7: Update sitemap.xml to 124 URLs

**Files:** Modify `public/sitemap.xml`

- [ ] **Step 1: Add 15 new URLs**

Open `public/sitemap.xml`. Find the closing `</urlset>` tag and insert before it:

```xml
  <!-- Blog articles (13 new) -->
  <url><loc>https://nodeflow.es/blog/asistente-ia-clinica-dental-donostia</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/recepcionista-ia-clinica-dental-vitoria</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/recepcionista-ia-farmacia-bilbao</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/asistente-ia-farmacia-donostia</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/asistente-ia-taller-mecanico-donostia</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/asistente-ia-centro-medico-privado</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/recepcionista-ia-clinicas-seguros-privados-espana</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/integracion-ia-software-gestion-clinica</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/recepcionista-ia-consultas-medicas-generales</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/asistente-ia-spa-balneario-espana</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/ia-recepcion-virtual-sector-servicios-espana</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/recepcionista-ia-academias-idiomas-espana</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://nodeflow.es/blog/asistente-ia-peluqueria-coloracion-citas-largas</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <!-- Index pages (2 new) -->
  <url><loc>https://nodeflow.es/blog</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>https://nodeflow.es/guias</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
```

- [ ] **Step 2: Verify count**

```bash
grep -c "<loc>" public/sitemap.xml
```

Expected: 124 (109 existing + 15 new).

- [ ] **Step 3: Commit**

```bash
git add public/sitemap.xml
git commit -m "chore: update sitemap to 124 URLs — 13 new articles + /blog + /guias index pages"
```

---

## Task 8: Final push

- [ ] **Step 1: Verify working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

- [ ] **Step 2: Push to remote**

```bash
git push origin master
```

Expected: `master -> master` with all commits pushed.

- [ ] **Step 3: Verify sitemap count**

```bash
grep -c "<loc>" public/sitemap.xml
```

Expected: 124.

- [ ] **Step 4: Verify no broken footer links**

```bash
grep "href=\"/privacy\|href=\"/terms\"" public/index.html
```

Expected: no output (all fixed).

---

## Self-Review Checklist

- [x] Spec §1 (footer links) → Task 1 Step 1
- [x] Spec §1 (FAQ schema) → Task 1 Step 2
- [x] Spec §1 (sectors grid) → Task 1 Step 3
- [x] Spec §1 (nav links) → Task 1 Step 4
- [x] Spec §1 (footer columns) → Task 1 Step 5
- [x] Spec §2 (topics.json sync) → Task 2
- [x] Spec §3 (13 blog articles) → Task 3
- [x] Spec §4 (/blog/index.html update) → Task 4
- [x] Spec §5 (/guias/index.html) → Task 5
- [x] Spec §6.1 (sector→blog) → Task 6
- [x] Spec §6.3 (cities in footer) → Task 1 Step 5
- [x] Spec §7 (sitemap 124) → Task 7
- [x] Pricing never changes: Starter gratis / Negocio 49€ / Pro 99€ — not touched anywhere
