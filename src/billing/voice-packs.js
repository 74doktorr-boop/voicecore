// ============================================================
// NodeFlow — Packs de minutos de voz (2026-07-04)
// Compra puntual que amplía el cupo de voz Premium/Ultra del mes:
//   · Premium: 50 min (ElevenLabs) por 5€
//   · Ultra:   100 min (Cartesia) por 5€  (más min: Cartesia es más barata)
// Al pagar, el webhook de Stripe llama applyVoicePack → suma los minutos a
// automation_config.config.premiumExtraMinutes (el mismo cupo que lee
// voice-quota). IDEMPOTENTE por sessionId: Stripe reintenta webhooks y no se
// puede sumar el pack dos veces (es dinero del cliente).
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('VOICE-PACKS');

const PACKS = {
  premium: { key: 'premium', minutes: 50,  cents: 500, envPriceVar: 'STRIPE_PACK_PREMIUM_PRICE_ID', label: '50 min voz Premium' },
  ultra:   { key: 'ultra',   minutes: 100, cents: 500, envPriceVar: 'STRIPE_PACK_ULTRA_PRICE_ID',   label: '100 min voz Ultra (Cartesia)' },
};

/**
 * Suma los minutos de un pack pagado al cupo del negocio. Idempotente.
 * @param {string} orgId
 * @param {{sessionId:string, minutes:number}} pack
 */
async function applyVoicePack(orgId, { sessionId, minutes } = {}, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const mins = Number(minutes) || 0;
  if (!db.enabled || !orgId || mins <= 0) return { ok: false };

  try {
    const { data: org } = await db.client
      .from('organizations').select('automation_config').eq('id', orgId).maybeSingle();
    const auto = (org && org.automation_config) || {};
    const config = auto.config || {};
    const seen = Array.isArray(config._voicePackSessions) ? config._voicePackSessions : [];

    if (sessionId && seen.includes(sessionId)) {
      return { ok: true, already: true }; // ya procesado — no duplicar
    }

    const current = Number(config.premiumExtraMinutes) || 0;
    auto.config = {
      ...config,
      premiumExtraMinutes: current + mins,
      _voicePackSessions: sessionId ? [...seen, sessionId].slice(-50) : seen,
    };
    const { error } = await db.client.from('organizations')
      .update({ automation_config: auto }).eq('id', orgId);
    if (error) throw new Error(error.message);

    log.info(`Pack de voz aplicado a ${orgId}: +${mins} min (total extra ${current + mins})`);
    return { ok: true, extraMinutes: current + mins };
  } catch (e) {
    log.warn(`applyVoicePack(${orgId}) falló: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { PACKS, applyVoicePack };
