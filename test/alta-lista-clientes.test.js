'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA LISTA DE CLIENTES, PEDIDA EN EL ALTA
//
// Con la última visita ya conectada (contact-import), el producto puede decir
// «de tus 480 clientes, 47 llevan más de X meses sin volver». Pero eso solo
// pasaba si el dueño encontraba por su cuenta la importación, escondida en el
// portal. Una función que hay que descubrir es una función que no existe para
// la mayoría — la misma lección que las 17 reglas aprendidas que nadie miraba.
//
// Pedirla en el alta la convierte en la victoria del DÍA 1: el dueño ve el
// número antes de pagar, calculado de SU propio fichero, y al entrar al portal
// ya le está esperando. Sin llamar a nadie y sin coste.
//
// El camino tiene tres tramos y los tres tienen que aguantar:
//   navegador (lee y cuenta) → alta (guarda) → aprovisionamiento (importa)
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const alta = leer('public/onboarding.html');
const registro = leer('src/api/routes-registro.js');
const billing = leer('src/api/routes-billing.js');

test('el alta pide la lista y la manda', () => {
  assert.match(alta, /id="clientesFile"/, 'el alta no pide la lista de clientes');
  assert.match(alta, /clientesCsv: \(_clientesCsv \|\| undefined\)/, 'la lista no viaja con el alta');
});

test('el fichero se lee EN EL NAVEGADOR, no se sube para ver el número', () => {
  // El dueño ve el recuento antes de pagar y sin que los datos de sus clientes
  // hayan salido de su ordenador todavía. Además evita crear un endpoint
  // público que acepte CSV, que sería un buen sitio para que llamen a la puerta.
  assert.match(alta, /new FileReader\(\)/);
  assert.match(alta, /fr\.readAsText/);
});

test('el número que se enseña dice CON QUÉ REGLA se ha contado', () => {
  // El portal usará después el umbral propio de su sector, que puede ser otro.
  // Enseñar aquí un número con una regla y otro distinto en el panel, sin
  // explicar por qué, es la forma más tonta de perder la credibilidad que da
  // justo este momento. Por eso se dice «más de N meses» y se dice N.
  assert.match(alta, /MESES_DORMIDO/);
  assert.match(alta, /llevan más de ' \+ MESES_DORMIDO \+ ' meses sin volver/);
});

test('sin columna de última visita NO se inventa un número', () => {
  // Se cuenta lo que hay (los clientes) y se dice lo que falta para lo otro.
  assert.match(alta, /Sin la columna de <b>Última visita<\/b> no puedo decirte a cuántos has perdido/);
});

test('un fichero enorme no se manda: se explica qué hacer', () => {
  assert.match(alta, /f\.size > 1000000/);
  assert.match(alta, /Súbelo desde tu panel/);
});

test('el servidor guarda la lista con el id del registro y con caducidad', () => {
  // En Redis y no en una columna: el CSV lleva datos personales de clientes
  // AJENOS y no tiene por qué sobrevivir a su propia importación. Además evita
  // una migración, que en este repo es siempre la parte que se queda a medias.
  assert.match(registro, /nf:alta-clientes:\$\{row\.id\}/);
  assert.match(registro, /24 \* 3600 \* 1000/, 'la lista debería caducar sola');
  assert.match(registro, /clientesCsv\.slice\(0, 1_000_000\)/, 'falta el tope de tamaño');
});

test('guardar la lista NUNCA bloquea el alta', () => {
  // Si Redis falla, el alta sigue: el dueño puede subir el fichero desde el
  // portal. Degradar bien es parte del diseño, no un parche.
  const i = registro.indexOf('nf:alta-clientes');
  const bloque = registro.slice(i - 400, i + 400);
  assert.match(bloque, /\.catch\(/, 'un fallo al guardar la lista no puede tumbar el alta');
});

test('el aprovisionamiento la consume UNA vez y la borra', () => {
  assert.match(billing, /take\(`nf:alta-clientes:\$\{registro\.id\}`\)/,
    'debe consumirse con take (leer y borrar), no con get');
  assert.match(billing, /importContacts\(org\.id, parsed\.rows\)/);
});

test('si el CSV viene raro, el alta se completa igual', () => {
  // Un aprovisionamiento a medias por un fichero mal formado sería un
  // intercambio pésimo: el cliente ha pagado y se queda sin asistente.
  const i = billing.indexOf('nf:alta-clientes');
  const bloque = billing.slice(i, i + 1200);
  assert.match(bloque, /catch/, 'la importación del alta tiene que fallar hacia dentro');
  assert.match(bloque, /log\.warn/);
});

test('el JS del alta compila (los CSV traen saltos de línea y las regex se rompen fácil)', () => {
  // Este test existe porque al escribir esto una expresión regular quedó partida
  // en dos líneas: `/\r?\n/` acabó con un salto de línea REAL dentro. El fichero
  // se veía bien y el navegador no habría ejecutado nada.
  for (const bloque of alta.split('<script>').slice(1).map(x => x.split('</script>')[0])) {
    assert.doesNotThrow(() => new Function(bloque), 'hay un bloque <script> que no compila');
  }
});
