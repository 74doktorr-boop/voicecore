#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   QUITAR EL EUSKERA DE LA WEB
   ───────────────────────────────────────────────────────────────────────────
   Por qué: la web afirmaba que el asistente habla euskera nativo —en insignias,
   en listas de características, en preguntas frecuentes y en el schema que lee
   Google— y el producto NO lo hace. No es un matiz de marketing: es una
   afirmación falsa repetida en 107 páginas, y algunas la ponían justo en la
   sección titulada "lo que podemos demostrar".

   Por qué NO es un buscar-y-reemplazar: no aparece como una palabra suelta.
   Aparece como bloques completos —una entrada de FAQ con su respuesta, un
   `<li>` de una lista de ventajas, una insignia con su punto verde, una
   pregunta entera dentro del JSON-LD—. Quitar sólo la palabra dejaría frases
   sin sentido, epígrafes huérfanos y un JSON roto, que además tumbaría el
   schema de TODA la página.

   Qué NO toca: las 4 entradas del blog que van SOBRE el euskera. Ahí no cabe
   borrar una frase: o se reescribe el artículo o se retira, y las cuatro están
   indexadas en el sitemap. Esa decisión no es de un script.

   Uso:
     node scripts/quitar-euskera.js --dry     (ensayo, no escribe)
     node scripts/quitar-euskera.js           (aplica)
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const EXCLUIR_DIR = new Set(['admin', 'hementxe']);
// Las que VAN de euskera: se dejan intactas a propósito (ver cabecera).
//
// OJO con guard/index.html, que es un caso distinto a todos los demás: ahí el
// euskera NO es una afirmación falsa. La app del vigilante de NodeFlow Guard
// está traducida entera, y hay tests en su repo que fallan si una sola frase se
// queda sin traducir. Lo que se retiró fue la promesa de que el asistente de
// VOZ habla euskera, que es otro producto y otra cosa. Un barrido que confunda
// las dos borraría un argumento de venta cierto delante de un cliente vasco.
const INTOCABLES = new Set([
  'guard/index.html',
  'blog/ia-multiidioma-turismo-pais-vasco/index.html',
  'blog/negocio-que-atiende-euskera-galego-ia/index.html',
  'blog/recepcionista-ia-multiidioma-euskera-galego/index.html',
  'blog/recepcionista-virtual-euskera-nativo/index.html',
]);

// ── Bloques completos que desaparecen ────────────────────────────────────
const BLOQUES = [
  // Insignia con su punto
  [/\s*<span><span class="dot"><\/span>\s*Habla euskera nativo<\/span>/g, ''],
  // Elemento de lista de ventajas
  [/\s*<li>[^<]*[Ee]uskera[^<]*<\/li>/g, ''],
  // Pregunta frecuente visible (bloque completo pregunta + respuesta)
  [/\s*<div class="faq-item">(?:(?!<\/div>\s*<div class="faq-item">)[\s\S])*?[Ee]uskera[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, ''],
  // Tarjeta de ventaja completa: icono + título + párrafo. Quitar sólo el <h3>
  // dejaba el párrafo huérfano bajo el título de la tarjeta siguiente.
  // OJO al espaciado: el mismo bloque existe en DOS formatos —compacto en unas
  // páginas y con saltos de línea e indentación en otras—. La primera versión
  // exigía que fuera todo seguido y por eso sólo cazó una parte.
  [/\s*<div class="benefit-card">\s*<div class="benefit-icon">[^<]*<\/div>\s*<div>\s*<h3>[^<]*[Ee]uskera[^<]*<\/h3>\s*<p>[\s\S]*?<\/p>\s*<\/div>\s*<\/div>/g, ''],
  // Insignia sin el verbo («Euskera nativo» a secas)
  [/\s*<span><span class="dot"><\/span>\s*Euskera nativo<\/span>/g, ''],
  // FAQ con microdatos (itemprop), que es otra plantilla distinta
  [/\s*<div itemscope[^>]*itemtype="[^"]*Question"[^>]*>(?:(?!<\/div>\s*<div itemscope)[\s\S])*?[Ee]uskera[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, ''],
];

// ── Frases donde sólo se recorta la mención ──────────────────────────────
const FRASES = [
  [/,?\s*gestiona citas y habla euskera nativo\./g, ' y gestiona citas.'],
  [/,\s*reservas automáticas y euskera nativo\./g, ' y reservas automáticas.'],
  [/\s*Habla euskera\.\s*/g, ' '],
  [/castellano,\s*euskera y galego/gi, 'castellano y galego'],
  [/euskera,\s*castellano,?\s*inglés y francés/gi, 'castellano, inglés y francés'],
  [/\s*·\s*[Ee]uskera nativo/g, ''],
  [/\s*y\s*euskera nativo/g, ''],
  [/\bes\s*·\s*eu\s*·\s*gl\b/g, 'es · gl'],
  [/\beu\s*·\s*gl\b/g, 'gl'],
  [/,\s*euskera\b/g, ''],
  [/\beuskera y\s*/g, ''],
  // Ficha de la guía sectorial: «Idiomas — Castellano · Euskera»
  [/Castellano\s*·\s*Euskera/g, 'Castellano'],
  // Frases de prosa que afirmaban el bilingüismo. Se reescribe la oración
  // entera: recortar la palabra dejaba textos sin sujeto («entiende a quien le
  // hable en; el cuerpo de la conversación…»).
  [/[^.<>]*entiende a quien le hable en euskera;[^.<>]*\./g, ''],
  [/[^.<>]*prefieren hablar en euskera\.\s*NodeFlow detecta el idioma y responde en el mismo\./g,
   'NodeFlow detecta el idioma del cliente y responde en el mismo.'],
  [/[^.<>]*En euskera, el asistente saluda y se despide[^.<>]*\./g, ''],
  [/\s*—?\s*y habla euskera nativo\.?/g, '.'],
  [/[Uu]n recepcionista virtual que habla euskera nativo/g, 'Un recepcionista virtual que no falla una llamada'],
  [/IA que habla euskera nativo\.\s*/g, ''],
  [/responda en euskera,\s*castellano,\s*inglés y francés/g, 'responda en castellano, inglés y francés'],
  [/atiende en euskera y galego con voces propias/g, 'atiende en galego con voces propias'],
  [/con soporte de euskera en el saludo y la despedida/g, 'con voces naturales'],
  [/\s*<span itemprop="name">¿Habla euskera\?<\/span>/g, ''],
  // Restos de prosa. Se reescribe la ORACIÓN, nunca la palabra suelta.
  [/[^.<>]*prefieren hablar en euskera\.\s*NodeFlow detecta el idioma[^.<>]*\./g,
   'NodeFlow entiende lo que le piden a la primera y responde con naturalidad.'],
  [/[Rr]ecepcionista [Vv]irtual en [Ee]uskera:\s*¿[^"<]*\?/g, 'Recepcionista virtual: qué hace y qué no'],
  [/\s*·?\s*euskera,\s*castellano,\s*inglés y francés/gi, ': castellano, inglés y francés'],
  [/turísticos del País Vasco:\s*castellano, inglés y francés/g, 'turísticos del País Vasco: castellano, inglés y francés'],
  [/\bque habla euskera nativo\b/g, 'que no deja una llamada sin atender'],
  [/\ben euskera y galego\b/g, 'en galego'],
  // NO hay regla comodín del tipo /euskera/ → 'castellano'. Convertiría
  // «castellano y euskera» en «castellano y castellano» y dejaría la web llena
  // de frases absurdas. Lo que no encaje en un patrón concreto se DECLARA al
  // final y se arregla a mano: es preferible una lista de pendientes a cien
  // páginas con el texto destrozado.
];

/**
 * Quita las preguntas sobre euskera del JSON-LD PARSEANDO el bloque, no con
 * expresiones regulares.
 *
 * El primer intento fue una expresión que se llevaba `, { …Question… }` entera.
 * Funcionó en 91 páginas y rompió el JSON de una, porque el schema de esa
 * escribía la respuesta en forma compacta y la expresión cortaba por donde no
 * debía. Un JSON-LD inválido no falla de forma visible: Google descarta el
 * schema de TODA la página en silencio, y se pierden las estrellas y el
 * desplegable de preguntas en el buscador.
 *
 * Parsear no puede producir JSON inválido: si el bloque no se puede leer, se
 * deja como estaba y se avisa.
 */
function limpiarSchema(html, avisos, rel) {
  return html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (todo, cuerpo) => {
    if (!/euskera/i.test(cuerpo)) return todo;
    let datos;
    try { datos = JSON.parse(cuerpo); }
    catch { avisos.push(`${rel}: el JSON-LD ya venía inválido, no se toca`); return todo; }

    let quitadas = 0;
    const podar = (n) => {
      if (Array.isArray(n)) { n.forEach(podar); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.mainEntity)) {
        const antes = n.mainEntity.length;
        n.mainEntity = n.mainEntity.filter(q => !/euskera/i.test(JSON.stringify(q)));
        quitadas += antes - n.mainEntity.length;
      }
      Object.values(n).forEach(podar);
    };
    podar(datos);
    if (!quitadas) return todo;
    return `<script type="application/ld+json">\n${JSON.stringify(datos, null, 2)}\n  </script>`;
  });
}

function limpiar(html, avisos, rel) {
  let s = limpiarSchema(html, avisos, rel);
  const hechos = [];
  if (s !== html) hechos.push('schema');
  for (const [re, a] of BLOQUES) { const n = (s.match(re) || []).length; if (n) { s = s.replace(re, a); hechos.push(`bloques:${n}`); } }
  for (const [re, a] of FRASES) { const n = (s.match(re) || []).length; if (n) { s = s.replace(re, a); hechos.push(`frases:${n}`); } }
  return { s, hechos };
}

// ── Recorrido ─────────────────────────────────────────────────────────────
const dry = process.argv.includes('--dry');
function rec(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!EXCLUIR_DIR.has(e.name)) rec(path.join(dir, e.name), acc); }
    else if (e.name.endsWith('.html')) acc.push(path.join(dir, e.name));
  }
  return acc;
}

let tocadas = 0, saltadas = 0, rotos = [], avisos = [];
for (const f of rec(PUBLIC, [])) {
  const rel = path.relative(PUBLIC, f).split(path.sep).join('/');
  if (INTOCABLES.has(rel)) { saltadas++; continue; }
  const antes = fs.readFileSync(f, 'utf8');
  if (!/euskera/i.test(antes)) continue;
  const { s, hechos } = limpiar(antes, avisos, rel);
  if (s === antes) { console.log(`  ?  ${rel}  — menciona euskera y NINGÚN patrón encaja`); continue; }

  // El JSON-LD tiene que seguir siendo JSON válido: si se rompe, Google
  // descarta el schema de la página entera y no avisa nadie.
  for (const m of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { rotos.push(`${rel}: ${e.message.slice(0, 60)}`); }
  }
  if (!dry) fs.writeFileSync(f, s);
  tocadas++;
  if (tocadas <= 6) console.log(`  ${dry ? '~' : '✓'}  ${rel}  ${hechos.join(' ')}`);
}
console.log(`\n${dry ? 'ENSAYO — no se ha escrito nada. ' : ''}Páginas limpiadas: ${tocadas} · intocables saltadas: ${saltadas}`);
if (avisos.length) { console.log('\nAvisos:'); avisos.slice(0, 5).forEach(a => console.log('   ·', a)); }
if (rotos.length) {
  console.log(`\n⚠ JSON-LD ROTO en ${rotos.length} páginas — NO se aplica hasta arreglarlo:`);
  rotos.slice(0, 5).forEach(r => console.log('   ·', r));
  process.exitCode = 1;
}
