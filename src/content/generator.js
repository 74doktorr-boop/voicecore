'use strict';
// ============================================================
// NodeFlow — Contenido & SEO: generador multi-tenant de artículos
// Deriva temas del propio negocio (sector/ciudad/servicios) y genera artículos
// SEO con GPT-4o, PROMOCIONANDO AL CLIENTE (no a NodeFlow) con CTA a pedir cita.
// Reutiliza la estructura del motor de blog (scripts/blog-gen) adaptada a
// multi-tenant. deps.openai inyectable para test (sin gastar en GPT).
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('CONTENT');

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

// Ideas de tema a partir del negocio. PURO (testable, reglas fuera del LLM).
// Prioriza long-tail local ("<servicio> en <ciudad>") que es lo que rankea y
// convierte para un negocio local.
function topicsForOrg(org) {
  const cfg = (org && org.automation_config && org.automation_config.config) || {};
  const name = (org && org.name) || 'el negocio';
  const city = cfg.city || (org && org.city) || '';
  const sector = (org && org.assistant_config && org.assistant_config.sector) || cfg.sector || 'servicios';
  const services = Array.isArray(cfg.serviceList) ? cfg.serviceList.map(s => (s && s.name) || s).filter(Boolean).slice(0, 8) : [];
  const inCity = city ? ` en ${city}` : '';
  const out = [];
  const push = (title, focus, kws) => out.push({ slug: slugify(title), title, focus, keywords: kws, sector, city: city || null });

  for (const svc of services) {
    push(`${svc}${inCity}: precios, cómo es y cuándo pedir cita`,
      `Guía práctica sobre ${svc}${inCity}: en qué consiste, rango de precios orientativo, cada cuánto conviene y cómo pedir cita en ${name}.`,
      [`${svc}${inCity}`.trim(), `precio ${svc}`.trim(), `${svc} cerca de mí`]);
  }
  push(`Cómo elegir ${sector}${inCity}: guía 2026`,
    `Qué mirar al elegir ${sector}${inCity} (experiencia, cercanía, opiniones, facilidad para pedir cita) y por qué ${name} es una buena opción.`,
    [`mejor ${sector}${inCity}`.trim(), `${sector}${inCity}`.trim(), `elegir ${sector}`]);
  push(`${sector}${inCity}: horarios, urgencias y cómo reservar`,
    `Info útil de ${sector}${inCity}: horarios, cómo actuar ante una urgencia y lo fácil que es reservar en ${name} a cualquier hora.`,
    [`${sector}${inCity} horario`.trim(), `urgencias ${sector}`.trim(), `pedir cita ${sector}`]);
  return out;
}

// Prompt del CLIENTE (no de NodeFlow). El artículo posiciona al negocio y
// empuja a pedir cita, sin nombrar a NodeFlow.
function _prompts(org, topic) {
  const name = (org && org.name) || 'el negocio';
  const city = topic.city || '';
  const system = `Eres un copywriter SEO experto en negocios locales españoles. Escribes en español de España, cercano y profesional, con datos concretos y ejemplos. Nunca uses Markdown: devuelves solo el JSON pedido. El artículo es para la web de "${name}"${city ? ` (${city})` : ''}: informa de verdad y posiciona a ${name} como la opción de confianza, invitando a pedir cita de forma natural. NO menciones ninguna marca de software ni "NodeFlow".`;
  const user = `Genera un artículo de blog SEO de alta calidad para la web de ${name}${city ? ` en ${city}` : ''}.

Tema: ${topic.title}
Keywords principales: ${(topic.keywords || []).join(', ')}
Enfoque: ${topic.focus}
${topic.sector ? `Sector: ${topic.sector}` : ''}

Devuelve ÚNICAMENTE un JSON válido con esta estructura exacta (sin markdown):
{
  "metaTitle": "título SEO máx 60 caracteres con keyword principal",
  "metaDescription": "descripción SEO 140-155 caracteres con keyword y llamada a pedir cita",
  "h1": "título H1 con keyword principal",
  "intro": "3 párrafos de intro; el primero abre con un dato o pregunta que engancha",
  "sections": [{ "h2": "título de sección con SEO", "content": "3 párrafos con datos y ejemplos" }],
  "conclusion": "conclusión que invita a pedir cita en ${name} (sin nombrar software)",
  "faqs": [{ "question": "pregunta real de Google", "answer": "respuesta directa en 2-3 frases" }],
  "readingMinutes": entero
}
Requisitos: 4 secciones H2, mínimo 900 palabras, 5 FAQs de búsquedas reales, keyword principal en H1, primer párrafo, 2 H2 y conclusión.`;
  return { system, user };
}

/**
 * Genera un artículo para el micrositio de un negocio. GPT inyectable (test).
 * @returns {Promise<{ok, article?, reason?}>}  article: { slug, ...campos }
 */
async function generateArticle({ org, topic }, deps = {}) {
  if (!org || !topic || !topic.title) return { ok: false, reason: 'bad_request' };
  const openai = deps.openai || _defaultOpenai();
  if (!openai) return { ok: false, reason: 'no_openai' };
  const { system, user } = _prompts(org, topic);
  try {
    const res = await openai.chat.completions.create({
      model: deps.model || 'gpt-4o',
      temperature: 0.7,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    });
    const post = JSON.parse(res.choices[0].message.content);
    if (!post || !post.h1 || !Array.isArray(post.sections) || !post.sections.length) return { ok: false, reason: 'bad_output' };
    const article = {
      slug: topic.slug || slugify(post.metaTitle || post.h1),
      meta_title: post.metaTitle || post.h1,
      meta_description: post.metaDescription || '',
      h1: post.h1,
      intro: post.intro || '',
      sections: post.sections.slice(0, 8).map(s => ({ h2: String(s.h2 || ''), content: String(s.content || '') })),
      conclusion: post.conclusion || '',
      faqs: Array.isArray(post.faqs) ? post.faqs.slice(0, 8).map(f => ({ question: String(f.question || ''), answer: String(f.answer || '') })) : [],
      keywords: topic.keywords || [],
      reading_minutes: Number(post.readingMinutes) || null,
    };
    return { ok: true, article };
  } catch (e) {
    log.warn(`generateArticle ${org.id}: ${e.message}`);
    return { ok: false, reason: 'error' };
  }
}

let _openaiSingleton = null;
function _defaultOpenai() {
  if (_openaiSingleton) return _openaiSingleton;
  if (!process.env.OPENAI_API_KEY) return null;
  try { const { OpenAI } = require('openai'); _openaiSingleton = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); } catch (_) { return null; }
  return _openaiSingleton;
}

module.exports = { topicsForOrg, generateArticle, slugify };
