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
//   - tier: 'basico' → se escribe en automation_config.config.tier y CAPA el
//       motor de seguimientos. Pro/legacy → null (defecto PRO, ver plan.js).
//   - wantsProAddon: true solo para 'pro' → el checkout añade la 2ª línea
//       (+36€) y la provisión registra addons.pro.
//
// FUNDADORES (isFounder): SIEMPRE base 'negocio' sin tier ni add-on → Pro
// completo al precio de 49€ de por vida (la oferta). Aunque cliquen "Pro",
// no se les cobra el add-on: su deal ES Pro gratis.
//
// Desconocido / ausente / 'negocio' → base 'negocio', sin tier, sin add-on
// (= comportamiento actual exacto: cero regresión antes del lanzamiento).
// ============================================================

/**
 * @param {string} rawPlan  valor `plan` del formulario/registro
 * @param {{isFounder?: boolean}} opts
 * @returns {{choice:'basico'|'pro'|'negocio', basePlan:'negocio', tier:('basico'|null), wantsProAddon:boolean}}
 */
function parseSignupPlan(rawPlan, opts = {}) {
  const raw = String(rawPlan || '').trim().toLowerCase();

  // Fundador: su oferta es Pro completo a 49€ → base sola, sin capar ni add-on.
  if (opts.isFounder) {
    return { choice: 'negocio', basePlan: 'negocio', tier: null, wantsProAddon: false };
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
