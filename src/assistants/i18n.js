// ============================================================
// NodeFlow — Cortesía del asistente por idioma (es / gl / eu)
// ------------------------------------------------------------
// El asistente saluda, se despide y da el primer mensaje en el
// idioma configurado. El gallego y el euskera reciben su propia
// cortesía nativa; cualquier otro valor cae a español.
//
// En modo BILINGÜE (es+gl / es+eu) el asistente ABRE en la lengua
// propia (gallego/euskera) — es lo acogedor y señala que atiende en
// ese idioma; si el cliente responde en castellano, el LLM cambia
// (lo gobierna el prompt, ver prompt-generator.formatLanguage).
// ============================================================
'use strict';

/** Idioma base para la cortesía: bilingüe → la lengua minoritaria. */
function baseLang(language) {
  const l = String(language || '').toLowerCase();
  if (l.indexOf('gl') !== -1) return 'gl';
  if (l.indexOf('eu') !== -1) return 'eu';
  return 'es';
}

// Saludo por franja horaria (mañana / tarde / noche) e idioma.
const GREETINGS = {
  es: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
  gl: ['Bos días',    'Boas tardes',   'Boas noites'],
  eu: ['Egun on',     'Arratsalde on', 'Gabon'],
};

/** Saludo apropiado a la hora de Madrid (0-23) en el idioma del asistente. */
function timeOfDayGreeting(language, madridHour) {
  const set = GREETINGS[baseLang(language)] || GREETINGS.es;
  if (madridHour >= 6  && madridHour < 14) return set[0];
  if (madridHour >= 14 && madridHour < 21) return set[1];
  return set[2];
}

// Despedidas de cierre automático (lifeguard). reason: 'silence' | 'maxlen'.
const FAREWELLS = {
  es: {
    silence: 'Parece que se ha cortado la línea. Gracias por llamar, ¡hasta pronto!',
    maxlen:  'Vamos a tener que dejarlo aquí. Gracias por llamar, ¡hasta pronto!',
  },
  gl: {
    silence: 'Parece que se cortou a liña. Grazas por chamar, ata pronto!',
    maxlen:  'Imos ter que deixalo aquí. Grazas por chamar, ata pronto!',
  },
  eu: {
    silence: 'Badirudi lineak eten egin duela. Eskerrik asko deitzeagatik, laster arte!',
    maxlen:  'Hemen utzi beharko dugu. Eskerrik asko deitzeagatik, laster arte!',
  },
};

/** Frase de despedida del cierre automático en el idioma del asistente. */
function farewell(language, reason) {
  const set = FAREWELLS[baseLang(language)] || FAREWELLS.es;
  return set[reason] || set.silence;
}

/**
 * Primer mensaje por defecto (si el dueño no lo personalizó), con el token
 * {{GREETING}} que resuelve el saludo horario. En el idioma del asistente.
 */
function defaultFirstMessage(language, businessName) {
  const name = businessName || 'el negocio';
  // TRANSPARENCIA IA (AI Act): quien llama debe saber que habla con una
  // máquina. Los saludos POR DEFECTO se presentan como asistente; si el
  // dueño escribe el suyo es su decisión, pero el default cumple siempre.
  switch (baseLang(language)) {
    case 'gl': return `{{GREETING}}, chamou a ${name}. Son o seu asistente virtual, en que podo axudarlle?`;
    case 'eu': return `{{GREETING}}, ${name}. Zure laguntzaile birtuala naiz, zertan lagundu zaitzaket?`;
    default:   return `{{GREETING}}, ha llamado a ${name}. Soy su asistente virtual, ¿en qué puedo ayudarle?`;
  }
}

module.exports = { baseLang, timeOfDayGreeting, farewell, defaultFirstMessage };
