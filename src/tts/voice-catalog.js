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
    // `language` se expone NORMALIZADO ('es-ES' → 'es'). Faltaba, y por eso la
    // prueba de voz no podía comparar el idioma de la voz con el del asistente
    // — que es justo la comprobación que habría cazado a «Greg», la voz inglesa
    // que estuvo atendiendo el teléfono en castellano. Un dato que está en el
    // fichero pero no sale por la función es un dato que no existe.
    return v ? {
      provider: v.provider,
      providerVoiceId: v.providerVoiceId,
      tier: v.tier || 'premium',
      gender: v.gender || null,
      language: v.language ? String(v.language).split('-')[0].toLowerCase() : null,
    } : null;
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
  // Cartesia/ElevenLabs, honestidad verificada). La API de ElevenLabs solo
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
 * key/URL). Sin esto, /api/voices ofrecía voces cuyo proveedor no
 * estuviera configurado; al previsualizarlas todas caían al MISMO fallback y
 * "sonaban igual" (bug real 2026-07-04). Fail-open: si no sabemos qué
 * proveedores hay (Set vacío), no ocultamos nada — mejor de más que un selector
 * vacío por un fallo de cableado.
 * @param {Array} voices
 * @param {Set<string>|string[]} availableProviders  nombres de proveedores con engine listo
 */
function renderableVoices(voices, availableProviders, tiersOfrecidos) {
  const list = Array.isArray(voices) ? voices : [];
  const avail = availableProviders instanceof Set
    ? availableProviders
    : new Set(availableProviders || []);
  let out = avail.size === 0 ? list : list.filter(v => avail.has(v.provider));

  // Y además: una voz de un nivel que NO se ofrece tampoco se enseña.
  //
  // Es el otro sentido del filtro de niveles, y hace falta para que el bloque
  // `tiers` de config/voices.json funcione como INTERRUPTOR de verdad. Sin esto,
  // el día que alguien vuelva a poner una clave de ElevenLabs reaparecerían las
  // 13 voces premium en el selector —el nivel se retiró el 01/08, no se vende—
  // y al elegir una saltaría el candado de `voiceChangeAllowed`: un selector que
  // ofrece cosas que rechaza al pulsarlas. Mejor no ofrecerlas.
  //
  // Fail-open: sin información de niveles no se oculta nada, igual que arriba.
  // Un selector vacío por un fallo de cableado es peor que uno de más.
  if (tiersOfrecidos && typeof tiersOfrecidos === 'object') {
    const claves = tiersOfrecidos instanceof Set ? tiersOfrecidos : new Set(Object.keys(tiersOfrecidos));
    if (claves.size) out = out.filter(v => claves.has(v.tier || 'premium'));
  }
  return out;
}

/**
 * Tiers que se pueden ANUNCIAR: sólo los que tienen alguna voz que suene.
 *
 * El filtro de voces existe desde julio, pero los tiers salían del fichero sin
 * filtrar, y eso dejó en producción un escaparate con un cartel y nada detrás:
 * el selector ofrecía 6 voces —las 6 de Cartesia, tier «estándar»— y encima un
 * apartado «Premium · +10€/mes · Voces ultra-realistas ElevenLabs» con CERO
 * voces dentro. Las 13 premium eran todas de ElevenLabs, y al quitar su clave
 * (cuenta en plan gratuito, 402 desde siempre, jamás sintetizó una sílaba) se
 * fueron todas a la vez. El cartel se quedó colgado.
 *
 * Es la misma falta que el euskera y el galego, pero en la lista de precios:
 * ofrecer lo que el producto no puede dar. Y con dinero delante, porque el
 * apartado lleva un +10€/mes escrito.
 *
 * Se filtra por INVARIANTE, no tachando «premium» a mano: un tier se anuncia si
 * y sólo si queda alguna voz suya que se pueda sintetizar. Así el día que haya
 * una voz premium de verdad, el apartado vuelve solo, sin que nadie se acuerde
 * de destacharlo — que es justo lo que no pasa con los apaños a mano.
 *
 * @param {object} tiers   getTiers()
 * @param {Array}  voices  las que YA han pasado por renderableVoices()
 */
function offerableTiers(tiers, voices) {
  const t = tiers && typeof tiers === 'object' ? tiers : {};
  const conVoz = new Set((Array.isArray(voices) ? voices : []).map(v => v.tier || 'premium'));
  const out = {};
  for (const [k, v] of Object.entries(t)) if (conVoz.has(k)) out[k] = v;
  return out;
}

module.exports = { listVoices, normalizeEleven, staticCatalog, getTiers, resolveVoiceEntry, renderableVoices, offerableTiers, clearCache, TTL_MS };
