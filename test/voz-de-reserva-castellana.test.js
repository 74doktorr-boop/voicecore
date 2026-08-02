'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA VOZ DE RESERVA ERA UN HOMBRE INGLÉS
//
// El 02/08 Unai llamó al número de producción y contestó, en sus palabras, «un
// inglés con acento español y calidad malísima». No era la calidad: era el
// IDIOMA. El router tenía escrito a fuego, en mitad de `_buildParams`:
//
//     params.voice = voice ?? 'a0e99841-438c-4a64-b679-ae501e7d6091';
//
// Preguntado a la API de Cartesia, ese UUID es **«Greg - Supporter», idioma
// `en`**. Un hombre inglés leyendo castellano por teléfono.
//
// Y no era un caso de laboratorio: la única organización con llamadas reales
// tiene guardada `ana-es`, de ElevenLabs, cuya clave se retiró. La guarda que
// impide pasarle a Cartesia un id de otro proveedor hace lo correcto —deja la
// voz en null— y justo por eso caía en la reserva inglesa. Cualquier
// organización cuya voz no se resuelva atendía así.
//
// Nadie eligió nunca esa voz: es un literal de la primera integración con
// Cartesia que sobrevivió a todos los cambios. La lección es la del charter:
// **una reserva es una decisión de producto, no un valor por defecto que nadie
// ha mirado** — y encima invisible, porque en los paneles no se ve. Solo se
// descubre llamando.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TTSRouter } = require('../src/tts/router');
const { staticCatalog, resolveVoiceEntry } = require('../src/tts/voice-catalog');

const RAIZ = path.join(__dirname, '..');
const router = new TTSRouter({});

// Los ids de proveedor de TODAS las voces castellanas que ofrecemos. Verificados
// uno a uno contra la API de Cartesia el 02/08: las seis devuelven `language: es`.
const CASTELLANAS = new Set(
  staticCatalog()
    .filter(v => v.provider === 'cartesia' && (v.tier === 'estandar' || !v.tier))
    .map(v => (resolveVoiceEntry(v.id) || {}).providerVoiceId)
    .filter(Boolean),
);

test('el catálogo tiene voces castellanas de Cartesia con las que caer', () => {
  assert.ok(CASTELLANAS.size >= 6, `solo ${CASTELLANAS.size} voces de reserva posibles`);
});

test('sin voz, Cartesia recibe una voz CASTELLANA', () => {
  const p = router._buildParams('cartesia', null, 1.0, 'es');
  assert.ok(CASTELLANAS.has(p.voice),
    `la reserva (${p.voice}) no es ninguna de las voces castellanas del catálogo`);
});

test('la voz inglesa de antes NO puede volver', () => {
  // «Greg - Supporter», idioma en. El número exacto que contestó el teléfono.
  const GREG = 'a0e99841-438c-4a64-b679-ae501e7d6091';
  for (const idioma of ['es', 'es+gl', 'gl', null]) {
    const p = router._buildParams('cartesia', null, 1.0, idioma);
    assert.notEqual(p.voice, GREG, `con idioma ${idioma} vuelve a contestar en inglés`);
  }
  const src = fs.readFileSync(path.join(RAIZ, 'src/tts/router.js'), 'utf8');
  // Puede seguir NOMBRADO en el comentario que explica el fallo; lo que no puede
  // es volver a estar asignado.
  assert.doesNotMatch(src, /params\.voice\s*=\s*voice\s*\?\?\s*'a0e99841/,
    'el UUID inglés vuelve a estar escrito a fuego como reserva');
});

test('EL CASO REAL: una voz de ElevenLabs cae a castellano, no a inglés', () => {
  // `ana-es` es lo que tiene guardado la única org con llamadas reales. Su
  // proveedor ya no existe, así que este es exactamente el camino que sonó mal.
  const p = router._buildParams('cartesia', 'ana-es', 1.0, 'es+gl');
  assert.ok(CASTELLANAS.has(p.voice), `ana-es sigue cayendo en ${p.voice}`);
  assert.equal(p.language, 'es', 'a Cartesia hay que darle "es", no el combo (devuelve 400)');
});

test('la reserva respeta el GÉNERO de la voz que eligió el cliente', () => {
  // Un negocio que eligió voz femenina y de pronto contesta un hombre es un
  // cambio que se nota en la primera sílaba. `ana-es` es femenina.
  const f = resolveVoiceEntry('ana-es');
  assert.equal(f && f.gender, 'female', 'cambió el catálogo: ana-es ya no es femenina');
  const p = router._buildParams('cartesia', 'ana-es', 1.0, 'es');
  const elegida = staticCatalog().find(v => (resolveVoiceEntry(v.id) || {}).providerVoiceId === p.voice);
  assert.equal(elegida && elegida.gender, 'female',
    'la reserva de una voz femenina ha salido masculina');
});

test('una voz masculina de ElevenLabs cae en una masculina castellana', () => {
  const masc = staticCatalog().find(v => v.provider === 'elevenlabs' && v.gender === 'male');
  if (!masc) return;                              // si no hay, no hay nada que probar
  const p = router._buildParams('cartesia', masc.id, 1.0, 'es');
  const elegida = staticCatalog().find(v => (resolveVoiceEntry(v.id) || {}).providerVoiceId === p.voice);
  assert.equal(elegida && elegida.gender, 'male');
});

test('una voz de Cartesia se respeta tal cual: la reserva NO se mete por medio', () => {
  const suya = resolveVoiceEntry('marcos-ca').providerVoiceId;
  assert.equal(router._buildParams('cartesia', suya, 1.0, 'es').voice, suya);
});

test('si el catálogo fallara, la última reserva sigue siendo castellana', () => {
  // Blanca, verificada contra Cartesia como `language: es`. Un fail-safe que
  // cayera en inglés reproduciría el bug justo el día que algo más se rompe.
  const src = fs.readFileSync(path.join(RAIZ, 'src/tts/router.js'), 'utf8');
  const m = src.match(/_RESERVA_ULTIMA = '([0-9a-f-]+)'/);
  assert.ok(m, 'no hay reserva última definida');
  assert.equal(m[1], resolveVoiceEntry('blanca-ca').providerVoiceId,
    'la reserva última ya no es Blanca: verifícala contra Cartesia antes de cambiarla');
});

// ── EL ASISTENTE DE RESERVA SE QUEDABA MUDO ────────────────────────────────
// Es el que atiende cuando una llamada no encaja con ningún asistente: un número
// mal configurado, una org a medio aprovisionar. O sea, justo cuando algo ya ha
// ido mal. Y tenía `voice: 'nova'`, que es un nombre de OpenAI.
//
// Con solo Cartesia registrada, ese nombre le llegaba tal cual y su API devolvía
// «400 — voice ID must be a valid UUID». La cadena se agotaba y el resultado
// medido el 02/08 fueron CERO bytes: quien llamaba oía silencio. El único
// asistente que no podía hablar era el de emergencia.
describe_reserva_mudo();
function describe_reserva_mudo() {
  const CASTELLANAS_UUID = new Set(
    staticCatalog()
      .filter(v => v.provider === 'cartesia' && (v.tier === 'estandar' || !v.tier))
      .map(v => (resolveVoiceEntry(v.id) || {}).providerVoiceId).filter(Boolean));

  test('un nombre que NO es UUID nunca llega a Cartesia', () => {
    // Su API lo dice explícitamente: el id tiene que ser un UUID. Cualquier otra
    // cosa —nombres de OpenAI heredados, ids de nuestro catálogo, basura— se
    // cambia por la reserva en vez de provocar un 400 y silencio.
    for (const basura of ['nova', 'marta-ca', 'shimmer', 'alloy', '', 'no-existe']) {
      const p = router._buildParams('cartesia', basura, 1.0, 'es');
      assert.ok(CASTELLANAS_UUID.has(p.voice),
        `«${basura}» llegaría a Cartesia como ${p.voice} y devolvería 400`);
    }
  });

  test('un UUID legítimo NO se toca, aunque no esté en el catálogo', () => {
    // Si alguien pega un id válido de Cartesia que no hemos curado, se respeta:
    // la guarda existe para evitar el 400, no para imponer nuestro catálogo.
    const ajeno = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    assert.equal(router._buildParams('cartesia', ajeno, 1.0, 'es').voice, ajeno);
  });

  test('el asistente de reserva de Telnyx usa una voz del catálogo', () => {
    const src = fs.readFileSync(path.join(RAIZ, 'src/telephony/telnyx-handler.js'), 'utf8');
    // Ventana amplia: entre el id y la voz hay un comentario que explica por qué
    // esa voz importa, y un límite corto haría fallar el test por la LONGITUD DEL
    // COMENTARIO, no por el código. Un test que se rompe al documentar algo
    // enseña a no documentar.
    const m = src.match(/id: 'default-fallback'[\s\S]{0,1500}?voice: '([^']+)'/);
    assert.ok(m, 'no se encuentra la voz del asistente de reserva');
    assert.ok(resolveVoiceEntry(m[1]), `su voz («${m[1]}») no existe en el catálogo`);
    assert.equal(resolveVoiceEntry(m[1]).provider, 'cartesia',
      'la voz del asistente de reserva debe ser de un proveedor que esté activo');
  });
}
