'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL COSTE DE VOZ SE MIDE, NO SE ESTIMA DE MEMORIA
//
// La tarea «validar el coste real de ElevenLabs contra la factura» llevaba
// abierta desde el principio y no se podía cerrar, pero no por falta de
// factura: **no había contra qué contrastarla**. En producción, la columna
// `cost` de nf_calls estaba en `{}` en las 40 llamadas y no se guardaba qué
// proveedor había atendido ninguna. El coste de voz —el 88% del coste variable
// de la empresa— no estaba medido en ningún sitio, y convivían DOS constantes
// escritas a mano para lo mismo: 0,07 €/min en tts/router.js y 0,10 en el resto.
//
// Y la clave de ElevenLabs del entorno está en plan GRATUITO: 10.000 caracteres
// al mes, 0 usados. O producción usa otra clave, o algo no cuadra — y sin
// medición no hay forma de saber cuál de las dos.
//
// Lo que fija este fichero:
//   · se cuentan CARACTERES por proveedor, que es lo que factura el proveedor
//     y lo que aparece en la factura;
//   · los euros se derivan AL LEER, para que una subida de tarifa no reescriba
//     el pasado;
//   · y lo que no cuesta, no se cuenta.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  TTSRouter, anotarConsumo, consumoDeLlamada, cerrarConsumo, purgarConsumo, costeDeConsumo,
} = require('../src/tts/router');

test('cuenta caracteres por proveedor, no una cifra global', () => {
  const id = 'test-a';
  anotarConsumo(id, 'elevenlabs', 400);
  anotarConsumo(id, 'elevenlabs', 200);
  anotarConsumo(id, 'cartesia', 300);
  const c = consumoDeLlamada(id);
  assert.equal(c.elevenlabs.caracteres, 600);
  assert.equal(c.elevenlabs.sintesis, 2);
  assert.equal(c.cartesia.caracteres, 300);
  cerrarConsumo(id);
});

test('el coste se DERIVA de la tarifa, no se guarda congelado', () => {
  // Es la diferencia entre poder cuadrar una factura vieja y no poder. Si se
  // guardaran euros, el día que suba la tarifa el histórico entero pasaría a
  // ser mentira. Con caracteres, la misma llamada da una cifra u otra según la
  // tarifa que se le aplique — y las dos son correctas, cada una para su mes.
  const consumo = { elevenlabs: { caracteres: 8400, sintesis: 10 } };
  const barato = costeDeConsumo(consumo, { elevenlabs: 0.07 });
  const caro   = costeDeConsumo(consumo, { elevenlabs: 0.10 });
  assert.ok(caro.total > barato.total, 'la tarifa tiene que mover el resultado');
  assert.equal(barato.desglose.elevenlabs.caracteres, 8400, 'los caracteres NO cambian con la tarifa');
  assert.equal(caro.desglose.elevenlabs.caracteres, 8400);
});

test('un proveedor sin tarifa declarada cuenta como 0, no como NaN', () => {
  // El TTS local corre en hierro propio y no factura nada. Si esto devolviera
  // NaN, el total de la llamada entera se volvería NaN y el dato de coste
  // quedaría inservible sin que nada fallara.
  const r = costeDeConsumo({ local: { caracteres: 5000, sintesis: 3 } }, {});
  assert.equal(r.total, 0);
  assert.ok(Number.isFinite(r.desglose.local.eur));
});

test('cerrar una llamada la saca del libro (si no, es una fuga de memoria)', () => {
  anotarConsumo('test-b', 'cartesia', 100);
  assert.ok(consumoDeLlamada('test-b').cartesia);
  cerrarConsumo('test-b');
  assert.deepEqual(consumoDeLlamada('test-b'), {},
    'sin esto el mapa crece durante toda la vida del proceso: una fuga lenta ' +
    'de las que se notan semanas después y ya no se sabe por qué');
});

test('lo que no se cierra se purga por antigüedad', () => {
  // Cuelgue abrupto, reinicio a medias: hay llamadas que nunca cierran bien.
  anotarConsumo('test-c', 'cartesia', 100);
  assert.equal(purgarConsumo(Date.now()), 0, 'no debe purgar lo reciente');
  assert.equal(purgarConsumo(Date.now() + 7200000), 1, 'a las dos horas ya no puede quedar nada');
  assert.deepEqual(consumoDeLlamada('test-c'), {});
});

test('lo que NO cuesta, NO se cuenta: la anotación va dentro del bucle', () => {
  // Es el detalle que decide si la cifra sirve. En synthesize(), un acierto de
  // caché sale por arriba con `return cached` ANTES del bucle de proveedores, y
  // un proveedor que falla hace `continue` antes de llegar a la anotación.
  // Contar cualquiera de los dos inflaría la factura contra la que luego se
  // quiere cuadrar la de verdad.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tts', 'router.js'), 'utf8');
  const cuerpo = src.slice(src.indexOf('async synthesize('));
  const posCache = cuerpo.indexOf('return cached');
  const posAnota = cuerpo.indexOf('anotarConsumo(callId');
  const posVacio = cuerpo.indexOf("devolvió audio VACÍO");
  assert.ok(posAnota > posCache,
    'la anotación quedó ANTES del retorno por caché: se estaría cobrando audio ' +
    'reutilizado, que no cuesta nada');
  assert.ok(posAnota > posVacio,
    'la anotación quedó antes del descarte por audio vacío: se contaría una ' +
    'síntesis que no produjo nada');
});

test('las tarifas salen del router, no de una copia', () => {
  // Había DOS constantes distintas para ElevenLabs (0,07 y 0,10) y nadie sabía
  // cuál era la buena. Que el cálculo lea del router evita que nazca una tercera.
  const r = new TTSRouter();
  const t = r.tarifasPorProveedor();
  assert.equal(typeof t, 'object');
  for (const [nombre, tarifa] of Object.entries(t)) {
    assert.ok(Number.isFinite(tarifa), `la tarifa de ${nombre} no es un número`);
    assert.ok(tarifa >= 0, `tarifa negativa en ${nombre}`);
  }
});

test('el coste llega a la fila: se escribe callData.cost', () => {
  // La columna existía y estaba en `{}` en las 40 llamadas. No es que el coste
  // fuera cero: es que nadie lo escribía.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'voice-pipeline.js'), 'utf8');
  assert.match(src, /callData\.cost = session\._coste/,
    'Ya no se adjunta el coste a callData, así que la columna `cost` de ' +
    'nf_calls volverá a quedarse vacía y no habrá contra qué cuadrar la factura.');
  assert.ok(src.indexOf('callData.cost = session._coste') > src.indexOf('session.end()'),
    'el coste se adjunta antes de end(): end() devuelve el objeto que se guarda, ' +
    'así que asignarlo antes no llega a la fila');
});

// ─────────────────────────────────────────────────────────────────────────────
// UN PROVEEDOR QUE RECHAZA POR PLAN NO SE REINTENTA EN CADA FRASE
//
// Medido el 2026-07-31 contra la API real: la clave de ElevenLabs de producción
// está en plan GRATUITO y devuelve 402 «Free users cannot use library voices
// via the API». Siempre. Cero caracteres consumidos en 90 días — nunca ha
// sintetizado nada.
//
// Y como para el castellano tiene afinidad de idioma, iba PRIMERA en la cadena:
// cada frase de cada llamada gastaba ~150 ms pidiéndole audio a un proveedor
// que se sabía que iba a decir que no. En un producto de teléfono eso es
// silencio para el que llama, en cada frase.
//
// Un 401/402/403 no es un hipo: es una respuesta estable. El plan no cambia
// entre una llamada y la siguiente.
// ─────────────────────────────────────────────────────────────────────────────
test('un 402 aparta al proveedor; un fallo normal no', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tts', 'router.js'), 'utf8');
  // Comparación de texto, no una expresión regular que describa otra expresión
  // regular: escribir eso en un heredoc se come las barras invertidas y el
  // test acaba buscando un carácter de retroceso. Ya ha pasado tres veces en
  // este repo.
  assert.ok(src.includes('(401|402|403)') && src.includes('.test(err.message)'),
    'Ya no se distingue el rechazo por plan de un fallo transitorio, así que se ' +
    'vuelve a reintentar en cada frase un proveedor que siempre dice que no.');
  assert.match(src, /_apartadoHasta = Date\.now\(\) \+ 30 \* 60 \* 1000/,
    'El apartado debe ser temporal: si fuera para siempre, contratar el plan ' +
    'obligaría a reiniciar el proceso para que volviera.');
});

test('el proveedor apartado se SALTA, no sólo se registra', () => {
  // Sin el salto en la cabecera del bucle, el corte sólo serviría para escribir
  // un log más bonito: se le seguiría pidiendo audio y los ~150 ms seguirían ahí.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tts', 'router.js'), 'utf8');
  const bucle = src.slice(src.indexOf('for (const providerName of chain)'));
  const posSalto = bucle.indexOf('_apartadoHasta && Date.now()');
  const posTry = bucle.indexOf('try {');
  assert.ok(posSalto > -1 && posSalto < posTry,
    'el salto tiene que estar ANTES del try, o se le pide audio igualmente');
});
