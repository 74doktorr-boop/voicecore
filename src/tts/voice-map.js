// ============================================================
// VoiceCore — Voice mapping (selector → ElevenLabs)
// ------------------------------------------------------------
// El selector guarda el ID de catálogo de la voz (p.ej. 'cristina-es')
// o, en configs antiguas, un nombre de OpenAI ('nova'). La demo y las
// llamadas usan ElevenLabs, que necesita su VOICE ID real. Este módulo
// traduce cualquier entrada a un voice_id válido de ElevenLabs.
//
// FUENTE ÚNICA DE VERDAD (2026-07-04): las voces ElevenLabs viven en
// config/voices.json. Antes había una segunda lista aquí que se
// desincronizaba (causa del bug "misma voz con otro nombre"). Ahora el
// catálogo manda: este módulo solo AÑADE traducción de alias legacy
// (nombres OpenAI y IDs del catálogo antiguo) hacia voces vigentes.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

// Default seguro: Cristina (femenina cálida) — sobreescribible por env.
const DEFAULT_ID = 'dNjJKg63Fr5AXwIdkATa';

// ── Catálogo ElevenLabs como fuente de verdad (memoizado) ─────────────
let _catalog = null; // { byId: {id→pvid}, ids: Set<pvid> }
function _elevenCatalog() {
  if (_catalog) return _catalog;
  const byId = {};
  const ids = new Set();
  try {
    const j = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'config', 'voices.json'), 'utf8'));
    for (const v of (j.voices || [])) {
      if (v.provider === 'elevenlabs' && v.providerVoiceId && v.providerVoiceId !== 'custom') {
        byId[v.id] = v.providerVoiceId;
        ids.add(v.providerVoiceId);
      }
    }
  } catch { /* fail-open: sin catálogo, solo alias + passthrough */ }
  _catalog = { byId, ids };
  return _catalog;
}
function clearCache() { _catalog = null; }

// Alias LEGACY → id de catálogo vigente. Solo para configs antiguas; las
// voces actuales se resuelven por el catálogo de arriba. Se traduce a un id
// de catálogo (no a un voice_id crudo) para no volver a desincronizar.
const LEGACY_ALIAS = {
  // Nombres de OpenAI del selector antiguo → voz vigente por carácter/género
  nova: 'cristina-es', shimmer: 'estela-es', alloy: 'ana-es',
  fable: 'cora-es', echo: 'carlos-es', onyx: 'tony-es',
  // IDs del catálogo retirado (2026-07-04) → equivalente vigente por género
  'sofia-es': 'cristina-es', 'lucia-es': 'laura-es', 'elena-es': 'estela-es',
  'marta-es': 'laura-es', 'carmen-es': 'gabriela-es', 'nerea-es': 'ana-es',
  'andrea-es': 'cora-es', 'pablo-es': 'tony-es', 'jorge-es': 'carlos-es',
  'daniel-es': 'marcos-es', 'hugo-es': 'tony-es', 'vera-es': 'cristina-es',
  'matilde-es': 'estela-es', 'belen-es': 'carolina-es', 'enrique-es': 'alex-es',
  'guillermo-es': 'marcos-es', 'bruno-es': 'alex-es',
  // Alias del catálogo MUY antiguo (studio/journey/11labs) → 5 voces distintas
  'marta-studio': 'laura-es', 'jorge-studio': 'carlos-es',
  'carmen-journey': 'gabriela-es', 'isabel-cartesia': 'estela-es',
  'andrea-11labs': 'cora-es',
};

/**
 * Resuelve un valor de voz entrante (id de catálogo, alias o voice_id) a un
 * VOICE ID válido de ElevenLabs. Lo desconocido cae al default seguro.
 * @param {string} [voice]
 * @returns {string} voice_id de ElevenLabs
 */
function resolveElevenVoice(voice) {
  const fallback = process.env.ELEVENLABS_VOICE_ID || DEFAULT_ID;
  if (!voice || typeof voice !== 'string') return fallback;
  const v = voice.trim();

  const { byId, ids } = _elevenCatalog();
  if (ids.has(v)) return v;                 // ya es un voice_id del catálogo
  if (byId[v]) return byId[v];              // id de catálogo → su voice_id (fuente de verdad)
  if (LEGACY_ALIAS[v] && byId[LEGACY_ALIAS[v]]) return byId[LEGACY_ALIAS[v]]; // alias → id vigente → voice_id
  if (/^[A-Za-z0-9]{20}$/.test(v)) return v; // parece un voice_id de ElevenLabs → respetar
  return fallback;                           // desconocido → default seguro
}

module.exports = { resolveElevenVoice, clearCache, DEFAULT_ELEVEN_ID: DEFAULT_ID };
