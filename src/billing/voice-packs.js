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

  // CAS con reintentos (auditoría 2026-07-16): antes era un read-modify-write
  // SIN candado sobre automation_config → dos reintentos del MISMO webhook de
  // Stripe (o una escritura concurrente del portal) podían (a) sumar el pack
  // DOS veces (doble cargo, dinero del cliente) o (b) perder el crédito recién
  // sumado. El update solo aplica si el sessionId NO está ya presente (idempo-
  // tencia atómica) y si premiumExtraMinutes sigue valiendo lo leído (no pisar
  // un cambio concurrente). Verificado contra la BD real (not-contains + eq
  // sobre JSON anidado).
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { data: org } = await db.client
        .from('organizations').select('automation_config').eq('id', orgId).maybeSingle();
      if (!org) return { ok: false, error: 'org not found' };
      const auto = org.automation_config || {};
      const config = auto.config || {};
      const seen = Array.isArray(config._voicePackSessions) ? config._voicePackSessions : [];

      if (sessionId && seen.includes(sessionId)) {
        return { ok: true, already: true }; // ya procesado — no duplicar
      }

      const current = Number(config.premiumExtraMinutes) || 0;
      const newAuto = {
        ...auto,
        config: {
          ...config,
          premiumExtraMinutes: current + mins,
          _voicePackSessions: sessionId ? [...seen, sessionId].slice(-50) : seen,
        },
      };

      let q = db.client.from('organizations')
        .update({ automation_config: newAuto }).eq('id', orgId);
      // (a) idempotencia: el sessionId no debe estar ya en la lista.
      if (sessionId) q = q.not('automation_config->config->_voicePackSessions', 'cs', JSON.stringify([sessionId]));
      // (b) CAS sobre el contador: sigue valiendo lo que leímos (o ausente si 0).
      q = current === 0
        ? q.or('automation_config->config->premiumExtraMinutes.is.null,automation_config->config->>premiumExtraMinutes.eq.0')
        : q.filter('automation_config->config->>premiumExtraMinutes', 'eq', String(current));

      const { data: rows, error } = await q.select('id');
      if (error) throw new Error(error.message);

      if (Array.isArray(rows) && rows.length > 0) {
        log.info(`Pack de voz aplicado a ${orgId}: +${mins} min (total extra ${current + mins})`);
        return { ok: true, extraMinutes: current + mins };
      }
      // 0 filas: o el reintento ya se aplicó (arriba se detecta al re-leer) o hubo
      // un cambio concurrente → reintentar con valores frescos.
    } catch (e) {
      log.warn(`applyVoicePack(${orgId}) falló: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }
  log.warn(`applyVoicePack(${orgId}): no aplicado tras varios intentos (contención)`);
  return { ok: false, error: 'contention' };
}

/**
 * Cierre de mes de una org: los packs "persisten hasta gastarse" (decisión Unai
 * 2026-07-04), así que al renovar el ciclo descontamos SOLO los minutos del pack
 * que se usaron este mes (los que desbordaron el cupo base) y el resto se
 * arrastra. NO toca monthly_minutes_used — de eso se encarga el reset del
 * llamante; aquí solo ajustamos premiumExtraMinutes cuando hay algo que gastar.
 * @param {{id:string, monthly_minutes_used:number, automation_config:object}} orgRow
 */
async function settleMonthlyPack(orgRow, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const auto   = (orgRow && orgRow.automation_config) || {};
  const config = auto.config || {};
  const extra  = Number(config.premiumExtraMinutes) || 0;
  if (!db.enabled || !orgRow || !orgRow.id || extra <= 0) {
    return { changed: false, extraMinutes: extra };
  }

  const { hasAddon } = require('./addons');
  const { depletePackOnReset } = require('../tts/voice-quota');
  const newExtra = depletePackOnReset({
    minutesUsed:   Number(orgRow.monthly_minutes_used) || 0,
    hasVoiceAddon: hasAddon(orgRow, 'voice_premium'),
    extraMinutes:  extra,
  });
  if (newExtra === extra) return { changed: false, extraMinutes: extra };

  const newAuto = { ...auto, config: { ...config, premiumExtraMinutes: newExtra } };
  try {
    // CAS (auditoría 2026-07-16): solo descuenta si premiumExtraMinutes sigue
    // valiendo lo leído → no pisa un pack recién comprado ni un cambio del
    // portal entre la lectura y la escritura.
    const { data: rows, error } = await db.client.from('organizations')
      .update({ automation_config: newAuto }).eq('id', orgRow.id)
      .filter('automation_config->config->>premiumExtraMinutes', 'eq', String(extra))
      .select('id');
    if (error) throw new Error(error.message);
    if (!Array.isArray(rows) || rows.length === 0) {
      log.info(`settleMonthlyPack(${orgRow.id}): premiumExtraMinutes cambió entre lectura y escritura — skip (se reintenta)`);
      return { changed: false, extraMinutes: extra };
    }
    log.info(`Cierre de mes org ${orgRow.id}: pack ${extra} → ${newExtra} min (gastado ${extra - newExtra})`);
    return { changed: true, extraMinutes: newExtra };
  } catch (e) {
    log.warn(`settleMonthlyPack(${orgRow.id}) falló: ${e.message}`);
    return { changed: false, error: e.message, extraMinutes: extra };
  }
}

module.exports = { PACKS, applyVoicePack, settleMonthlyPack };
