'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// UNA PÁGINA EN public/ NO ES UNA PÁGINA PUBLICADA
//
// `express.static` va con `index:false`, así que un directorio con su
// index.html dentro NO se sirve solo: hace falta una ruta declarada en
// server.js. El comentario ya está escrito ahí desde hace meses y aun así
// volvió a pasar: /guard se creó, se desplegó, sus diez capturas devolvían 200
// —o sea, el fichero ESTABA en el contenedor— y la página devolvía 404. Se
// había probado en local contra un servidor estático de los que sí resuelven
// directorios, y ahí funcionaba.
//
// Es un fallo silencioso y caro: el enlace existe en la portada, el despliegue
// sale verde, nada peta, y lo que se lleva el visitante es un 404. Sólo se
// descubre entrando a mano.
//
// Este test cierra el hueco por el lado que importa: NINGÚN enlace interno de
// las páginas principales puede apuntar a un sitio que el servidor no sepa
// servir.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const PUBLIC = path.join(raiz, 'public');
const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');

// Páginas cuyos enlaces se auditan: las que reciben tráfico de verdad.
const PAGINAS = ['index.html', 'recepcion/index.html', 'guard/index.html'];

// Prefijos que NO se comprueban aquí y por qué:
//  · /api y /webhook   → no son páginas.
//  · /blog/…           → los sirve una ruta paramétrica sobre el directorio.
//  · /:sector/:ciudad  → ruta paramétrica que comprueba el fichero en tiempo real.
const FUERA = [/^\/api\b/, /^\/webhooks?\b/, /^\/blog(\/|$)/];

/** ¿server.js declara una ruta que sirva exactamente esta path? */
function tieneRuta(p) {
  // La raíz aparte: quitarle la barra la deja en cadena vacía y ningún patrón
  // encaja. La sirve app.get('/') con enrutado por host (apex vs app.).
  if (p === '/') return /app\.get\('\/',/.test(servidor);
  const sin = p.replace(/\/$/, '');
  // app.get('/x'  |  app.get(['/x', '/x/']  |  app.get(`/${v}`) de las listas
  const patrones = [
    new RegExp(`app\\.get\\(\\s*'${sin}'`),
    new RegExp(`app\\.get\\(\\s*\\[\\s*'${sin}'`),
    new RegExp(`'${sin}'\\s*,\\s*'${sin}/'`),
    new RegExp(`\\[\\s*'${sin}'\\s*,\\s*'${sin}/'\\s*\\]`),
  ];
  if (patrones.some(re => re.test(servidor))) return true;
  // Páginas generadas en bucle desde SECTOR_PAGES. Se leen los elementos de ESA
  // lista, no se busca el nombre suelto por el fichero.
  //
  // La primera versión hacía justo eso —buscar /['"]guard['"]\s*[,\]]/ en todo
  // server.js— y daba verde aunque se borrara la ruta, porque casaba con el
  // 'guard' de path.join(__dirname,'public','guard','index.html'). Un test que
  // no sabe fallar es peor que no tener test: da permiso para desplegar.
  return EN_BUCLE.includes(sin.replace(/^\//, ''));
}

/**
 * Páginas que server.js registra recorriendo una lista en vez de una a una.
 * Se leen los elementos de ESAS listas concretas; no se busca el nombre suelto
 * por todo el fichero.
 *
 * Hay dos formas en el código y las dos cuentan:
 *   const SECTOR_PAGES = [ … ]           → luego SECTOR_PAGES.forEach(...)
 *   ['privacidad','terminos',…].forEach  → lista escrita en el propio bucle
 */
const EN_BUCLE = (() => {
  const nombres = [];
  const sector = servidor.match(/const SECTOR_PAGES = \[([\s\S]*?)\];/);
  if (sector) nombres.push(...[...sector[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]));
  for (const m of servidor.matchAll(/\[([^\]]*?)\]\s*\.forEach\s*\(\s*(?:page|p|sector)\b/g)) {
    nombres.push(...[...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]));
  }
  return nombres;
})();

/** ¿express.static puede servirlo tal cual, sin ruta? (sólo ficheros reales) */
function esFicheroEstatico(p) {
  const f = path.join(PUBLIC, p.replace(/^\//, ''));
  return fs.existsSync(f) && fs.statSync(f).isFile();
}

for (const pagina of PAGINAS) {
  test(`todos los enlaces internos de ${pagina} se pueden servir`, () => {
    const f = path.join(PUBLIC, pagina);
    if (!fs.existsSync(f)) return; // la página aún no existe: no es este test
    const html = fs.readFileSync(f, 'utf8');

    const rotos = [];
    const vistos = new Set();
    for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
      const p = m[1];
      if (vistos.has(p) || FUERA.some(re => re.test(p))) continue;
      vistos.add(p);
      if (esFicheroEstatico(p) || tieneRuta(p)) continue;
      // Un directorio con index.html dentro y SIN ruta: éste es justo el fallo.
      const dir = path.join(PUBLIC, p.replace(/^\//, ''), 'index.html');
      rotos.push(fs.existsSync(dir)
        ? `${p} → el fichero existe pero NO hay ruta en server.js (express.static va con index:false, así que dará 404)`
        : `${p} → no hay ni fichero ni ruta`);
    }

    assert.deepEqual(rotos, [],
      `Enlaces que el servidor no sabe servir:\n  ` + rotos.join('\n  '));
  });
}

test('cada página de producto enlazada desde la portada tiene su ruta', () => {
  // Las de producto son las que se anuncian y por las que entra gente desde
  // fuera. Que una caiga en 404 es perder la visita entera, no un enlace roto.
  const PRODUCTO = ['/recepcion', '/guard'];
  const sinRuta = PRODUCTO.filter(p => !tieneRuta(p));
  assert.deepEqual(sinRuta, [],
    `Páginas de producto sin ruta declarada en server.js: ${sinRuta.join(', ')}`);
});

test('las páginas de producto están en el calentamiento de arranque', () => {
  // No es rendimiento por gusto: getPage baja el HTML de GitHub raw y la
  // primera visita tras un reinicio se come esa latencia entera.
  for (const p of ['/recepcion/index.html', '/guard/index.html']) {
    assert.ok(servidor.includes(`'${p}'`),
      `${p} no está en la lista de warm-up: la primera visita tras cada ` +
      'reinicio pagará la descarga desde GitHub.');
  }
});
