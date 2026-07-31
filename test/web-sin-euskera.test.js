'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA WEB NO PUEDE VOLVER A PROMETER EUSKERA
//
// Se limpió en dos rondas. La primera cubrió lo que encajaba en un patrón y
// dejó 168 menciones en 88 páginas — y, peor, dejó frases DESTROZADAS
// publicadas: «Sí. NodeFlow soporta castellanos.», «prefieren recibir
// información en valoran que la autoescuela ofrezca esa opción», y preguntas
// frecuentes a las que les había borrado la pregunta y les había dejado la
// respuesta. La segunda ronda reescribió las 149 frases distintas, una a una.
//
// Este test no cuenta apariciones de una palabra: CLASIFICA. Hay cuatro sitios
// donde «euskera» es correcto y uno donde no lo es nunca, y confundirlos es
// justo lo que llevaría a borrar algo cierto o a dejar pasar algo falso.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Dónde «euskera» es CORRECTO, y por qué:
const PERMITIDO = new Map([
  ['guard/index.html',
   'La app del vigilante de NodeFlow Guard está traducida entera al euskera y ' +
   'hay tests en su repo que fallan si una frase se queda sin traducir. Aquí ' +
   'es un argumento de venta CIERTO.'],
  ['blog/retirado.html',
   'Es la página del 410: explica que retiramos los artículos que lo prometían.'],
  ['blog/ia-voz-para-negocios-espana-tendencias-2026/index.html',
   'Análisis del sector, no promesa nuestra: el euskera y el catalán tienen ' +
   'calidad desigual EN EL MERCADO. Va seguido de lo que NodeFlow sí hace.'],
]);
const FUERA_DE_ALCANCE = [
  // hementxe es OTRA EMPRESA y queda fuera de todos los barridos de marca.
  /^hementxe\//,
  // El panel interno MUESTRA el idioma que tenga guardado una organización
  // («🔵 EU»); no lo ofrece. La diferencia importa: la oferta se cerró en el
  // portal y en el alta, pero si algún día apareciera una fila heredada, lo
  // correcto es enseñarla tal cual y no mentir sobre lo que hay en la base.
  /^admin\//,
];

function paginas(dir = PUBLIC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { paginas(p, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}
const rel = (p) => path.relative(PUBLIC, p).split(path.sep).join('/');
/** Lo que ve un visitante: sin comentarios HTML (varios explican esta retirada). */
const visible = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

test('ninguna página promete euskera', () => {
  const culpables = [];
  for (const f of paginas()) {
    const r = rel(f);
    if (PERMITIDO.has(r) || FUERA_DE_ALCANCE.some(re => re.test(r))) continue;
    const h = visible(fs.readFileSync(f, 'utf8'));
    const n = (h.match(/euskera/gi) || []).length;
    if (!n) continue;
    const muestra = (h.match(/[^<>]{0,70}euskera[^<>]{0,70}/i) || [''])[0].replace(/\s+/g, ' ').trim();
    culpables.push(`${r} (${n}×): «${muestra}»`);
  }
  assert.deepEqual(culpables, [],
    'El producto NO habla euskera. Estas páginas vuelven a decir que sí:\n  ' +
    culpables.join('\n  '));
});

test('lo que sí es cierto sigue en pie — no se ha barrido de más', () => {
  // La otra mitad del riesgo: un barrido demasiado ancho borraría el euskera de
  // Guard, que es verdad y es un argumento de venta delante de un cliente vasco.
  for (const [r, motivo] of PERMITIDO) {
    const f = path.join(PUBLIC, r);
    if (!fs.existsSync(f)) continue;
    // visible(), no el fichero en bruto: al probarlo por mutación, borrar la
    // frase de Guard NO ponía el test en rojo porque le bastaba con encontrar
    // la palabra en un comentario del código. Un test que se conforma con eso
    // aprueba una página que ya no dice lo que tiene que decir.
    assert.match(visible(fs.readFileSync(f, 'utf8')), /euskera/i,
      `${r} ha perdido su mención al euskera y NO debía perderla. ${motivo}`);
  }
});

test('no quedan frases partidas de los barridos', () => {
  // Lo que de verdad hace daño no es que sobre una palabra: es que falte media
  // oración. Recortar una palabra en medio de una frase deja textos sin sujeto,
  // y eso no lo detecta contar apariciones.
  const SENALES = [
    [/\bcastellanos\b/, '«castellanos» — plural imposible, resto de un recorte'],
    [/\ben\s+valoran\b/, '«en valoran» — frase partida'],
    [/\s+en\s*\.(?!\.)/, '«… en .» — preposición huérfana'],
    [/\s+y\s*\.(?!\.)/, '«… y .» — conjunción huérfana'],
    [/,\s*\.(?!\.)/, '«, .» — coma pegada a un punto'],
    [/\s+—\s*\.(?!\.)/, '«— .» — inciso vacío'],
  ];
  const rotos = [];
  for (const f of paginas()) {
    const r = rel(f);
    if (FUERA_DE_ALCANCE.some(re => re.test(r))) continue;
    // Sólo texto: en el CSS y el JS estos signos son normales.
    const texto = visible(fs.readFileSync(f, 'utf8'))
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    for (const [re, motivo] of SENALES) if (re.test(texto)) rotos.push(`${r}: ${motivo}`);
  }
  assert.deepEqual(rotos, [], 'Frases rotas en páginas publicadas:\n  ' + rotos.join('\n  '));
});

test('no quedan preguntas frecuentes sin pregunta', () => {
  // La primera ronda borró el <span itemprop="name"> de varias preguntas y dejó
  // el resto: un desplegable con su «+», sin texto, y debajo una respuesta que
  // no responde a nada. Estuvo publicado así.
  const mudas = [];
  for (const f of paginas()) {
    const r = rel(f);
    if (FUERA_DE_ALCANCE.some(re => re.test(r))) continue;
    const h = fs.readFileSync(f, 'utf8');
    for (const m of h.matchAll(/<button class="faq-q"[^>]*>([\s\S]*?)<\/button>/g)) {
      const dentro = m[1].replace(/<span class="faq-icon"[^>]*>[\s\S]*?<\/span>/g, '')
                         .replace(/<[^>]+>/g, '').trim();
      if (!dentro) mudas.push(r);
    }
  }
  assert.deepEqual([...new Set(mudas)], [],
    'Preguntas frecuentes con el desplegable pero sin pregunta:\n  ' + [...new Set(mudas)].join('\n  '));
});

test('todo el JSON-LD del sitio es válido', () => {
  // Un JSON-LD inválido no falla de forma visible: Google descarta el schema de
  // la página ENTERA en silencio. recepcionista-ia-farmacia-bilbao llevaba así
  // desde que se publicó, por unas comillas rectas dentro de una cadena.
  const rotos = [];
  for (const f of paginas()) {
    const h = fs.readFileSync(f, 'utf8');
    for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(m[1]); }
      catch (e) { rotos.push(`${rel(f)}: ${e.message.slice(0, 55)}`); }
    }
  }
  assert.deepEqual(rotos, [], 'JSON-LD inválido (Google descarta el schema entero):\n  ' + rotos.join('\n  '));
});

test('no hay clientes ni métricas inventadas de las que ya cazamos', () => {
  // «La Clínica VetBilbao implementó NodeFlow y vio un aumento del 15%». No
  // existe. En una empresa cuyo argumento es que no se inventa nada, un
  // testimonio falso hace más daño que cualquier promesa de idioma.
  const INVENTADOS = [/Cl[ií]nica VetBilbao/i];
  const culpables = [];
  for (const f of paginas()) {
    const h = fs.readFileSync(f, 'utf8');
    for (const re of INVENTADOS) if (re.test(h)) culpables.push(rel(f));
  }
  assert.deepEqual(culpables, [], 'Clientes inventados de vuelta en la web:\n  ' + culpables.join('\n  '));
});
