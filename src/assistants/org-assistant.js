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
  'register_lead',
  'end_call',
];

// Modo "contacto" (negocios SIN agenda — asesorías, abogados, el propio
// NodeFlow): informa y toma recados; NO PUEDE ni intentar agendar (las
// herramientas de citas ni existen para él — determinista, no prompt).
const CONTACT_TOOLS = [
  'get_client_memory',
  'flag_urgent',
  'register_lead',
  'end_call',
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
      .select('id, name, language, assistant_config, automation_config, is_active, monthly_minutes_used')
      .eq('id', orgId)
      .maybeSingle();
    if (!org || org.is_active === false) return null;

    const cfg      = org.assistant_config || {};
    const language = cfg.language || org.language || 'es';

    // Cupo de voz Premium/Ultra (2026-07-04): el plan básico incluye pocos
    // minutos de voz cara; superado el cupo, se degrada a Azure (protege el
    // margen). El add-on voice_premium y los minutos extra comprados lo suben.
    const { hasAddon } = require('../billing/addons');
    const { shouldDowngradeVoice, azureFallbackFor } = require('../tts/voice-quota');
    const hasVoiceAddon  = hasAddon(org, 'voice_premium');
    const extraVoiceMin  = Number(org.automation_config?.config?.premiumExtraMinutes) || 0;
    const minutesUsed    = Number(org.monthly_minutes_used) || 0;

    // La tabla estructurada entra al prompt base (#8). voice-pipeline sigue
    // inyectando la versión fresca de BD como red — con dedupe.
    const structuredList = org.automation_config?.config?.serviceList;
    const cfgConLista = (Array.isArray(structuredList) && structuredList.length)
      ? { ...cfg, serviceList: structuredList }
      : cfg;

    const assistant = {
      id:           org.id,
      name:         cfg.assistantName || org.name,
      systemPrompt: generatePrompt(cfgConLista, org.name),
      firstMessage: cfg.firstMessage ||
        `{{GREETING}}, ha llamado a ${org.name}. ¿En qué puedo ayudarle?`,
      // La voz elegida decide también el PROVEEDOR (tiers 2026-07-03):
      // Estándar = Azure (voz por nombre neural), Premium = ElevenLabs
      // (voice-map resuelve id/alias), euskera = servidor local.
      ...(() => {
        const { resolveVoiceEntry } = require('../tts/voice-catalog');
        const entry = resolveVoiceEntry(cfg.voice);
        // Degradación por cupo: si la voz configurada es premium/ultra y la org
        // ya agotó su cupo de minutos caros este mes, suena por Azure.
        if (entry && shouldDowngradeVoice(entry.tier, minutesUsed, hasVoiceAddon, extraVoiceMin)) {
          const azId = azureFallbackFor(entry.gender);
          const az = resolveVoiceEntry(azId);
          log.info(`[${orgId}] Voz ${cfg.voice} (${entry.tier}) degradada a Azure ${azId} — cupo agotado (${minutesUsed} min)`);
          return { voice: az ? az.providerVoiceId : 'es-ES-ElviraNeural', ttsProvider: 'azure', voiceDowngraded: true };
        }
        if (entry && entry.provider === 'azure')    return { voice: entry.providerVoiceId, ttsProvider: 'azure' };
        if (entry && entry.provider === 'local')    return { voice: entry.providerVoiceId, ttsProvider: 'local' };
        if (entry && entry.provider === 'cartesia') return { voice: entry.providerVoiceId, ttsProvider: 'cartesia' }; // tier Ultra
        return { voice: cfg.voice || 'nova' }; // elevenlabs por defecto (voice-map traduce)
      })(),
      language,
      // Palanca admin-only para experimentos A/B de cerebro (2026-07-03):
      // assistant_config.model ('proveedor/modelo') fuerza el LLM de la org;
      // sin él, el router elige el más rápido. El portal filtra 'model' de
      // las ediciones del cliente — solo el admin la toca. El juez del A/B
      // es el auditor + quality score (llmProvider queda en metrics.turns).
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.fallbackModel ? { fallbackModel: cfg.fallbackModel } : {}),
      // mode: 'citas' (default) | 'contacto' — decide herramientas y prompt.
      // Se expone también para que el AUDITOR sepa qué guion es el correcto
      // (falso positivo real 2026-07-04: marcó como alucinación "el equipo
      // le llamará", que es el comportamiento diseñado tras register_lead).
      mode:         cfg.mode === 'contacto' ? 'contacto' : 'citas',
      tools:        cfg.mode === 'contacto' ? CONTACT_TOOLS : RECEPTIONIST_TOOLS,
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
