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
// DEFECTO = PRO (no negociable): una org SIN tier explícito tiene TODO. Así:
//   (1) las orgs existentes y los 20 FUNDADORES no pierden nada,
//   (2) el gating es un NO-OP hasta que se marque a un cliente como 'basico'.
// Solo un `tier: 'basico'` explícito capa el motor de seguimientos.
// ============================================================

/** Tier del negocio: 'basico' | 'pro'. Pro por defecto (ver cabecera). PURA. */
function tierOf(org) {
  const t = org && org.automation_config && org.automation_config.config && org.automation_config.config.tier;
  return t === 'basico' ? 'basico' : 'pro';
}

/**
 * ¿La org tiene desbloqueado el motor de seguimientos (Pro)? PURA.
 * Dos caminos: (a) tier != 'basico' (defecto/fundadores), o (b) el add-on
 * 'pro' comprado (un Básico que se subió pagando +36€ → item Stripe activo).
 * El add-on ANULA el cap 'basico': activarlo abre todo sin reescribir tier;
 * cancelarlo vuelve a capar (el tier:'basico' sigue ahí). Ver billing/addons.js.
 */
function hasPro(org) {
  if (tierOf(org) !== 'basico') return true;
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
