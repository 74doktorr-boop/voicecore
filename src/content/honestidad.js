// ============================================================================
// NodeFlow — LO QUE NO SE DICE. Reglas fuera del LLM.
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO
//
// La noche del 31/07 se retiraron de la web 76 datos inventados: clientes que
// no existen «reportando» reducciones del 40%, estudios que nadie puede
// enseñar, y promesas de euskera y de acento gallego que el producto no puede
// cumplir. Al día siguiente, el blog automático publicó esto:
//
//   «una farmacia en el Casco Viejo reportó una reducción del 40%»
//   «una farmacia en Indautxu reportó que el 30%»
//   «¿Sabías que el 60% de las farmacias en Bilbao...?»
//   «...y hasta euskera y galego nativos»
//
// Los mismos patrones exactos, generados de nuevo. Y con motivo: el prompt del
// generador decía, literalmente, «Datos y porcentajes concretos (pueden ser
// estimaciones realistas si no tienes fuente exacta)». O sea que estaba
// PEDIDO. Se limpió la salida y se dejó la fábrica encendida.
//
// La lección es la del charter, y esta vez con nombre y apellidos: **una
// instrucción a un modelo es una petición, no una garantía**. Si algo no se
// puede publicar, la comprobación tiene que ser determinista y estar fuera del
// modelo. Este fichero es esa comprobación, y el generador no escribe un
// fichero sin pasar por aquí.
//
// Los patrones son los MISMOS que vigilan los tests sobre la web publicada. Si
// se relajan aquí, el artículo pasa el filtro y revienta el despliegue después;
// da igual por dónde se intente, la mentira no llega a producción.
// ============================================================================
'use strict';

const REGLAS = [
  {
    id: 'cliente-con-cifra',
    // «una farmacia en el Casco Viejo reportó una reducción del 40%»
    re: /[^.!?<>]{0,180}(han visto|ha visto|report[óo]|reportaron|han reportado|experiment[óo]|vio un incremento|vio un aumento|datos internos|estudios internos|ROI de(l)? \d|caso de éxito es|ejemplo real es)[^.!?<>]{0,200}\d{1,3}\s?%/gi,
    porque: 'atribuye un resultado a un cliente. En producción hay cuatro organizaciones, las cuatro propias, con cuatro llamadas reales en treinta días: no hay clientes de los que sacar ese número.',
  },
  {
    id: 'cliente-sin-cifra',
    // La misma mentira sin porcentaje, que por eso se escapó a la primera pasada.
    //
    // El (?! de un folleto) NO es una excusa: es que la frase que sustituyó a
    // varias de estas dice «...no sobre un caso de éxito de un folleto», o sea
    // justo lo contrario. Sin la excepción, el chivato denunciaba el arreglo — y
    // un chivato que señala su propia corrección se acaba desactivando entero.
    re: /caso[s]? de [ée]xito(?! de un folleto)|que (lo |la )?usan reportan|que (lo |la )?utilizan han visto|tras adoptar NodeFlow|tras implementar NodeFlow/gi,
    porque: 'promete casos de éxito que no se pueden enseñar.',
  },
  {
    id: 'estudio-fantasma',
    re: /(un estudio reciente|según estudios|estudios muestran|estudio de mercado|estudios del sector|según un informe|un estudio de \d{4}|un estudio revela|investigación reciente|estudios demuestran|un análisis de)/gi,
    porque: 'cita un estudio que nadie puede enseñar. Si mañana alguien lo pide, no hay estudio.',
  },
  {
    id: 'cifra-sin-fuente',
    // «¿Sabías que el 60% de las farmacias en Bilbao...?» — el porcentaje
    // reciclado con precisión local inventada. Nadie ha encuestado a las
    // farmacias de Bilbao.
    re: /¿Sabías que[^?]{0,200}\d{1,3}\s?%[^?]{0,200}\?/gi,
    porque: 'abre con un porcentaje que nadie ha medido. O lleva fuente citada, o se convierte en una pregunta concreta sin cifra — que además interpela más.',
  },
  {
    id: 'porcentaje-local-inventado',
    // «el 70% de las peluquerías de Bilbao», «el 45% de las clínicas en Vitoria».
    re: /\b\d{1,3}\s?%\s+de\s+(las?|los)\s+[a-záéíóúñ]+\s+(de|en)\s+(Bilbao|Donostia|San Sebastián|Vitoria|Gasteiz|Andoain|Irún|Barakaldo|Getxo|Pamplona|Iruña|Santander|Logroño)/gi,
    porque: 'inventa una precisión local que no existe. Nadie ha encuestado a ese gremio en esa ciudad.',
  },
  {
    id: 'euskera',
    re: /euskera|euskara|bilingüe (vasco|euskera)|en vasco/gi,
    porque: 'el euskera se retiró del producto el 31/07: el asistente no lo ofrece. (Excepción legítima: ETS Guard, donde SÍ es cierto — pero eso no lo escribe este generador.)',
  },
  {
    id: 'voz-gallega',
    re: /galego nativo|gallego nativo|(?<!non ten )acento galego|acento gallego|voces propias en galego|entoación da nosa terra|suenan a galego de verdad/gi,
    porque: 'NodeFlow atiende en galego, pero lo lee una voz castellana: no tiene acento gallego. Se puede decir que atiende en galego; no que suene gallego.',
  },
  {
    id: 'voz-premium',
    re: /voz premium|voces premium|ultra-?realistas|ElevenLabs/gi,
    porque: 'el nivel Premium se retiró el 01/08: no hay ninguna voz premium que suene.',
  },
  {
    id: 'cupo-viejo',
    re: /\b500\s?min(utos)?\/?\s?(al )?mes\b/gi,
    porque: 'el plan incluye 200 minutos desde el 29/07, no 500.',
  },
];

/**
 * Revisa un texto (o un objeto: se serializa) y devuelve lo que no se puede
 * publicar. Lista vacía = limpio.
 * @param {string|object} contenido
 * @returns {Array<{regla:string, encontrado:string, porque:string}>}
 */
function revisar(contenido) {
  // `JSON.stringify(undefined)` devuelve undefined, no una cadena — y entonces
  // el .replace de abajo revienta. Un validador que se cae con una entrada rara
  // acaba envuelto en un try/catch que se lo traga, y ahí deja de validar.
  const texto = typeof contenido === 'string'
    ? contenido
    : (JSON.stringify(contenido, null, 1) || '');
  // Se mira el texto que LEE una persona: sin etiquetas ni comentarios HTML,
  // porque varios comentarios de este repo explican precisamente estas retiradas
  // y denunciarlos sería denunciar el arreglo.
  const visible = texto
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  const fallos = [];
  for (const r of REGLAS) {
    for (const m of visible.matchAll(r.re)) {
      fallos.push({
        regla: r.id,
        encontrado: m[0].replace(/\s+/g, ' ').trim().slice(0, 120),
        porque: r.porque,
      });
      if (fallos.filter(f => f.regla === r.id).length >= 3) break;  // 3 ejemplos bastan
    }
  }
  return fallos;
}

/** Igual, pero lanza. Para usar donde no publicar es lo correcto. */
function exigirHonestidad(contenido, queEs = 'el contenido') {
  const fallos = revisar(contenido);
  if (!fallos.length) return;
  const detalle = fallos.map(f => `  · [${f.regla}] «${f.encontrado}»\n      ${f.porque}`).join('\n');
  throw new Error(`No se publica ${queEs}: dice cosas que no son ciertas.\n${detalle}`);
}

// ── Excepciones POR PÁGINA, cada una con su motivo ──────────────────────────
// No todas las apariciones son mentiras. El euskera en la página de ETS Guard es
// CIERTO —esa app sí está traducida entera—, la página del 410 explica
// precisamente que retiramos los artículos que lo prometían, y la documentación
// de la API enumera los valores que acepta un parámetro, no promete voces.
//
// Van aquí, con su motivo escrito, y no como un patrón más laxo: aflojar la
// regla dejaría pasar también las mentiras de verdad. Y sin excepciones, el
// barrido del sitio sale con siete avisos de los que cinco son ruido — y un
// informe con más ruido que señal se deja de leer.
const EXCEPCIONES = [
  [/^guard\//, ['euskera'],
   'ETS Guard SÍ está traducida entera al euskera, con tests que lo vigilan. Aquí es un argumento de venta cierto.'],
  [/^blog\/retirado\.html$/, ['euskera', 'voz-gallega'],
   'Es la página del 410: explica que retiramos los artículos que lo prometían.'],
  [/^blog\/ia-voz-para-negocios-espana-tendencias-2026\//, ['euskera'],
   'Análisis del MERCADO, no promesa nuestra: dice que el euskera tiene calidad desigual en el sector.'],
  [/^docs\.html$/, ['voz-premium'],
   'Documentación de la API: enumera los valores que acepta el parámetro ttsProvider. Describe la interfaz, no ofrece voces.'],
  [/^privacidad\//, ['voz-premium'],
   'La política nombra a los encargados del tratamiento. Si algún día se vuelve a usar un proveedor, tiene que poder nombrarse.'],
  [/^admin\//, ['euskera', 'voz-premium', 'voz-gallega'],
   'Panel interno: MUESTRA lo que hay guardado en la base, no lo ofrece.'],
  [/^hementxe\//, null, 'Otra empresa: fuera de todos los barridos de marca de NodeFlow.'],
];

/**
 * Revisa una página del sitio teniendo en cuenta sus excepciones.
 * @param {string} rutaRelativa  p.ej. 'blog/algo/index.html'
 */
function revisarPagina(rutaRelativa, contenido) {
  const ruta = String(rutaRelativa || '').split('\\').join('/');
  for (const [re, reglas] of EXCEPCIONES) {
    if (!re.test(ruta)) continue;
    if (reglas === null) return [];                       // la página entera queda fuera
    return revisar(contenido).filter(f => !reglas.includes(f.regla));
  }
  return revisar(contenido);
}

module.exports = { REGLAS, EXCEPCIONES, revisar, revisarPagina, exigirHonestidad };
