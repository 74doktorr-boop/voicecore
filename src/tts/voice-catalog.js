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

function _readStaticFile() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'voices.json'), 'utf8'));
}

/** Catálogo estático (config/voices.json) normalizado — la AUTORIDAD del selector. */
function staticCatalog() {
  try {
    const j = _readStaticFile();
    return (j.voices || []).map(v => ({
      id: v.id, name: v.name, provider: v.provider || 'static',
      gender: v.gender || null, accent: v.accent || null, age: null,
      useCase: (v.tags || [])[0] || null, description: v.description || '',
      previewUrl: null, category: 'static', labels: v.tags || [],
      tier: v.tier || 'premium',
    }));
  } catch { return []; }
}

/** Tiers de voz (Estándar/Premium/Ultra) con su blurb comercial. */
function getTiers() {
  try { return _readStaticFile().tiers || {}; } catch { return {}; }
}

/**
 * Entrada del catálogo estático por id — para que el asistente sepa QUÉ
 * proveedor y QUÉ voice_id real usar según la voz elegida por el dueño.
 * @returns {{provider:string, providerVoiceId:string, tier:string}|null}
 */
function resolveVoiceEntry(voiceId) {
  if (!voiceId) return null;
  try {
    const v = (_readStaticFile().voices || []).find(x => x.id === voiceId || x.providerVoiceId === voiceId);
    return v ? { provider: v.provider, providerVoiceId: v.providerVoiceId, tier: v.tier || 'premium', gender: v.gender || null } : null;
  } catch { return null; }
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

  // El catálogo ESTÁTICO curado es la autoridad (tiers, proveedores mixtos
  // Azure/ElevenLabs, honestidad verificada). La API de ElevenLabs solo
  // AÑADE las voces clonadas/profesionales de la cuenta (W1: "tu negocio
  // contesta con TU voz") — nunca sustituye al catálogo curado.
  const base = staticCatalog();

  if (apiKey && fetchImpl) {
    try {
      const res = await fetchImpl(`${ELEVEN_BASE}/voices`, { headers: { 'xi-api-key': apiKey } });
      if (res.ok) {
        const data = await res.json();
        const clones = (data.voices || [])
          .filter(v => v.category === 'cloned' || v.category === 'professional')
          .map(normalizeEleven)
          .map(v => ({ ...v, tier: 'premium' }));
        const voices = [...clones, ...base];
        _cache = { at: now, voices };
        if (clones.length) log.info(`Catálogo: ${clones.length} voz/voces clonadas de la cuenta añadidas`);
        return voices;
      }
      log.warn(`ElevenLabs /voices HTTP ${res.status} → catálogo estático solo`);
    } catch (e) {
      log.warn(`ElevenLabs /voices falló (${e.message}) → catálogo estático solo`);
    }
  }

  _cache = { at: now, voices: base };
  return base;
}

function clearCache() { _cache = null; }

/**
 * Filtra el catálogo a las voces cuyo proveedor está REALMENTE activo (tiene
 * key/URL). Sin esto, /api/voices ofrecía p.ej. 6 voces Azure aunque Azure no
 * estuviera configurado; al previsualizarlas todas caían al MISMO fallback y
 * "sonaban igual" (bug real 2026-07-04). Fail-open: si no sabemos qué
 * proveedores hay (Set vacío), no ocultamos nada — mejor de más que un selector
 * vacío por un fallo de cableado.
 * @param {Array} voices
 * @param {Set<string>|string[]} availableProviders  nombres de proveedores con engine listo
 */
function renderableVoices(voices, availableProviders) {
  const list = Array.isArray(voices) ? voices : [];
  const avail = availableProviders instanceof Set
    ? availableProviders
    : new Set(availableProviders || []);
  if (avail.size === 0) return list;
  return list.filter(v => avail.has(v.provider));
}

module.exports = { listVoices, normalizeEleven, staticCatalog, getTiers, resolveVoiceEntry, renderableVoices, clearCache, TTL_MS };
