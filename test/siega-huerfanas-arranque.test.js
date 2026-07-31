'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// PILOTO-12 · LA SIEGA DEL ARRANQUE NO PUEDE LLAMARSE UNA SOLA VEZ
//
// Si un deploy mata el proceso a mitad de llamada, la fila queda en 'active'
// para siempre y el portal del cliente enseña un reloj corriendo (caso real:
// «1989 minutos»). Para eso existe reapOrphanCalls, y estaba bien escrito y
// bien conectado: al arrancar y cada hora, con candado de líder.
//
// EL FALLO ESTABA EN EL ORDEN, NO EN LA LÓGICA. Con Redis,
// startLeaderElection() lanza un tick ASÍNCRONO y devuelve; `_isLeader` nace
// en false y sólo cambia cuando Redis contesta. La siega del arranque se
// llamaba UNA VEZ y en seco, justo antes de que eso ocurriera: leía false
// siempre y NO SE EJECUTABA NUNCA. La que existe precisamente para el caso
// «deploy a media llamada» era la única que no llegaba a correr.
//
// La siguiente oportunidad era el intervalo horario. Es decir: hasta una hora
// con la fila fantasma marcando minutos en el portal de un cliente.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('la siega del arranque reintenta hasta que el liderazgo se asienta', () => {
  assert.match(server, /_siegaArranque = setInterval\(/,
    'Ha vuelto la llamada única al arrancar: con Redis, isLeader() todavía es ' +
    'false en ese instante y la siega no se ejecuta.');
  assert.ok(server.includes('}, 5000)'), 'el reintento debe ser corto (5 s)');
});

test('el reintento tiene techo: no insiste para siempre', () => {
  // Una réplica seguidora nunca va a ser líder. Sin techo, se quedaría
  // preguntando cada 5 s durante toda la vida del proceso para no hacer nada.
  assert.match(server, /_intentosSiega \+?\+? ?>= 24|\+\+_intentosSiega >= 24/,
    'sin tope, una réplica seguidora reintenta indefinidamente');
});

test('para cuando consigue segar, no cuando se cansa', () => {
  // El orden del `||` importa: si se comprobara antes el contador, se gastaría
  // un intento de más y, peor, seguiría reintentando después de haber segado.
  assert.match(server, /if \(_reapIfLeader\(\) \|\| \+\+_intentosSiega >= 24\) clearInterval/,
    'la condición debe cortar EN CUANTO siega, no sólo al agotar los intentos');
});

test('_reapIfLeader informa de si llegó a segar', () => {
  // Antes no devolvía nada, así que el reintento no habría podido saber cuándo
  // parar. Es el cambio que hace posible todo lo demás.
  const bloque = server.slice(server.indexOf('const _reapIfLeader'), server.indexOf('PILOTO-12'));
  assert.ok(bloque.includes('return false') && bloque.includes('return true'),
    'sin valor de retorno, el reintento no sabe si ha funcionado');
});

test('la siega horaria sigue en pie', () => {
  // El reintento del arranque cubre los primeros dos minutos. El resto de la
  // vida del proceso lo cubre el intervalo: si se pierde, vuelven los fantasmas
  // de los reinicios que ocurran con el proceso ya arrancado.
  assert.match(server, /setInterval\(_reapIfLeader, 3600000\)/);
});

test('los temporizadores no mantienen vivo el proceso', () => {
  // Sin .unref(), un script que sólo importe server.js se queda colgado sin
  // decir por qué — y el drenaje del apagado deja de poder terminar.
  const i = server.indexOf('_siegaArranque = setInterval');
  assert.match(server.slice(i, i + 400), /_siegaArranque\.unref/,
    'al temporizador de arranque le falta .unref()');
});
