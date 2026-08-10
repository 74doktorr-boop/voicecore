'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL BLOG SE ESTABA COMIENDO SUS PROPIOS ARTÍCULOS
//
// Medido el 11/08 sobre el historial de git: de 18 ejecuciones del generador,
// DOCE reescribieron un artículo que ya existía en lugar de publicar uno nuevo.
// Solo seis crearon una URL nueva.
//
// Y no eran actualizaciones. La del 08/08 metió un texto distinto en
// /blog/asistente-ia-taller-mecanico-donostia —vivo desde el 29 de mayo, con su
// posicionamiento acumulado— y de paso cambió `datePublished` a 2026-08-08, así
// que el esquema pasó a mentir sobre cuándo se escribió.
//
// LA CAUSA: el generador preguntaba solo al manifiesto. En disco había 101
// directorios publicados y en `manifest.published` solo 64: los 37 que faltaban
// se veían como «pendientes» y se regeneraban encima del artículo vivo.
//
// POR QUÉ NO SE VIO EN DOS MESES: porque el resultado SE PARECE a publicar. El
// cron sale en verde, hay commit, el índice se regenera y llega el correo. Lo
// único que no cambiaba era el número de artículos, y eso no lo miraba nadie.
// Otra vez lo mismo: la ausencia se parece a que todo va bien.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const lib = require('../scripts/blog-lib');

test('un artículo YA publicado no se puede pisar', () => {
  const topic = { slug: 'asistente-ia-taller-mecanico-donostia', title: 'X' };
  assert.ok(lib.yaPublicado(topic.slug), 'este artículo debería existir en disco');
  assert.throws(
    () => lib.publishPost(topic, { title: 'otro texto', sections: [] }),
    /YA está publicado: no se pisa/,
    'el generador vuelve a sobrescribir artículos vivos');
});

test('el DISCO manda sobre el manifiesto', () => {
  // El fallo exacto: 101 directorios y 64 slugs en el manifiesto. Preguntarle
  // solo al manifiesto daba 37 «pendientes» que estaban publicadísimos.
  const dirs = fs.readdirSync(lib.BLOG_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  const manifiesto = new Set(JSON.parse(fs.readFileSync(lib.MANIFEST, 'utf8')).published || []);
  const soloEnDisco = dirs.filter(d => !manifiesto.has(d)
    && fs.existsSync(path.join(lib.BLOG_DIR, d, 'index.html')));

  assert.ok(soloEnDisco.length > 0,
    'si esto llega a 0, el manifiesto se ha puesto al día y este test pierde su gracia');
  for (const slug of soloEnDisco) {
    assert.ok(lib.yaPublicado(slug),
      `«${slug}» está en disco y yaPublicado() dice que no: se volvería a pisar`);
  }
});

test('se puede sobrescribir A PROPÓSITO, pero hay que pedirlo', () => {
  // La puerta existe: actualizar un artículo es legítimo. Lo que no vale es que
  // pase por descuido en el camino normal.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-'));
  const antiguo = path.join(lib.BLOG_DIR, '___prueba-sobrescribir');
  try {
    fs.mkdirSync(antiguo, { recursive: true });
    fs.writeFileSync(path.join(antiguo, 'index.html'), '<html>viejo</html>');
    const topic = { slug: '___prueba-sobrescribir', title: 'T' };
    assert.throws(() => lib.publishPost(topic, { title: 'T', sections: [] }), /no se pisa/);
    // Y con el permiso explícito, ya no se queja por existir.
    assert.doesNotThrow(() => {
      try { lib.publishPost(topic, { title: 'T', sections: [] }, { sobrescribir: true }); }
      catch (e) { if (/no se pisa/.test(e.message)) throw e; }
    });
  } finally {
    fs.rmSync(antiguo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la SELECCIÓN de tema tampoco propone artículos vivos', () => {
  // La guarda de publishPost es el cinturón; esto son los tirantes. Sin esto el
  // cron elegiría un tema ya publicado, fallaría al escribir, y el blog se
  // quedaría sin publicar nada durante días sin que nadie supiera por qué.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/blog-gen.js'), 'utf8');
  assert.doesNotMatch(src, /!manifest\.published\.includes/,
    'la selección vuelve a preguntar SOLO al manifiesto, que se queda corto');
  assert.match(src, /lib\.yaPublicado\(/);
});

test('quedan temas por publicar (si no, el blog se para en silencio)', () => {
  // No es un test de código: es un aviso con antelación. Cuando esto se ponga
  // rojo, quedan pocos temas y hay que añadir más a topics.json antes de que el
  // cron empiece a no publicar nada.
  const topics = JSON.parse(fs.readFileSync(path.join(lib.BLOG_DIR, 'topics.json'), 'utf8'));
  const lista = Array.isArray(topics) ? topics : (topics.topics || []);
  const pendientes = lista.filter(t => !lib.yaPublicado(t.slug));
  assert.ok(pendientes.length >= 3,
    `solo quedan ${pendientes.length} temas sin publicar: añade más a topics.json`);
});
