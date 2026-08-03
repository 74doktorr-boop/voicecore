'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NO INSISTIR
//
// Medido el 03/08 sobre 54 llamadas reales: el 18% de las preguntas del
// asistente eran una que ya había hecho, y las dos primeras de la lista eran
// ofrecer cita (17) y ofrecer más ayuda (14) — 31 de 49 repeticiones.
//
// El caso que lo retrata, llamada 9d30bfe6 del 12/07: al cliente le ofrecieron
// cita diez veces mientras preguntaba por el parking, el seguro y la punción
// seca. Su frase «Espera, antes te sigo preguntando» es un cliente esquivando
// a un vendedor.
//
// Lo que se prueba aquí no es solo que calle: es que calle SIN romper la
// conversación. Un tope que dejara al cliente sin respuesta, o que impidiera
// reservar a quien quiere reservar, sería peor que el problema original.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../src/core/limite-insistencia');

test('las dos primeras ofertas pasan; de la tercera en adelante se callan', () => {
  const e = {};
  const f = (t) => L.filtrar(e, t, 'una pregunta sobre otra cosa');
  assert.equal(f('Es gratuita. ¿Te gustaría agendar una cita?').callado, false);
  assert.equal(f('Cuesta cuarenta y cinco. ¿Te gustaría fijar una cita?').callado, false);
  assert.equal(f('No hay descuentos. ¿Te gustaría agendar la primera consulta?').callado, true);
});

test('CALLAR EL REMATE NO ES CALLAR LA RESPUESTA', () => {
  // Lo más importante del módulo. El cliente preguntó por el parking: eso se
  // contesta igual. Lo que desaparece es el «¿y ya que estamos, reservas?».
  const e = { 'ofrecer-cita': 9 };
  const r = L.filtrar(e, 'Sí, tenemos aparcamiento gratuito. ¿Te gustaría agendar la primera consulta?', '¿tenéis parking?');
  assert.equal(r.callado, true);
  assert.match(r.texto, /aparcamiento gratuito/, 'se ha comido la respuesta del cliente');
  assert.doesNotMatch(r.texto, /agendar/);
});

test('si el CLIENTE pide cita, no se limita nunca', () => {
  // Un tope que impidiera contestar a quien quiere reservar sería una avería
  // de negocio: la llamada existe justamente para eso.
  const e = { 'ofrecer-cita': 99 };
  const r = L.filtrar(e, 'Perfecto. ¿Te gustaría agendar para esta semana?', 'quiero pedir cita');
  assert.equal(r.callado, false);
  assert.match(r.texto, /agendar/);
});

test('también se limita el «¿algo más?», que si no hereda el problema', () => {
  // Al simular el tope solo sobre la cita, el remate que más se repetía pasaba
  // a ser este. Limitar uno solo movía el problema de sitio.
  const e = {};
  const f = (t) => L.filtrar(e, t, 'gracias');
  assert.equal(f('Anotado. ¿Quiere que le ayude en algo más?').callado, false);
  assert.equal(f('Hecho. ¿Le ayudo en algo más?').callado, false);
  assert.equal(f('Vale. ¿Quiere que le ayude en algo más?').callado, true);
});

test('los dos contadores son independientes', () => {
  // Gastar las ofertas de cita no debe silenciar el «¿algo más?», ni al revés:
  // son dos tics distintos y cada uno tiene su cupo.
  const e = { 'ofrecer-cita': 5 };
  assert.equal(L.filtrar(e, 'Listo. ¿Le ayudo en algo más?', 'gracias').callado, false);
});

test('nunca deja al cliente sin nada que oír', () => {
  // Si la frase ENTERA era el remate, callarla dejaría silencio en el teléfono.
  // Entre insistir y el vacío, se insiste.
  const e = { 'ofrecer-cita': 9 };
  const r = L.filtrar(e, '¿Te gustaría agendar una cita?', 'hola');
  assert.ok(r.texto.trim().length > 0, 'el cliente se quedaría escuchando silencio');
});

test('una frase sin remate no se toca', () => {
  const e = {};
  const t = 'La primera consulta es gratuita y dura treinta minutos.';
  assert.equal(L.filtrar(e, t, 'cuánto dura').texto, t);
});

test('el contador es POR LLAMADA', () => {
  // Cada cliente empieza de cero: el estado vive en la sesión, no en el módulo.
  const a = {}, b = {};
  for (let i = 0; i < 5; i++) L.filtrar(a, 'Ya. ¿Te gustaría agendar una cita?', 'hola');
  assert.equal(L.filtrar(b, 'Ya. ¿Te gustaría agendar una cita?', 'hola').callado, false,
    'la llamada siguiente ha heredado el contador de la anterior');
});

test('ante basura, habla: fail-open', () => {
  for (const basura of [null, undefined, 123, {}, []]) {
    const r = L.filtrar({}, basura, 'hola');
    assert.equal(r.callado, false);
  }
});

test('LA LLAMADA REAL: de diez ofertas a dos', () => {
  const e = {};
  const turnos = [
    ['a ver si la primera consulta es gratis', 'La primera consulta es gratuita. ¿Te gustaría agendar una cita?'],
    ['soy estudiante', 'La sesión cuesta cuarenta y cinco euros. ¿Te gustaría fijar una cita?'],
    ['¿me haces descuento?', 'No ofrecemos descuentos. ¿Te gustaría agendar la primera consulta gratuita?'],
    ['¿aceptáis Adeslas?', 'Sí, aceptamos Adeslas y Sanitas. ¿Te gustaría agendar una cita con alguno de ellos?'],
    ['¿tenéis parking?', 'Sí, tenemos aparcamiento gratuito. ¿Te gustaría agendar la primera consulta?'],
    ['necesito punción seca', 'No tengo información sobre ese servicio. ¿Te gustaría agendar la primera consulta?'],
  ];
  const dichas = turnos.map(([cli, asi]) => L.filtrar(e, asi, cli));
  const ofertas = dichas.filter(r => /agendar|fijar/.test(r.texto)).length;
  assert.equal(ofertas, 2, `se ofreció cita ${ofertas} veces; el tope son 2`);
  // Y las cinco respuestas siguen ahí: nadie se queda sin contestación.
  assert.match(dichas[3].texto, /Adeslas y Sanitas/);
  assert.match(dichas[4].texto, /aparcamiento/);
  assert.match(dichas[5].texto, /No tengo información/);
});

test('el arreglo y la medida usan el MISMO criterio', () => {
  // Si el tope callara cosas que el medidor no cuenta —o al revés— «ahora se
  // repite menos» volvería a ser una opinión en vez de un número.
  const M = require('../src/monitoring/preguntas-repetidas');
  for (const frase of [
    '¿Te gustaría agendar una cita?',
    '¿Quiere que le ayude en algo más?',
  ]) {
    const tipos = L.cierresEn(frase).map(c => c.tipo);
    assert.deepEqual(tipos, [M.intencion(frase)]);
  }
});
