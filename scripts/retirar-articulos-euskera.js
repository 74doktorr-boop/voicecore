#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   RETIRAR LOS ARTÍCULOS CUYA PREMISA ES EL EUSKERA
   ───────────────────────────────────────────────────────────────────────────
   El barrido de julio quitó las menciones sueltas de euskera de 107 páginas,
   pero dejó intactos cuatro artículos del blog: en esos no cabía recortar una
   frase, porque el euskera ES el tema. «Recepcionista virtual que habla
   euskera nativo: ¿es posible en 2026?» no se arregla tachando una palabra.

   El producto no habla euskera. Los cuatro están indexados en Google y
   enlazados desde la web. Cada uno es una promesa falsa que sigue captando
   visitas y que un cliente puede usar como argumento de compra.

   POR QUÉ 410 Y NO 404 NI 301
   Un 404 dice «no lo encuentro» y Google reintenta durante meses. Un **410
   Gone** dice «existía y lo hemos retirado a propósito»: se desindexa mucho
   antes. Y un 301 a otro artículo sería peor que no hacer nada — redirigir
   «recepcionista en euskera» a una página que va de otra cosa es justo lo que
   Google trata como soft-404, y encima el visitante llega a algo que no ha
   pedido. Se sirve un 410 CON PÁGINA: código honesto y, aun así, salidas
   útiles para quien venga de una búsqueda.

   QUÉ TOCA (una retirada de verdad, no borrar la carpeta):
     1. Los ficheros.
     2. manifest.json — `posts` (de ahí sale el índice) y `published`.
     3. topics.json — si no, el generador los vuelve a escribir el martes.
     4. El índice del blog: se REGENERA desde el manifiesto, no se parchea.
     5. sitemap.xml.
     6. Los enlaces entrantes desde otras páginas. Retirar un artículo y dejar
        quien lo enlaza es cambiar un problema por otro.

   Uso:  node scripts/retirar-articulos-euskera.js [--dry]
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { buildBlogIndex, MANIFEST, SITEMAP, BLOG_DIR } = require('./blog-lib');

const PUBLIC = path.join(__dirname, '..', 'public');
const dry = process.argv.includes('--dry');

const RETIRADOS = [
  'recepcionista-virtual-euskera-nativo',
  'recepcionista-ia-multiidioma-euskera-galego',
  'ia-multiidioma-turismo-pais-vasco',
  'negocio-que-atiende-euskera-galego-ia',
];

// Enlaces entrantes desde páginas que se quedan. Se repuntan a un artículo
// VIVO y del mismo tema, no a la portada: quien pulsa «artículos relacionados»
// quiere leer algo parecido, no aterrizar en un formulario.
const REENLACES = [
  ['hoteles/index.html',
   '<a href="/blog/ia-multiidioma-turismo-pais-vasco"', '<a href="/blog/asistente-virtual-hoteles-rurales-espana"',
   'IA multiidioma turismo vasco →', 'Asistente virtual para hoteles →'],
  ['agencia-viajes/index.html',
   '<a href="/blog/ia-multiidioma-turismo-pais-vasco"', '<a href="/blog/asistente-virtual-hoteles-rurales-espana"',
   'IA multiidioma turismo →', 'Asistente virtual para alojamientos →'],
];

const log = (s) => console.log(s);
let fallos = [];

// ── 1. Los ficheros ────────────────────────────────────────────────────────
for (const slug of RETIRADOS) {
  const dir = path.join(BLOG_DIR, slug);
  if (!fs.existsSync(dir)) { log(`  ·  ${slug} — ya no estaba`); continue; }
  if (!dry) fs.rmSync(dir, { recursive: true, force: true });
  log(`  ${dry ? '~' : '✓'}  borrado public/blog/${slug}/`);
}

// ── 2. El manifiesto: posts (índice) y published (cola del generador) ──────
const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const antesPosts = man.posts.length, antesPub = man.published.length;
man.posts = man.posts.filter(p => !RETIRADOS.includes(p.slug));
man.published = man.published.filter(s => !RETIRADOS.includes(s));
log(`  ${dry ? '~' : '✓'}  manifiesto: posts ${antesPosts}→${man.posts.length}, published ${antesPub}→${man.published.length}`);
if (!dry) fs.writeFileSync(MANIFEST, JSON.stringify(man, null, 2) + '\n');

// ── 3. La cola de temas ────────────────────────────────────────────────────
// Sin esto, quitarlos de `published` los devuelve a «pendientes» y el
// generador los reescribe en la siguiente tirada. Sería el peor de los casos:
// borrarlos y que vuelvan solos el martes.
const TOPICS = path.join(BLOG_DIR, 'topics.json');
const temas = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));
const antesT = temas.length;
const quedan = temas.filter(t => !RETIRADOS.includes(t.slug));
log(`  ${dry ? '~' : '✓'}  topics.json: ${antesT}→${quedan.length} temas`);
if (!dry) fs.writeFileSync(TOPICS, JSON.stringify(quedan, null, 2) + '\n');

// ── 4. El índice del blog, regenerado ─────────────────────────────────────
if (!dry) { buildBlogIndex(); log('  ✓  índice del blog regenerado desde el manifiesto'); }

// ── 5. El sitemap ──────────────────────────────────────────────────────────
let sm = fs.readFileSync(SITEMAP, 'utf8');
let quitadas = 0;
for (const slug of RETIRADOS) {
  const re = new RegExp(`\\s*<url>(?:(?!</url>)[\\s\\S])*?/blog/${slug}<[\\s\\S]*?</url>`, 'g');
  const n = (sm.match(re) || []).length;
  if (n) { sm = sm.replace(re, ''); quitadas += n; }
}
log(`  ${dry ? '~' : '✓'}  sitemap: ${quitadas} URLs fuera`);
if (!dry) fs.writeFileSync(SITEMAP, sm);

// ── 6. Los enlaces entrantes ───────────────────────────────────────────────
for (const [rel, deHref, aHref, deTexto, aTexto] of REENLACES) {
  const f = path.join(PUBLIC, rel);
  if (!fs.existsSync(f)) { fallos.push(`${rel}: no existe`); continue; }
  let h = fs.readFileSync(f, 'utf8');
  if (!h.includes(deHref)) { fallos.push(`${rel}: el enlace de partida ya no está`); continue; }
  h = h.replace(deHref, aHref).replace(deTexto, aTexto);
  if (!dry) fs.writeFileSync(f, h);
  log(`  ${dry ? '~' : '✓'}  ${rel}: enlace repuntado`);
}

// ── Comprobación final: no puede quedar NINGÚN enlace a los retirados ──────
// Es la parte que se olvida. Un artículo retirado con doce páginas apuntándole
// no es una retirada: es doce errores nuevos.
// En ENSAYO no se ha escrito nada, así que este recuento vería los enlaces de
// siempre y daría una alarma falsa. Se declara en vez de fingir que pasa.
const sueltos = [];
if (dry) {
  log(`\nENSAYO — no se ha escrito nada, así que la comprobación de enlaces`);
  log(`huérfanos no aplica: los vería todos. Se ejecuta al aplicar de verdad.`);
} else
(function rec(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { rec(p); continue; }
    if (!e.name.endsWith('.html') && !e.name.endsWith('.xml')) continue;
    const s = fs.readFileSync(p, 'utf8');
    for (const slug of RETIRADOS) {
      if (s.includes('/blog/' + slug)) sueltos.push(`${path.relative(PUBLIC, p)} → ${slug}`);
    }
  }
})(PUBLIC);

log(`\nArtículos retirados: ${RETIRADOS.length}`);
if (fallos.length) { log('\nSin aplicar:'); fallos.forEach(f => log('   · ' + f)); }
if (dry) { /* ya avisado arriba */ }
else if (sueltos.length) {
  log(`\n⚠ QUEDAN ${sueltos.length} enlaces apuntando a artículos retirados:`);
  sueltos.slice(0, 10).forEach(s => log('   · ' + s));
  process.exitCode = 1;
} else {
  log('Sin enlaces huérfanos.');
}
