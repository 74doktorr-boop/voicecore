'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NO SE PUEDE OFRECER UN IDIOMA QUE EL PRODUCTO NO HABLA
//
// La web afirmaba que el asistente hablaba euskera nativo. Eso se limpió: era
// marketing falso. Pero lo grave no estaba en la web — estaba en el PRODUCTO:
//
//   · el portal ofrecía «Euskera» y «Castellano + Euskera» en el desplegable de
//     idioma del asistente,
//   · el onboarding lo ofrecía en el alta y ADEMÁS reproducía un saludo de
//     ejemplo en euskera en el paso «Escuchar mi asistente»,
//   · y la API lo aceptaba, así que quitarlo del desplegable no habría cerrado
//     nada: seguía siendo configurable llamando al endpoint.
//
// Un cliente podía activarlo un martes por la tarde y quedarse esperando algo
// que no llega. Se comprobó antes de tocar nada que ninguna organización lo
// tenía puesto ({"(sin fijar)":3,"es+gl":1}), así que nadie pierde un ajuste.
//
// LO QUE FIJA ESTE FICHERO, y es la parte que se olvida: retirar la OFERTA no
// es borrar la CAPACIDAD. `src/assistants/i18n.js` conserva el euskera a
// propósito. El día que las voces estén listas esto vuelve añadiendo una cadena
// a dos listas. El último test existe para que nadie lo «limpie» de camino.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

/** Saca la lista literal IDIOMAS_OFRECIDOS del código fuente de un fichero. */
function listaOfrecida(rel) {
  const src = leer(...rel.split('/'));
  const m = src.match(/const IDIOMAS_OFRECIDOS = \[([^\]]*)\]/);
  assert.ok(m, `${rel} ya no declara IDIOMAS_OFRECIDOS. Si se ha renombrado, ` +
    'actualiza este test; si se ha borrado, la puerta está otra vez abierta.');
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

const PUERTAS = {
  'portal (cambiar idioma)': 'src/api/routes-portal.js',
  'alta (registro nuevo)':   'src/api/routes-registro.js',
};

for (const [nombre, fichero] of Object.entries(PUERTAS)) {
  test(`la puerta del ${nombre} no acepta euskera`, () => {
    const lista = listaOfrecida(fichero);
    const euskera = lista.filter(l => l.includes('eu'));
    assert.deepEqual(euskera, [],
      `${fichero} vuelve a aceptar ${euskera.join(', ')}. El producto no habla ` +
      'euskera: aceptarlo por API es prometer al cliente algo que no ocurre, ' +
      'aunque el desplegable ya no lo enseñe.');
  });
}

test('las dos puertas ofrecen EXACTAMENTE los mismos idiomas', () => {
  // Si divergen, un idioma nuevo se puede elegir al darse de alta y luego no
  // se puede volver a poner desde el portal (o al revés). El cliente lo vive
  // como «se me ha borrado la configuración».
  const [a, b] = Object.values(PUERTAS).map(listaOfrecida);
  assert.deepEqual([...a].sort(), [...b].sort(),
    `Alta y portal ofrecen listas distintas:\n  alta:   ${b.join(', ')}\n  portal: ${a.join(', ')}`);
});

test('ningún desplegable de la interfaz ofrece euskera', () => {
  // El validador es la cerradura, pero el desplegable es lo que el cliente ve.
  // Dejarlo puesto significa enseñar una opción que devuelve error 400.
  const pantallas = ['public/portal/index.html', 'public/onboarding.html'];
  const culpables = [];
  for (const p of pantallas) {
    for (const m of leer(...p.split('/')).matchAll(/<option value="([^"]*)"/g)) {
      if (/(^|\+)eu$/.test(m[1])) culpables.push(`${p} → value="${m[1]}"`);
    }
  }
  assert.deepEqual(culpables, [], 'Desplegables que aún ofrecen euskera:\n  ' + culpables.join('\n  '));
});

test('el onboarding no reproduce un saludo de ejemplo en euskera', () => {
  // Esto era lo peor de todo: no lo PROMETÍA, lo DEMOSTRABA. En el paso
  // «Escuchar mi asistente», durante el alta.
  const src = leer('public', 'onboarding.html');
  assert.doesNotMatch(src, /Kaixo|Zure laguntzaile|lagundu diezazuket/i,
    'onboarding.html vuelve a tener un saludo en euskera. Enseñar una muestra ' +
    'de algo que el producto no hace es peor que anunciarlo: parece verificado.');
});

test('el MOTOR conserva el euskera — retirar la oferta no es borrar la capacidad', () => {
  // A propósito. Si alguien «limpia» esto creyendo que sobra, el día que las
  // voces en euskera estén listas habrá que reescribir el i18n en vez de añadir
  // una cadena a dos listas. Ver project_euskera_tts (F5-TTS + RTX 4090).
  const src = leer('src', 'assistants', 'i18n.js');
  assert.match(src, /case 'eu':/,
    'Se ha borrado el euskera de src/assistants/i18n.js. Eso NO formaba parte ' +
    'de la retirada: lo que se quitó fue la OFERTA comercial, no el soporte del ' +
    'motor. Revertir.');
});
