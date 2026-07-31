'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RETIRAR UN ARTÍCULO ES SEIS COSAS, NO BORRAR UNA CARPETA
//
// Cuatro artículos del blog afirmaban que el asistente de voz atiende en
// euskera. El producto no lo habla, y ahí no cabía recortar una frase porque el
// euskera ERA el tema: «Recepcionista virtual que habla euskera nativo: ¿es
// posible en 2026?» no se arregla tachando una palabra.
//
// Borrar la carpeta habría dejado, cada una por su lado y en silencio:
//   · la URL en el sitemap, invitando a Google a rastrear un 404;
//   · la entrada en el índice del blog, enlazando a la nada;
//   · el slug en `published`, así que al quitarlo volvía a «pendiente» y el
//     generador LO REESCRIBÍA en la siguiente tirada — borrado el martes,
//     resucitado el jueves;
//   · enlaces entrantes desde páginas de sector que siguen vivas;
//   · y un 404 en vez de un 410, que es la diferencia entre «no lo encuentro»
//     —Google reintenta meses— y «lo hemos quitado a propósito».
//
// Este fichero comprueba las seis a la vez. Y sobre todo que las DOS LISTAS
// —la del script que retira y la que el servidor responde con 410— digan lo
// mismo: si se separan, o queda un artículo servido que debía estar fuera, o un
// 410 para algo que sigue publicado.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const PUBLIC = path.join(raiz, 'public');
const BLOG = path.join(PUBLIC, 'blog');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

/** Saca una lista de slugs de un literal con nombre, del fichero que sea. */
function listaDe(fichero, nombre) {
  const src = leer(...fichero.split('/'));
  const m = src.match(new RegExp(`${nombre}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${fichero} ya no declara ${nombre}`);
  return [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]).sort();
}

const DEL_SERVIDOR = listaDe('server.js', 'ARTICULOS_RETIRADOS');
const DEL_SCRIPT   = listaDe('scripts/retirar-articulos-euskera.js', 'RETIRADOS');

test('el servidor y el script retiran EXACTAMENTE los mismos artículos', () => {
  assert.deepEqual(DEL_SERVIDOR, DEL_SCRIPT,
    'Las dos listas se han separado. O hay un artículo servido que debería ' +
    'estar retirado, o se devuelve 410 de algo que sigue publicado.\n' +
    `  servidor: ${DEL_SERVIDOR.join(', ')}\n  script:   ${DEL_SCRIPT.join(', ')}`);
});

test('ninguno de los retirados sigue en disco', () => {
  const vivos = DEL_SERVIDOR.filter(s => fs.existsSync(path.join(BLOG, s, 'index.html')));
  assert.deepEqual(vivos, [], `Estos artículos siguen publicados: ${vivos.join(', ')}`);
});

test('ninguno sigue en el sitemap', () => {
  const sm = leer('public', 'sitemap.xml');
  const dentro = DEL_SERVIDOR.filter(s => sm.includes('/blog/' + s));
  assert.deepEqual(dentro, [],
    `El sitemap sigue mandando a Google a rastrear: ${dentro.join(', ')}`);
});

test('ninguno sigue en el manifiesto — ni en posts ni en published', () => {
  const man = JSON.parse(leer('public', 'blog', 'manifest.json'));
  const enPosts = DEL_SERVIDOR.filter(s => (man.posts || []).some(p => p.slug === s));
  const enPub   = DEL_SERVIDOR.filter(s => (man.published || []).includes(s));
  assert.deepEqual(enPosts, [], `Siguen en manifest.posts (y por tanto en el índice del blog): ${enPosts.join(', ')}`);
  assert.deepEqual(enPub, [], `Siguen en manifest.published: ${enPub.join(', ')}`);
});

test('ninguno sigue en la cola del generador', () => {
  // La trampa fina: si se quitan de `published` pero se dejan en topics.json,
  // vuelven a contar como PENDIENTES y el generador los reescribe. Borrado el
  // martes, resucitado el jueves, y nadie mirando.
  const temas = JSON.parse(leer('public', 'blog', 'topics.json'));
  const enCola = DEL_SERVIDOR.filter(s => temas.some(t => t.slug === s));
  assert.deepEqual(enCola, [],
    `Siguen en topics.json: el generador los volverá a escribir. ${enCola.join(', ')}`);
});

test('ninguna página del sitio los enlaza', () => {
  const rotos = [];
  (function rec(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { rec(p); continue; }
      if (!/\.(html|xml)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const slug of DEL_SERVIDOR) {
        if (s.includes('/blog/' + slug)) rotos.push(`${path.relative(PUBLIC, p)} → ${slug}`);
      }
    }
  })(PUBLIC);
  assert.deepEqual(rotos, [],
    'Enlaces a artículos retirados. Retirar uno y dejar quien lo enlaza es ' +
    `cambiar un problema por otro:\n  ${rotos.join('\n  ')}`);
});

test('se responde 410 con página, no un 404 ni un error seco', () => {
  const src = leer('server.js');
  assert.match(src, /res\.status\(410\)\.sendFile\([^)]*'retirado\.html'\)/,
    'El servidor ya no devuelve 410 con la página de retirada. Un 404 hace que ' +
    'Google reintente durante meses en vez de desindexar.');
  assert.ok(fs.existsSync(path.join(BLOG, 'retirado.html')),
    'Falta public/blog/retirado.html: el 410 se quedaría sin página que servir.');
});

test('la página de retirada no se indexa y explica el motivo', () => {
  const h = leer('public', 'blog', 'retirado.html');
  assert.match(h, /noindex/, 'La página de retirada no debe indexarse ella misma.');
  assert.match(h, /No es cierto/,
    'La página tiene que decir qué pasó. Un "no disponible" genérico deja al ' +
    'visitante igual de perdido que un 404.');
});
