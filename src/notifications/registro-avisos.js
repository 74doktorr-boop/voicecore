// ============================================================================
// NodeFlow — REGISTRO DE AVISOS: que el silencio deje de parecerse a la salud
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO
//
// En la config de producción había DOS líneas `NOTIFY_EMAIL` con direcciones
// distintas. Manda la última, así que una de las dos llevaba meses sin recibir
// un solo aviso. Y nadie se enteró — porque no hay forma de enterarse: **un
// buzón callado se parece exactamente a que todo va bien**. La avería sólo se
// descubre el día que algo se rompe, que es justo el día en que el aviso
// hubiera servido de algo.
//
// Es la misma familia que las caídas del 31/07 y que el watchdog que se apagaba
// con lo vigilado: si lo único que te avisaría de un problema es lo que está
// roto, no te vas a enterar nunca. La cura es siempre la misma —dejar rastro y
// que lo mire alguien de fuera— así que aquí va, aplicada al correo.
//
// QUÉ HACE, y por qué cada pieza:
//
//   1. ANOTA cada envío en Redis (a quién, con qué asunto, si salió). En Redis
//      y no en memoria, para que sobreviva al reinicio del proceso.
//
//   2. COMPRUEBA LA ENTREGA de verdad. Que Resend devuelva 200 significa
//      «aceptado», NO «entregado»: un rebote llega minutos después y hasta hoy
//      se perdía en el vacío. `resend.emails.get(id)` da el último evento
//      (delivered / bounced / complained), así que el rastro dice si LLEGÓ.
//
//   3. Y publica un VEREDICTO en /health/avisos que el vigilante externo lee en
//      cada pasada. Incluido el detector que faltaba: cuántos días lleva el
//      canal sin entregar NADA. Para un sistema que manda un informe todas las
//      semanas, un mes de silencio no es paz — es que el canal está muerto.
//
// LO QUE ESTO **NO** ARREGLA, y conviene no engañarse: si una dirección
// simplemente no está en la configuración —el caso del gmail— aquí no salta
// nada, porque no hay nada roto: hay una decisión de config. Contra eso lo que
// vale es poder VER a dónde van los avisos, y para eso está el campo
// `destinatarios` del informe.
// ============================================================================
'use strict';

const { Logger } = require('../utils/logger');
const store = require('../utils/rate-store');

const log = new Logger('AVISOS');

const CLAVE = 'nf:avisos';
const MAXIMO = 300;                       // suficiente para semanas de historia
const DIAS_DE_SILENCIO_SOSPECHOSO = 10;   // el informe es semanal: 10 días ya es raro

/** Anota un intento de envío. Nunca lanza: un fallo al anotar no puede tumbar el aviso. */
async function anotar({ to, subject, ok, id, error }) {
  try {
    await store.pushCapped(CLAVE, {
      t: Date.now(),
      to: Array.isArray(to) ? to : [to],
      s: String(subject || '').slice(0, 80),
      ok: !!ok,
      id: id || null,
      e: error ? String(error).slice(0, 140) : null,
      ev: null,                            // último evento de Resend, se rellena después
    }, MAXIMO);
  } catch (e) {
    log.warn(`no se pudo anotar el aviso: ${e.message}`);
  }
}

async function leer(count = MAXIMO) {
  const crudo = await store.listRange(CLAVE, count);
  const out = [];
  for (const s of crudo) {
    try { out.push(typeof s === 'string' ? JSON.parse(s) : s); } catch (_) { /* una línea rota no tumba el informe */ }
  }
  return out;
}

/**
 * Reescribe la lista entera. Se usa al confirmar entregas: hay que ACTUALIZAR
 * anotaciones ya escritas, y una lista de Redis no deja modificar por posición
 * de forma segura si mientras tanto entran más.
 *
 * Por eso sólo se reescriben las que ya estaban y se dejan intactas las nuevas:
 * se comparan por (t, id), no por posición.
 */
async function _actualizar(cambios) {
  if (!cambios.size) return;
  const actual = await leer();
  const nuevos = actual.map(a => {
    const k = `${a.t}|${a.id}`;
    return cambios.has(k) ? { ...a, ev: cambios.get(k) } : a;
  });
  try {
    await store.reset(CLAVE);
    for (const a of nuevos) await store.pushCapped(CLAVE, a, MAXIMO);
  } catch (e) {
    log.warn(`no se pudo actualizar el registro de avisos: ${e.message}`);
  }
}

/**
 * Pregunta a Resend qué pasó de verdad con los envíos recientes que aún no
 * tienen veredicto. Aquí es donde «aceptado» se convierte en «entregado» — o en
 * «rebotado», que es lo que había que poder ver.
 *
 * @param {{resend?:object, ahora?:number}} deps
 */
async function confirmarEntregas(deps = {}) {
  const resend = deps.resend || (() => { try { return require('./email').getResend(); } catch (_) { return null; } })();
  if (!resend || !resend.emails || typeof resend.emails.get !== 'function') return { revisados: 0 };

  const ahora = deps.ahora || Date.now();
  // Sólo los que salieron bien, tienen id, no tienen veredicto y llevan al menos
  // un minuto: preguntar antes de eso devuelve siempre "sent" y no dice nada.
  const pendientes = (await leer()).filter(a =>
    a.ok && a.id && !a.ev && ahora - a.t > 60_000 && ahora - a.t < 7 * 24 * 3600_000);

  const cambios = new Map();
  for (const a of pendientes.slice(-40)) {          // techo: no castigar la API
    try {
      const r = await resend.emails.get(a.id);
      const ev = (r && (r.data?.last_event || r.last_event)) || null;
      if (ev) cambios.set(`${a.t}|${a.id}`, ev);
    } catch (e) {
      log.warn(`no se pudo consultar el estado de ${a.id}: ${e.message}`);
    }
  }
  await _actualizar(cambios);
  if (cambios.size) {
    const malos = [...cambios.values()].filter(v => v !== 'delivered' && v !== 'sent').length;
    log.info(`Entregas confirmadas: ${cambios.size}${malos ? ` · ${malos} NO entregado(s)` : ''}`);
  }
  return { revisados: cambios.size };
}

/**
 * Analiza el registro y escribe el veredicto. Función pura: se testea sin Redis.
 * @param {Array} avisos
 * @param {{ahora?:number, destinatarios?:string[]}} opts
 */
function analizar(avisos, opts = {}) {
  const ahora = opts.ahora || Date.now();
  const l = (Array.isArray(avisos) ? avisos : []).filter(a => a && typeof a.t === 'number');
  l.sort((a, b) => a.t - b.t);

  const fallos = l.filter(a => !a.ok);
  // Rebotado / marcado como spam: salió, pero NO llegó. Sin esto, un 200 de
  // Resend se leía como «avisado» y la dirección podía estar muerta.
  const noEntregados = l.filter(a => a.ev && !['delivered', 'sent', 'delivered_delayed'].includes(a.ev));
  const entregados = l.filter(a => a.ev === 'delivered');

  const ultimoIntento = l.length ? l[l.length - 1] : null;
  const ultimoOk = [...l].reverse().find(a => a.ok) || null;
  const ultimaEntrega = entregados.length ? entregados[entregados.length - 1] : null;

  const dias = (t) => Math.floor((ahora - t) / 86400_000);
  // OJO con esta distinción, que me la salté en la primera versión y salió en la
  // prueba real: «no hay ninguna entrega confirmada» NO es «hace 0 días de la
  // última». Aquel cálculo caía al primer registro cuando no había ninguna
  // entrega, y el resumen decía «el canal funciona: última entrega confirmada
  // hace 0 día(s)» con CERO entregadas. O sea, el mismo silencio-que-parece-
  // salud que vengo a matar, metido dentro del arreglo.
  //
  // Hay TRES estados y hay que separarlos, porque confundirlos es o mentir o
  // dar una falsa alarma:
  //   · confirmada hace poco      → funciona
  //   · sin confirmar todavía     → pendiente; no es un fallo (Resend tarda ~1 min)
  //   · sin ninguna en X días     → el canal está muerto
  const diasSinEntregar = ultimaEntrega ? dias(ultimaEntrega.t) : null;
  const diasDesdeElPrimerIntento = l.length ? dias(l[0].t) : null;
  const sinConfirmarTodavia = !ultimaEntrega && l.length > 0;

  const problemas = [];
  if (fallos.length) problemas.push(`${fallos.length} envío(s) fallaron`);
  if (noEntregados.length) {
    problemas.push(`${noEntregados.length} NO llegaron (${[...new Set(noEntregados.map(a => a.ev))].join(', ')})`);
  }
  // El detector que faltaba. El informe sale todas las semanas: si el canal
  // lleva más de diez días sin entregar nada, no es que no haya noticias — es
  // que no hay canal.
  //
  // Lo que este umbral da por supuesto, escrito para que se pueda discutir: que
  // el sistema manda ALGO cada semana. Hoy es verdad —el informe semanal sale
  // los lunes a las 08:00 a cada negocio— pero si algún día no quedara ningún
  // negocio activo, esto saltaría sin que el canal estuviera roto. Aun así se
  // deja: que un producto cuyo trabajo es avisar a gente pase diez días sin
  // mandar un solo correo es algo que hay que mirar, se llame como se llame.
  // Se mide contra la última entrega CONFIRMADA; y si nunca hubo ninguna, contra
  // el primer intento anotado — porque un canal que lleva semanas intentándolo
  // sin que se confirme una sola entrega está tan roto como uno que no manda.
  const referencia = diasSinEntregar != null ? diasSinEntregar : diasDesdeElPrimerIntento;
  const calladoDemasiado = referencia != null && referencia >= DIAS_DE_SILENCIO_SOSPECHOSO;
  if (calladoDemasiado) {
    problemas.push(ultimaEntrega
      ? `${referencia} días sin entregar NADA`
      : `${referencia} días de envíos SIN UNA SOLA entrega confirmada`);
  }

  return {
    // A dónde van HOY los avisos. Esto es lo que había que poder mirar: la
    // avería del gmail no era un fallo, era no saber que no estaba en la lista.
    destinatarios: opts.destinatarios || [],
    anotados: l.length,
    entregados: entregados.length,
    fallos: fallos.length,
    noEntregados: noEntregados.slice(-10).map(a => ({
      cuando: new Date(a.t).toISOString(), a: a.to, asunto: a.s, estado: a.ev,
    })),
    ultimosFallos: fallos.slice(-5).map(a => ({
      cuando: new Date(a.t).toISOString(), a: a.to, asunto: a.s, error: a.e,
    })),
    ultimoIntento: ultimoIntento ? new Date(ultimoIntento.t).toISOString() : null,
    ultimoEnviado: ultimoOk ? new Date(ultimoOk.t).toISOString() : null,
    ultimaEntregaConfirmada: ultimaEntrega ? new Date(ultimaEntrega.t).toISOString() : null,
    diasSinEntregar,
    sinConfirmarTodavia,
    sano: problemas.length === 0 && l.length > 0,
    resumen: !l.length
      ? 'no hay ni un aviso anotado — o no se ha mandado nada todavía, o el registro no está funcionando'
      : problemas.length
        ? problemas.join(' · ')
        : sinConfirmarTodavia
          // Ni «funciona» ni «roto»: pendiente. Resend tarda cerca de un minuto
          // en dar veredicto, y llamarlo fallo en esa ventana sería una falsa
          // alarma; llamarlo éxito sería la mentira de siempre.
          ? `${l.length} aviso(s) enviados, ninguna entrega confirmada TODAVÍA (Resend tarda ~1 min en decirlo)`
          : `el canal de avisos funciona: última entrega confirmada hace ${diasSinEntregar} día(s)`,
  };
}

/** Informe listo para /health/avisos. */
async function informe(opts = {}) {
  const dest = (() => {
    try { return require('./email').destinatarios(process.env.NOTIFY_EMAIL || ''); } catch (_) { return []; }
  })();
  const a = analizar(await leer(), { ...opts, destinatarios: dest });
  return {
    ...a,
    persistente: store.isRedisEnabled(),
    aviso: store.isRedisEnabled() ? null
      : 'SIN REDIS: el registro vive en memoria y se pierde en cada reinicio, así que no puede demostrar nada sobre el pasado.',
  };
}

/**
 * El mismo informe, pero con los destinatarios ENMASCARADOS: es lo que se
 * publica sin autenticar.
 *
 * Hasta el 02/08 este endpoint daba las direcciones enteras a quien preguntara.
 * No se borran del todo a propósito: el fallo que motivó todo esto fue tener DOS
 * líneas NOTIFY_EMAIL distintas, y sin ver el dominio «los avisos llegan» y «los
 * avisos llegan al buzón equivocado» volverían a parecerse.
 */
async function informePublico(opts = {}) {
  const { correo } = require('../monitoring/sin-identidades');
  const i = await informe(opts);
  return { ...i, destinatarios: (i.destinatarios || []).map(correo).filter(Boolean) };
}

// ── Cron: confirmar entregas cada 10 min ────────────────────────────────────
// Va aparte del envío a propósito. Preguntar a Resend justo después de mandar
// devuelve siempre «sent» y no dice nada: el rebote tarda. Y bloquear el envío
// esperando el veredicto sería pagar latencia en el camino que importa por un
// dato que puede llegar tarde sin problema.
let _timer = null;
function arrancarConfirmacion() {
  if (_timer) return;
  _timer = setInterval(() => {
    // Sólo el líder: con varias réplicas, todas preguntando lo mismo a Resend
    // es gastar cuota para escribir el mismo resultado N veces.
    try { if (!require('../utils/leader').isLeader()) return; } catch (_) { return; }
    confirmarEntregas().catch(e => log.warn(`confirmarEntregas: ${e.message}`));
  }, 10 * 60 * 1000);
  _timer.unref?.();
  log.info('Confirmación de entregas cada 10 min');
}
function pararConfirmacion() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = {
  anotar, leer, analizar, informe, informePublico, confirmarEntregas,
  arrancarConfirmacion, pararConfirmacion,
  CLAVE, DIAS_DE_SILENCIO_SOSPECHOSO,
};
