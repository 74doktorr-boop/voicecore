// ============================================================================
// NodeFlow — NO INSISTIR: tope duro a los cierres de venta
// ----------------------------------------------------------------------------
// Medido el 03/08 sobre 54 llamadas reales: el 18% de las preguntas del
// asistente eran una que ya había hecho, y las dos que más se repetían eran
// **ofrecer cita (17) y ofrecer más ayuda (14)** — 31 de 49 repeticiones. No es
// que olvidara lo que le habían dicho: remataba CADA respuesta con el mismo
// cierre.
//
// El caso que lo retrata, llamada 9d30bfe6 del 12/07:
//
//   cliente: ¿aceptáis seguro de Adeslas o Sanitas?
//   asist.:  Sí, aceptamos… ¿Te gustaría agendar una cita con alguno de ellos?
//   cliente: Espera, antes te sigo preguntando, ¿tenéis parking?
//   asist.:  Sí, tenemos aparcamiento… ¿Te gustaría agendar la primera consulta?
//
// «Espera, antes te sigo preguntando» es un cliente esquivando a un vendedor.
//
// POR QUÉ NO SE ARREGLA EN EL PROMPT
//
// El motor de mejoras propuso cinco reglas para pedirle al modelo que no se
// repita. Se rechazaron: el charter dice que las reglas de negocio van fuera del
// LLM, y una instrucción de prompt no se puede garantizar ni medir — el modelo
// la cumple casi siempre, que es justo lo que hace invisible el fallo restante.
// Un tope que se cuenta con los dedos, sí.
//
// POR QUÉ SE LIMITAN DOS COSAS Y NO UNA
//
// Empezó siendo solo la oferta de cita. Al simular el tope sobre las 54
// llamadas, en cuanto se calla esa el que más se repite pasa a ser «¿le ayudo
// en algo más?». Es el MISMO tic con otra coletilla: limitar solo una habría
// movido el problema de sitio en vez de arreglarlo.
//
// CÓMO
//
//   · DOS cierres no pedidos de cada tipo por llamada. Del tercero en adelante,
//     se calla ese remate.
//   · Si el cliente saca el tema —«quiero una cita», «¿algo más?»— no es
//     insistir: ni se limita ni cuenta. Un tope que impidiera contestar a quien
//     quiere reservar sería peor que el problema.
//   · Callar el remate NO es callar la respuesta: se quita solo esa pregunta y
//     lo que el cliente preguntó se contesta igual.
//   · Y si al quitarla no quedara nada que decir, se dice el texto original:
//     dejar al cliente escuchando silencio es peor que insistir.
//
// La clasificación la hace EL MISMO módulo que mide (`preguntas-repetidas`).
// Es deliberado: si el arreglo y la medida usaran criterios distintos, «ahora se
// repite menos» volvería a ser una opinión.
// ============================================================================
'use strict';

const { intencion, preguntasDe } = require('../monitoring/preguntas-repetidas');

/** Cierres NO pedidos que se toleran por llamada, de cada tipo. */
const MAX_OFERTAS = 2;

/**
 * Los cierres que se limitan y, para cada uno, cómo se reconoce que el tema lo
 * ha sacado el cliente (en cuyo caso responderle no es insistir).
 */
const CIERRES = [
  ['ofrecer-cita', /\b(cita|citas|reserv|agend|hueco|disponib|apunta|coger hora|pedir hora|cuando pod)/],
  ['ofrecer-mas-ayuda', /\b(algo mas|otra cosa|ademas|tambien queria|una cosa mas|una pregunta)/],
];

const _TIPOS = new Set(CIERRES.map(c => c[0]));

function _sinAcentos(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** ¿Ha sacado el cliente ESE tema? */
function _clienteLoPidio(textoCliente, tipo) {
  const t = _sinAcentos(textoCliente);
  const c = CIERRES.find(x => x[0] === tipo);
  return !!c && c[1].test(t);
}

/** Las preguntas del texto que son un cierre, con su tipo. */
function cierresEn(texto) {
  return preguntasDe(texto)
    .map(frase => ({ frase, tipo: intencion(frase) }))
    .filter(x => _TIPOS.has(x.tipo));
}

/** Quita del texto los cierres de los tipos indicados (o todos). */
function quitarCierres(texto, tipos) {
  const s = String(texto || '');
  const soloEstos = tipos ? new Set(tipos) : null;
  const fuera = cierresEn(s).filter(c => !soloEstos || soloEstos.has(c.tipo));
  if (!fuera.length) return s;
  let out = s;
  for (const c of fuera) out = out.replace(c.frase, '');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out || s;      // sin nada que decir, mejor el original que el silencio
}

/**
 * Decide y actualiza el contador. Devuelve el texto que hay que decir.
 *
 * Nunca lanza: ante cualquier duda, habla. Un tope que enmudeciera al asistente
 * sería una avería mucho peor que la que viene a arreglar.
 */
function filtrar(estado, texto, textoCliente) {
  try {
    const e = estado || {};
    const cierres = cierresEn(texto);
    if (!cierres.length) return { texto, callado: false };

    const callar = [];
    for (const c of cierres) {
      if (_clienteLoPidio(textoCliente, c.tipo)) continue;
      if ((e[c.tipo] || 0) >= MAX_OFERTAS) callar.push(c.tipo);
      else e[c.tipo] = (e[c.tipo] || 0) + 1;
    }
    if (!callar.length) return { texto, callado: false };

    const limpio = quitarCierres(texto, callar);
    if (limpio !== texto) e.calladas = (e.calladas || 0) + callar.length;
    return { texto: limpio, callado: limpio !== texto };
  } catch (_) {
    return { texto, callado: false };
  }
}

module.exports = {
  filtrar, cierresEn, quitarCierres, _clienteLoPidio,
  CIERRES, MAX_OFERTAS,
};
