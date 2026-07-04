// ============================================================
// VoiceCore — Voice mapping (selector → ElevenLabs)
// ------------------------------------------------------------
// El selector del portal/admin guarda NOMBRES de voz de OpenAI
// (nova, shimmer, alloy, echo, onyx) en assistant_config.voice.
// La demo y las llamadas reales usan ElevenLabs (voz premium), que
// necesita un VOICE ID propio. Si le pasamos "nova" como voiceId,
// la API devuelve 400 y caemos a Azure → la demo deja de sonar a
// ElevenLabs. Este módulo traduce cualquier nombre/ID entrante a un
// ID válido de ElevenLabs, con un default seguro (Femenina 1).
// ============================================================

'use strict';

// Los 4 IDs de ElevenLabs en producción (los del selector de demo.html).
const ELEVEN = {
  FEM_1: 'dNjJKg63Fr5AXwIdkATa', // Femenina 1 (default)
  FEM_2: 'kwNLkNjbQHMw9YUFZsHI', // Femenina 2
  MAS_1: 'JngPf0lmRkKhY3qSJz0f', // Masculina 1
  MAS_2: 'uVoJJFOcQglSD16zUGOl', // Masculina 2
};

// Allow-list de IDs nativos de ElevenLabs que pasan tal cual.
const ELEVEN_IDS = new Set(Object.values(ELEVEN));

// Mapa nombre/alias → ID de ElevenLabs (por género/carácter equivalente).
const VOICE_TO_ELEVEN = {
  // Nombres de OpenAI usados por el selector del portal/admin
  nova:    ELEVEN.FEM_1, // Sofía — femenina cálida (recepción)
  shimmer: ELEVEN.FEM_2, // Lucía — femenina suave (clínicas)
  alloy:   ELEVEN.FEM_1, // Elena — femenina joven/versátil
  fable:   ELEVEN.FEM_2,
  echo:    ELEVEN.MAS_1, // Carlos — masculino profesional
  onyx:    ELEVEN.MAS_2, // Pablo — masculino con autoridad
  // IDs del catálogo config/voices.json → voice_id REAL y DISTINTO de
  // ElevenLabs (verificados contra la API 2026-07-03). El mapa anterior
  // colapsaba todo el catálogo a 4 voces: el cliente oía la misma voz
  // con distinto nombre.
  'sofia-es':  ELEVEN.FEM_1,
  'lucia-es':  ELEVEN.FEM_2,
  'carlos-es': ELEVEN.MAS_1,
  'pablo-es':  ELEVEN.MAS_2,
  'elena-es':  'EXAVITQu4vr4xnSDxMaL', // madura, tranquilizadora
  'marta-es':  'FGY2WhTYpPnrIDTdsKH5', // enérgica, cercana
  'carmen-es': 'pFZP5JQG7iQjIQuC4Bku', // aterciopelada, elegante
  'nerea-es':  'Xb7hH8MSUJpSbSDYk0k2', // clara, didáctica
  'andrea-es': 'cgSgspJ2msm6clMCkdW9', // alegre, brillante
  'jorge-es':  'JBFqnCBsd6RMkjVDRZzb', // cálido, narrador
  'daniel-es': 'onwK4e9ZLuTAKqWW03F9', // locutor, estable
  'hugo-es':   'nPczCjzI2devNBz1zQrb', // grave, reconfortante
  // Lote 2026-07-04 (más variedad Premium — IDs premade reales de la cuenta):
  'vera-es':      'SAz9YHcvj6GT2YYXdXww', // relajada, neutral
  'matilde-es':   'XrExE9yKIg1WjnnlVkGX', // profesional, clara
  'belen-es':     'hpp4J3VqNfWAUOO0d1Us', // cálida, luminosa
  'enrique-es':   'cjVigY5qzO86Huf0OWal', // suave, de confianza
  'guillermo-es': 'pqHfZKP75CvOlQylNhV4', // sereno, equilibrado
  'bruno-es':     'bIHbv24MWmeRgasZH58o', // relajado, optimista
  // Alias del catálogo antiguo (orgs que ya los tengan guardados):
  // ahora también suenan DISTINTOS entre sí.
  'marta-studio':    'FGY2WhTYpPnrIDTdsKH5',
  'jorge-studio':    'JBFqnCBsd6RMkjVDRZzb',
  'carmen-journey':  'pFZP5JQG7iQjIQuC4Bku',
  'isabel-cartesia': 'EXAVITQu4vr4xnSDxMaL',
  'andrea-11labs':   'cgSgspJ2msm6clMCkdW9',
};

/**
 * Resuelve un valor de voz entrante (nombre, alias o ID) a un VOICE ID
 * válido de ElevenLabs. Nunca devuelve un valor que rompa la API:
 * lo desconocido cae al default seguro.
 *
 * @param {string} [voice]   Valor del selector (p.ej. 'nova', un ID, …)
 * @returns {string} ID de voz de ElevenLabs
 */
function resolveElevenVoice(voice) {
  const fallback = process.env.ELEVENLABS_VOICE_ID || ELEVEN.FEM_1;
  if (!voice || typeof voice !== 'string') return fallback;

  const v = voice.trim();
  if (ELEVEN_IDS.has(v)) return v;          // ya es uno de nuestros 4 IDs
  if (VOICE_TO_ELEVEN[v]) return VOICE_TO_ELEVEN[v];

  // ¿Parece un ID de ElevenLabs (20 chars alfanuméricos)? Lo respetamos.
  if (/^[A-Za-z0-9]{20}$/.test(v)) return v;

  return fallback;                           // desconocido → default seguro
}

module.exports = { resolveElevenVoice, ELEVEN_VOICES: ELEVEN };
