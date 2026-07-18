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
const { encryptSecret, decryptSecret } = require('../utils/crypto');
const log = new Logger('CAL-SYNC');

function _resolve(deps) {
  return {
    db:  deps.db  || require('../db/database').getDatabase(),
    cal: deps.cal || require('./google-calendar').getGoogleCalendar(),
    ocal: deps.ocal || (() => { try { return require('./outlook-calendar').getOutlookCalendar(); } catch (_) { return { enabled: false }; } })(),
    getConfig: deps.getConfig || ((id) => {
      try { return require('../scheduling/scheduler').scheduler.getBusinessConfig(id); }
      catch (_) { return null; }
    }),
  };
}

function _store(deps) {
  return deps.appointmentsStore
    || (() => { try { return require('../db/appointments-store').appointmentsStore; } catch (_) { return null; } })();
}

// Refresca el token de Outlook del negocio (y lo persiste si cambió). Devuelve
// { fresh, calendarId } o null si la org no tiene Outlook conectado / no se puede.
async function _freshOutlookTokens(db, ocal, businessId) {
  if (!db.enabled || !ocal || !ocal.enabled) return null;
  const org = await db.getOrg(businessId);
  if (!org?.outlook_refresh_token) return null;
  // Descifrado al leer (decryptSecret tolera legacy en claro).
  const raw = {
    access_token:  decryptSecret(org.outlook_access_token),
    refresh_token: decryptSecret(org.outlook_refresh_token),
    expiry_date:   org.outlook_token_expiry,
  };
  if (!raw.refresh_token) return null;
  const fresh = await ocal.refreshIfNeeded(raw);
  if (fresh.access_token !== raw.access_token || fresh.refresh_token !== raw.refresh_token) {
    await db.updateOrg(businessId, {
      outlook_access_token:  fresh.access_token,
      outlook_refresh_token: fresh.refresh_token,
      outlook_token_expiry:  fresh.expiry_date,
    }).catch(() => {});
  }
  return { fresh, calendarId: org.outlook_calendar_id || 'primary' };
}

// Refresca el token del negocio y lo guarda si cambió. Devuelve los tokens
// frescos, o null si el negocio no tiene Google conectado / no se puede.
async function _freshTokens(db, cal, businessId) {
  if (!db.enabled || !cal.enabled) return null;
  const org = await db.getOrg(businessId);
  if (!org?.google_refresh_token) return null;
  // Los tokens se guardan CIFRADOS en reposo (auditoría 2026-07-16); hay que
  // descifrarlos antes de hablar con Google. Sin esto, el refresh recibía el
  // blob cifrado → invalid_grant → la cita nunca llegaba al calendario (y como
  // todo es fail-open, moría en silencio). decryptSecret tolera legacy en claro.
  const raw = {
    access_token:  decryptSecret(org.google_access_token),
    refresh_token: decryptSecret(org.google_refresh_token),
    expiry_date:   org.google_token_expiry,
  };
  if (!raw.refresh_token) return null; // descifrado inválido (p.ej. clave rotada)
  const fresh = await cal.refreshIfNeeded(raw);
  if (fresh.access_token !== raw.access_token) {
    try {
      await db.updateOrg(businessId, {
        google_access_token: encryptSecret(fresh.access_token),
        google_token_expiry: fresh.expiry_date,
      });
    } catch (_) {}
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
  // Fan-out a Outlook en paralelo (independiente de Google): una org puede tener
  // uno, otro, ambos o ninguno. Guarda outlook_event_id APARTE para poder
  // borrarlo al cancelar. Fire-and-forget: nunca bloquea la reserva.
  _fanOutlookPush(businessId, appointment, deps).catch(() => {});
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

/** Crea el evento en el Outlook del negocio. @returns {Promise<string|null>} id. */
async function pushOutlookEvent(businessId, appointment, deps = {}) {
  const { db, ocal, getConfig } = _resolve(deps);
  try {
    const t = await _freshOutlookTokens(db, ocal, businessId);
    if (!t) return null;
    const cfg = getConfig(businessId);
    const ev = await ocal.createEvent(t.fresh, appointment, {
      calendarId: t.calendarId,
      timezone:   cfg?.timezone || 'Europe/Madrid',
    });
    return (ev && ev.id) || null;
  } catch (e) {
    log.warn(`pushOutlookEvent(${businessId}): ${e.message}`);
    return null;
  }
}

/** Borra un evento de Outlook. @returns {Promise<boolean>} */
async function removeOutlookEvent(businessId, eventId, deps = {}) {
  const { db, ocal } = _resolve(deps);
  try {
    if (!eventId) return false;
    const t = await _freshOutlookTokens(db, ocal, businessId);
    if (!t) return false;
    return await ocal.deleteEvent(t.fresh, eventId, t.calendarId);
  } catch (e) {
    log.warn(`removeOutlookEvent(${businessId}): ${e.message}`);
    return false;
  }
}

/** Actualiza (reprograma) un evento de Outlook. @returns {Promise<boolean>} */
async function updateOutlookEvent(businessId, eventId, appointment, deps = {}) {
  const { db, ocal, getConfig } = _resolve(deps);
  try {
    if (!eventId) return false;
    const t = await _freshOutlookTokens(db, ocal, businessId);
    if (!t) return false;
    const cfg = getConfig(businessId);
    const ev = await ocal.updateEvent(t.fresh, eventId, appointment, {
      calendarId: t.calendarId,
      timezone:   cfg?.timezone || 'Europe/Madrid',
    });
    return !!ev;
  } catch (e) {
    log.warn(`updateOutlookEvent(${businessId}): ${e.message}`);
    return false;
  }
}

// Empuja a Outlook y persiste el id en la cita (outlookEventId ↔ outlook_event_id).
async function _fanOutlookPush(businessId, appointment, deps = {}) {
  const oid = await pushOutlookEvent(businessId, appointment, deps);
  if (oid && appointment && appointment.id) {
    appointment.outlookEventId = oid;
    const store = _store(deps);
    if (store && store.patch) store.patch(appointment.id, { outlookEventId: oid });
  }
  return oid;
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

/**
 * Mueve/actualiza el evento de Google Calendar de una cita REPROGRAMADA (cambio
 * de fecha/hora en el portal). Sin esto el evento quedaba en la hora vieja.
 * Fail-open. @returns {Promise<boolean>} true si se actualizó.
 */
async function updateAppointmentEvent(businessId, eventId, appointment, deps = {}) {
  const { db, cal, getConfig } = _resolve(deps);
  try {
    if (!eventId) return false;
    const t = await _freshTokens(db, cal, businessId);
    if (!t) return false;
    const cfg = getConfig(businessId);
    const ev = await cal.updateEvent(t.fresh, eventId, appointment, {
      calendarId: t.calendarId,
      timezone:   cfg?.timezone || 'Europe/Madrid',
    });
    return !!ev;
  } catch (e) {
    log.warn(`updateAppointmentEvent(${businessId}): ${e.message}`);
    return false;
  }
}

/**
 * Cancela en Google Calendar el evento de una cita cancelada, VENGA DE DONDE
 * VENGA (WhatsApp, voz o portal): borra el evento y limpia el id guardado, para
 * que no quede de fantasma en el calendario del dueño. Fail-open, fire-and-forget.
 * Deps inyectables (removeAppointmentEvent, appointmentsStore) para tests.
 * @returns {Promise<boolean>} true si se borró el evento.
 */
async function syncCancelToCalendar(apt, deps = {}) {
  if (!apt || !apt.businessId) return false;
  if (!apt.googleEventId && !apt.outlookEventId) return false;
  const remove   = deps.removeAppointmentEvent || removeAppointmentEvent;
  const removeO  = deps.removeOutlookEvent      || removeOutlookEvent;
  const store    = _store(deps);
  let any = false;

  if (apt.googleEventId) {
    const ok = await remove(apt.businessId, apt.googleEventId, deps);
    if (ok) {
      apt.googleEventId = null;
      if (store && store.patch) store.patch(apt.id, { googleEventId: null });
      any = true;
    }
  }
  if (apt.outlookEventId) {
    const okO = await removeO(apt.businessId, apt.outlookEventId, deps);
    if (okO) {
      apt.outlookEventId = null;
      if (store && store.patch) store.patch(apt.id, { outlookEventId: null });
      any = true;
    }
  }
  return any;
}

module.exports = {
  pushAppointmentEvent, removeAppointmentEvent, updateAppointmentEvent, syncCancelToCalendar,
  pushOutlookEvent, removeOutlookEvent, updateOutlookEvent,
};
