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
  // ── RETIRADO 2026-08-01 (decisión de Unai) ─────────────────────────────────
  // Las 13 voces premium eran TODAS de ElevenLabs. Al quitar su clave —cuenta en
  // plan gratuito, 402 desde siempre, jamás sintetizó una sílaba— se fueron las
  // 13 a la vez y el nivel se quedó vacío. Producción ofrece 6 voces, todas
  // Cartesia, todas incluidas en el plan, y suenan bien.
  //
  // Este complemento seguía anunciándose a 10 €/mes y, al no haber price id en
  // Stripe, el portal remataba con «Muy pronto online — escríbenos y lo
  // activamos hoy». No hay nada que activar. Nadie llegó a pagarlo, así que no
  // hay dinero que devolver, pero es exactamente lo mismo que el euskera y el
  // galego —ofrecer lo que el producto no puede dar— y encima con un precio
  // delante.
  //
  // Se MARCA, no se borra: el código tiene que conservar por qué se retiró y qué
  // lo devolvería. Quitar la línea `retirado` lo revive entero.
  //
  // 🔴 Lo que haría falta para revivirlo: un proveedor de voz premium que
  //    funcione y esté MEDIDO —calidad y coste por minuto— antes de volver a
  //    prometer «ultra-realistas». Ver la tarea abierta.
  voice_premium: {
    key: 'voice_premium',
    label: 'Voz Premium',
    monthlyCents: 1000,
    envPriceVar: 'STRIPE_ADDON_VOICE_PRICE_ID',
    retirado: 'No hay ninguna voz premium que suene: las 13 eran de ElevenLabs y su clave se retiró.',
    blurb: 'Voces ultra-realistas de última generación. La voz estándar sigue incluida en tu plan.',
  },
  growth: {
    key: 'growth',
    label: 'Crecimiento',
    monthlyCents: 3900,
    envPriceVar: 'STRIPE_ADDON_GROWTH_PRICE_ID',
    blurb: 'Campañas de reactivación por voz: tu asistente llama a clientes antiguos para traerlos de vuelta.',
  },
  wa_own_number: {
    key: 'wa_own_number',
    label: 'WhatsApp con tu número',
    monthlyCents: 1500,
    envPriceVar: 'STRIPE_ADDON_WA_PRICE_ID',
    blurb: 'Los avisos a tus clientes (confirmación, recordatorio, reseña) salen desde el número de WhatsApp de tu propio negocio, no desde uno compartido.',
  },
  // Salto de plan Básico→Pro implementado como subscription item (+36€ sobre
  // la base de 49€ = 85€). Reutiliza toda la maquinaria de add-ons ya probada
  // sin tocar el precio base — los fundadores conservan su 49€ intacto. Es el
  // ENTITLEMENT de billing; el gating lo lee vía plan.hasPro (tier o este add-on).
  // `hidden`: no aparece en la caja genérica de Complementos, tiene banner propio.
  pro: {
    key: 'pro',
    label: 'Plan Pro',
    monthlyCents: 3600,
    envPriceVar: 'STRIPE_ADDON_PRO_PRICE_ID',
    hidden: true,
    // Ya NO dice «voz premium»: se retiró el 01/08 y un plan de 85 € no puede
    // llevar en su lista de ventajas algo que no existe.
    blurb: 'Todo desbloqueado: motor de seguimientos completo (reseñas, reactivación, plantones, avisos por entidad), informe completo, integraciones y TODOS los complementos incluidos (WhatsApp con tu número) sin coste extra.',
  },
};

function _orgAddons(org) {
  return (org && org.automation_config && org.automation_config.config && org.automation_config.config.addons) || {};
}

/** ¿Tiene la org este add-on activo? */
function hasAddon(org, key) {
  if (_orgAddons(org)[key]) return true;
  // El plan Pro INCLUYE todos los add-ons de capacidad (voz premium, WhatsApp
  // propio, reactivación) sin coste extra — decisión de producto 2026-07-27.
  // El propio 'pro' NO se auto-incluye (sería circular). require lazy: evita
  // ciclo con plan.js (que lee addons.pro directamente, no vía esta función).
  if (key !== 'pro' && org && require('./plan').hasPro(org)) return true;
  return false;
}

/** Estado de todos los add-ons para el portal (activo + disponible para compra). */
function listAddons(org) {
  const active = _orgAddons(org);
  const pro = require('./plan').hasPro(org);
  // `retirado` fuera: si no se puede entregar, no se enseña. Antes bastaba con
  // no tener price id, y entonces el portal ponía «Muy pronto online —
  // escríbenos y lo activamos hoy», que es peor que no ofrecerlo: invita a
  // escribir por algo que no existe.
  return Object.values(ADDONS).filter(a => !a.hidden && !a.retirado).map(a => ({
    key: a.key,
    label: a.label,
    monthlyCents: a.monthlyCents,
    blurb: a.blurb,
    // Pro los incluye todos → activos y sin botón de compra (includedInPro).
    active: Boolean(active[a.key]) || pro,
    includedInPro: pro && !active[a.key],
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
  // El motivo cambió al retirar el complemento: ya no se puede mandar a nadie a
  // «Facturación → Complementos», porque ahí no hay nada. Se dice lo que hay.
  return {
    allowed: false,
    reason: ADDONS.voice_premium.retirado
      ? 'Ese nivel de voz no está disponible ahora mismo. Las voces incluidas en tu plan son naturales y son las que usamos en todas las llamadas.'
      : 'Esa voz es Premium (+10€/mes). Actívala en Facturación → Complementos y vuelve a elegirla — tardas un minuto.',
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
  // Fail-closed: un complemento retirado no se puede dar de alta ni aunque
  // alguien llame a la ruta a mano o quede una price id suelta en el entorno.
  // Cobrar por algo que no se puede entregar es el único error que no se puede
  // arreglar después con un despliegue.
  if (def.retirado) return { ok: false, error: `${def.label} no está disponible: ${def.retirado}` };
  const priceId = process.env[def.envPriceVar];
  if (!priceId) return { ok: false, error: `${def.label} aún no está disponible para contratación online. Escríbenos y lo activamos.` };

  const billing = deps.billing || require('./stripe').getBilling();
  const db = deps.db || require('../db/database').getDatabase();
  if (!billing.enabled || !db.enabled) return { ok: false, error: 'Facturación no disponible ahora mismo.' };

  try {
    const org = await _loadOrg(db, orgId);
    if (!org) return { ok: false, error: 'Negocio no encontrado.' };
    // Anti doble-cobro: si ya es Pro, los add-ons de capacidad van INCLUIDOS →
    // no se añade item Stripe. (El 'pro' sí sigue su camino: es el upgrade.)
    if (key !== 'pro' && require('./plan').hasPro({ automation_config: org.automation_config })) {
      return { ok: true, includedInPro: true };
    }
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
