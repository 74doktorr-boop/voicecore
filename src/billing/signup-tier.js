'use strict';
// ============================================================
// NodeFlow — Mapeo de la ELECCIÓN de plan en el alta → tier/billing (2026-07-27)
// ------------------------------------------------------------
// La landing de dos tiers manda plan:'basico'|'pro' en /api/registro. Este
// módulo traduce esa elección a lo que necesita la provisión, en UN sitio
// (DRY + testeable sin Stripe ni BD):
//
//   - basePlan: el plan Stripe BASE (siempre 'negocio' = 49€; Básico y Pro
//       comparten base — Pro es base + add-on 'pro' de +36€ = 85€).
//   - tier: 'basico' | 'pro' | null → se escribe en automation_config.config.tier.
//   - wantsProAddon: true solo para 'pro' → el checkout añade la 2ª línea
//       (+36€) y la provisión registra addons.pro.
//
// FUNDADORES (isFounder): base 'negocio' sin add-on, pero con `tier:'pro'`
// ESCRITO. Su oferta es Pro completo a 49€ de por vida y, desde que el defecto
// pasó a Básico (2026-07-29), dejar su tier a null los habría capado en
// silencio. Una promesa comercial tiene que estar en los datos, no depender del
// valor por defecto de una función. Aunque cliquen "Pro" no se les cobra el
// add-on: su deal ES Pro gratis.
//
// Desconocido / ausente / 'negocio' → base 'negocio', sin tier explícito → cae
// al defecto, que ahora es BÁSICO. Es el cambio: antes esto regalaba ~64€/mes
// de complementos dentro de un plan de 49€.
// ============================================================

/**
 * @param {string} rawPlan  valor `plan` del formulario/registro
 * @param {{isFounder?: boolean}} opts
 * @returns {{choice:'basico'|'pro'|'negocio', basePlan:'negocio', tier:('basico'|null), wantsProAddon:boolean}}
 */
function parseSignupPlan(rawPlan, opts = {}) {
  const raw = String(rawPlan || '').trim().toLowerCase();

  // Fundador: su oferta es Pro completo a 49€. Se ESCRIBE tier:'pro' — con el
  // defecto en Básico, dejarlo a null los caparía en silencio y romperíamos la
  // oferta sin que nadie lo notara hasta que un fundador echara algo en falta.
  if (opts.isFounder) {
    return { choice: 'negocio', basePlan: 'negocio', tier: 'pro', wantsProAddon: false };
  }

  if (raw === 'basico') {
    return { choice: 'basico', basePlan: 'negocio', tier: 'basico', wantsProAddon: false };
  }
  if (raw === 'pro') {
    return { choice: 'pro', basePlan: 'negocio', tier: null, wantsProAddon: true };
  }
  // 'negocio', vacío, legacy ('starter'), o cualquier cosa rara → base, Pro por
  // defecto, sin cobro de add-on. Es el comportamiento pre-lanzamiento.
  return { choice: 'negocio', basePlan: 'negocio', tier: null, wantsProAddon: false };
}

module.exports = { parseSignupPlan };
