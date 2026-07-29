'use strict';
// ============================================================
// NodeFlow — El aviso de que es una IA no puede depender de la buena voluntad.
//
// POR QUÉ EXISTE (auditoría 2026-07-29):
// En tres sitios distintos afirmamos públicamente que "la IA avisa SIEMPRE de
// que es IA" y que lo hace "por ley". Pero ese aviso vive en
// assistant_config.firstMessage, un campo de texto libre que el cliente edita
// desde el portal SIN NINGUNA validación. Un cliente puede borrar la mención en
// diez segundos, y entonces pasan dos cosas a la vez:
//   · NodeFlow queda afirmando en su web algo que su producto no garantiza;
//   · y el cliente incumple el art. 50 del Reglamento (UE) 2024/1689 (AI Act)
//     con una herramienta que le prometía justo lo contrario.
//
// (De paso: la web decía que quien obliga es el RGPD. No es cierto — es el AI
// Act. Corregido en el copy.)
//
// La solución NO es rechazar el saludo del cliente: eso frustra y se acaba
// evitando. Es garantizar el resultado — si el saludo no menciona que es un
// asistente virtual, se le añade la mención en su idioma. El dueño escribe lo
// que quiera y la obligación se cumple igual.
// ============================================================

// Marcadores que ya cuentan como aviso, por idioma. Deliberadamente amplios:
// se trata de detectar que la mención EXISTE, no de imponer una redacción.
const MARCADORES = [
  // castellano
  'asistente virtual', 'asistente automático', 'asistente automatico',
  'inteligencia artificial', 'soy una ia', 'soy un asistente', 'sistema automático',
  'sistema automatico', 'contestador automático', 'contestador automatico', 'asistente de voz',
  // galego
  'asistente virtual', 'intelixencia artificial',
  // euskera
  'laguntzaile birtual', 'adimen artifizial',
  // inglés (por si algún día)
  'virtual assistant', 'ai assistant', 'automated assistant',
];

const AVISO = {
  es: 'Le atiende un asistente virtual.',
  gl: 'Atendéalle un asistente virtual.',
  eu: 'Laguntzaile birtual batek artatzen zaitu.',
  en: 'You are speaking with a virtual assistant.',
};

const _base = (lang) => String(lang || 'es').toLowerCase().split(/[-+_]/)[0];

/** ¿El texto ya avisa de que quien habla es un asistente virtual? (puro) */
function hasAIDisclosure(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  return MARCADORES.some(m => t.includes(m));
}

/**
 * Devuelve un saludo que SIEMPRE avisa. Si el del cliente ya lo hace, se
 * respeta tal cual (no se toca ni una coma).
 * @param {string} firstMessage  saludo escrito por el negocio
 * @param {string} language      'es' | 'gl' | 'eu' | 'es+gl' | …
 * @returns {string}
 */
function ensureAIDisclosure(firstMessage, language = 'es') {
  const txt = String(firstMessage || '').trim();
  if (!txt) return txt;                       // vacío = "sin opinión", no se inventa nada
  if (hasAIDisclosure(txt)) return txt;
  const aviso = AVISO[_base(language)] || AVISO.es;
  // Se añade al final: el negocio conserva su primera frase, que es la que
  // marca el tono, y el aviso llega igualmente en los primeros segundos.
  const sep = /[.!?…]\s*$/.test(txt) ? ' ' : '. ';
  return `${txt}${sep}${aviso}`;
}

module.exports = { hasAIDisclosure, ensureAIDisclosure, AVISO, MARCADORES };
