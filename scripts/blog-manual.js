#!/usr/bin/env node
// ============================================================
// NodeFlow — Publicador manual de posts
// Publica posts escritos a mano (sin GPT) usando la misma
// plantilla del motor (scripts/blog-lib.js).
//
// Uso:
//   node scripts/blog-manual.js scripts/posts/<archivo>.js [...más archivos]
//
// Cada archivo exporta un array de { topic, post }:
//   topic: { slug, title, keywords[], sector?, city? }
//   post:  { metaTitle, metaDescription, h1, intro, sections[{h2,content}], faqs[{question,answer}], readingMinutes }
// Los posts se publican en orden INVERSO al del array, de modo
// que el primer elemento del array queda arriba del índice del blog.
// ============================================================

const path = require('path');
const lib  = require('./blog-lib');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Uso: node scripts/blog-manual.js <archivo-de-posts.js> [...]');
  process.exit(1);
}

let batch = [];
for (const f of files) {
  const abs = path.resolve(f);
  const arr = require(abs);
  if (!Array.isArray(arr)) { console.error(`${f} no exporta un array`); process.exit(1); }
  batch = batch.concat(arr);
}

// Validación mínima antes de tocar nada
for (const { topic, post } of batch) {
  const missing = [];
  if (!topic || !topic.slug || !topic.keywords) missing.push('topic.slug/keywords');
  if (!post || !post.metaTitle || !post.h1 || !post.intro) missing.push('post.metaTitle/h1/intro');
  if (!post || !Array.isArray(post.sections) || !post.sections.length) missing.push('post.sections');
  if (missing.length) {
    console.error(`❌ Post inválido (${topic && topic.slug}): falta ${missing.join(', ')}`);
    process.exit(1);
  }
}

console.log(`\n🚀 Publicando ${batch.length} posts manuales...\n`);
for (const { topic, post } of [...batch].reverse()) {
  console.log(`📝 [${topic.slug}]`);
  lib.publishPost(topic, post);
}
console.log(`\n🎉 ${batch.length} posts publicados.\n`);
