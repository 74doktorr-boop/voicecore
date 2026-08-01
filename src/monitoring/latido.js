// ============================================================================
// NodeFlow — LATIDO: la aplicación se mide a sí misma, sin parar
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO
//
// El 31 de julio el vigilante externo saltó dos veces —18:42 y 22:17 UTC—, sin
// despliegue de por medio, y las dos veces dijo lo mismo: «HTTP 000». curl agotó
// sus 25 segundos sin llegar a abrir la conexión. Eso deja tres culpables
// posibles y ninguna forma de elegir entre ellos:
//
//   A) el proceso MURIÓ y estaba reiniciándose,
//   B) el proceso estaba VIVO pero con el bucle de eventos atascado —acepta la
//      conexión y no contesta—,
//   C) el proceso estaba PERFECTAMENTE y el problema estaba fuera: el proxy,
//      la máquina, la red.
//
// Desde fuera esos tres casos se ven idénticos. Y el vigilante mira una vez cada
// hora o dos (GitHub encola los crons), o sea que ve alrededor del 1% del día:
// no se puede diagnosticar una avería intermitente con eso. Preguntarle a la
// aplicación DESPUÉS tampoco vale — si se murió, se llevó su memoria.
//
// QUÉ HACE
//
// Cada 10 segundos escribe un latido en Redis: el instante, el bootId, el
// retardo máximo del bucle de eventos, la memoria y las llamadas activas. En
// Redis, no en memoria, precisamente para que sobreviva a la muerte del proceso.
// Después, leer la serie contesta la pregunta sola:
//
//   · hueco en los latidos + bootId DISTINTO  → murió y reinició        (caso A)
//   · hueco con el MISMO bootId               → vivo pero atascado      (caso B)
//   · sin hueco durante la caída              → la aplicación iba bien; \
//                                               mirar proxy/máquina/red (caso C)
//
// El caso C es el que más falta hacía: sin esto no hay manera de exculpar a la
// aplicación, y uno se pasa la noche buscando una fuga de memoria que no existe.
//
// Cuesta ~160 KB en Redis y un temporizador. Nada que se note.
// ============================================================================
'use strict';

const { Logger } = require('../utils/logger');
const store = require('../utils/rate-store');

const log = new Logger('LATIDO');

const CLAVE = 'nf:latido';
const CADA_MS = 10_000;          // un latido cada 10 s
const MAXIMO = 2000;             // ~5,5 h de historia
const MUESTREO_LAG_MS = 500;     // cada cuánto se mide el retardo del bucle
// Un hueco es «de verdad» a partir de 2,5 latidos. Menos que eso es el ruido
// normal de un temporizador de Node bajo carga, y un detector que llama caída a
// medio segundo de retraso acaba en la carpeta de ignorados.
const HUECO_MS = CADA_MS * 2.5;

let _timer = null;
let _timerLag = null;
let _lagMax = 0;
let _bootId = null;
let _obtenerLlamadas = () => 0;

/**
 * Retardo del bucle de eventos: se programa un aviso a 500 ms y se mira cuánto
 * se ha retrasado de verdad. Si algo bloquea el hilo —una regex que se
 * desmadra, un JSON gigante, una síntesis síncrona— el retraso lo delata. Es la
 * única señal del caso B: el proceso está vivo, responde a /health cuando le
 * llega el turno, y mientras tanto no atiende a nadie.
 */
function _arrancarMedidorDeLag() {
  let esperado = Date.now() + MUESTREO_LAG_MS;
  _timerLag = setInterval(() => {
    const ahora = Date.now();
    const retraso = ahora - esperado;
    if (retraso > _lagMax) _lagMax = retraso;
    esperado = ahora + MUESTREO_LAG_MS;
  }, MUESTREO_LAG_MS);
  _timerLag.unref?.();
}

/** Un latido: lo mínimo para reconstruir qué pasaba, en el menor espacio. */
function _latido() {
  const m = process.memoryUsage();
  const l = {
    t: Date.now(),
    b: _bootId,
    lag: Math.max(0, Math.round(_lagMax)),
    rss: Math.round(m.rss / 1048576),
    heap: Math.round(m.heapUsed / 1048576),
    up: Math.round(process.uptime()),
  };
  const llamadas = Number(_obtenerLlamadas()) || 0;
  if (llamadas) l.c = llamadas;   // se omite cuando es 0: la mayoría de latidos
  _lagMax = 0;
  return l;
}

/**
 * Analiza una serie de latidos y devuelve lo que hay que mirar, ya masticado.
 * Función pura: se testea sin Redis y sin esperar.
 * @param {Array<object>} latidos  en orden cronológico
 */
function analizar(latidos) {
  const l = (Array.isArray(latidos) ? latidos : []).filter(x => x && typeof x.t === 'number');
  l.sort((a, b) => a.t - b.t);

  const huecos = [];
  const reinicios = [];
  for (let i = 1; i < l.length; i++) {
    const dt = l[i].t - l[i - 1].t;
    const cambioDeBoot = l[i].b !== l[i - 1].b;
    if (cambioDeBoot) {
      reinicios.push({ cuando: new Date(l[i].t).toISOString(), de: l[i - 1].b, a: l[i].b });
    }
    if (dt > HUECO_MS) {
      huecos.push({
        desde: new Date(l[i - 1].t).toISOString(),
        hasta: new Date(l[i].t).toISOString(),
        segundos: Math.round(dt / 1000),
        // El veredicto va AQUÍ, no en la cabeza de quien lo lea a las 4 de la
        // mañana. Un dato que hay que interpretar se interpreta mal.
        veredicto: cambioDeBoot
          ? 'el proceso MURIÓ y reinició (el bootId cambió)'
          : 'el proceso siguió VIVO pero dejó de latir: bucle de eventos atascado o congelado por el anfitrión',
      });
    }
  }

  // Picos de retardo aunque NO lleguen a hueco: es el aviso temprano del caso B.
  const picos = l.filter(x => x.lag > 1000)
    .map(x => ({ cuando: new Date(x.t).toISOString(), lagMs: x.lag, rssMb: x.rss }));

  const rss = l.map(x => x.rss).filter(Number.isFinite);
  return {
    latidos: l.length,
    desde: l.length ? new Date(l[0].t).toISOString() : null,
    hasta: l.length ? new Date(l[l.length - 1].t).toISOString() : null,
    huecos,
    reinicios,
    picosDeRetardo: picos.slice(-20),
    memoriaRssMb: rss.length ? { min: Math.min(...rss), max: Math.max(...rss), ultimo: rss[rss.length - 1] } : null,
    // Lo que hay que leer primero.
    resumen: !l.length
      ? 'sin latidos todavía'
      : huecos.length
        ? `${huecos.length} hueco(s): ${huecos[huecos.length - 1].veredicto}`
        : picos.length
          ? `sin huecos, pero ${picos.length} pico(s) de retardo del bucle — el proceso se atasca a ratos`
          : 'sin huecos ni picos: durante este tramo la aplicación estuvo bien. Si hubo caída, fue FUERA (proxy, máquina o red)',
  };
}

/** Lee la serie guardada y la analiza. */
async function historial(count = MAXIMO) {
  const crudo = await store.listRange(CLAVE, count);
  const latidos = [];
  for (const s of crudo) {
    try { latidos.push(JSON.parse(s)); } catch (_) { /* una línea rota no tumba el informe */ }
  }
  return {
    ...analizar(latidos),
    persistente: store.isRedisEnabled(),
    aviso: store.isRedisEnabled() ? null
      : 'SIN REDIS: los latidos viven en memoria y se pierden justo cuando el proceso muere, que es cuando hacen falta. Esto no puede demostrar nada sobre una caída.',
  };
}

/**
 * Arranca el latido. Idempotente.
 * @param {{bootId:string, activeCalls?:function}} opts
 */
function arrancar({ bootId, activeCalls } = {}) {
  if (_timer) return;
  _bootId = String(bootId || process.pid);
  if (typeof activeCalls === 'function') _obtenerLlamadas = activeCalls;

  _arrancarMedidorDeLag();

  // Al arrancar, mirar lo que dejó el proceso ANTERIOR y decirlo en el log. Si
  // esto reinició por una caída, el arranque es justo el momento en que alguien
  // va a mirar los logs — que lo encuentre ahí y no tenga que ir a buscarlo.
  historial(200).then(h => {
    const ultimo = h.huecos[h.huecos.length - 1];
    if (ultimo) log.warn(`Al arrancar: hueco de ${ultimo.segundos}s hasta ${ultimo.hasta} — ${ultimo.veredicto}`);
    if (h.aviso) log.warn(h.aviso);
  }).catch(() => { /* sin historial se empieza de cero */ });

  const latir = () => {
    store.pushCapped(CLAVE, _latido(), MAXIMO).catch(e => {
      // Que no se caiga nada por no poder anotar un latido.
      log.warn(`no se pudo anotar el latido: ${e.message}`);
    });
  };
  latir();
  _timer = setInterval(latir, CADA_MS);
  _timer.unref?.();
  log.info(`Latido cada ${CADA_MS / 1000}s (boot ${_bootId})`);
}

function parar() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_timerLag) { clearInterval(_timerLag); _timerLag = null; }
}

module.exports = { arrancar, parar, historial, analizar, CLAVE, CADA_MS, HUECO_MS };
