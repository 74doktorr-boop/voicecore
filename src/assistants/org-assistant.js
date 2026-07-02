// ============================================================
// NodeFlow — Puente org → asistente vivo
// ------------------------------------------------------------
// Lo que el cliente configura en el portal vive en Supabase
// (organizations.assistant_config). El flujo de llamada solo
// conocía los asistentes de archivo (assistants/*.json), así que
// TODAS las llamadas de clientes caían al asistente demo (voz y
// prompt equivocados). Este módulo construye el asistente real
// de una org bajo demanda, con cache corto.
// ============================================================
'use strict';

const { getDatabase }    = require('../db/database');
const { generatePrompt } = require('./prompt-generator');
const { Logger }         = require('../utils/logger');

const log = new Logger('ORG-ASSISTANT');

const _cache = new Map();      // orgId → { assistant, at }
const TTL_MS = 60 * 1000;      // cambios del portal visibles en ≤60s (o al instante vía invalidate)

// Set estándar de recepcionista — el mismo que usan los asistentes de archivo.
const RECEPTIONIST_TOOLS = [
  'get_client_memory',
  'check_availability',
  'book_appointment',
  'lookup_appointments',
  'cancel_appointment',
  'flag_urgent',
];

/**
 * Devuelve el asistente vivo de una org, construido desde assistant_config.
 * null si la org no existe, está inactiva o no hay BD.
 */
async function getOrgAssistant(orgId) {
  if (!orgId) return null;
  const hit = _cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.assistant;

  const db = getDatabase();
  if (!db.enabled) return null;

  try {
    const { data: org } = await db.client
      .from('organizations')
      .select('id, name, language, assistant_config, is_active')
      .eq('id', orgId)
      .maybeSingle();
    if (!org || org.is_active === false) return null;

    const cfg      = org.assistant_config || {};
    const language = cfg.language || org.language || 'es';

    const assistant = {
      id:           org.id,
      name:         cfg.assistantName || org.name,
      systemPrompt: generatePrompt(cfg, org.name),
      firstMessage: cfg.firstMessage ||
        `{{GREETING}}, ha llamado a ${org.name}. ¿En qué puedo ayudarle?`,
      voice:        cfg.voice || 'nova',   // voice-map lo traduce a ElevenLabs
      language,
      // SIN model: el router LLM elige el proveedor más rápido disponible
      tools:        RECEPTIONIST_TOOLS,
    };

    _cache.set(orgId, { assistant, at: Date.now() });
    log.info(`Asistente de org construido: ${org.name} (${orgId}) — voz ${assistant.voice}, idioma ${language}`);
    return assistant;
  } catch (e) {
    log.warn(`getOrgAssistant(${orgId}) falló: ${e.message}`);
    return null;
  }
}

/** Invalida el cache de una org (llamar al guardar assistant_config). */
function invalidateOrgAssistant(orgId) {
  _cache.delete(orgId);
}

module.exports = { getOrgAssistant, invalidateOrgAssistant };
