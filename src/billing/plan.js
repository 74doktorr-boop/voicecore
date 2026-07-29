'use strict';
// ============================================================
// NodeFlow — Plan del negocio: Básico vs Pro (2026-07-27)
// ------------------------------------------------------------
// BÁSICO (49€): recepcionista + agenda + CRM básico + recordatorios de cita.
// PRO (85€): todo lo anterior + el MOTOR DE SEGUIMIENTOS (reseñas automáticas,
//   reactivación de dormidos, recuperación de plantones, avisos por entidad),
//   entidades, informe de resultados completo e integraciones avanzadas.
//
// FUENTE DE VERDAD del tier: organizations.automation_config.config.tier
//   ('basico' | 'pro'). Mismo almacén que los add-ons (billing/addons.js).
//
// DEFECTO = BÁSICO (cambiado el 2026-07-29, decisión de Unai).
//
// Antes el defecto era PRO: una org SIN tier explícito tenía TODO. Se hizo así
// para que el gating fuera un NO-OP y nadie perdiera nada al desplegarlo, pero
// el efecto económico no era un no-op: toda org sin marcar recibía voz premium,
// crecimiento y WhatsApp propio — unos 64€/mes de complementos — dentro de un
// plan de 49€. Con 0 suscripciones activas en Stripe era el momento de
// corregirlo, antes de que el regalo se volviera un derecho adquirido.
//
// La regla ahora es explícita en los dos sentidos: para tener Pro hay que
// tenerlo ESCRITO (`tier:'pro'`) o haberlo COMPRADO (`addons.pro`). Nada de
// entitlements que dependen de la ausencia de un campo.
//
// FUNDADORES: su oferta sigue intacta (Pro completo a 49€ de por vida), pero
// ahora se les escribe `tier:'pro'` en el alta (ver billing/signup-tier.js) en
// vez de dárselo por omisión. Una promesa comercial tiene que estar en los
// datos, no en el valor por defecto de una función.
// ============================================================

/**
 * Tier del negocio: 'basico' | 'pro'. BÁSICO por defecto (ver cabecera). PURA.
 * Solo un `tier:'pro'` explícito da Pro por tier; el otro camino es el add-on.
 */
function tierOf(org) {
  const t = org && org.automation_config && org.automation_config.config && org.automation_config.config.tier;
  return t === 'pro' ? 'pro' : 'basico';
}

/**
 * ¿La org tiene desbloqueado el motor de seguimientos (Pro)? PURA.
 * Dos caminos, ambos EXPLÍCITOS: (a) `tier:'pro'` escrito (fundadores, o una
 * cortesía decidida a mano), o (b) el add-on 'pro' comprado (un Básico que se
 * subió pagando +36€ → item Stripe activo). Activar el add-on abre todo sin
 * tocar el tier; cancelarlo vuelve a capar. Ver billing/addons.js.
 */
function hasPro(org) {
  if (tierOf(org) === 'pro') return true;
  const addons = org && org.automation_config && org.automation_config.config && org.automation_config.config.addons;
  return Boolean(addons && addons.pro);
}

// Precios (€/mes) — fuente única para portal y landing. El Básico es la base
// (49€) con el cap; el Pro = base + add-on 'pro' (+36€) = 85€.
const BASICO_PRICE_EUR = 49;
const PRO_PRICE_EUR = 85;

// Catálogo de lo que SOLO está en Pro (para mensajes de upgrade coherentes en
// el portal y para saber qué gatear). key → etiqueta cara al dueño.
const PRO_FEATURES = {
  reviews:          'Reseñas automáticas en Google',
  reactivation:     'Reactivación de clientes dormidos',
  noshow_recovery:  'Recuperación de plantones',
  entity_reminders: 'Avisos por entidad (pre-ITV, vacuna, renovación…)',
  entities:         'Entidades (ficha viva de coches, mascotas, pólizas…)',
  full_report:      'Informe de resultados completo',
  connector:        'Integraciones avanzadas (webhooks / conector)',
};

/** Mensaje de upgrade para una feature Pro (para respuestas 402 del portal). */
function upgradeMessage(featureKey) {
  const name = PRO_FEATURES[featureKey] || 'Esta función';
  return `${name} forma parte del plan Pro. Súbete a Pro desde Facturación para desbloquear todo el motor de seguimientos.`;
}

module.exports = { tierOf, hasPro, PRO_FEATURES, upgradeMessage, BASICO_PRICE_EUR, PRO_PRICE_EUR };
