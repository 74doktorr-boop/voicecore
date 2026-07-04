// ============================================================
// NodeFlow — Auto-borrador de sectores (2026-07-04)
// ------------------------------------------------------------
// Escalar a CUALQUIER vertical sin programar uno a uno: cuando entra
// un negocio de un sector no cubierto, un LLM propone sus normas de
// comportamiento + métricas + alias a partir de su descripción, en el
// MISMO estilo que los 32 curados. El fundador lo aprueba UNA vez
// (mismo carril que las reglas candidatas) y `upsertSector` lo guarda
// como dato — sirve para todos los negocios de ese vertical, sin deploy.
//
// El borrador NUNCA se usa a ciegas: pasa por normalizeSectorDef (valida
// forma) y por la aprobación humana antes de tocar producción.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('SECTOR-DRAFT');
const { normalizeSectorDef } = require('./sector-registry');

let _openai = null;
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_openai) _openai = new (require('openai').OpenAI)({ apiKey });
  return _openai;
}

const DRAFT_PROMPT = `Eres un diseñador de asistentes telefónicos para negocios locales españoles. Te dan un TIPO DE NEGOCIO y devuelves ÚNICAMENTE un JSON con la configuración de ese sector para su recepcionista de IA. Formato EXACTO:
{
  "label": "nombre corto y claro del sector (p.ej. 'Floristería')",
  "aliases": ["sinónimos o variantes en minúsculas, sin tildes"],
  "norms": ["3-4 reglas de COMPORTAMIENTO para el recepcionista telefónico de ESE negocio: qué datos pedir siempre, cómo priorizar urgencias, qué NO hacer"],
  "metricChecks": [{"key":"slug_corto","label":"¿pregunta que verifica si lo hizo bien?"}]
}
REGLAS DE ORO (obligatorias):
- Las normas son concretas y accionables, propias de ESE sector (qué preguntar para agendar/atender bien).
- Si es SALUD (clínica, dentista, fisio, veterinaria, farmacia…): incluye SIEMPRE "nunca dar diagnóstico ni medicación por teléfono" y triaje de urgencias.
- Si es LEGAL o PSICOLOGÍA: incluye confidencialidad y "no asesorar / no hacer terapia por teléfono".
- Si vende servicios a medida (reformas, viajes, inmobiliaria…): "no cerrar precios por teléfono, registrar el lead / encaminar a visita".
- 2-3 metricChecks, cada uno con key en minúsculas_con_guiones y una pregunta de sí/no que un auditor pueda responder.
- Nada de emojis. Español de España.`;

/**
 * Propone (NO guarda) un sector nuevo a partir de una descripción de negocio.
 * @param {{label?:string, description?:string}} input
 * @returns {Promise<object|null>} def normalizada lista para revisar/aprobar, o null
 */
async function draftSector({ label, description } = {}, deps = {}) {
  const openai = deps.openai !== undefined ? deps.openai : getOpenAI();
  const desc = [label, description].filter(Boolean).join(' — ').trim();
  if (!openai || !desc) return null;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DRAFT_PROMPT },
        { role: 'user', content: `TIPO DE NEGOCIO: ${desc}` },
      ],
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const raw = JSON.parse(resp.choices[0].message.content);
    // El slug lo derivamos del label propuesto (o del input) — determinista.
    if (!raw.slug) raw.slug = label || raw.label;
    const def = normalizeSectorDef(raw);
    if (!def) { log.warn(`Borrador de "${desc}" descartado: forma inválida`); return null; }
    log.info(`Borrador de sector "${def.slug}" propuesto (${def.norms.length} normas, ${def.metricChecks.length} métricas)`);
    return def;
  } catch (e) {
    log.warn(`draftSector("${desc}") falló: ${e.message}`);
    return null;
  }
}

module.exports = { draftSector, DRAFT_PROMPT };
