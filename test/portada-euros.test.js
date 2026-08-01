'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA PORTADA ABRÍA CON «HOY», Y NADIE RENUEVA POR LO QUE VE HOY
//
// Para un negocio con tres llamadas a la semana, un panel que solo cuenta el día
// de hoy está vacío casi todos los días. Un mes entero de trabajo, invisible. Y
// la cifra que sí justifica la cuota —lo recuperado en 30 días— ya se calculaba:
// estaba en /api/portal/recovery, a una pantalla de distancia, donde no la ve
// quien tiene que decidir si sigue pagando.
//
// Y por el camino apareció otra vez lo mismo: TRES formas distintas de resolver
// el ticket medio en el mismo fichero. La portada usaba el modelo bueno
// (declarado → mediana de sus precios reales → null) y las otras dos leían el
// campo en crudo con `|| 0`. El mismo negocio podía ver euros arriba y CERO
// euros justo debajo, en la misma pantalla, sin ninguna explicación. Un número
// que cambia según dónde lo mires no es un número: es una razón para dejar de
// creerse el panel entero.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
const rutas = leer('src/api/routes-portal.js');
const portal = leer('public/portal/portal.js');

test('UNA sola forma de resolver el ticket medio', () => {
  // Si vuelve a aparecer un `avgTicket` leído en crudo, vuelven los dos números
  // distintos en la misma pantalla.
  assert.doesNotMatch(rutas, /Number\(flowConfig\.automations\?\.config\?\.avgTicket\) \|\| 0/,
    'las señales de tareas vuelven a leer el ticket en crudo');
  assert.doesNotMatch(rutas, /req\.flowConfig\?\.automations\?\.config\?\.avgTicket \|\| 0/,
    '/api/portal/recovery vuelve a leer el ticket en crudo');
  assert.ok((rutas.match(/_ticketDeLaOrg\(/g) || []).length >= 4,
    'no todos los sitios pasan por el mismo resolutor');
});

test('el resolutor compartido respeta la jerarquía de fiabilidad', () => {
  const { resolveAvgTicket } = require('../src/analytics/value-model');
  assert.equal(resolveAvgTicket({ configured: 120, prices: [40, 40] }).source, 'configured',
    'lo declarado por el dueño manda siempre');
  assert.equal(resolveAvgTicket({ prices: [40, 40, 45] }).source, 'observed');
  assert.equal(resolveAvgTicket({}).value, null, 'sin datos NO se inventa');
});

test('la portada recibe lo recuperado en 30 días', () => {
  assert.match(rutas, /recuperado30d/, 'el dashboard no envía el acumulado');
  assert.match(rutas, /sinceDays: 30/);
});

test('solo cuenta la atribución FUERTE, la que el dueño no puede discutir', () => {
  // `strongValue` = lo que se habría perdido sin NodeFlow (fuera de horario y
  // saturación). Una cita en horario y sin solape la habrían cogido igual, y
  // contarla convertiría la cifra en un eslogan.
  const ini = rutas.indexOf('let recuperado30d');
  const bloque = rutas.slice(ini, ini + 1600);
  assert.match(bloque, /rc\.totals\?\.strongValue/);
  assert.doesNotMatch(bloque, /weakValue/, 'se está contando atribución débil');
});

test('sin ticket conocido NO se calcula ni se enseña', () => {
  const bloque = rutas.slice(rutas.indexOf('let recuperado30d'), rutas.indexOf('let recuperado30d') + 900);
  assert.match(bloque, /if \(ticket\.value && _db\.enabled\)/,
    'se calcularían euros sin saber el ticket medio');
});

test('un 0 € NO se publica en portada', () => {
  // Puede venir simplemente de que aún no ha entrado ninguna llamada. Un cero
  // gigante en la portada desanima sin informar de nada.
  const bloque = rutas.slice(rutas.indexOf('let recuperado30d'), rutas.indexOf('let recuperado30d') + 1400);
  assert.match(bloque, /if \(euros > 0\) recuperado30d/);
});

test('el cálculo va en su propio try: no puede tumbar la portada', () => {
  // Es lo más caro de esta pantalla. Sin la cifra el panel sigue sirviendo; sin
  // portada no hay producto.
  const bloque = rutas.slice(rutas.indexOf('let recuperado30d'), rutas.indexOf('let recuperado30d') + 1600);
  assert.match(bloque, /catch \(e\) \{ log\.warn\(`recuperado30d/);
});

test('el bloque pide su PROPIA conexión a la base', () => {
  // `db` no existe en el ámbito de esa ruta: se pide dentro de cada try anidado.
  // Usar el de fuera lanzaba ReferenceError, y el catch de arriba se lo tragaba
  // — la cifra no aparecería NUNCA y el panel se vería perfectamente bien. Un
  // fallo silencioso escondido justo detrás del try puesto para que nada caiga.
  const bloque = rutas.slice(rutas.indexOf('let recuperado30d'), rutas.indexOf('let recuperado30d') + 900);
  assert.match(bloque, /const _db = getDatabase\(\)/);
  assert.match(bloque, /db: _db/);
});

test('la portada lo pinta ANTES que lo de hoy', () => {
  const iRec = portal.indexOf("recuperado +\n    '<div class=\"nf-hero-lead\">");
  assert.ok(iRec > 0, 'el acumulado no se pinta antes del texto del día');
});

test('la cifra es auditable: enlaza al detalle', () => {
  // Un número que no se puede comprobar es un eslogan, y este existe
  // precisamente para convencer a quien duda.
  assert.match(portal, /ver cuáles/);
  assert.match(portal, /oportunidades' \) \+\s*\n?.*|oportunidades/);
});

test('el JS del portal compila', () => {
  assert.doesNotThrow(() => new Function(portal));
});
