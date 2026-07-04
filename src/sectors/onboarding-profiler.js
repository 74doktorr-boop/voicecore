// ============================================================
// NodeFlow — Perfilado de alta (onboarding self-serve, 2026-07-04)
// ------------------------------------------------------------
// El cliente describe su negocio en una frase y el sistema DEDUCE su
// sector y el modo de asistente por defecto — sin desplegables ni
// configuración manual. Si encaja con un sector conocido (semilla o
// custom aprobado), se asigna al instante; si no, se propone un
// borrador para que el fundador lo apruebe (mismo carril), y mientras
// el negocio arranca con 'generico' (que funciona).
//
// Determinista primero (coincidencia por etiqueta/alias, sin coste ni
// red), LLM solo si hace falta desambiguar. Nunca lanza.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('ONBOARD-PROFILE');
const { allSectors, resolveSector, defaultModeFor } = require('./sector-registry');
const { draftSector } = require('./sector-drafter');

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

function _norm(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

/** Coincidencia por etiqueta/slug/alias dentro del texto (sin LLM). */
function _deterministicMatch(text) {
  const hay = _norm(text);
  for (const s of allSectors()) {
    if (s.slug === 'generico') continue;
    const cand = [s.slug, s.label, ...(s.aliases || [])];
    for (const c of cand) {
      const token = _norm(c).trim();
      if (token.length >= 4 && hay.includes(' ' + token + ' ')) return s.slug;
    }
  }
  return null;
}

/** Clasifica el negocio en uno de los sectores conocidos vía LLM, o 'none'. */
async function _llmClassify(desc, openai) {
  const list = allSectors().filter(s => s.slug !== 'generico');
  const menu = list.map(s => `${s.slug}: ${s.label}`).join('\n');
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 30,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Clasifica un negocio en UNO de estos sectores (devuelve su slug), o "none" si ninguno encaja bien. Responde SOLO JSON: {"sector":"<slug|none>"}.\nSECTORES:\n${menu}` },
      { role: 'user', content: `NEGOCIO: ${desc}` },
    ],
  });
  const slug = (JSON.parse(resp.choices[0].message.content).sector || '').trim();
  return slug && slug !== 'none' && list.some(s => s.slug === slug) ? slug : null;
}

/**
 * Perfila un negocio a partir de su nombre/descripción.
 * @returns {Promise<{sector, sectorLabel, mode, matched, suggested?}>}
 *   matched=true → sector conocido asignable. matched=false → generico +
 *   'suggested' con un borrador de sector nuevo (pendiente de aprobación).
 */
async function profileBusiness({ name, description } = {}, deps = {}) {
  const desc = [name, description].filter(Boolean).join(' — ').trim();
  const generico = { sector: 'generico', sectorLabel: 'Genérico', mode: 'contacto', matched: false };
  if (!desc) return generico;

  try {
    let slug = _deterministicMatch(desc);
    const openai = deps.openai !== undefined ? deps.openai : getOpenAI();
    if (!slug && openai) slug = await _llmClassify(desc, openai);

    if (slug) {
      const s = resolveSector(slug);
      return { sector: s.slug, sectorLabel: s.label, mode: defaultModeFor(s.slug), matched: true };
    }

    // Ningún sector encaja → proponer un borrador (no se aplica sin aprobación).
    // Sin 'label': el slug lo pone la ETIQUETA que proponga el LLM (el sector),
    // no el nombre del negocio.
    const draft = openai ? await draftSector({ description: desc }, { openai }) : null;
    if (draft) {
      log.info(`Alta sin sector conocido — borrador propuesto: ${draft.slug}`);
      return { ...generico, suggested: { slug: draft.slug, label: draft.label, draft } };
    }
    return generico;
  } catch (e) {
    log.warn(`profileBusiness("${desc}") falló: ${e.message}`);
    return generico;
  }
}

module.exports = { profileBusiness, _deterministicMatch };
