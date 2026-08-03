// ============================================================================
// NodeFlow — SALUD DE LA CONVERSACIÓN: ¿se repite el asistente?
// ----------------------------------------------------------------------------
// El 03/08 se midió a mano que el 18% de las preguntas del asistente eran una
// que ya había hecho, se pusieron dos arreglos —el tope de insistencia y el
// reintento del turno vacío— y se simuló una mejora del 27%.
//
// Simulada. Sobre conversaciones que ya habían ocurrido, donde callar un remate
// no cambia lo que el cliente responde después. El número de verdad solo lo
// dirán las llamadas nuevas.
//
// Y ahí estaba el hueco: para saberlo hacía falta que alguien —yo— volviera a
// ejecutar un script a mano. Eso no es una medida, es una anécdota que se repite
// si te acuerdas. Es exactamente el patrón que llevamos toda la semana cerrando:
// construir algo y dejar sin instrumento la pregunta de si funciona.
//
// Así que la medida pasa a ser un endpoint, con la misma regla de ayer: PÚBLICO
// PERO SIN IDENTIDADES. Aquí no sale ni un nombre de cliente, ni un teléfono, ni
// una frase de ninguna conversación — solo recuentos. Ni siquiera las preguntas
// sin clasificar, que son texto literal del asistente: se cuentan juntas.
// ============================================================================
'use strict';

const { analizarLlamada, resumir } = require('./preguntas-repetidas');

const DIAS = 14;

/**
 * Por debajo de esto, el porcentaje no significa nada.
 *
 * Con 6 llamadas, una sola conversación mueve la cifra quince puntos. Y como
 * el informe enseña al lado la referencia del 03/08 (18%), un 12% sacado de 6
 * llamadas invita a cantar victoria: la comparación PARECE una mejora y es
 * ruido. El instrumento tiene que decir cuándo no puede concluir — si no, el
 * primer día que alguien lo mire sacará la conclusión que le apetezca.
 */
const MINIMO_PARA_COMPARAR = 25;

/**
 * Quita del ranking cualquier cosa que sea texto literal.
 *
 * Las intenciones reconocidas son etiquetas nuestras («ofrecer-cita») y se
 * pueden publicar. Las que no se reconocen se guardan como
 * `sin-clasificar:<la frase entera>`, que es texto real dicho en una llamada:
 * eso no sale de aquí. Se agregan en una sola línea con su total.
 */
function _sinTexto(ranking) {
  const limpio = [];
  let sinClasificar = 0;
  for (const r of ranking || []) {
    if (String(r.intencion).startsWith('sin-clasificar:')) sinClasificar += r.repeticiones;
    else limpio.push(r);
  }
  if (sinClasificar) limpio.push({ intencion: '(sin clasificar)', repeticiones: sinClasificar });
  return limpio;
}

/** Informe de los últimos DIAS días. Sin identidades. */
async function informe(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const dias = deps.dias || DIAS;
  const vacio = {
    dias, llamadas: 0,
    resumen: 'no hay llamadas con transcripción en esta ventana: nada que medir',
  };
  if (!db.enabled) return vacio;

  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString();
  const { data } = await db.client.from('nf_calls')
    .select('transcript, metrics, started_at').gte('started_at', desde);

  const llamadas = (data || []).filter(c => Array.isArray(c.transcript) && c.transcript.length);
  if (!llamadas.length) return vacio;

  const r = resumir(llamadas.map(c => analizarLlamada(c.transcript)));

  // Los contadores que dejan los dos arreglos, para saber si están ACTUANDO.
  // Un tope que nunca se dispara y uno que se dispara siempre se ven igual en el
  // porcentaje final; estos números distinguen los dos casos.
  let rematesCallados = 0, reintentos = 0, reintentosConExito = 0, recoveries = 0;
  for (const c of llamadas) {
    const m = c.metrics || {};
    rematesCallados += m.rematesCallados || 0;
    reintentos += m.reintentos || 0;
    reintentosConExito += m.reintentosConExito || 0;
    recoveries += m.recoveries || 0;
  }

  return {
    dias,
    llamadas: r.llamadas,
    conRepeticiones: r.conRepeticiones,
    porcentajeConRepeticiones: r.porcentajeConRepeticiones,
    preguntasTotales: r.preguntasTotales,
    repeticionesTotales: r.repeticionesTotales,
    porcentajeDePreguntasRepetidas: r.porcentajeDePreguntasRepetidas,
    ranking: _sinTexto(r.ranking),
    arreglos: { rematesCallados, reintentos, reintentosConExito, recoveries },
    // La referencia contra la que compararse. Medida a mano el 03/08 sobre las
    // 54 llamadas que había entonces, con este mismo medidor.
    referencia: { fecha: '2026-08-03', llamadas: 54, porcentajeDePreguntasRepetidas: 18 },
    // Y el aviso, que es lo que impide sacar conclusiones de humo.
    comparable: r.llamadas >= MINIMO_PARA_COMPARAR,
    resumen: r.llamadas >= MINIMO_PARA_COMPARAR
      ? r.resumen
      : `${r.resumen}. MUESTRA INSUFICIENTE (${r.llamadas} llamadas, hacen falta `
        + `${MINIMO_PARA_COMPARAR}): este porcentaje NO se puede comparar con la referencia todavía`,
  };
}

module.exports = { informe, _sinTexto, DIAS, MINIMO_PARA_COMPARAR };
