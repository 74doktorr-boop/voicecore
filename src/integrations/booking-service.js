// ============================================================
// NodeFlow — Orquestador de reservas en webs externas (RPA)
// Une: receta declarativa + config del negocio + datos de la cita.
// Ejecuta y, pase lo que pase, GARANTIZA que la cita no se pierde:
//   • OK   → notifica "reservada" (cliente + negocio) y devuelve la ref.
//   • FALLO→ fallback humano: avisa al negocio con todos los datos +
//            captura del error para que la metan a mano.
// Tanto el driver como el notificador se inyectan → 100% testeable y
// reutilizable para cualquier cliente/software (solo cambia la receta).
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const { runRecipe } = require('./recipe-engine');
const log = new Logger('BOOKING');

async function safeNotify(notify, payload) {
  if (typeof notify !== 'function') return;
  try { await notify(payload); }
  catch (e) { log.warn(`notify falló (${payload.type}): ${e.message}`); }
}

/**
 * Reserva una cita ejecutando una receta sobre una web externa.
 * @param {object} p
 * @param {object} p.recipe         - receta declarativa (organizate/stormplus/…)
 * @param {object} p.org            - { id, name, ... + URLs/credenciales para la receta }
 * @param {object} p.appt           - { service, date, time, sede, ... }
 * @param {object} p.patient        - { name, phone, email, ... }
 * @param {Function} [p.driverFactory] - async (ctx)=>driver. Por defecto Playwright.
 * @param {Function} [p.notify]     - async (evento)=>void  (WhatsApp/email de NodeFlow)
 * @param {boolean} [p.headless]
 * @returns {Promise<{ok, ref?, evidence, error?, fallback?}>}
 */
async function bookAppointment(p) {
  const { recipe, org = {}, appt = {}, patient = {}, notify } = p;
  const ctx = { org, appt, patient, bookingUrl: org.bookingUrl, ...p.extra };

  // 1) Arrancar el driver (navegador). Si ni eso → fallback humano directo.
  let driver;
  try {
    driver = p.driverFactory
      ? await p.driverFactory(ctx)
      : await require('./drivers/playwright-driver').PlaywrightDriver.launch({ headless: p.headless !== false });
  } catch (e) {
    log.error(`No se pudo iniciar el navegador: ${e.message}`);
    await safeNotify(notify, { type: 'manual_needed', reason: 'sin_navegador', org, appt, patient, error: e.message });
    return { ok: false, fallback: 'human', error: e.message, evidence: [] };
  }

  // 2) Ejecutar la receta (en dry-run se salta el envío final → no crea cita real).
  const dryRun = p.dryRun === true;
  let r;
  try {
    r = await runRecipe(recipe, ctx, driver, { dryRun });
  } finally {
    if (driver && typeof driver.close === 'function') { try { await driver.close(); } catch (_) {} }
  }

  // 3) Resultado.
  if (r.ok) {
    if (dryRun) {
      log.info(`DRY-RUN OK en ${recipe.id}: formulario rellenado sin enviar.`);
      return { ok: true, dryRun: true, evidence: r.evidence, captured: r.captured };
    }
    log.info(`Cita reservada en ${recipe.id} para ${patient.name || '—'} (${appt.service || '—'} ${appt.date || ''} ${appt.time || ''})`);
    await safeNotify(notify, {
      type: 'booked', org, appt, patient,
      ref: r.captured?.referencia || null, evidence: r.evidence,
    });
    return { ok: true, ref: r.captured?.referencia || null, captured: r.captured, evidence: r.evidence };
  }

  // Fallback humano — la cita NO se pierde.
  log.warn(`Reserva automática falló (${recipe.id}) → fallback humano. ${r.error}`);
  await safeNotify(notify, {
    type: 'manual_needed', reason: 'recipe_failed', org, appt, patient,
    error: r.error, evidence: r.evidence,
  });
  return { ok: false, fallback: 'human', error: r.error, evidence: r.evidence };
}

module.exports = { bookAppointment, safeNotify };
