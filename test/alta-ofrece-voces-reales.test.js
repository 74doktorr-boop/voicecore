'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EL ALTA NO PUEDE HACER ESCUCHAR UNA VOZ QUE LUEGO NO VA A SONAR
//
// El «momento wow» de /onboarding hacía escuchar seis voces —Cristina, Laura,
// Gabriela, Carlos, Marcos, Tony— y GUARDA la elegida en el alta (`voz:
// currentVoice`). Las seis eran de ElevenLabs, del nivel Premium que se retiró
// el 2026-08-01 al quedarse sin clave. O sea: alguien se daba de alta, oía a
// Cristina, se decidía por Cristina… y su asistente contestaba con otra voz,
// porque ese id ya no sintetiza y el router cae a la de por defecto.
//
// Es el peor sitio posible para eso: el minuto exacto en que alguien decide
// pagar. Y es la misma falta que llevo toda la noche quitando —ofrecer lo que el
// producto no puede dar— pero en la puerta de entrada.
//
// Este test ata las dos listas: lo que el alta ofrece TIENE que existir en el
// catálogo, ser de un nivel que se ofrezca, y tener su muestra en disco.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'public', 'onboarding.html'), 'utf8');
const catalogo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config', 'voices.json'), 'utf8'));

// Se lee la lista REAL del fichero, no una copia: si alguien la cambia, este
// test mira la nueva. Copiarla aquí sería volver a tener dos verdades.
function vocesDelAlta() {
  const m = html.match(/const VOICES = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'no se encuentra la lista VOICES en onboarding.html');
  return [...m[1].matchAll(/\{\s*id:\s*'([^']+)'[^}]*name:\s*'([^']+)'[^}]*f:\s*'([^']+)'/g)]
    .map(x => ({ id: x[1], name: x[2], fichero: x[3] }));
}

const OFRECIDAS = vocesDelAlta();
const porId = new Map(catalogo.voices.map(v => [v.id, v]));
const nivelesOfrecidos = new Set(Object.keys(catalogo.tiers || {}));

test('el alta ofrece alguna voz (si no, no hay momento wow)', () => {
  assert.ok(OFRECIDAS.length >= 3, `solo ${OFRECIDAS.length} voces en el alta`);
});

test('todas las voces del alta existen en el catálogo', () => {
  const fantasmas = OFRECIDAS.filter(v => !porId.has(v.id)).map(v => v.id);
  assert.deepEqual(fantasmas, [],
    `el alta ofrece voces que no están en config/voices.json: ${fantasmas.join(', ')}`);
});

test('todas son de un nivel que SE OFRECE (aquí estaba el daño)', () => {
  // Las seis anteriores eran tier "premium", nivel retirado. Este es el test que
  // habría impedido que el alta siguiera vendiéndolas.
  const malas = OFRECIDAS
    .map(v => ({ ...v, tier: (porId.get(v.id) || {}).tier }))
    .filter(v => !nivelesOfrecidos.has(v.tier || 'premium'));
  assert.deepEqual(malas, [],
    'el alta hace escuchar voces de un nivel que ya no se ofrece: ' +
    malas.map(v => `${v.id}(${v.tier})`).join(', '));
});

test('todas tienen su muestra pregrabada EN DISCO', () => {
  // Pegarle '.mp3' al id era lo que había antes, y con las voces nuevas —que son
  // .wav— habría dejado el reproductor en silencio sin decir nada.
  const sinAudio = OFRECIDAS.filter(v =>
    !fs.existsSync(path.join(RAIZ, 'public', 'audio', 'voices', v.fichero)));
  assert.deepEqual(sinAudio.map(v => v.fichero), [],
    'faltan muestras de audio: el momento wow se quedaría mudo');
});

test('la muestra que suena es la del id que se guarda', () => {
  // El alta guarda `voz: currentVoice`. Si el fichero de audio no correspondiera
  // a ese id, el cliente elegiría oyendo una voz y se llevaría otra — que es
  // exactamente lo que pasaba, solo que por otro camino.
  const manifiesto = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'public', 'audio', 'voices', 'manifest.json'), 'utf8'));
  for (const v of OFRECIDAS) {
    assert.equal(manifiesto[v.id], v.fichero,
      `${v.id}: el alta reproduce "${v.fichero}" pero el manifiesto dice "${manifiesto[v.id]}"`);
  }
});

test('el nombre de respaldo sale de la lista, no escrito a mano', () => {
  // Quedaba un `|| 'Cristina'` de la tanda anterior: el resumen del alta podía
  // enseñar el nombre de una voz que ya no existe.
  assert.doesNotMatch(html, /\|\|\s*'Cristina'/,
    'vuelve a haber un nombre de voz escrito a mano como respaldo');
});

test('no queda ninguna voz de ElevenLabs ofrecida en el alta', () => {
  const eleven = OFRECIDAS.filter(v => (porId.get(v.id) || {}).provider === 'elevenlabs');
  assert.deepEqual(eleven.map(v => v.id), [],
    'ElevenLabs no tiene clave en producción: esas voces no suenan');
});
