'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MEDIR ANTES DE TOCAR
//
// «Evitar repetir preguntas ya respondidas» era la queja número uno del motor
// de mejoras: 22 observaciones en cinco reglas. Se rechazaron como reglas de
// prompt a propósito —pedirle por favor al modelo que no se repita no se puede
// medir— y en su lugar se midió.
//
// Este fichero fija el medidor, porque una línea de partida que se mueve sola
// no sirve para decir si una mejora mejoró.
//
// LOS CASOS SON REALES. Están sacados de llamadas de producción de julio,
// leídas a mano una por una antes de escribir el detector.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../src/monitoring/preguntas-repetidas');

test('la misma intención dicha de siete formas distintas cuenta como una', () => {
  // El caso que motivó todo esto: llamada 9d30bfe6 del 12/07. Contar texto
  // literal repetido no habría visto NINGUNA de estas — son siete frases
  // diferentes— y sin embargo al cliente le preguntaron lo mismo siete veces.
  const formas = [
    '¿Te gustaría agendar una cita?',
    '¿Te gustaría fijar una cita?',
    '¿Te gustaría agendar la primera consulta gratuita?',
    '¿Te gustaría reservar la primera consulta?',
    '¿Te gustaría agendar una cita con alguno de ellos?',
    'Pero puedo agendarte la cita ahora mismo. ¿Te parece bien?',
    'No puedo llamar, pero puedo agendar tu cita ahora mismo. ¿Te gustaría hacerlo?',
  ];
  const intenciones = new Set(formas.map(f => M.intencion(f)));
  assert.equal(intenciones.size, 1, `se clasificaron como ${intenciones.size} intenciones: ${[...intenciones]}`);
  assert.equal([...intenciones][0], 'ofrecer-cita');
});

test('DOS PREGUNTAS DISTINTAS NO SON UNA REPETICIÓN', () => {
  // La primera versión metía todo lo no reconocido en un cubo llamado 'otra',
  // así que «¿tenéis parking?» y «¿aceptáis seguro?» contaban como la misma
  // pregunta hecha dos veces. Salieron 58 repeticiones fantasma: más de la
  // mitad del total, y el titular habría sido el DOBLE del real.
  //
  // Un medidor más laxo que la realidad no mide, abulta — y encima abulta a
  // favor de quien lo escribió, porque hace que la mejora posterior luzca más.
  assert.notEqual(M.intencion('¿Tenéis parking?'), M.intencion('¿Aceptáis seguro de Adeslas?'));
  assert.equal(M.intencion('¿Tenéis parking?'), M.intencion('tenéis parking'),
    'la misma pregunta escrita distinto debería seguir siendo la misma');
});

test('la primera vez NO es una repetición', () => {
  const r = M.analizarLlamada([
    { role: 'assistant', content: '¿Te gustaría agendar una cita?' },
    { role: 'user', content: 'no sé' },
  ]);
  assert.equal(r.preguntas, 1);
  assert.equal(r.repeticiones, 0, 'preguntar una vez se está contando como repetición');
});

test('preguntar dos veces es UNA repetición, no dos', () => {
  const r = M.analizarLlamada([
    { role: 'assistant', content: '¿Te gustaría agendar una cita?' },
    { role: 'user', content: 'espera' },
    { role: 'assistant', content: '¿Te gustaría fijar una cita?' },
  ]);
  assert.equal(r.repeticiones, 1);
});

test('lo que dice el CLIENTE no cuenta', () => {
  // Un cliente que insiste con la misma pregunta no es el asistente repitiéndose
  // — normalmente es lo contrario: que no le han contestado.
  const r = M.analizarLlamada([
    { role: 'user', content: '¿Aceptáis seguro?' },
    { role: 'user', content: '¿Aceptáis seguro?' },
    { role: 'user', content: '¿Aceptáis seguro?' },
  ]);
  assert.equal(r.preguntas, 0);
  assert.equal(r.repeticiones, 0);
});

test('varias preguntas en un mismo turno se cuentan por separado', () => {
  const p = M.preguntasDe('Perfecto. ¿Me dice su nombre? ¿Y prefiere esta semana o la que viene?');
  assert.equal(p.length, 2);
  assert.equal(M.intencion(p[0]), 'pedir-nombre');
  assert.equal(M.intencion(p[1]), 'pedir-fecha-hora');
});

test('«su nombre para la cita» es pedir el nombre, no ofrecer cita', () => {
  // El orden de las reglas importa: de la más específica a la más general. Si
  // «cita» ganara, media conversación se contaría como ofrecer cita.
  assert.equal(M.intencion('Perfecto, ¿me dice su nombre para anotar la cita?'), 'pedir-nombre');
});

test('un turno sin preguntas no aporta nada', () => {
  const r = M.analizarLlamada([
    { role: 'assistant', content: 'Perfecto, Unay. Que tenga un muy buen día.' },
  ]);
  assert.equal(r.preguntas, 0);
});

test('aguanta transcripciones rotas sin reventar', () => {
  for (const basura of [null, undefined, [], [{}], [{ role: 'assistant' }], 'no es un array']) {
    const r = M.analizarLlamada(basura);
    assert.equal(r.repeticiones, 0);
  }
});

test('sin datos NO dice que todo va bien', () => {
  const r = M.resumir([]);
  assert.equal(r.llamadas, 0);
  assert.doesNotMatch(r.resumen, /bien|correcto|ninguna repetici/i);
  assert.match(r.resumen, /no hay/);
});

test('LA LLAMADA REAL COMPLETA: 9d30bfe6, del 12/07', () => {
  // Reconstruida de la transcripción de producción. Es la peor de las 54, y
  // sirve de ancla: si alguien toca el detector y este número se mueve, hay que
  // volver a leer la conversación a mano antes de creerse la nueva medida.
  const t = [
    ['assistant', '¡Hola Raúl! Soy la asistente de Fisioterapia Unai, ¿en qué te ayudo?'],
    ['user', 'a ver si la primera consulta es gratis'],
    ['assistant', 'La primera consulta es gratuita. ¿Te gustaría agendar una cita?'],
    ['user', 'para la sesión normal soy estudiante'],
    ['assistant', 'La sesión cuesta cuarenta y cinco euros. ¿Te gustaría fijar una cita?'],
    ['user', '¿me haces descuento?'],
    ['assistant', 'No ofrecemos descuentos. ¿Te gustaría agendar la primera consulta gratuita?'],
    ['user', '¿aceptáis Adeslas?'],
    ['assistant', 'Sí, aceptamos Adeslas. ¿Te gustaría agendar una cita con alguno de ellos?'],
    ['user', '¿tenéis parking?'],
    ['assistant', 'Sí, tenemos aparcamiento. ¿Te gustaría agendar la primera consulta?'],
  ].map(([role, content]) => ({ role, content }));

  const r = M.analizarLlamada(t);
  assert.equal(r.preguntas, 6);
  assert.equal(r.peor.intencion, 'ofrecer-cita');
  assert.equal(r.peor.veces, 5, 'al cliente se le ofreció cita 5 veces en esta muestra');
  assert.equal(r.repeticiones, 4);
});

test('el resumen dice el porcentaje, no solo el recuento', () => {
  const r = M.resumir([
    { preguntas: 10, repeticiones: 4, repetidas: [{ intencion: 'ofrecer-cita', veces: 5 }] },
    { preguntas: 10, repeticiones: 0, repetidas: [] },
  ]);
  assert.equal(r.llamadas, 2);
  assert.equal(r.conRepeticiones, 1);
  assert.equal(r.porcentajeConRepeticiones, 50);
  assert.equal(r.porcentajeDePreguntasRepetidas, 20);
  assert.equal(r.ranking[0].intencion, 'ofrecer-cita');
});
