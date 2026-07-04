// ============================================================
// NodeFlow — Add-ons de suscripción (2026-07-04)
// Voz Premium +10€/mes · Crecimiento +39€/mes — los añadidos que
// anuncia la landing, cobrados como subscription items sobre la
// suscripción Stripe existente (prorrateo automático de Stripe).
//
// Fuente de verdad del entitlement: organizations.automation_config
// .config.addons = { voice_premium: { itemId, since }, ... } — se
// escribe SOLO cuando Stripe confirma el alta/baja del item.
//
// Charter: el candado es server-side y determinista (el PUT del
// asistente rechaza cambiar a voz premium sin add-on; no depende
// del UI). Sin castigo retroactivo: una voz premium YA guardada
// sigue sonando — el candado actúa al CAMBIAR.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('ADDONS');

const ADDONS = {
  voice_premium: {
    key: 'voice_premium',
    label: 'Voz Premium',
    monthlyCents: 1000,
    envPriceVar: 'STRIPE_ADDON_VOICE_PRICE_ID',
    blurb: 'Voces ultra-realistas de última generación (ElevenLabs). La voz estándar sigue incluida en tu plan.',
  },
  growth: {
    key: 'growth',
    label: 'Crecimiento',
    monthlyCents: 3900,
    envPriceVar: 'STRIPE_ADDON_GROWTH_PRICE_ID',
    blurb: 'Campañas de reactivación por voz: tu asistente llama a clientes antiguos para traerlos de vuelta.',
  },
};

function _orgAddons(org) {
  return (org && org.automation_config && org.automation_config.config && org.automation_config.config.addons) || {};
}

/** ¿Tiene la org este add-on activo? */
function hasAddon(org, key) {
  return Boolean(_orgAddons(org)[key]);
}

/** Estado de todos los add-ons para el portal (activo + disponible para compra). */
function listAddons(org) {
  const active = _orgAddons(org);
  return Object.values(ADDONS).map(a => ({
    key: a.key,
    label: a.label,
    monthlyCents: a.monthlyCents,
    blurb: a.blurb,
    active: Boolean(active[a.key]),
    available: Boolean(process.env[a.envPriceVar]),
  }));
}

/**
 * Candado de la voz premium: ¿puede la org guardar esta voz?
 * - Estándar/local/desconocida (ids legacy): siempre sí.
 * - Premium/ultra: solo con el add-on — EXCEPTO si es la misma voz que ya
 *   tenía guardada (sin castigo retroactivo a configs anteriores al gating).
 */
function voiceChangeAllowed(org, voiceId, deps = {}) {
  const resolve = deps.resolve || require('../tts/voice-catalog').resolveVoiceEntry;
  if (!voiceId) return { allowed: true };
  const entry = resolve(voiceId);
  if (!entry || (entry.tier !== 'premium' && entry.tier !== 'ultra')) return { allowed: true };
  if (hasAddon(org, 'voice_premium')) return { allowed: true };
  const current = org && org.assistant_config && org.assistant_config.voice;
  if (current === voiceId) return { allowed: true }; // ya la tenía — no degradar
  return {
    allowed: false,
    reason: 'Esa voz es Premium (+10€/mes). Actívala en Facturación → Complementos y vuelve a elegirla — tardas un minuto.',
  };
}

async function _loadOrg(db, orgId) {
  const { data } = await db.client
    .from('organizations')
    .select('id, stripe_subscription_id, automation_config')
    .eq('id', orgId)
    .single();
  return data;
}

async function _saveAddons(db, orgId, org, addons, flowMgr) {
  const auto = org.automation_config || {};
  auto.config = { ...(auto.config || {}), addons };
  const { error } = await db.client
    .from('organizations')
    .update({ automation_config: auto })
    .eq('id', orgId);
  if (error) throw new Error(error.message);
  // El flow EN MEMORIA también (gotcha 2026-07-04): el cron de reactivación
  // lee flowManager — sin esto, el add-on recién pagado no regiría hasta el
  // siguiente reinicio (estado en memoria muere con cada deploy, y viceversa).
  try {
    const fm = flowMgr || require('../automations/flow-manager').flowManager;
    const flow = fm.get(orgId);
    if (flow) {
      flow.automations = flow.automations || {};
      flow.automations.config = { ...(flow.automations.config || {}), addons };
    }
  } catch (_) { /* sin flow en memoria: la rehidratación del arranque lo trae */ }
}

/**
 * Alta del add-on: añade el subscription item en Stripe (prorrateo
 * automático) y persiste el entitlement. Idempotente.
 */
async function activateAddon(orgId, key, deps = {}) {
  const def = ADDONS[key];
  if (!def) return { ok: false, error: 'Complemento desconocido.' };
  const priceId = process.env[def.envPriceVar];
  if (!priceId) return { ok: false, error: `${def.label} aún no está disponible para contratación online. Escríbenos y lo activamos.` };

  const billing = deps.billing || require('./stripe').getBilling();
  const db = deps.db || require('../db/database').getDatabase();
  if (!billing.enabled || !db.enabled) return { ok: false, error: 'Facturación no disponible ahora mismo.' };

  try {
    const org = await _loadOrg(db, orgId);
    if (!org) return { ok: false, error: 'Negocio no encontrado.' };
    const addons = { ...(_orgAddons(org)) };
    if (addons[key]) return { ok: true, already: true };
    if (!org.stripe_subscription_id) {
      return { ok: false, error: 'Primero activa tu plan (Facturación) y después añade complementos.' };
    }

    const item = await billing.stripe.subscriptionItems.create({
      subscription: org.stripe_subscription_id,
      price: priceId,
      quantity: 1,
      proration_behavior: 'create_prorations',
    });

    addons[key] = { itemId: item.id, since: new Date().toISOString() };
    await _saveAddons(db, orgId, org, addons, deps.flowManager);
    log.info(`Add-on ${key} ACTIVADO para ${orgId} (item ${item.id})`);
    return { ok: true, itemId: item.id };
  } catch (e) {
    log.warn(`activateAddon(${orgId}, ${key}) falló: ${e.message}`);
    return { ok: false, error: 'No se pudo activar el complemento: ' + e.message };
  }
}

/** Baja del add-on: borra el subscription item y limpia el entitlement. */
async function cancelAddon(orgId, key, deps = {}) {
  const def = ADDONS[key];
  if (!def) return { ok: false, error: 'Complemento desconocido.' };
  const billing = deps.billing || require('./stripe').getBilling();
  const db = deps.db || require('../db/database').getDatabase();
  if (!billing.enabled || !db.enabled) return { ok: false, error: 'Facturación no disponible ahora mismo.' };

  try {
    const org = await _loadOrg(db, orgId);
    if (!org) return { ok: false, error: 'Negocio no encontrado.' };
    const addons = { ...(_orgAddons(org)) };
    const current = addons[key];
    if (!current) return { ok: true, already: true };

    if (current.itemId) {
      await billing.stripe.subscriptionItems.del(current.itemId, { proration_behavior: 'create_prorations' });
    }
    delete addons[key];
    await _saveAddons(db, orgId, org, addons, deps.flowManager);
    log.info(`Add-on ${key} CANCELADO para ${orgId}`);
    return { ok: true };
  } catch (e) {
    log.warn(`cancelAddon(${orgId}, ${key}) falló: ${e.message}`);
    return { ok: false, error: 'No se pudo cancelar el complemento: ' + e.message };
  }
}

module.exports = { ADDONS, hasAddon, listAddons, voiceChangeAllowed, activateAddon, cancelAddon };
