'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA FÁBRICA DE MENTIRAS SEGUÍA ENCENDIDA
//
// La noche del 31/07 se retiraron 76 datos inventados de la web. Al día
// siguiente el blog automático publicó, él solo:
//
//   «una farmacia en el Casco Viejo reportó una reducción del 40%»
//   «¿Sabías que el 60% de las farmacias en Bilbao...?»
//
// Los mismos patrones. Y con motivo: el prompt del generador decía LITERALMENTE
// «Datos y porcentajes concretos (pueden ser estimaciones realistas si no tienes
// fuente exacta)». Estaba pedido. Se limpió la salida y se dejó la máquina.
//
// Lo cazaron los tests de anoche, pero al desplegar — o sea, con el artículo ya
// publicado y el despliegue roto. Este fichero prueba el candado que lo impide
// ANTES: el generador pasa cada borrador por `revisar()` y no escribe nada si
// dice algo que no se puede sostener.
//
// La regla de fondo, que es la del charter: **una instrucción a un modelo es una
// petición, no una garantía**. Si algo no se puede publicar, la comprobación
// tiene que ser determinista y vivir fuera del modelo.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { revisar, exigirHonestidad, REGLAS } = require('../src/content/honestidad');

const reglas = (t) => [...new Set(revisar(t).map(f => f.regla))].sort();

// ── Regresión con el TEXTO REAL que se publicó el 01/08 ─────────────────────
// No son ejemplos inventados para que el test pase: son las frases exactas que
// llegaron a producción. Si el candado deja de cazarlas, vuelve a pasar.
test('caza las frases EXACTAS que publicó el blog el 01/08', () => {
  assert.deepEqual(
    reglas('Por ejemplo, una farmacia en el Casco Viejo reportó una reducción del 40% en el tiempo dedicado a atender llamadas después de implementar NodeFlow.'),
    ['cliente-con-cifra']);
  assert.deepEqual(
    reglas('En Bilbao, una farmacia en Indautxu reportó que el 30% de sus llamadas diarias estaban relacionadas con la disponibilidad de medicamentos.'),
    ['cliente-con-cifra']);
  assert.deepEqual(
    reglas('¿Sabías que el 60% de las farmacias en Bilbao enfrentan problemas de saturación en sus líneas telefónicas?'),
    ['cifra-sin-fuente', 'porcentaje-local-inventado']);
  assert.deepEqual(
    reglas('voz natural, respuesta en menos de un segundo y hasta euskera y galego nativos'),
    ['euskera', 'voz-gallega']);
});

test('caza la mentira SIN cifra, que es la que se escapó a la primera pasada', () => {
  // Un «caso de éxito» sin porcentaje dice lo mismo y ningún patrón numérico lo ve.
  assert.deepEqual(reglas('Un caso de éxito es una clínica de San Sebastián que pasó una auditoría de RGPD.'), ['cliente-sin-cifra']);
  assert.deepEqual(reglas('Los negocios que lo usan reportan más reservas.'), ['cliente-sin-cifra']);
});

test('caza el estudio que nadie puede enseñar', () => {
  assert.deepEqual(reglas('Según estudios del sector, la atención telefónica es clave.'), ['estudio-fantasma']);
  assert.deepEqual(reglas('Un análisis de centros que han implementado IA muestra mejoras.'), ['estudio-fantasma']);
});

test('caza lo que ya no ofrece el producto', () => {
  assert.deepEqual(reglas('Voces ultra-realistas de ElevenLabs con voz premium.'), ['voz-premium']);
  assert.deepEqual(reglas('Tu plan incluye 500 min/mes.'), ['cupo-viejo']);
  assert.deepEqual(reglas('Habla euskera nativo.'), ['euskera']);
});

// ── Y lo contrario, que es igual de importante ──────────────────────────────
// Un filtro que denuncia de más se acaba desactivando, y entonces no filtra
// nada. Estas frases son verdad y TIENEN que pasar.
test('NO denuncia lo que sí es cierto', () => {
  const ciertas = [
    'El teléfono de una farmacia suena mientras estás dispensando una receta.',
    'NodeFlow atiende en castellano y en galego, y deja la cita puesta en tu agenda.',
    'El recordatorio sale 24 horas antes, que es cuando el hueco todavía se puede volver a llenar.',
    'Tu plan incluye 200 minutos al mes; el minuto extra son 0,15 €.',
    'La voz é natural, aínda que non ten acento galego: iso preferimos dicilo antes que prometelo.',
    '¿Cuántas llamadas se te escapan mientras atiendes el mostrador?',
    'Según el INE, el comercio electrónico creció en 2024.',
  ];
  for (const f of ciertas) assert.deepEqual(revisar(f), [], `denuncia una frase verdadera: «${f}»`);
});

test('la frase HONESTA sobre el galego no se denuncia a sí misma', () => {
  // Lleva un (?<!non ten ) a propósito. Sin él, el chivato señalaba justo el
  // arreglo — y un chivato que señala el arreglo se acaba ignorando.
  assert.deepEqual(revisar('a voz é natural, aínda que non ten acento galego'), []);
  assert.equal(revisar('acento galego real').length, 1);
});

test('no mira dentro de los comentarios HTML', () => {
  // Varios comentarios de este repo explican estas retiradas citando la frase
  // retirada. Denunciarlos sería denunciar la explicación del arreglo.
  assert.deepEqual(revisar('<p>Texto limpio.</p><!-- antes decía: euskera nativo -->'), []);
});

test('revisa objetos, no solo cadenas (el generador devuelve JSON)', () => {
  const post = { h1: 'Recepcionista IA', sections: [{ h2: 'Ventajas', content: 'Una clínica reportó un 40% menos de ausencias.' }] };
  assert.deepEqual(reglas(post), ['cliente-con-cifra']);
});

test('exigirHonestidad lanza con el motivo, no con un booleano', () => {
  // Quien lea el fallo a las tres de la mañana necesita saber QUÉ frase y POR
  // QUÉ, no que «la validación falló».
  assert.throws(() => exigirHonestidad('Una clínica reportó un 40% menos.', 'el artículo'), (e) => {
    assert.match(e.message, /No se publica el artículo/);
    assert.match(e.message, /cliente-con-cifra/);
    assert.match(e.message, /no hay clientes/i);
    return true;
  });
  exigirHonestidad('NodeFlow coge el teléfono cuando tú no puedes.');   // no lanza
});

test('cada regla explica POR QUÉ, no solo que está prohibida', () => {
  // Sin el porqué, el que se lo encuentre lo tomará por una manía y buscará
  // cómo esquivarlo. Con el porqué, entiende que es la verdad la que manda.
  for (const r of REGLAS) {
    assert.ok(r.porque && r.porque.length > 30, `la regla ${r.id} no explica su motivo`);
    assert.ok(r.id && r.re instanceof RegExp);
  }
});

test('aguanta entradas raras sin romper', () => {
  for (const x of ['', null, undefined, 0, [], {}]) assert.deepEqual(revisar(x), []);
});

// ── Las excepciones, que importan tanto como las reglas ─────────────────────
describe_excepciones();
function describe_excepciones() {
  const { revisarPagina, EXCEPCIONES } = require('../src/content/honestidad');

  test('el euskera de ETS Guard NO se denuncia: ahí es cierto', () => {
    // Esa app está traducida entera y hay tests en su repo que lo vigilan.
    assert.deepEqual(revisarPagina('guard/index.html', 'La app está en euskera.'), []);
    // Pero en cualquier otra página sí.
    assert.equal(revisarPagina('recepcion/index.html', 'La app está en euskera.').length, 1);
  });

  test('la página del 410 puede nombrar lo que retiramos', () => {
    assert.deepEqual(revisarPagina('blog/retirado.html', 'Retiramos los artículos que prometían euskera y acento galego.'), []);
  });

  test('la documentación de la API puede enumerar sus valores', () => {
    // `ttsProvider: openai | cartesia | elevenlabs` describe la interfaz, no
    // ofrece voces. Denunciarlo sería obligar a mentir en la documentación.
    assert.deepEqual(revisarPagina('docs.html', 'ttsProvider string openai | cartesia | elevenlabs'), []);
  });

  test('hementxe queda fuera entero: es otra empresa', () => {
    assert.deepEqual(revisarPagina('hementxe/index.html', 'euskera, voz premium, un estudio reciente dice que el 80%'), []);
  });

  test('una excepción tapa SOLO su regla, no todas', () => {
    // Guard está exceptuada del euskera; si mañana dijera que una clínica
    // reportó un 40%, eso tiene que seguir saltando.
    const f = revisarPagina('guard/index.html', 'Está en euskera. Y una clínica reportó un 40% menos de ausencias.');
    assert.deepEqual(f.map(x => x.regla), ['cliente-con-cifra']);
  });

  test('cada excepción explica POR QUÉ está exceptuada', () => {
    for (const [re, , porque] of EXCEPCIONES) {
      assert.ok(re instanceof RegExp);
      assert.ok(porque && porque.length > 30, `una excepción no explica su motivo: ${re}`);
    }
  });

  test('las rutas de Windows se normalizan (si no, la excepción no aplica)', () => {
    assert.deepEqual(revisarPagina('guard\\index.html', 'La app está en euskera.'), []);
  });
}

// ── Y el barrido del sitio entero, que es lo que hace esto permanente ───────
test('NINGUNA página publicada dice algo que no se sostiene', () => {
  // Esto es lo que faltaba: los tests de anoche vigilaban cada mentira por
  // separado, en su fichero. Este pasa TODAS las reglas por TODAS las páginas,
  // así que una regla nueva protege el sitio entero desde el minuto uno.
  const fs = require('node:fs');
  const path = require('node:path');
  const { revisarPagina } = require('../src/content/honestidad');
  const PUBLIC = path.join(__dirname, '..', 'public');

  const malas = [];
  (function recorrer(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // `continue`, NO `return`: con return se abandona la carpeta entera al
      // primer fichero que no sea HTML, y el barrido da «cero» sin haber mirado.
      if (e.isDirectory()) { recorrer(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = path.relative(PUBLIC, p).split(path.sep).join('/');
      const f = revisarPagina(rel, fs.readFileSync(p, 'utf8'));
      if (f.length) malas.push(`${rel}: [${f[0].regla}] «${f[0].encontrado}»`);
    }
  })(PUBLIC);

  assert.deepEqual(malas, [],
    'Hay páginas publicadas diciendo cosas que no se sostienen:\n  ' + malas.join('\n  '));
});
