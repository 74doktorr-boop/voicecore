# NodeFlow SEO Sprint — Design Spec

**Date:** 2026-05-29  
**Scope:** Bug fixes + content + navigation + internal linking

---

## Goal

Fix 4 real bugs, generate 13 pending blog articles, create /blog/ and /guias/ index pages, improve internal linking across all 29 sector pages and 79 blog articles, and update the landing page navigation.

## Architecture

All changes are static HTML + minimal CSS/JS — no backend changes. The SEO sprint touches:
- `public/index.html` (bugs + sectors grid + footer + nav)
- `public/blog/topics.json` (sync `generated: true` for 66 existing articles)
- 13 new `public/blog/<slug>/index.html` files
- New `public/blog/index.html`
- New `public/guias/index.html`
- 29 sector `index.html` files (add related-articles section)
- Sitemap update (+13 articles + 2 index pages = +15 URLs)

---

## 1. Bug Fixes (`public/index.html`)

### 1.1 Footer links (broken 404s)
Lines ~1469–1472:
- `/privacy` → `/privacidad`
- First `/terms` (Términos de uso) → `/terminos`  
- Second `/terms` (Aviso legal) → `/aviso-legal`

### 1.2 FAQ Schema JSON-LD (incomplete)
Currently 4 questions in the JSON-LD `<head>`. Add the 4 missing:
- "¿Qué es la memoria persistente?"
- "¿Cómo funciona la base de conocimiento?"
- "¿Qué pasa si el cliente quiere hablar con un humano?"
- "¿Puedo cancelar en cualquier momento?"

Answers copied verbatim from the existing accordion `<div class="faq-a-inner">` elements.

### 1.3 Sectors grid (7 → 29 sectors)
Replace the current 7-card grid at `id="sectores"` with a comprehensive grid showing all 29 sectors. Group by archetype with visual separators:

**Salud & Bienestar:** fisioterapia, clinicas, veterinarias, psicologia, nutricion, podologia, optica  
**Belleza & Cuidado:** peluquerias, estetica, estetica-avanzada, yoga, pilates  
**Hostelería & Ocio:** restaurantes, hoteles, gimnasios  
**Profesionales:** abogados, asesorias, notaria, coaching  
**Hogar & Movilidad:** talleres, reformas, autoescuela, agencia-viajes  
**Comercio & Servicios:** farmacias, academias, inmobiliarias, guarderia-canina  

Each card: icon + sector name + one-line description + "Desde 49€/mes →" + href to sector page.

### 1.4 Nav & Footer additions
**Nav:** Add "Blog" link and "Guías" link to `.nav-links` and to `.mobile-nav`.  
**Footer:** Add "Recursos" column with links to Blog and Guías. Add "Ciudades" column with Bilbao, Donostia, Vitoria, Andoain.

---

## 2. topics.json Sync

Script (inline sed/Python) to set `"generated": true` on the 66 slugs that already have `public/blog/<slug>/index.html` files. The 13 still without HTML remain `false`.

---

## 3. 13 New Blog Articles

**Slugs to generate:**
1. `asistente-ia-clinica-dental-donostia`
2. `recepcionista-ia-clinica-dental-vitoria`
3. `recepcionista-ia-farmacia-bilbao`
4. `asistente-ia-farmacia-donostia`
5. `asistente-ia-taller-mecanico-donostia`
6. `asistente-ia-centro-medico-privado`
7. `recepcionista-ia-clinicas-seguros-privados-espana`
8. `integracion-ia-software-gestion-clinica`
9. `recepcionista-ia-consultas-medicas-generales`
10. `asistente-ia-spa-balneario-espana`
11. `ia-recepcion-virtual-sector-servicios-espana`
12. `recepcionista-ia-academias-idiomas-espana`
13. `asistente-ia-peluqueria-coloracion-citas-largas`

**Template** (same as all 66 existing articles):
- Dark theme (`--bg:#070712`, `--accent:#7c3aed`)
- GA4 `G-ZPKHPG2BLC` + Plausible
- Schema: SoftwareApplication + FAQPage JSON-LD
- Structure: nav + breadcrumb + hero + ToC + 5× h2 sections + mid-CTA + FAQ accordion + related-links + footer
- Breadcrumb: Inicio → Blog → [título]
- Related links: 3 articles from same category + link to sector page
- Each article: unique meta title/description, unique h1, unique content per slug

---

## 4. `/blog/index.html` — Blog index page

**Design:** Dark theme consistent with landing. No server-side rendering — static HTML with all 79 articles hardcoded.

**Structure:**
- Hero: "Blog NodeFlow — Recursos sobre IA para negocios" + subtitle
- Filter chips (JS): Todos / Salud / Hostelería / Belleza / Talleres / Ciudades / General
- Article grid (3 cols desktop, 2 tablet, 1 mobile): card with colored category badge, title, excerpt (1 sentence), date, "Leer más →"
- Articles ordered newest-first
- No pagination needed at 79 articles

**Canonical:** `https://nodeflow.es/blog`  
**Schema:** `ItemList` with `ListItem` for each article

---

## 5. `/guias/index.html` — Guías index page

**Design:** Dark theme, same CSS variables as the guides themselves.

**Structure:**
- Hero: "Guías de uso NodeFlow — Para tu sector"
- 5 cards (one per guide): sector icon + title + 2-line description + plan badge (Negocio/Pro) + "Ver guía →" + "🖨️ Imprimir" button
- Info box: "¿No encuentras tu sector? Todas las guías están incluidas en tu plan."

**Sectors:**
1. Salud y Fisioterapia → `/guias/salud-fisioterapia/`
2. Belleza y Estética → `/guias/belleza-estetica/`
3. Restaurantes y Hostelería → `/guias/restaurantes-hosteleria/`
4. Servicios Profesionales → `/guias/servicios-profesionales/`
5. Talleres y Veterinarias → `/guias/talleres-veterinarias/`

---

## 6. Internal Linking

### 6.1 Sector pages → Blog (29 sector pages)
Add a `<section class="related-blog">` block before the final CTA in each sector page. Show 2-3 hardcoded links to relevant blog articles. Example for `/fisioterapia/`:
```html
<section class="related-blog">
  <h2>Artículos relacionados</h2>
  <ul>
    <li><a href="/blog/automatizar-recordatorios-citas-reducir-no-shows/">Cómo automatizar recordatorios de cita...</a></li>
    <li><a href="/blog/asistente-ia-fisioterapia-donostia/">Asistente IA para fisioterapia en Donostia</a></li>
  </ul>
</section>
```

Mapping (sector → 2–3 relevant slugs) defined per sector based on existing article titles.

### 6.2 Blog articles → Sector page
The existing "Artículos relacionados" section at the end of each blog article already links to 3 other articles. Add one more link: "🔗 Ver solución para [sector]" pointing to the corresponding sector page. This requires touching all 79 articles — done via the blog-gen.js script or a targeted find/replace.

**Approach:** Find/replace on each article — locate the `<div class="related-links">` block and append the sector link before closing `</div>`.

---

## 7. Sitemap Update

Add 15 new URLs:
- 13 new blog articles
- `/blog` (index)
- `/guias` (index)

New total: **124 URLs**

---

## Constraints

- Pricing NEVER changes: Starter gratis / Negocio €49/mes / Pro €99/mes
- All HTML uses existing CSS variables and dark theme
- No new dependencies
- Each new article must have unique meta title + description + h1 (no duplicate content)
- Blog articles for dental/farmacia/medical use "salud" as sector in breadcrumb/schema
