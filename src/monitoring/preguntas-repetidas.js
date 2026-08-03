// ============================================================================
// NodeFlow — ¿CUÁNTO SE REPITE EL ASISTENTE?
// ----------------------------------------------------------------------------
// La queja número uno del motor de mejoras, con diferencia: 22 observaciones
// repartidas en cinco reglas distintas, todas diciendo lo mismo —«evitar
// repetir preguntas ya respondidas»—.
//
// Esas reglas se rechazaron a propósito el 03/08. Aprobarlas habría metido en
// el prompt una frase pidiéndole al modelo por favor que no se repita, y eso
// tiene dos problemas: no se puede medir si funcionó, y el charter es explícito
// en que las reglas de negocio van fuera del LLM.
//
// Así que primero se mide. Esto no arregla nada: cuenta.
//
// QUÉ CUENTA, Y POR QUÉ ASÍ
//
// Leyendo las conversaciones reales, lo que pasa no es exactamente lo que decía
// la queja. El asistente no vuelve a pedir un dato que ya tiene: **remata cada
// respuesta con el mismo cierre**. En una llamada del 12/07, al cliente le
// preguntaron si quería agendar SIETE veces, en siete formulaciones distintas:
//
//   «¿Te gustaría agendar una cita?»
//   «¿Te gustaría fijar una cita?»
//   «¿Te gustaría agendar la primera consulta gratuita?»
//   «¿Te gustaría reservar la primera consulta?»
//   …
//
// Contar texto repetido literal no vería NINGUNA de esas: son siete frases
// diferentes. Por eso se clasifica por INTENCIÓN —qué está pidiendo— con
// reglas deterministas, y se cuenta cuántas veces se pide lo mismo.
//
// Es una heurística, y conviene decirlo: clasifica por palabras, no entiende.
// Está calibrada contra dos conversaciones leídas a mano (ver el test), y su
// trabajo es dar un NÚMERO ANTES de tocar nada, para que después se pueda saber
// si el arreglo sirvió de algo. Sin esta medida, «ahora se repite menos» sería
// una opinión.
// ============================================================================
'use strict';

/** Normaliza para comparar: sin acentos, sin signos, sin dobles espacios. */
function _norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Intenciones. El orden IMPORTA: gana la primera que case, y van de la más
 * específica a la más general para que «¿me dice su nombre para la cita?» se
 * cuente como pedir el nombre y no como ofrecer cita.
 */
const INTENCIONES = [
  ['pedir-nombre',      /\b(su|tu) nombre\b|\bcomo se llama\b|\bme dice.{0,12}nombre\b/],
  ['pedir-telefono',    /\beste numero\b|\bnumero de (telefono|contacto)\b|\ble aviso a este\b/],
  ['pedir-fecha-hora',  /\bque (dia|hora)\b|\bcuando\b|\bprefiere.{0,25}(semana|hora|manana|tarde)\b|\bviene mejor\b|\bva mejor\b|\bcual le va\b/],
  ['pedir-servicio',    /\bque servicio\b|\bpara que servicio\b|\bque tratamiento\b/],
  ['confirmar-entendido', /\bes correcto\b|\bcorrecto\b|\bconfirmar? si\b|\bme lo puede repetir\b|\bhe entendido\b|\bde haberle entendido\b/],
  ['ofrecer-cita',      /\bagendar\b|\breservar\b|\bfijar (una )?cita\b|\bponer una cita\b|\bquiere.{0,15}cita\b|\bgustaria.{0,25}cita\b|\bcita\b/],
  ['ofrecer-mas-ayuda', /\balgo mas\b|\balgo mais\b|\bayude en algo\b|\bayudarle en algo\b|\ben que.{0,10}ayud/],
];

/** Qué pide esta frase. `null` si no es una pregunta reconocible. */
function intencion(frase) {
  const t = _norm(frase);
  if (!t) return null;
  for (const [nombre, re] of INTENCIONES) if (re.test(t)) return nombre;
  // Sin clasificar NO es una intención, es «no lo sé». Meterlas todas en un
  // mismo cubo llamado 'otra' hacía que dos preguntas COMPLETAMENTE DISTINTAS
  // contaran como una repetición: la primera medida salió con 58 repeticiones
  // fantasma por esto, más de la mitad del total. Un medidor más laxo que la
  // realidad no mide, abulta.
  //
  // Así que a las que no se reconocen se les exige coincidencia literal (ya
  // normalizada). Es conservador a propósito: prefiero quedarme corto que
  // presentar un número inflado como línea de partida de una mejora.
  return `sin-clasificar:${t}`;
}

/** Las preguntas de un turno del asistente (frases que acaban en '?'). */
function preguntasDe(texto) {
  const s = String(texto || '');
  // Se parte por interrogación de cierre, conservando la frase entera anterior.
  // El castellano abre con '¿' pero las transcripciones no siempre lo traen.
  return s.split(/(?<=\?)/).map(x => x.trim()).filter(x => x.endsWith('?'));
}

/**
 * Analiza UNA conversación. Puro: entra transcripción, sale recuento.
 * @param {Array<{role:string, content:string}>} transcripcion
 */
function analizarLlamada(transcripcion) {
  const t = Array.isArray(transcripcion) ? transcripcion : [];
  const veces = new Map();          // intención → nº de veces pedida
  let preguntas = 0;

  for (const turno of t) {
    if (!turno || turno.role !== 'assistant') continue;
    for (const p of preguntasDe(turno.content)) {
      const i = intencion(p);
      if (!i) continue;
      preguntas++;
      veces.set(i, (veces.get(i) || 0) + 1);
    }
  }

  // Una repetición es cada vez de MÁS a partir de la primera. Preguntar dos
  // veces cuenta una repetición, no dos: la primera es legítima.
  const repetidas = [];
  let total = 0;
  for (const [i, n] of veces) {
    if (n >= 2) { repetidas.push({ intencion: i, veces: n }); total += n - 1; }
  }
  repetidas.sort((a, b) => b.veces - a.veces);

  return {
    turnosAsistente: t.filter(x => x && x.role === 'assistant').length,
    preguntas,
    repeticiones: total,
    repetidas,
    peor: repetidas.length ? repetidas[0] : null,
  };
}

/** Resume un conjunto de llamadas. Puro. */
function resumir(analisis) {
  const a = (Array.isArray(analisis) ? analisis : []).filter(x => x && x.preguntas > 0);
  if (!a.length) {
    return { llamadas: 0, resumen: 'no hay ninguna llamada con preguntas que medir' };
  }
  const conRepe = a.filter(x => x.repeticiones > 0);
  const totalPreg = a.reduce((s, x) => s + x.preguntas, 0);
  const totalRepe = a.reduce((s, x) => s + x.repeticiones, 0);

  const porIntencion = new Map();
  for (const x of a) for (const r of x.repetidas) {
    porIntencion.set(r.intencion, (porIntencion.get(r.intencion) || 0) + (r.veces - 1));
  }
  const ranking = [...porIntencion.entries()]
    .map(([intencion, repeticiones]) => ({ intencion, repeticiones }))
    .sort((x, y) => y.repeticiones - x.repeticiones);

  const pct = Math.round((conRepe.length / a.length) * 100);
  return {
    llamadas: a.length,
    conRepeticiones: conRepe.length,
    porcentajeConRepeticiones: pct,
    preguntasTotales: totalPreg,
    repeticionesTotales: totalRepe,
    // De cada 100 preguntas del asistente, cuántas eran una que ya había hecho.
    porcentajeDePreguntasRepetidas: Math.round((totalRepe / totalPreg) * 100),
    ranking,
    peorLlamada: a.reduce((m, x) => (x.repeticiones > (m ? m.repeticiones : -1) ? x : m), null),
    resumen: `${conRepe.length} de ${a.length} llamadas (${pct}%) repiten alguna pregunta; `
      + `${totalRepe} repeticiones sobre ${totalPreg} preguntas`,
  };
}

module.exports = { analizarLlamada, resumir, intencion, preguntasDe, _norm, INTENCIONES };
