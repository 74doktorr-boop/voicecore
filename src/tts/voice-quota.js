// ============================================================
// NodeFlow — Cupo de voz Premium/Ultra (decisión Unai 2026-07-04)
// El plan básico ofrece TODAS las voces, pero las caras (ElevenLabs
// Premium ~5-7cts/min, Cartesia Ultra ~2-4cts/min) solo hasta un cupo
// de minutos/mes; superado, el asistente sigue hablando pero con voz
// Estándar (Azure ~1cts/min). El add-on voice_premium sube el cupo;
// los minutos extra comprados lo amplían más. Determinista, server-side:
// el margen no depende de que el LLM ni el frontend se porten bien.
// ============================================================
'use strict';

const QUOTA_BASIC = 40;   // min/mes de voz premium/ultra incluidos en el plan
const QUOTA_ADDON = 200;  // con el add-on voice_premium (+10€/mes)

/** Cupo de minutos premium/ultra del mes según add-on + minutos extra comprados. */
function premiumQuota(hasVoiceAddon, extraMinutes = 0) {
  const base = hasVoiceAddon ? QUOTA_ADDON : QUOTA_BASIC;
  return base + (Number(extraMinutes) > 0 ? Number(extraMinutes) : 0);
}

/**
 * ¿Debe una voz premium/ultra degradar a Estándar por cupo agotado?
 * @param {string} voiceTier            - 'premium' | 'ultra' | 'estandar' | null
 * @param {number} minutesUsedThisMonth - minutos ya consumidos este mes por la org
 * @param {boolean} hasVoiceAddon
 * @param {number} [extraMinutes]       - packs de minutos premium comprados
 */
function shouldDowngradeVoice(voiceTier, minutesUsedThisMonth, hasVoiceAddon, extraMinutes = 0) {
  if (voiceTier !== 'premium' && voiceTier !== 'ultra') return false; // estándar/local no gastan cupo
  const used = Math.max(0, Number(minutesUsedThisMonth) || 0);
  return used >= premiumQuota(hasVoiceAddon, extraMinutes);
}

/** Voz Azure (estándar) de reemplazo, del mismo género que la premium. */
function azureFallbackFor(gender) {
  return gender === 'male' ? 'alvaro-az' : 'elvira-az';
}

const r1 = n => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Resumen del cupo premium que consume el portal ("te quedan X min premium
 * este mes"). Deriva TODO del mismo estado que la degradación real, para que
 * lo que ve el cliente coincida con lo que suena. No toca BD ni HTTP: función
 * pura, se alimenta con lo que ya trae portalAuth + org-assistant.
 * @param {object} p
 * @param {string} p.voiceTier      - tier de la voz configurada AHORA
 * @param {number} p.minutesUsed    - monthly_minutes_used de la org
 * @param {boolean} p.hasVoiceAddon
 * @param {number} [p.extraMinutes] - packs de minutos premium comprados
 */
function voiceQuotaSummary({ voiceTier, minutesUsed, hasVoiceAddon, extraMinutes = 0 }) {
  const metered = voiceTier === 'premium' || voiceTier === 'ultra';
  const quota   = premiumQuota(hasVoiceAddon, extraMinutes);
  const used    = Math.max(0, Number(minutesUsed) || 0);
  const extra   = Number(extraMinutes) > 0 ? Number(extraMinutes) : 0;
  return {
    tier:         voiceTier || null,
    metered,                                     // ¿la voz actual gasta cupo?
    quota,
    used:         r1(used),
    remaining:    Math.max(0, r1(quota - used)),
    extraMinutes: extra,
    hasAddon:     !!hasVoiceAddon,
    // consistente por construcción con la degradación real del asistente
    downgraded:   metered && shouldDowngradeVoice(voiceTier, used, hasVoiceAddon, extra),
  };
}

module.exports = {
  QUOTA_BASIC, QUOTA_ADDON, premiumQuota, shouldDowngradeVoice, azureFallbackFor,
  voiceQuotaSummary,
};
