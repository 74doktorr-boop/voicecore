'use strict';
// ============================================================
// NodeFlow — Sincronización cita ↔ Google Calendar (Fase 3)
// Encapsula org + refresco de token + create/delete, para que TANTO la reserva
// por voz (executor) COMO la confirmación/cancelación por WhatsApp (reply-handler)
// creen y BORREN el evento sin duplicar el boilerplate de OAuth.
//
// Clave: pushAppointmentEvent DEVUELVE el id del evento → se guarda en la cita
// (nf_appointments.google_event_id) para poder borrarlo al cancelar. Antes el id
// se tiraba y el evento quedaba de fantasma en el calendario del dueño.
//
// Todo FAIL-OPEN: si el negocio no tiene Google conectado, o Google falla, la
// cita sigue su curso — nunca tumba la reserva/cancelación. Deps inyectables
// (db, cal, getConfig) para poder testear sin googleapis ni red.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('CAL-SYNC');

function _resolve(deps) {
  return {
    db:  deps.db  || require('../db/database').getDatabase(),
    cal: deps.cal || require('./google-calendar').getGoogleCalendar(),
    getConfig: deps.getConfig || ((id) => {
      try { return require('../scheduling/scheduler').scheduler.getBusinessConfig(id); }
      catch (_) { return null; }
    }),
  };
}

// Refresca el token del negocio y lo guarda si cambió. Devuelve los tokens
// frescos, o null si el negocio no tiene Google conectado / no se puede.
async function _freshTokens(db, cal, businessId) {
  if (!db.enabled || !cal.enabled) return null;
  const org = await db.getOrg(businessId);
  if (!org?.google_refresh_token) return null;
  const fresh = await cal.refreshIfNeeded({
    access_token:  org.google_access_token,
    refresh_token: org.google_refresh_token,
    expiry_date:   org.google_token_expiry,
  });
  if (fresh.access_token !== org.google_access_token) {
    await db.updateOrg(businessId, {
      google_access_token: fresh.access_token,
      google_token_expiry: fresh.expiry_date,
    }).catch(() => {});
  }
  return { fresh, calendarId: org.google_calendar_id || 'primary' };
}

/**
 * Crea el evento de la cita en el Google Calendar del negocio.
 * @returns {Promise<string|null>} el id del evento creado (para guardarlo en la
 *   cita), o null si no hay Google conectado / Google falló.
 */
async function pushAppointmentEvent(businessId, appointment, deps = {}) {
  const { db, cal, getConfig } = _resolve(deps);
  try {
    const t = await _freshTokens(db, cal, businessId);
    if (!t) return null;
    const cfg = getConfig(businessId);
    const ev = await cal.createEvent(t.fresh, appointment, {
      calendarId: t.calendarId,
      timezone:   cfg?.timezone || 'Europe/Madrid',
    });
    return (ev && ev.id) || null;
  } catch (e) {
    log.warn(`pushAppointmentEvent(${businessId}): ${e.message}`);
    return null;
  }
}

/**
 * Borra el evento de Google Calendar de una cita cancelada.
 * @returns {Promise<boolean>} true si se borró.
 */
async function removeAppointmentEvent(businessId, eventId, deps = {}) {
  const { db, cal } = _resolve(deps);
  try {
    if (!eventId) return false;
    const t = await _freshTokens(db, cal, businessId);
    if (!t) return false;
    return await cal.deleteEvent(t.fresh, eventId, t.calendarId);
  } catch (e) {
    log.warn(`removeAppointmentEvent(${businessId}): ${e.message}`);
    return false;
  }
}

module.exports = { pushAppointmentEvent, removeAppointmentEvent };
