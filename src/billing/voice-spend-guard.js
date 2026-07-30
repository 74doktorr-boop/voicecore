'use strict';
// ============================================================
// NodeFlow — ¿Puede esta organización seguir gastando minutos de voz?
//
// POR QUÉ EXISTE (2026-07-30):
// `checkUsageLimits` estaba montado en UN solo sitio: `/api/calls/outbound`.
// Las llamadas ENTRANTES —que son el producto— no pasaban por ningún control de
// gasto. Una org podía consumir minutos sin techo, y cada minuto cuesta dinero
// de verdad (Telnyx + STT + LLM + TTS).
//
// LA REGLA, Y POR QUÉ NO ES "BAJAR EL TOPE":
// La auditoría del 29/07 recomendaba bajar `hardCapMultiplier` de 3 a 2. Al ir a
// hacerlo se ve que es la respuesta equivocada a la pregunta correcta: cortarle
// las llamadas a un cliente que consume 1.000 minutos es AUTOLESIÓN si el
// overage se le está cobrando — cada minuto extra son 0,15 € de ingreso, y la
// promesa del producto es "no pierdas ninguna llamada".
//
// Lo que decide no es cuántos minutos son, sino QUIÉN LOS PAGA:
//
//   · Con suscripción activa → los minutos extra se facturan. El tope solo
//     existe contra un bucle o un abuso, y se queda alto (3×).
//   · Sin suscripción (prueba, demo, alta a medias) → NADIE paga esos minutos.
//     Son pérdida pura, y ahí el tope tiene que ser estrecho.
//
// Hoy en producción NINGUNA org tiene `stripe_subscription_id`. O sea que el
// caso "sin suscripción" no es el raro: es el único que hay.
//
// Cortar NUNCA es en silencio: quien llama oye un mensaje, y el dueño recibe
// aviso. Ver [feedback: no fallbacks silenciosos que gasten dinero].
//
// Todo PURO: entra la fila de la org y los límites de su plan, sale un veredicto.
// ============================================================

// Margen de cortesía sobre lo incluido cuando no hay quien pague los minutos.
// No es cero para no cortar a alguien por un redondeo o por una llamada larga
// justo en el límite.
const MARGEN_SIN_PAGAR = 1.2;

/**
 * ¿Puede seguir gastando? PURA.
 *
 * @param {{monthly_minutes_used?:number, stripe_subscription_id?:string, plan?:string}} org
 * @param {{minutesPerMonth:number, overage?:boolean, hardCapMultiplier?:number}} limites
 * @returns {{
 *   nivel: 'ok'|'overage'|'tope',
 *   usados: number, incluidos: number, tope: number,
 *   loPaga: boolean, restantes: number, motivo: string
 * }}
 */
function voiceSpendStatus(org = {}, limites = {}) {
  const incluidos = Number(limites.minutesPerMonth) || 0;
  const usados = Math.max(0, Number(org.monthly_minutes_used) || 0);

  // "Lo paga alguien" = el plan admite overage Y hay una suscripción viva.
  // Si falta la suscripción, los minutos extra se cuentan y no se cobran.
  const loPaga = !!limites.overage && !!org.stripe_subscription_id;

  const tope = loPaga
    ? incluidos * (Number(limites.hardCapMultiplier) || 3)
    : Math.ceil(incluidos * MARGEN_SIN_PAGAR);

  const base = { usados, incluidos, tope, loPaga, restantes: Math.max(0, tope - usados) };

  if (incluidos <= 0) {
    // Sin límite definido no inventamos uno: fail-open, pero visible.
    return { ...base, nivel: 'ok', motivo: 'el plan no define minutos incluidos' };
  }
  if (usados >= tope) {
    return {
      ...base, nivel: 'tope',
      motivo: loPaga
        ? `tope de seguridad: ${Math.round(usados)} min sobre ${incluidos} incluidos (×${limites.hardCapMultiplier || 3})`
        : `${Math.round(usados)} min consumidos y sin suscripción activa: nadie paga estos minutos`,
    };
  }
  if (usados >= incluidos) {
    return {
      ...base, nivel: 'overage',
      motivo: loPaga
        ? `${Math.round(usados - incluidos)} min extra, se facturan`
        : `${Math.round(usados - incluidos)} min extra SIN suscripción: no se están cobrando`,
    };
  }
  return { ...base, nivel: 'ok', motivo: '' };
}

/**
 * ¿Hay que rechazar esta llamada entrante? PURA.
 *
 * Se separa de `voiceSpendStatus` a propósito: el estado sirve para avisar y
 * para pintar el portal; esto es la ÚNICA pregunta que cuelga una llamada, y
 * quiero poder leerla de un vistazo.
 *
 * A UN CLIENTE QUE PAGA NO SE LE CORTA NUNCA, aunque llegue al tope. Dos
 * motivos, y el segundo pesa más que el primero:
 *
 *  1. Sus minutos extra son ingreso (0,15 €/min). Cortarlos es autolesión.
 *  2. Su contador se pone a cero con el webhook `invoice.paid` de Stripe
 *     (routes-billing.js). Si ese webhook se pierde UNA vez —caída, firma,
 *     reintento agotado— `monthly_minutes_used` no vuelve a bajar nunca, y el
 *     tope acabaría colgándole las llamadas a un cliente que está al día por un
 *     fallo NUESTRO. El precio de equivocarse en esa dirección es perder al
 *     cliente; en la otra, unos euros de minutos.
 *
 * Al que paga y llega al tope se le avisa a gritos, y decide un humano.
 */
function debeRechazarLlamada(estado) {
  return !!estado && estado.nivel === 'tope' && !estado.loPaga;
}

module.exports = { voiceSpendStatus, debeRechazarLlamada, MARGEN_SIN_PAGAR };
