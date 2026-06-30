// ============================================================
// NodeFlow — Catálogo dinámico de voces (ElevenLabs)
// ------------------------------------------------------------
// En vez de hardcodear 4 IDs, tira EN DIRECTO del catálogo real de la
// cuenta de ElevenLabs (/v1/voices): premade + las que añadas desde su
// biblioteca. Así "más voces" es automático: añades una voz en ElevenLabs
// y aparece en el selector. Normaliza al formato que consume la UI, cachea
// 10 min y cae al catálogo estático (config/voices.json) si no hay key o la
// API falla. `fetch` y `apiKey` son inyectables → testeable sin red.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { Logger } = require('../utils/logger');
const log = new Logger('VOICE-CATALOG');

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';
const TTL_MS = 10 * 60 * 1000;
let _cache = null; // { at, voices }

/** Voz de ElevenLabs (/v1/voices) → formato UI de NodeFlow. */
function normalizeEleven(v) {
  const L = v.labels || {};
  const labels = Object.values(L).filter(Boolean);
  return {
    id: v.voice_id,
    name: v.name,
    provider: 'elevenlabs',
    gender: (L.gender || '').toLowerCase() || null,
    accent: L.accent || null,
    age: L.age || null,
    useCase: L.use_case || L['use case'] || null,
    description: v.description || L.description || labels.join(' · '),
    previewUrl: v.preview_url || null,
    category: v.category || null, // premade | professional | cloned | generated
    labels,
  };
}

/** Catálogo estático de respaldo (config/voices.json) normalizado. */
function staticCatalog() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'voices.json'), 'utf8'));
    return (j.voices || []).map(v => ({
      id: v.id, name: v.name, provider: v.provider || 'static',
      gender: v.gender || null, accent: v.accent || null, age: null,
      useCase: (v.tags || [])[0] || null, description: v.description || '',
      previewUrl: null, category: 'static', labels: v.tags || [],
    }));
  } catch { return []; }
}

/**
 * Lista las voces disponibles (cacheadas). Orden: profesionales/cloned primero.
 * @param {object} [opts] { apiKey, fetch, force }
 * @returns {Promise<Array>} voces normalizadas
 */
async function listVoices(opts = {}) {
  const now = Date.now();
  if (!opts.force && _cache && now - _cache.at < TTL_MS) return _cache.voices;

  const apiKey = opts.apiKey || process.env.ELEVENLABS_API_KEY;
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);

  if (apiKey && fetchImpl) {
    try {
      const res = await fetchImpl(`${ELEVEN_BASE}/voices`, { headers: { 'xi-api-key': apiKey } });
      if (res.ok) {
        const data = await res.json();
        const rank = (c) => (c === 'cloned' || c === 'professional' ? 0 : c === 'premade' ? 1 : 2);
        const voices = (data.voices || []).map(normalizeEleven)
          .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
        _cache = { at: now, voices };
        log.info(`Catálogo ElevenLabs cargado: ${voices.length} voces`);
        return voices;
      }
      log.warn(`ElevenLabs /voices HTTP ${res.status} → fallback estático`);
    } catch (e) {
      log.warn(`ElevenLabs /voices falló (${e.message}) → fallback estático`);
    }
  } else {
    log.info('Sin ELEVENLABS_API_KEY → catálogo estático');
  }

  const voices = staticCatalog();
  _cache = { at: now, voices };
  return voices;
}

function clearCache() { _cache = null; }

module.exports = { listVoices, normalizeEleven, staticCatalog, clearCache, TTL_MS };
