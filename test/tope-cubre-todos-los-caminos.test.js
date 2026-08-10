'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL TOPE ESTÁ EN EL PASO OBLIGATORIO, NO EN UN SITIO
//
// El 03/08 se puso el tope de insistencia en el bucle de frases del turno
// principal. Los tests del módulo pasaban, las mutaciones se cazaban, y estaba
// desplegado en producción. Y sin embargo dejaba CUATRO caminos sin cubrir:
//
//   · el resto de texto al final del turno principal;
//   · el bucle de frases de la respuesta POSTERIOR a ejecutar una herramienta;
//   · y el resto de texto de esa segunda respuesta.
//
// El segundo es el peor: es el que corre justo después de reservar una cita, o
// sea el sitio con más papeletas de soltar un «¿le ayudo en algo más?» — que
// era la segunda coletilla más repetida de todas las medidas.
//
// La lección no es «se me olvidó un sitio», es que la guarda estaba en UN sitio
// en vez de en el paso por el que todo tiene que pasar. Ahora vive dentro de
// `_speakQueued`, que es por donde sale TODO lo que genera el LLM y solo eso.
//
// Este fichero existe para que no vuelva a abrirse un camino paralelo: si
// alguien añade un quinto sitio que habla, o «simplifica» _speakQueued sacándole
// el tope, aquí se pone rojo.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { VoicePipeline } = require('../src/core/voice-pipeline');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src/core/voice-pipeline.js'), 'utf8');

/** Un pipeline mínimo que apunta lo que llega al TTS. */
function pipelineFalso(session = {}) {
  const dicho = [];
  const s = {
    metrics: {}, _speechChain: Promise.resolve(),
    _ultimoTextoCliente: 'hola, buenos días', ...session,
  };
  const p = Object.create(VoicePipeline.prototype);
  p.activeCalls = new Map([['c1', s]]);
  p._speakText = async (id, t) => { dicho.push(t); };
  return { p, s, dicho };
}

test('EL TOPE VIVE EN _speakQueued: cualquier camino queda cubierto', async () => {
  const { p, dicho } = pipelineFalso();
  for (let i = 0; i < 4; i++) {
    await p._speakQueued('c1', `Perfecto. ¿Te gustaría agendar una cita?`);
  }
  const conOferta = dicho.filter(t => /agendar/.test(t)).length;
  assert.equal(conOferta, 2, `se ofreció cita ${conOferta} veces; el tope son 2`);
  // Y las otras dos no desaparecen: se dice la respuesta sin el remate.
  assert.equal(dicho.length, 4);
  assert.equal(dicho[3], 'Perfecto.');
});

test('lo que se habla es el texto FILTRADO, no el original', async () => {
  const { p, dicho } = pipelineFalso({ _cierres: { 'ofrecer-cita': 9 } });
  await p._speakQueued('c1', 'Sí, tenemos aparcamiento. ¿Te gustaría agendar la primera consulta?');
  assert.equal(dicho.length, 1);
  assert.match(dicho[0], /aparcamiento/, 'se ha comido la respuesta al cliente');
  assert.doesNotMatch(dicho[0], /agendar/);
});

test('se anota lo DICHO, para que la transcripción no mienta', async () => {
  // Si el historial guardara la frase entera mientras el cliente oyó otra cosa,
  // la transcripción mentiría sobre la llamada — y el medidor de repeticiones
  // contaría remates que nadie llegó a decir, o sea que la mejora sería
  // invisible en su propia medida.
  const { p, s } = pipelineFalso({ _cierres: { 'ofrecer-cita': 9 } });
  await p._speakQueued('c1', 'Sí, tenemos aparcamiento. ¿Te gustaría agendar?');
  assert.deepEqual(s._turnDicho, ['Sí, tenemos aparcamiento.']);
  assert.equal(s._turnCallado, true);
});

test('NINGÚN camino habla saltándose el cuello de botella', () => {
  // La comprobación estructural, que es la que habría cazado el fallo del 03/08.
  // Todo lo que sale del LLM se encola con _speakQueued; _speakText directo se
  // reserva para frases NUESTRAS (saludo, frase-puente, recuperación), que no
  // llevan remates de venta.
  const i = SRC.indexOf('_speakQueued(callId, text, opts = {})');
  assert.ok(i > 0, 'no se encuentra _speakQueued');
  const cuerpo = SRC.slice(i, i + 1600);
  assert.match(cuerpo, /_limitarInsistencia\(/,
    'a _speakQueued le han quitado el tope: el asistente vuelve a insistir sin límite');
  assert.match(cuerpo, /_speakText\(callId, dicho/,
    '_speakQueued sintetiza el texto SIN filtrar: el tope decide y no se aplica');
});

test('el contador NO se duplica: el tope se aplica una sola vez', () => {
  // Estuvo en el bucle de frases Y luego se movió a _speakQueued. Si quedaran
  // los dos, cada frase gastaría dos ofertas y el asistente enmudecería a la
  // primera — un tope demasiado agresivo es tan avería como ninguno.
  const llamadas = (SRC.match(/this\._limitarInsistencia\(/g) || []).length;
  assert.equal(llamadas, 1,
    `_limitarInsistencia se invoca ${llamadas} veces; debe hacerlo solo _speakQueued`);
});

test('una frase nuestra (saludo, frase-puente) NO gasta cupo', async () => {
  // Van por _speakText, no por la cola. Si el saludo o el «un momento, por
  // favor» consumieran ofertas, el cliente se quedaría sin ninguna.
  const { p, s, dicho } = pipelineFalso();
  await p._speakText('c1', 'Un momento, por favor…');
  assert.equal(dicho.length, 1);
  assert.equal((s._cierres || {})['ofrecer-cita'] || 0, 0,
    'una frase nuestra ha gastado cupo del tope');
});
