'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// UNA VOZ DE UN PROVEEDOR NO VALE EN OTRO
//
// El asistente pide la voz con el id del proveedor al que pertenece. Si ese
// proveedor no atiende, el router pasa al siguiente de la cadena — y le
// entregaba el MISMO id. Cartesia recibiendo un id de ElevenLabs no sintetiza:
// falla. Y el siguiente tampoco. La cadena entera se agota por un id que no era
// suyo, y lo que oye el que llama es SILENCIO.
//
// Se descubrió al ir a quitar la clave de ElevenLabs (que devuelve 402 desde
// siempre): la única org con voz premium habría quedado sin salida en la
// cadena. Sin este arreglo, quitar la clave rompía a un cliente.
//
// La preferencia del cliente NO se toca en la base de datos: sigue guardada.
// El día que se contrate el plan, su voz vuelve sola.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const { TTSRouter } = require('../src/tts/router');
const { resolveVoiceEntry } = require('../src/tts/voice-catalog');

const router = (conEleven) => new TTSRouter(
  conEleven ? { cartesiaApiKey: 'x', openaiApiKey: 'x', elevenlabsApiKey: 'x' }
            : { cartesiaApiKey: 'x', openaiApiKey: 'x' });

test('un id de otro proveedor se descarta, no se reenvía', () => {
  const idEleven = resolveVoiceEntry('ana-es').providerVoiceId;
  const p = router(false)._buildParams('cartesia', idEleven, 1.0, 'es');
  assert.notEqual(p.voice, idEleven,
    'Cartesia está recibiendo un id de ElevenLabs: fallará, y detrás no queda ' +
    'nadie. Eso es silencio para el que llama.');
  assert.ok(p.voice, 'y tiene que quedarse con SU voz por defecto, no sin ninguna');
});

test('la voz propia del proveedor se respeta', () => {
  // El arreglo no puede llevarse por delante la elección legítima: si la voz
  // ES de ese proveedor, se usa tal cual.
  const idCartesia = resolveVoiceEntry('blanca-ca').providerVoiceId;
  const p = router(false)._buildParams('cartesia', idCartesia, 1.0, 'es');
  assert.equal(p.voice, idCartesia);
});

test('un idioma COMBINADO no deja al cliente con el fallback a secas', () => {
  // 'es+gl' no está en la lista de ningún proveedor, así que el filtro los
  // descartaba todos y sólo sobrevivía el fallback declarado. Medido: la cadena
  // era «openai» a secas — el cliente gallego perdía Cartesia, que es la voz
  // por defecto y la más barata. No fallaba nada ni se registraba en ningún
  // sitio: simplemente costaba un 33% más y sonaba distinto.
  const chain = router(true)._buildProviderChain(null, 'openai', 'latency', 'es+gl');
  assert.ok(chain.includes('cartesia'),
    `'es+gl' dejó fuera a Cartesia. Cadena: ${chain.join(' → ')}`);
  assert.ok(chain.length > 1, 'un combo no puede quedarse con un solo proveedor');
});

test('sin ElevenLabs la cadena sigue teniendo salida', () => {
  // Es la comprobación que autoriza a quitar la clave: si esto se queda vacío
  // o con un solo eslabón, quitarla deja llamadas sin voz.
  const r = router(false);
  for (const lang of ['es', 'es+gl']) {
    const chain = r._buildProviderChain(null, 'openai', 'latency', lang);
    assert.ok(chain.length >= 1, `sin ElevenLabs, '${lang}' se queda sin proveedor`);
    assert.ok(chain.includes('cartesia'), `'${lang}' debería seguir pudiendo usar Cartesia`);
  }
});

test('ElevenLabs ya no va primero en castellano cuando no está', () => {
  // Con la clave puesta iba PRIMERO por afinidad de idioma y devolvía 402 en
  // cada frase. Sin clave no se registra, y la cadena empieza por quien sí sirve.
  const chain = router(false)._buildProviderChain(null, 'openai', 'latency', 'es');
  assert.equal(chain[0], 'cartesia', `la cadena empieza por ${chain[0]}`);
});
