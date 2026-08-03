'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CUANDO EL FALLO ES NUESTRO, NO SE LO PEDIMOS AL CLIENTE
//
// Los 8 «¿me lo puede repetir?» que salieron al medir las 54 llamadas de
// producción no venían de un problema de audio. Se comprobó:
//
//   · la confianza del reconocimiento bajó de 0,55 UNA vez en 260 turnos;
//   · pero hubo 8 `recoveries`, que es exactamente el camino del LLM vacío.
//
// Los 8 eran turnos en los que NUESTRO modelo no devolvió nada. Y la frase que
// se decía —«Perdone, no le he escuchado bien»— era falsa: se le había
// escuchado perfectamente, la transcripción lo prueba. Encima invitaba a
// repetir lo que ya había fallado, así que producía esto:
//
//     cliente: Sí, por favor.     asist.: ¿Me lo puede repetir?
//     cliente: Sí, por favor.     asist.: ¿Me lo puede repetir?
//
// Repetir no podía funcionar. El cliente nunca fue el problema.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src/core/voice-pipeline.js'), 'utf8');

/** El pipeline entero es pesado de montar; se prueba el método aislado. */
function pipelineFalso(respuestas) {
  const { VoicePipeline } = require('../src/core/voice-pipeline');
  const p = Object.create(VoicePipeline.prototype);
  p.llmRouter = {
    streamCompletion: async function* () {
      const r = respuestas.shift();
      if (r === 'error') { yield { type: 'error', message: 'boom' }; return; }
      if (r === 'excepcion') throw new Error('el proveedor se cayó');
      if (r) yield { type: 'text', content: r };
      yield { type: 'done', content: r || '' };
    },
  };
  return p;
}

function sesionFalsa() {
  return { metrics: {}, messages: [], assistant: { model: 'x' }, interrupted: false };
}

test('el reintento devuelve la frase cuando el segundo intento sí responde', async () => {
  const p = pipelineFalso(['Claro, le agendo la cita.']);
  const s = sesionFalsa();
  assert.equal(await p._reintentarRespuesta('c1', s), 'Claro, le agendo la cita.');
  assert.equal(s.metrics.reintentos, 1);
});

test('si el reintento también viene vacío, devuelve cadena vacía', async () => {
  const p = pipelineFalso(['']);
  assert.equal(await p._reintentarRespuesta('c1', sesionFalsa()), '');
});

test('un error del proveedor NO revienta el turno', async () => {
  // Este método corre en mitad de una llamada en vivo: si lanzara, el cliente
  // se quedaría escuchando silencio, que es peor que cualquier frase.
  for (const caso of ['error', 'excepcion']) {
    const p = pipelineFalso([caso]);
    assert.equal(await p._reintentarRespuesta('c1', sesionFalsa()), '');
  }
});

test('si el cliente interrumpe, el reintento se abandona', async () => {
  const p = pipelineFalso(['algo que ya no interesa']);
  const s = sesionFalsa();
  s.interrupted = true;
  assert.equal(await p._reintentarRespuesta('c1', s), '');
});

test('el reintento va SIN herramientas: no debe ejecutar acciones', async () => {
  // Un segundo intento existe para no dejar al cliente colgado, no para
  // reservar citas por su cuenta. Pasarle herramientas aquí podría duplicar una
  // reserva que el primer intento ya hubiera hecho a medias.
  const i = SRC.indexOf('async _reintentarRespuesta');
  assert.ok(i > 0, 'no se encuentra el método');
  const bloque = SRC.slice(i, i + 1200);
  assert.doesNotMatch(bloque, /\btools\b/, 'el reintento está pasando herramientas al LLM');
});

test('YA NO SE LE DICE AL CLIENTE QUE NO SE LE HA ESCUCHADO', () => {
  // Era mentira y además invitaba a repetir lo que iba a volver a fallar.
  assert.doesNotMatch(SRC, /no le he escuchado bien/,
    'vuelve a culpar al cliente de un turno vacío del LLM');
  assert.match(SRC, /ha sido un fallo mío, no suyo/,
    'la frase honesta ha desaparecido');
});

test('se reintenta ANTES de rendirse, no después', () => {
  // Si el escalado a recado fuera primero, el reintento no correría nunca en el
  // caso que más importa: la tercera vez seguida.
  const iReintento = SRC.indexOf('const segundoIntento = await this._reintentarRespuesta');
  const iEscalado = SRC.indexOf('_consecRecovery >= ESCALATE_AFTER');
  assert.ok(iReintento > 0 && iEscalado > 0);
  assert.ok(iReintento < iEscalado, 'se escala a recado antes de haber reintentado');
});

test('un reintento con éxito borra la racha de fallos', () => {
  // Si no, tres turnos recuperados con éxito escalarían a recado igualmente —
  // el cliente estaría siendo atendido y se le cortaría la conversación.
  const i = SRC.indexOf('if (segundoIntento) {');
  assert.ok(i > 0);
  assert.match(SRC.slice(i, i + 400), /_consecRecovery = 0/);
});
