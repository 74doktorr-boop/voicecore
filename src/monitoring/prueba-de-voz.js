// ============================================================================
// NodeFlow — PRUEBA DE VOZ: comprobar que lo que se OYE está bien
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO
//
// El 02/08 salieron tres fallos seguidos en la ruta de voz, y los tres tenían
// algo en común: **ninguno aparecía en ningún panel**. Solo se descubrieron
// porque Unai cogió el teléfono y llamó.
//
//   1. La voz de reserva era «Greg - Supporter», idioma `en`. Un hombre inglés
//      leyendo castellano a quien llamaba.
//   2. El asistente de reserva tenía `voice: 'nova'` —un nombre de OpenAI—, así
//      que Cartesia devolvía 400 y la llamada acababa en CERO bytes de audio:
//      silencio.
//   3. Y la única organización con llamadas reales tenía guardada una voz de
//      ElevenLabs que ya no existe.
//
// A esas alturas el producto ya sabía decir si el proceso late (`/health/latidos`),
// si los correos llegan (`/health/avisos`) y si se pierde alguna llamada
// (`/health/llamadas`). Lo que no sabía decir era **si lo que se oye está bien**,
// que es literalmente el producto.
//
// QUÉ HACE
//
// Para cada organización activa: coge SU voz configurada, sintetiza una frase
// corta de verdad, y comprueba cuatro cosas —en este orden, porque cada una
// explica el fallo de la siguiente:
//
//   · ¿la voz existe en el catálogo?          (el caso de `ana-es`)
//   · ¿su proveedor está activo?              (el caso de ElevenLabs sin clave)
//   · ¿el IDIOMA de la voz es el del asistente? (el caso de Greg, el inglés)
//   · ¿sale audio de verdad?                  (el caso de `nova`, el silencio)
//
// LA FRASE LLEVA LA FECHA A PROPÓSITO. El router cachea por (texto, voz,
// proveedor, idioma), así que una frase fija daría en la caché a partir de la
// segunda vez y la prueba pasaría en verde con el proveedor caído. Una prueba
// que puede aprobar sin ejecutar nada no es una prueba.
//
// LO QUE CUESTA: unos 60 caracteres por organización y pasada, una vez al día.
// Con cuatro organizaciones son ~240 caracteres diarios — céntimos al año. Se
// deja escrito porque esto GASTA DINERO, poco pero gasta, y eso no se esconde.
// ============================================================================
'use strict';

const { Logger } = require('../utils/logger');
const store = require('../utils/rate-store');

const log = new Logger('PRUEBA-VOZ');

const CLAVE = 'nf:prueba-voz';
const CADA_MS = 24 * 60 * 60 * 1000;   // una vez al día

/** Frase corta y con fecha: corta por el coste, con fecha para no dar en caché. */
function _frase(hoy) {
  return `Hola, gracias por llamar. Comprobación de voz del ${hoy}.`;
}

/**
 * El camino de la RESERVA: el que usa una org que no ha elegido voz.
 *
 * No se comprueba «que exista una reserva», que sería trivial y siempre verde.
 * Se le pregunta al router LA VOZ QUE USARÍA —el mismo `_buildParams` que corre
 * en una llamada de verdad— y se juzga esa: idioma primero, audio después.
 * Cualquier cosa que no recorra ese camino comprobaría otro producto.
 */
async function _revisarReserva(org, deps, base) {
  const idiomaOrg = String(org.idioma || 'es').split('+')[0];
  const aviso = 'sin voz configurada — se comprueba la de reserva';

  let elegida = null;
  try {
    const prov = deps.proveedorPorDefecto || 'cartesia';
    const p = deps.router._buildParams(prov, null, 1.0, org.idioma || 'es');
    elegida = { provider: prov, providerVoiceId: p.voice };
    // `resolver` busca por id NUESTRO o por id del proveedor, así que el UUID
    // que devuelve el router se resuelve tal cual.
    const entrada = deps.resolver(p.voice);
    if (entrada && entrada.language && entrada.language !== idiomaOrg) {
      return { ...base, ok: false, proveedor: prov,
        motivo: `la voz de RESERVA habla "${entrada.language}" y el asistente atiende en "${idiomaOrg}" — esto es exactamente el fallo del 02/08` };
    }
  } catch (e) {
    return { ...base, ok: false, motivo: `no se pudo averiguar la voz de reserva: ${String(e.message).slice(0, 100)}` };
  }

  try {
    const audio = await deps.sintetizar({
      callId: `prueba-voz-reserva-${org.id}`,
      text: _frase(deps.hoy),
      provider: elegida.provider,
      voice: elegida.providerVoiceId,
      language: org.idioma || 'es',
    });
    if (!audio || !audio.length) {
      return { ...base, ok: false, proveedor: elegida.provider,
        motivo: 'la voz de RESERVA devolvió CERO bytes: quien llame oirá silencio' };
    }
    return { ...base, ok: true, aviso, proveedor: elegida.provider, bytes: audio.length };
  } catch (e) {
    return { ...base, ok: false, proveedor: elegida.provider,
      motivo: `la voz de RESERVA falló: ${String(e.message).slice(0, 120)}` };
  }
}

/**
 * Revisa UNA organización. Núcleo comprobable: recibe todo inyectado.
 * @param {{id:string, nombre:string, voz:string, idioma:string}} org
 * @param {{router:object, resolver:function, sintetizar:function, hoy:string}} deps
 */
async function revisarOrg(org, deps) {
  const base = { org: org.nombre || org.id, voz: org.voz || null };

  if (!org.voz) {
    // OJO CON ESTE CAMINO. Es tentador despacharlo con un aviso y seguir —«no
    // ha elegido voz, no hay nada que comprobar»— pero es justo al revés: tres
    // de las cuatro organizaciones están así, y la voz de reserva es la que
    // estuvo contestando EN INGLÉS. Saltárselo dejaría sin vigilancia
    // precisamente el trozo que se rompió.
    //
    // Así que se le pregunta al router qué voz usaría de verdad, y se comprueba
    // esa: que sea del idioma del negocio, y que suene.
    return await _revisarReserva(org, deps, base);
  }

  const entrada = deps.resolver(org.voz);
  if (!entrada) {
    return { ...base, ok: false, motivo: `la voz "${org.voz}" no existe en el catálogo` };
  }

  const activos = deps.router?.providers ? new Set(deps.router.providers.keys()) : new Set();
  if (activos.size && !activos.has(entrada.provider)) {
    return { ...base, ok: false, proveedor: entrada.provider,
      motivo: `su proveedor (${entrada.provider}) NO está activo — sonará la voz de reserva, no la suya` };
  }

  // El idioma de la voz contra el del asistente. Es la comprobación que habría
  // cazado a Greg: una voz `en` atendiendo a un negocio que habla castellano.
  const idiomaOrg = String(org.idioma || 'es').split('+')[0];
  if (entrada.language && entrada.language !== idiomaOrg) {
    return { ...base, ok: false, proveedor: entrada.provider,
      motivo: `la voz habla "${entrada.language}" y el asistente atiende en "${idiomaOrg}"` };
  }

  // Y por fin: que salga audio. Lo demás son comprobaciones de papel; esta es la
  // que se parece a lo que oye quien llama.
  try {
    const t0 = Date.now();
    const audio = await deps.sintetizar({
      callId: `prueba-voz-${org.id}`,
      text: _frase(deps.hoy),
      provider: entrada.provider,
      voice: entrada.providerVoiceId,
      language: org.idioma || 'es',
    });
    const ms = Date.now() - t0;
    if (!audio || !audio.length) {
      return { ...base, ok: false, proveedor: entrada.provider, ms,
        motivo: 'la síntesis devolvió CERO bytes: quien llame oirá silencio' };
    }
    return { ...base, ok: true, proveedor: entrada.provider, bytes: audio.length, ms };
  } catch (e) {
    return { ...base, ok: false, proveedor: entrada.provider,
      motivo: `la síntesis falló: ${String(e.message).slice(0, 120)}` };
  }
}

/** Resume el conjunto y escribe el veredicto. PURA. */
function resumir(resultados, cuando) {
  const r = Array.isArray(resultados) ? resultados : [];
  const malas = r.filter(x => x && !x.ok);
  const avisos = r.filter(x => x && x.ok && x.aviso);
  return {
    cuando: cuando || null,
    revisadas: r.length,
    conProblemas: malas.length,
    problemas: malas.map(x => ({ org: x.org, voz: x.voz, motivo: x.motivo })),
    avisos: avisos.map(x => ({ org: x.org, aviso: x.aviso })),
    detalle: r.map(x => ({ org: x.org, voz: x.voz, ok: x.ok, bytes: x.bytes || 0, ms: x.ms || null })),
    resumen: !r.length
      ? 'no se ha revisado ninguna organización todavía'
      : malas.length
        ? `${malas.length} de ${r.length} organizaciones NO suenan como deberían: ${malas[0].motivo}`
        : `las ${r.length} organizaciones sintetizan audio con su propia voz`,
  };
}

/** Ejecuta la pasada completa y la guarda. */
async function pasada(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const router = deps.router || (deps.pipeline && deps.pipeline.ttsRouter);
  if (!db.enabled || !router) return resumir([], null);

  const { data } = await db.client
    .from('organizations').select('id, name, is_active, assistant_config').eq('is_active', true);

  const orgs = (data || []).map(o => ({
    id: o.id, nombre: o.name,
    voz: (o.assistant_config || {}).voice || null,
    idioma: (o.assistant_config || {}).language || (o.assistant_config || {}).idioma || 'es',
  }));

  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  const d = {
    router,
    resolver: deps.resolver || require('../tts/voice-catalog').resolveVoiceEntry,
    sintetizar: deps.sintetizar || (p => router.synthesize(p)),
    hoy,
  };

  const resultados = [];
  for (const o of orgs) resultados.push(await revisarOrg(o, d));

  const informe = resumir(resultados, new Date().toISOString());
  try { await store.put(CLAVE, JSON.stringify(informe), 8 * 24 * 3600 * 1000); } catch (_) {}
  if (informe.conProblemas) {
    log.error(`Prueba de voz: ${informe.resumen}`);
    for (const p of informe.problemas) log.error(`  · ${p.org}: ${p.motivo}`);
  } else {
    log.info(`Prueba de voz: ${informe.resumen}`);
  }
  return informe;
}

/** Lo último que se sabe, para /health/voz. */
async function informe() {
  try {
    const s = await store.get(CLAVE);
    if (!s) return { ...resumir([], null), persistente: store.isRedisEnabled() };
    return { ...JSON.parse(s), persistente: store.isRedisEnabled() };
  } catch (_) {
    return { ...resumir([], null), persistente: store.isRedisEnabled() };
  }
}

let _timer = null;
function arrancar(deps = {}) {
  if (_timer) return;
  const tic = () => {
    try { if (!require('../utils/leader').isLeader()) return; } catch (_) { return; }
    pasada(deps).catch(e => log.warn(`prueba de voz: ${e.message}`));
  };
  _timer = setInterval(tic, CADA_MS);
  _timer.unref?.();
  // La primera, a los 3 minutos del arranque: da tiempo a que los proveedores
  // se registren y a que un despliegue se asiente, y así un cambio de voz que
  // rompa algo se ve el mismo día, no al siguiente.
  setTimeout(tic, 3 * 60 * 1000).unref?.();
  log.info('Prueba de voz diaria activada');
}
function parar() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = { revisarOrg, resumir, pasada, informe, arrancar, parar, _frase, CLAVE };
