'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA PRUEBA DE VOZ — el instrumento que faltaba
//
// El 02/08 salieron tres fallos en la ruta de voz. Los tres invisibles: ninguno
// aparecía en ningún panel, ninguno rompía ningún test, ninguno disparaba ningún
// aviso. Se descubrieron porque Unai cogió el teléfono, llamó, y dijo «contesta
// horriblemente mal, un inglés con acento español».
//
// El producto ya sabía decir si el proceso late, si los correos llegan y si se
// pierde alguna llamada. Lo que no sabía decir era si lo que se OYE está bien —
// que es, literalmente, el producto entero.
//
// Este fichero comprueba dos cosas distintas:
//   · que la prueba detecta los TRES fallos reales del 02/08 (abajo, uno a uno);
//   · que la prueba no puede aprobar sin sintetizar de verdad (la caché).
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const { revisarOrg, resumir, _frase } = require('../src/monitoring/prueba-de-voz');

const CATALOGO = {
  'marta-ca':  { provider: 'cartesia', providerVoiceId: 'de38f545-1111', gender: 'female', language: 'es' },
  'greg-en':   { provider: 'cartesia', providerVoiceId: 'a0e99841-2222', gender: 'male',   language: 'en' },
  'ana-es':    { provider: 'elevenlabs', providerVoiceId: 'UOIqAn', gender: 'female', language: 'es' },
  'ane-eu':    { provider: 'local', providerVoiceId: 'ane', gender: 'female', language: 'eu' },
};

/** Un entorno de mentira, pero con las mismas piezas que el de verdad. */
function entorno(opts = {}) {
  const llamadas = [];
  return {
    llamadas,
    deps: {
      router: { providers: new Map((opts.activos || ['cartesia']).map(p => [p, {}])) },
      resolver: id => CATALOGO[id] || null,
      sintetizar: async p => { llamadas.push(p); return opts.audio === undefined ? Buffer.alloc(4000) : opts.audio; },
      hoy: opts.hoy || '2026-08-02',
    },
  };
}

// ── LOS TRES FALLOS REALES ──────────────────────────────────────────────────

test('FALLO 1 · la voz inglesa: una voz `en` en un negocio que atiende en `es`', async () => {
  // Es el que oyó Unai. Ningún test lo cazaba porque técnicamente todo iba bien:
  // la síntesis devolvía audio, el proveedor respondía 200, el pipeline no se
  // quejaba. Solo estaba en el idioma equivocado.
  const e = entorno();
  const r = await revisarOrg({ id: '1', nombre: 'Clínica', voz: 'greg-en', idioma: 'es' }, e.deps);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /habla "en".*atiende en "es"/);
  assert.equal(e.llamadas.length, 0, 'ni siquiera hace falta gastar una síntesis para verlo');
});

test('FALLO 2 · el silencio: la síntesis devuelve cero bytes', async () => {
  // El asistente de reserva tenía `voice: 'nova'`, un nombre de OpenAI. Cartesia
  // devolvía 400 y la cadena se agotaba: CERO bytes. Quien llamaba oía silencio,
  // y el silencio es exactamente igual que una llamada que va bien pero calla.
  const e = entorno({ audio: Buffer.alloc(0) });
  const r = await revisarOrg({ id: '1', nombre: 'Clínica', voz: 'marta-ca', idioma: 'es' }, e.deps);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /CERO bytes|silencio/);
});

test('FALLO 3 · el proveedor apagado: la voz existe pero nadie la puede decir', async () => {
  // La única org con llamadas reales tenía `ana-es`, de ElevenLabs, cuya clave se
  // retiró al matar el nivel premium. La voz sigue en el catálogo, así que en el
  // panel se ve perfectamente elegida — y por dentro cae en la de reserva.
  const e = entorno({ activos: ['cartesia'] });
  const r = await revisarOrg({ id: '1', nombre: 'Clínica', voz: 'ana-es', idioma: 'es' }, e.deps);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /elevenlabs.*NO está activo/);
});

// ── Y LOS CASOS QUE NO SON FALLO ────────────────────────────────────────────

test('una voz que existe, de un proveedor activo, en el idioma correcto: pasa', async () => {
  const e = entorno();
  const r = await revisarOrg({ id: '1', nombre: 'Clínica', voz: 'marta-ca', idioma: 'es' }, e.deps);
  assert.equal(r.ok, true);
  assert.equal(r.bytes, 4000);
  assert.equal(e.llamadas.length, 1, 'tiene que haber sintetizado de verdad');
});

test('el combo es+gl NO cuenta como idioma distinto', async () => {
  // `hierros a freixa` tiene guardado 'es+gl'. Comparar la cadena entera contra
  // 'es' la marcaría en rojo todos los días para siempre — y una alarma que
  // siempre suena es una alarma que nadie mira.
  const e = entorno();
  const r = await revisarOrg({ id: '1', nombre: 'Freixa', voz: 'marta-ca', idioma: 'es+gl' }, e.deps);
  assert.equal(r.ok, true, r.motivo);
});

test('una voz que no existe en el catálogo se nombra, no se traga', async () => {
  const e = entorno();
  const r = await revisarOrg({ id: '1', nombre: 'X', voz: 'inventada-99', idioma: 'es' }, e.deps);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no existe en el catálogo/);
});

test('sin voz configurada no es un fallo, pero se AVISA', async () => {
  // Tres de las cuatro orgs están así. No es un error —cae en la reserva, que
  // desde hoy es castellana— pero es justo el camino que sonaba en inglés, y
  // conviene que se vea en vez de contarlo como verde.
  const e = entorno();
  const r = await revisarOrg({ id: '1', nombre: 'Demo', voz: null, idioma: 'es' }, e.deps);
  assert.equal(r.ok, true);
  assert.match(r.aviso, /reserva/);
});

test('si la síntesis revienta, la prueba lo cuenta en vez de morirse', async () => {
  const deps = { ...entorno().deps, sintetizar: async () => { throw new Error('ECONNREFUSED api.cartesia.ai'); } };
  const r = await revisarOrg({ id: '1', nombre: 'X', voz: 'marta-ca', idioma: 'es' }, deps);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /ECONNREFUSED/);
});

// ── LA CACHÉ: por qué la frase lleva la fecha ───────────────────────────────

test('LA FRASE CAMBIA CADA DÍA — si no, la prueba daría en la caché y no probaría nada', async () => {
  // El router cachea por (texto, voz, proveedor, idioma). Con una frase fija, la
  // segunda pasada y todas las siguientes devolverían el audio guardado: la
  // prueba saldría verde con Cartesia caída, con la clave caducada, con el
  // proveedor devolviendo 400. Una prueba que puede aprobar sin ejecutar nada
  // no es una prueba, es un adorno.
  assert.notEqual(_frase('2026-08-02'), _frase('2026-08-03'));
  assert.match(_frase('2026-08-02'), /2026-08-02/);
});

test('la frase es CORTA: esto gasta dinero de verdad', async () => {
  // ~60 caracteres × 4 orgs × 365 días ≈ 88.000 caracteres al año. Céntimos.
  // Pero se mide, porque el charter dice que nada gasta dinero en silencio.
  assert.ok(_frase('2026-08-02').length <= 80, `la frase mide ${_frase('2026-08-02').length}`);
});

test('lo que se sintetiza es el id REAL del proveedor, no el nuestro', async () => {
  // Pasarle `marta-ca` a Cartesia es exactamente el fallo de `nova`: su API pide
  // un UUID y devuelve 400. Si la prueba mandara el id de nuestro catálogo,
  // fallaría siempre y por el motivo equivocado.
  const e = entorno();
  await revisarOrg({ id: '1', nombre: 'X', voz: 'marta-ca', idioma: 'es' }, e.deps);
  assert.equal(e.llamadas[0].voice, 'de38f545-1111');
  assert.equal(e.llamadas[0].provider, 'cartesia');
});

// ── EL RESUMEN ──────────────────────────────────────────────────────────────

test('el resumen dice CUÁL es el problema, no solo cuántos', async () => {
  const r = resumir([
    { org: 'A', voz: 'marta-ca', ok: true, bytes: 4000 },
    { org: 'B', voz: 'greg-en', ok: false, motivo: 'la voz habla "en" y el asistente atiende en "es"' },
  ], '2026-08-02T10:00:00Z');
  assert.equal(r.conProblemas, 1);
  assert.match(r.resumen, /1 de 2/);
  assert.match(r.resumen, /habla "en"/, 'el resumen tiene que traer el motivo, no solo el recuento');
});

test('sin datos NO dice que todo va bien', async () => {
  // La trampa de siempre: cero problemas encontrados se parece muchísimo a cero
  // problemas. Un recuento no demuestra ausencia; demuestra que no se ha mirado.
  const r = resumir([], null);
  assert.equal(r.conProblemas, 0);
  assert.doesNotMatch(r.resumen, /bien|correct|ok/i);
  assert.match(r.resumen, /no se ha revisado/);
});
