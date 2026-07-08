// ============================================================
// NodeFlow — "Primeros pasos" onboarding checklist (SMART)
// Pure functions: cada paso del cuadro de bienvenida se marca solo a
// partir de señales REALES del negocio, y el cuadro entero desaparece
// cuando todos los pasos están hechos. Sin I/O — testeable con mocks.
//
// Petición del fundador (2026-07-09): "cuando se vayan completando los
// pasos que se marquen, y cuando se acabe todo el proceso que no salga
// más ese cuadro."
// ============================================================
'use strict';

/**
 * ¿El asistente está personalizado más allá de los valores por defecto?
 * DONE cuando hay sector definido Y (algún servicio en la lista O saludo
 * personalizado O voz elegida). Solo el sector no basta: es lo primero que
 * se rellena y no prueba que el dueño haya hecho suyo el asistente.
 *
 * @param {object} s - señales { sector, serviceList, welcomeMessage, voice }
 */
function isAssistantConfigured(s) {
  s = s || {};
  var hasSector  = !!(s.sector && String(s.sector).trim());
  if (!hasSector) return false;
  var hasServices = Array.isArray(s.serviceList) && s.serviceList.length > 0;
  var hasWelcome  = !!(s.welcomeMessage && String(s.welcomeMessage).trim());
  var hasVoice    = !!(s.voice && String(s.voice).trim());
  return hasServices || hasWelcome || hasVoice;
}

/**
 * ¿Están los datos del negocio? DONE con que haya UNO: dirección, horario
 * o teléfono del dueño para alertas. Tolerante: cualquiera de ellos ya es
 * señal de que el dueño entró a completar su ficha.
 *
 * @param {object} s - señales { address, schedule, alertPhone }
 */
function isBusinessDataComplete(s) {
  s = s || {};
  var hasAddress = !!(s.address    && String(s.address).trim());
  var hasSched   = !!(s.schedule   && String(s.schedule).trim());
  var hasAlert   = !!(s.alertPhone && String(s.alertPhone).trim());
  return hasAddress || hasSched || hasAlert;
}

/**
 * ¿Lo ha escuchado antes de desviar? DONE con ≥1 llamada en nf_calls (de
 * cualquier dirección) — lo han probado / oído, sea con "Llámame" o real.
 *
 * @param {object} s - señales { totalCalls }
 */
function hasHeardIt(s) {
  s = s || {};
  return (Number(s.totalCalls) || 0) >= 1;
}

/**
 * ¿Está el desvío ACTIVO? La única señal fiable es una llamada ENTRANTE
 * real: el desvío se configura en el teléfono por MMI y no se puede leer
 * directamente, pero una llamada inbound demuestra que llega al asistente.
 *
 * @param {object} s - señales { inboundCalls }
 */
function isForwardingActive(s) {
  s = s || {};
  return (Number(s.inboundCalls) || 0) >= 1;
}

/**
 * Calcula el estado DONE de cada paso a partir de las señales reales.
 * Devuelve un array ordenado con la clave, si está hecho y la señal usada.
 *
 * @param {object} signals - {
 *   sector, serviceList, welcomeMessage, voice,   // asistente
 *   address, schedule, alertPhone,                // datos negocio
 *   totalCalls, inboundCalls,                      // llamadas
 * }
 * @returns {Array<{ key:string, done:boolean }>}
 */
function computeOnboardingSteps(signals) {
  signals = signals || {};
  return [
    { key: 'paid',        done: true },                            // llegaron al dashboard → pagaron
    { key: 'assistant',   done: isAssistantConfigured(signals) },
    { key: 'business',    done: isBusinessDataComplete(signals) },
    { key: 'heard',       done: hasHeardIt(signals) },
    { key: 'forwarding',  done: isForwardingActive(signals) },
  ];
}

/**
 * Resumen del cuadro: pasos, cuántos hechos, total, y si TODO está hecho
 * (→ el cuadro se debe ocultar de forma permanente).
 *
 * @param {object} signals
 * @returns {{ steps:Array, doneCount:number, total:number, allDone:boolean }}
 */
function onboardingSummary(signals) {
  var steps = computeOnboardingSteps(signals);
  var doneCount = steps.filter(function (s) { return s.done; }).length;
  return {
    steps:     steps,
    doneCount: doneCount,
    total:     steps.length,
    allDone:   doneCount === steps.length,
  };
}

module.exports = {
  isAssistantConfigured,
  isBusinessDataComplete,
  hasHeardIt,
  isForwardingActive,
  computeOnboardingSteps,
  onboardingSummary,
};
