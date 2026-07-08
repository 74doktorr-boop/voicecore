// ============================================================
// NodeFlow — Brevedad, saludo natural, cierre con gracia y
// criterio de relevancia (funciones PURAS, testeables)
// ------------------------------------------------------------
// Veredicto del fundador sobre una llamada real (75/100): "la IA
// habla demasiado y no le deja respirar al cliente." Suelta
// párrafos de 3 frases, enumera los 7 días de la semana de golpe y
// apila varias preguntas en un turno. Este módulo concentra:
//  1) el bloque de PROMPT que impone respuestas cortas (una idea,
//     una pregunta por turno), prohíbe volcar catálogos/días/precios
//     y define el token [NO_DIRIGIDO] para lo que no va con ella;
//  2) el SALUDO natural determinista (reconoce al cliente por su
//     nombre ANTES de hablar, sin re-saludar a media llamada);
//  3) el CIERRE con gracia ante un "nada"/"no"/"ya está" corto;
//  4) la INTERCEPCIÓN del token de relevancia (jamás se lee en voz).
// Todo determinista por charter: las reglas de negocio no dependen
// de que el LLM se acuerde.
// ============================================================
'use strict';

// Token que el LLM emite (y SOLO eso) cuando la última frase del
// cliente NO va dirigida a la asistente (habla con alguien al lado,
// tele de fondo, ruido transcrito como palabras). El pipeline lo
// intercepta: ni TTS, ni turno del asistente registrado.
const NOT_ADDRESSED_TOKEN = '[NO_DIRIGIDO]';

/**
 * Bloque de PROMPT de brevedad + relevancia. Se antepone al system
 * prompt del asistente vivo (org-assistant). Cabecera => lo primero
 * que el LLM lee, máxima obediencia.
 * @param {boolean} greetedAlready — el cliente ya fue saludado por el
 *   firstMessage: prohíbe re-saludar a media llamada.
 */
function brevityPromptBlock(greetedAlready = true) {
  return [
    'BREVEDAD (REGLA MÁS IMPORTANTE, POR ENCIMA DE TODO LO DEMÁS):',
    '- Respuestas MUY cortas y conversacionales. Como en una charla real por teléfono: una o dos frases, nunca un párrafo.',
    '- UNA sola idea y UNA sola pregunta por turno. Di algo, haz UNA pregunta, y CALLA para que el cliente responda.',
    '- Deja respirar al cliente. Es un diálogo, no un discurso: nunca sueltes monólogos ni listas.',
    '- PROHIBIDO enumerar de golpe todas las opciones, todos los días o todos los precios. Nunca recites listas.',
    '- Para fechas, acota en vez de listar: en lugar de "mañana, el viernes, sábado, domingo, lunes..." di "¿Te viene mejor esta semana o la que viene?" y, según responda, vas cerrando el día y la hora poco a poco.',
    '- Cuando pregunten por servicios o precios, menciona SOLO 2 o 3 relevantes y pregunta cuál le interesa. JAMÁS recites el catálogo entero con todos los precios.',
    '- NUNCA apiles preguntas ("¿esto? ¿lo otro? ¿y esto?"). Una pregunta, y esperas la respuesta antes de la siguiente.',
    '',
    'CRITERIO DE RELEVANCIA (no contestes a lo que no va contigo):',
    `- Si la última frase del cliente NO parece dirigida a ti (habla con otra persona a su lado, se oye la tele o ruido de fondo, comentarios sueltos que no te preguntan nada), responde EXACTAMENTE con el token ${NOT_ADDRESSED_TOKEN} y NADA más. No lo expliques, no añadas nada.`,
    `- Usa ${NOT_ADDRESSED_TOKEN} solo cuando estés razonablemente segura de que no te hablaban a ti. Ante la duda, atiende con normalidad.`,
    greetedAlready
      ? '- Al cliente YA le has saludado al descolgar. NO vuelvas a saludar ni a presentarte a media llamada: ve directa a ayudarle.'
      : '',
    '',
    'CIERRE CON GRACIA:',
    '- Si tras ofrecerle algo el cliente responde un "nada", "no", "no gracias", "ya está" o "eso es todo", entiéndelo como que NO necesita más: despídete con amabilidad ("Perfecto, ¡que tenga muy buen día!"). NUNCA le pidas que lo repita ni le vuelvas a ofrecer nada.',
    '',
  ].filter(l => l !== null).join('\n');
}

// ── Saludo natural ──────────────────────────────────────────
// El firstMessage configurado suele ser "{{GREETING}}, ha llamado a
// {negocio}. Soy su asistente virtual, ¿en qué puedo ayudarle?".
// Si reconocemos al cliente por su número, queremos abrir por su
// nombre SIN perder la identidad del negocio ni la transparencia IA.

// Extrae el nombre del negocio del firstMessage configurado. Patrones
// habituales: "...ha llamado a NEGOCIO. Soy...", "...llamado a NEGOCIO,
// soy...", "NEGOCIO, dígame". Fallback: null (usamos el nombre de la org).
function extractBusinessName(firstMessage) {
  const s = String(firstMessage || '').trim();
  if (!s) return null;
  // "ha llamado a X." / "chamou a X." / "llamado a X,"
  const m = s.match(/llamad[oa]\s+a\s+(.+?)[.,]/i) || s.match(/chamou\s+a\s+(.+?)[.,]/i);
  if (m && m[1]) return m[1].trim();
  return null;
}

/**
 * Saludo personalizado determinista. Si conocemos el nombre del
 * cliente, abre por él manteniendo la identidad del negocio; si no,
 * devuelve el saludo configurado tal cual.
 * PURA: no toca red ni reloj (el {{GREETING}} lo resuelve el pipeline).
 *
 * @param {string} configuredFirst — firstMessage del asistente (con o
 *   sin {{GREETING}}).
 * @param {string} name — nombre del cliente reconocido (o vacío).
 * @param {string} [businessName] — nombre del negocio (fallback si no
 *   se puede extraer del firstMessage).
 * @returns {string} saludo a decir (con {{GREETING}} intacto si venía).
 */
function personalizeGreeting(configuredFirst, name, businessName) {
  const clean = String(name || '').trim();
  if (!clean) return String(configuredFirst || '');
  const biz = extractBusinessName(configuredFirst) || String(businessName || '').trim();
  // Primer nombre solo: "Raúl García" → "Raúl" (más natural al teléfono).
  const firstName = clean.split(/\s+/)[0];
  if (biz) {
    return `¡Hola ${firstName}! Soy la asistente de ${biz}, ¿en qué te ayudo?`;
  }
  return `¡Hola ${firstName}! Soy tu asistente, ¿en qué te ayudo?`;
}

// ── Cierre con gracia ───────────────────────────────────────
// Tras una oferta, si el cliente responde un negativo corto ("nada",
// "no", "ya está", "eso es todo") NO es un fallo de STT: quiere cerrar.
// La escalera de confianza no debe convertir "Nada" en "¿me lo puede
// repetir?" — se trata como cierre de alta confianza.
const SHORT_CLOSER = /^(?:no|no,?\s+gracias|no,?\s+nada(\s+m[aá]s)?|nada(\s+m[aá]s)?|gracias,?\s+nada|ya\s+est[aá]|eso\s+es\s+todo|est[aá]\s+bien(\s+as[ií])?|as[ií]\s+est[aá]\s+bien|ninguno|ninguna|no\s+hace\s+falta|todo\s+bien|listo|vale\s+gracias)\.?$/i;

/**
 * ¿La frase es un cierre corto/negativo educado (no un fallo de STT)?
 * PURA. Se usa para: (a) despedir con gracia y (b) no escalar la
 * escalera de confianza a "¿me lo puede repetir?".
 */
function isShortCloser(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s || s.length > 24) return false; // un cierre real es breve
  return SHORT_CLOSER.test(s);
}

// ── Interceptación del token de relevancia ──────────────────

/** ¿La respuesta del LLM es (o contiene) el token [NO_DIRIGIDO]? PURA. */
function containsNotAddressedToken(text) {
  return String(text || '').includes(NOT_ADDRESSED_TOKEN);
}

/**
 * Elimina el token [NO_DIRIGIDO] de un texto (defensa en profundidad:
 * jamás debe leerse en voz alta ni aunque venga incrustado en una frase).
 * PURA.
 */
function stripNotAddressedToken(text) {
  return String(text || '').split(NOT_ADDRESSED_TOKEN).join('').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  NOT_ADDRESSED_TOKEN,
  brevityPromptBlock,
  extractBusinessName,
  personalizeGreeting,
  isShortCloser,
  containsNotAddressedToken,
  stripNotAddressedToken,
};
