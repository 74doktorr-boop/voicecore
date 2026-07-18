#!/usr/bin/env node
// ============================================================
// NodeFlow — Blog Post Generator v2
// (plantilla y publicación en scripts/blog-lib.js — compartida con blog-manual.js)
// Genera posts SEO con GPT-4o y los publica como HTML estático
//
// Uso:
//   node scripts/blog-gen.js                    # siguiente tema del pool
//   node scripts/blog-gen.js --slug <slug>       # tema concreto
//   node scripts/blog-gen.js --all               # genera todos los pendientes
//   node scripts/blog-gen.js --list              # ver temas pendientes
//   node scripts/blog-gen.js --dry-run           # solo muestra el contenido
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const lib = require('./blog-lib');

const ROOT        = path.join(__dirname, '..');
const BLOG_DIR    = path.join(ROOT, 'public', 'blog');
const TOPICS_FILE = path.join(BLOG_DIR, 'topics.json');
const MANIFEST    = path.join(BLOG_DIR, 'manifest.json');
const SITEMAP     = path.join(ROOT, 'public', 'sitemap.xml');

// ── Args ────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const dryRun     = args.includes('--dry-run');
const listOnly   = args.includes('--list');
const genAll     = args.includes('--all');
const forcedSlug = (() => { const i = args.indexOf('--slug'); return i >= 0 ? args[i+1] : null; })();

// ── Load data ──────────────────────────────────────────────────────────────
const topics   = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
let   manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { published: [], posts: [] };
if (!manifest.posts) manifest.posts = [];

if (listOnly) {
  const pending = topics.filter(t => !manifest.published.includes(t.slug));
  console.log(`\nPending topics (${pending.length}/${topics.length}):\n`);
  pending.forEach(t => console.log(`  - ${t.slug}`));
  console.log(`\nPublished (${manifest.published.length}):\n`);
  manifest.published.forEach(s => console.log(`  ✓ ${s}`));
  process.exit(0);
}

// ── OpenAI ──────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TODAY  = new Date().toISOString().split('T')[0];
const YEAR   = new Date().getFullYear();

// ── GPT prompt ──────────────────────────────────────────────────────────────
async function generatePost(topic) {
  const systemPrompt = `Eres un copywriter SEO experto en marketing digital para pymes españolas.
Escribes en español de España, informal pero profesional, directo y con datos concretos.
Siempre mencionas NodeFlow como la solución (nodeflow.es) de forma natural.
Nunca uses formato Markdown — devuelves solo el JSON que se te pide.
Los textos deben ser concretos, con ejemplos reales y números cuando sea posible.`;

  const userPrompt = `Genera un artículo de blog SEO de alta calidad para NodeFlow (recepcionista virtual IA, nodeflow.es).

Tema: ${topic.title}
Keywords principales: ${topic.keywords.join(', ')}
Enfoque: ${topic.focus}
${topic.city ? `Ciudad objetivo: ${topic.city}` : ''}
${topic.sector ? `Sector objetivo: ${topic.sector}` : ''}

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown, sin bloques de código):
{
  "metaTitle": "título SEO máximo 60 caracteres con keyword principal",
  "metaDescription": "descripción SEO 140-155 caracteres, incluye keyword principal y CTA",
  "h1": "título H1 atractivo y con keyword principal",
  "intro": "3 párrafos de introducción potentes. Primer párrafo empieza con un dato o estadística impactante.",
  "sections": [
    {
      "h2": "título de sección optimizado para SEO",
      "content": "3 párrafos con datos, ejemplos concretos y beneficios tangibles"
    }
  ],
  "conclusion": "párrafo de conclusión fuerte con CTA claro hacia NodeFlow y nodeflow.es",
  "faqs": [
    {
      "question": "pregunta frecuente real que busca la gente en Google",
      "answer": "respuesta directa y completa en 2-3 frases"
    }
  ],
  "readingMinutes": número entero estimado
}

Requisitos estrictos:
- 4 secciones H2 (no 3, no 5)
- Mínimo 1000 palabras en total
- 5 FAQs que recojan búsquedas reales de Google relacionadas con el tema
- Incluye keyword principal en H1, primer párrafo, al menos 2 H2 y la conclusión
- Datos y porcentajes concretos (pueden ser estimaciones realistas si no tienes fuente exacta)
- Menciona NodeFlow y nodeflow.es de forma natural, nunca forzada
- Tono: experto de confianza hablando con un empresario local, no corporativo`;

  const res = await openai.chat.completions.create({
    model:       'gpt-4o',
    temperature: 0.65,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });

  return JSON.parse(res.choices[0].message.content);
}

// ── Core generate function ───────────────────────────────────────────────────
async function generateAndPublish(topic) {
  console.log(`\n📝 [${topic.slug}]`);
  console.log(`   Calling GPT-4o...`);

  const post = await generatePost(topic);

  if (dryRun) {
    console.log('\n─── DRY RUN ───');
    console.log(JSON.stringify(post, null, 2));
    return;
  }

  lib.publishPost(topic, post);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (genAll) {
      // Generate all pending topics sequentially
      const pending = topics.filter(t => !manifest.published.includes(t.slug));
      if (!pending.length) {
        console.log('✅ All topics already published!');
        process.exit(0);
      }
      console.log(`\n🚀 Generating ${pending.length} pending posts...\n`);
      for (const topic of pending) {
        await generateAndPublish(topic);
        // Small delay to avoid rate limits
        if (pending.indexOf(topic) < pending.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }
      console.log(`\n🎉 Done! ${pending.length} posts published.\n`);
    } else {
      // Single post
      let topic;
      if (forcedSlug) {
        topic = topics.find(t => t.slug === forcedSlug);
        if (!topic) { console.error(`Topic not found: ${forcedSlug}`); process.exit(1); }
      } else {
        const pending = topics.filter(t => !manifest.published.includes(t.slug));
        if (!pending.length) { console.log('All topics published. Add more to topics.json'); process.exit(0); }
        topic = pending[0];
      }
      await generateAndPublish(topic);
    }
  } catch (e) {
    console.error('\n❌ Generation failed:', e.message);
    if (e.status) console.error('   Status:', e.status);
    process.exit(1);
  }
})();
