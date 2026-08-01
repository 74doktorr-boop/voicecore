// ============================================================================
// NodeFlow — CONCILIACIÓN CON TELNYX: las llamadas que NO llegamos a coger
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO
//
// El 01/08 el anfitrión se quedó inalcanzable dos veces (10:52 y 13:47 UTC).
// Medido: nodeflow.es y ets.nodeflow.es —otro contenedor del MISMO servidor— no
// aceptaban conexiones, mientras Cloudflare respondía en 0,05 s y nuestro propio
// proceso seguía latiendo cada 10 segundos sin un solo hueco. O sea: la máquina
// viva, la aplicación perfecta, y desde fuera inalcanzable.
//
// Y AQUÍ ESTÁ EL AGUJERO. Durante esos minutos, Telnyx no alcanza el webhook y
// la llamada se cae. Nosotros nos enteramos por... nada. `nf_calls` solo tiene
// las llamadas cuyo webhook SÍ llegó. Una llamada perdida y una hora tranquila
// se ven exactamente igual en todos nuestros paneles.
//
// Es insostenible para un producto que se vende diciendo «no pierdas ninguna
// llamada»: hoy esa frase no es comprobable ni por nosotros. Y no hace falta una
// caída del anfitrión — un fallo de Telnyx, un número mal enrutado o un tope de
// concurrencia producen exactamente el mismo silencio.
//
// QUÉ HACE
//
// Telnyx sabe de TODAS las llamadas que entraron a nuestros números, las
// cogiéramos o no. Se le piden las de una ventana, se cruzan con `nf_calls`, y
// lo que Telnyx vio y nosotros no es, literalmente, una llamada perdida.
//
// Con eso el producto puede por fin:
//   · decir «atendimos 47 de 47» y que sea VERIFICABLE, no una suposición;
//   · avisar al dueño con el número, para que devuelva la llamada;
//   · y medir de verdad cuánto cuesta cada caída, en vez de estimarlo.
//
// El núcleo es PURO (cruzar dos listas) y se testea sin red ni base de datos.
// Las dos costuras —traer de Telnyx y traer de la BD— se inyectan.
// ============================================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CONCILIACION');

const TELNYX_CDR = 'https://api.telnyx.com/v2/detail_records';

/** Normaliza un número a solo dígitos con prefijo, para poder comparar. */
function _tel(n) {
  const s = String(n == null ? '' : n).replace(/[^\d+]/g, '');
  return s.startsWith('+') ? s : (s ? `+${s}` : '');
}

/**
 * Cruza lo que vio Telnyx con lo que tenemos guardado. PURA.
 *
 * El emparejamiento va por (número que llama, número llamado, instante ±
 * tolerancia) y NO por identificador, a propósito: cuando el webhook no llega,
 * nunca hemos visto el call_control_id de Telnyx, así que emparejar por id daría
 * TODAS las llamadas por perdidas. Es justo el caso que hay que detectar bien.
 *
 * @param {Array} deTelnyx  [{ from, to, started_at, duration_millis, hangup_cause }]
 * @param {Array} nuestras  [{ caller_number, called_number, started_at }]
 * @param {{toleranciaMs?:number}} opts
 */
function cruzar(deTelnyx, nuestras, opts = {}) {
  const tol = opts.toleranciaMs ?? 120_000;   // 2 min: el webhook y el CDR no marcan el mismo instante
  const mias = (Array.isArray(nuestras) ? nuestras : [])
    .map(c => ({ de: _tel(c.caller_number), a: _tel(c.called_number), t: Date.parse(c.started_at), usada: false }))
    .filter(c => Number.isFinite(c.t));

  const perdidas = [];
  const conciliadas = [];

  for (const r of (Array.isArray(deTelnyx) ? deTelnyx : [])) {
    const de = _tel(r.from), a = _tel(r.to), t = Date.parse(r.started_at);
    if (!Number.isFinite(t)) continue;

    // Se busca la MÁS CERCANA en el tiempo, no la primera que encaje: con dos
    // llamadas del mismo número seguidas, «la primera que encaje» puede casar la
    // segunda con la primera y dejar huérfana una que sí atendimos.
    let mejor = null, mejorD = Infinity;
    for (const m of mias) {
      if (m.usada || m.de !== de || m.a !== a) continue;
      const d = Math.abs(m.t - t);
      if (d <= tol && d < mejorD) { mejor = m; mejorD = d; }
    }
    if (mejor) { mejor.usada = true; conciliadas.push({ de, a, t }); continue; }

    perdidas.push({
      de, a,
      cuando: new Date(t).toISOString(),
      // Telnyx da los milisegundos como cadena en algunos planes.
      segundos: Math.round((Number(r.duration_millis) || 0) / 1000),
      causa: r.hangup_cause || null,
    });
  }

  // Lo contrario también importa, aunque sea raro: llamadas que tenemos y Telnyx
  // no. Si aparece, o la ventana está mal calculada o hay algo que no entendemos,
  // y en los dos casos hay que saberlo antes de fiarse del número de arriba.
  const soloNuestras = mias.filter(m => !m.usada).length;

  return {
    deTelnyx: (deTelnyx || []).length,
    nuestras: mias.length,
    conciliadas: conciliadas.length,
    perdidas,
    soloNuestras,
    // El veredicto escrito, no la materia prima.
    resumen: !deTelnyx || !deTelnyx.length
      ? 'Telnyx no reporta ninguna llamada en esta ventana'
      : perdidas.length
        ? `${perdidas.length} de ${deTelnyx.length} llamadas NO se atendieron`
        : `las ${conciliadas.length} llamadas que vio Telnyx están todas atendidas`,
  };
}

/**
 * Trae de Telnyx las llamadas ENTRANTES de una ventana.
 * @param {{desde:Date, hasta:Date, apiKey?:string, fetch?:function}} o
 */
// Telnyx no acepta `record_type=voice` («No matching record type was found»),
// y su nomenclatura ha cambiado entre versiones de la API. En vez de adivinar a
// base de despliegues, se prueban los candidatos y se usa el primero que
// responda — y se DICE cuál fue, para no volver a adivinar nunca.
const TIPOS_CANDIDATOS = ['call', 'voice', 'call-control', 'calls', 'webrtc'];
let _tipoQueFunciona = null;

async function traerDeTelnyx({ desde, hasta, apiKey, fetch: f, tipo } = {}) {
  const key = apiKey || process.env.TELNYX_API_KEY;
  const doFetch = f || globalThis.fetch;
  if (!key) throw new Error('sin TELNYX_API_KEY: no se puede conciliar');
  if (!doFetch) throw new Error('sin fetch disponible');

  // Un solo intento por tipo, y en cuanto uno va se recuerda.
  const tipos = tipo ? [tipo] : (_tipoQueFunciona ? [_tipoQueFunciona] : TIPOS_CANDIDATOS);
  let ultimoError = null;
  for (const t of tipos) {
    try {
      const r = await _traerConTipo({ desde, hasta, key, doFetch, tipo: t });
      if (_tipoQueFunciona !== t) {
        _tipoQueFunciona = t;
        log.info(`Telnyx acepta record_type="${t}" — usando ese de aquí en adelante`);
      }
      return r;
    } catch (e) {
      ultimoError = e;
      // Solo se sigue probando si el rechazo es POR EL TIPO. Un 401 o un 429 no
      // se arreglan cambiando de nombre, y reintentar cinco veces contra el
      // proveedor por un problema de credenciales es maleducado y además tapa
      // el error de verdad.
      if (!/record type|10011|invalid.*filter/i.test(e.message)) throw e;
    }
  }
  throw new Error(`Telnyx no acepta ninguno de los tipos probados (${tipos.join(', ')}). Último: ${ultimoError && ultimoError.message}`);
}

async function _traerConTipo({ desde, hasta, key, doFetch, tipo }) {
  const out = [];
  let page = 1;
  // Techo de páginas: una ventana corta no debería pasar de aquí, y sin tope un
  // filtro mal puesto se convierte en un bucle contra la API de un proveedor.
  while (page <= 20) {
    const url = `${TELNYX_CDR}?filter[record_type]=${tipo}`
      + `&filter[date_range][gte]=${encodeURIComponent(desde.toISOString())}`
      + `&filter[date_range][lte]=${encodeURIComponent(hasta.toISOString())}`
      + `&page[number]=${page}&page[size]=250`;
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Telnyx CDR HTTP ${res.status}: ${txt.slice(0, 160)}`);
    }
    const j = await res.json();
    const lote = j.data || [];
    out.push(...lote.filter(r => String(r.direction || '').toLowerCase().startsWith('in')));
    const total = j.meta?.total_pages ?? 1;
    if (page >= total || !lote.length) break;
    page++;
  }
  return out;
}

/** Trae de nf_calls las llamadas entrantes de la misma ventana. */
async function traerNuestras({ desde, hasta, db }) {
  const base = db || require('../db/database').getDatabase();
  if (!base.enabled) return [];
  const { data, error } = await base.client
    .from('nf_calls')
    .select('caller_number, called_number, started_at, org_id')
    .eq('direction', 'inbound')
    .gte('started_at', desde.toISOString())
    .lte('started_at', hasta.toISOString());
  if (error) throw new Error(`nf_calls: ${error.message}`);
  return data || [];
}

/**
 * Concilia una ventana. Por defecto, las últimas 6 horas con 10 minutos de
 * margen al final: un CDR tarda un rato en aparecer, y preguntar por lo que
 * acaba de pasar daría falsos perdidos.
 */
async function conciliar(opts = {}) {
  const hasta = opts.hasta || new Date(Date.now() - 10 * 60 * 1000);
  const desde = opts.desde || new Date(hasta.getTime() - 6 * 3600 * 1000);
  const [telnyx, nuestras] = await Promise.all([
    (opts.traerDeTelnyx || traerDeTelnyx)({ desde, hasta, apiKey: opts.apiKey, fetch: opts.fetch }),
    (opts.traerNuestras || traerNuestras)({ desde, hasta, db: opts.db }),
  ]);
  const r = cruzar(telnyx, nuestras, opts);
  return { ventana: { desde: desde.toISOString(), hasta: hasta.toISOString() }, ...r };
}

/**
 * SONDA DE DIAGNÓSTICO: prueba varias formas de preguntar y dice cuál trae
 * filas. No adivina — mide.
 *
 * Existe porque la primera versión devolvió «0 llamadas» en una ventana donde
 * nosotros teníamos 3 registradas. Con solo un cero no se distingue «no hubo
 * llamadas» de «la consulta está mal», y averiguarlo a base de despliegues de
 * cinco minutos es la peor forma posible de gastar una tarde.
 *
 * Devuelve la forma de la petición y el número de filas — NUNCA teléfonos.
 */
async function sondearTelnyx({ desde, hasta, apiKey, fetch: f } = {}) {
  const key = apiKey || process.env.TELNYX_API_KEY;
  const doFetch = f || globalThis.fetch;
  if (!key) return { error: 'sin TELNYX_API_KEY' };

  // Sondeo 2 (01/08, tras el primero): ya se sabe que el tipo es `call-control`
  // —los demás dan 400— y que SIN fechas trae filas pero CON ellas da cero. O
  // sea que lo que está mal es el filtro de fechas. Aquí se prueban sus formas.
  const gte = desde.toISOString(), lte = hasta.toISOString();
  const B = `${TELNYX_CDR}?filter[record_type]=call-control&page[size]=5`;
  const intentos = [
    ['sin fechas (control: tiene que traer filas)', B],
    ['filter[date_range][gte]/[lte]  ← la que da cero',
     `${B}&filter[date_range][gte]=${encodeURIComponent(gte)}&filter[date_range][lte]=${encodeURIComponent(lte)}`],
    ['filter[started_at][gte]/[lte]',
     `${B}&filter[started_at][gte]=${encodeURIComponent(gte)}&filter[started_at][lte]=${encodeURIComponent(lte)}`],
    ['filter[finished_at][gte]/[lte]  (el campo que sí devuelve)',
     `${B}&filter[finished_at][gte]=${encodeURIComponent(gte)}&filter[finished_at][lte]=${encodeURIComponent(lte)}`],
    ['filter[date_range]=last_30_days  (enum, no rango)', `${B}&filter[date_range]=last_30_days`],
    ['filter[date_range]=yesterday', `${B}&filter[date_range]=yesterday`],
  ];

  const salida = [];
  for (const [nombre, url] of intentos) {
    try {
      const res = await doFetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const txt = await res.text();
      let j = null; try { j = JSON.parse(txt); } catch (_) {}
      salida.push({
        forma: nombre,
        http: res.status,
        filas: j && Array.isArray(j.data) ? j.data.length : null,
        // Los NOMBRES de campo de la primera fila: con eso se sabe si trae
        // llamadas y cómo se llaman `from`/`to`/`started_at` en esta versión.
        campos: j && Array.isArray(j.data) && j.data[0] ? Object.keys(j.data[0]) : null,
        tiposVistos: j && Array.isArray(j.data) ? [...new Set(j.data.map(x => x.record_type).filter(Boolean))] : null,
        error: j && j.errors ? String(j.errors[0] && (j.errors[0].detail || j.errors[0].title)).slice(0, 160) : null,
      });
    } catch (e) {
      salida.push({ forma: nombre, error: e.message.slice(0, 160) });
    }
  }
  return { ventana: { desde: gte, hasta: lte }, intentos: salida };
}

module.exports = { cruzar, conciliar, traerDeTelnyx, traerNuestras, sondearTelnyx, _tel };
