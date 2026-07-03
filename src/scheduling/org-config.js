// ============================================================
// NodeFlow — Traductor canónico: config de org (BD) → scheduler
// Bug real (Peluquería HHR, 2026-07-03): la IA respondía "no puedo
// ofrecerte una cita" a TODO. Dos causas apiladas:
//   1. El scheduler vive en memoria y nadie lo rehidrataba al
//      arrancar: tras cada deploy, toda org quedaba
//      "Business not configured".
//   2. El portal guarda el horario como {mon:{...}, tue:{...}} y
//      services como texto libre; el scheduler indexa por día
//      NUMÉRICO (0-6) y espera services como array con duración.
//      La sync en caliente copiaba el formato incompatible → todos
//      los días parecían cerrados.
// Este módulo es LA única traducción entre ambos mundos: la usan el
// arranque (hydrateSchedulerFromDB) y el portal al guardar cambios.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('ORG-CONFIG');

const DAY_KEYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Horario por defecto cuando la org aún no configuró el suyo — el mismo
// que se asigna al crear la org (routes-billing). Mejor ofrecer horario
// comercial estándar que "Business not configured" eterno.
const DEFAULT_SCHEDULE = {
  1: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  2: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  3: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  4: { open: '09:00', close: '14:00', afternoon_open: '15:30', afternoon_close: '19:30' },
  5: { open: '09:00', close: '14:00' },
};

/** "30 min" | "90 min" | "1h" | "1h 30" | 45 → minutos (defecto 30). */
function parseDurationMinutes(raw) {
  if (typeof raw === 'number' && raw > 0) return Math.round(raw);
  const s = String(raw || '').toLowerCase();
  let mins = 0;
  const h = s.match(/(\d+)\s*h(?:ora)?s?/);
  if (h) mins += parseInt(h[1], 10) * 60;
  const m = s.match(/(\d+)\s*min/);
  if (m) mins += parseInt(m[1], 10);
  if (!h && !m) {
    const n = s.match(/^\s*(\d+)\s*$/);
    if (n) mins = parseInt(n[1], 10);
  }
  return mins > 0 ? mins : 30;
}

/** Horario {mon:{...},fri:null} o {1:{...}} → claves numéricas 0-6 del scheduler. */
function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const out = {};
  for (const [key, val] of Object.entries(schedule)) {
    if (!val || typeof val !== 'object') continue; // null = cerrado
    const dayNum = key in DAY_KEYS ? DAY_KEYS[key] : (/^[0-6]$/.test(key) ? parseInt(key, 10) : null);
    if (dayNum === null) continue;
    if (!val.open || !val.close) continue;
    const day = { open: val.open, close: val.close };
    if (val.afternoon_open && val.afternoon_close) {
      day.afternoon_open = val.afternoon_open;
      day.afternoon_close = val.afternoon_close;
    }
    out[dayNum] = day;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function slug(name, i) {
  const s = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `servicio-${i}`;
}

/** serviceList estructurado (automation_config) o array libre → services del scheduler. */
function normalizeServices(serviceList, assistantServices) {
  const source = (Array.isArray(serviceList) && serviceList.length) ? serviceList
    : (Array.isArray(assistantServices) && assistantServices.length) ? assistantServices
    : null;
  if (!source) {
    // Texto libre o nada: un servicio genérico de 30 min — los huecos salen
    // igual y la IA ya conoce los servicios reales por el prompt.
    return [{ id: 'general', name: 'Servicio', duration: 30 }];
  }
  return source.map((s, i) => ({
    id: s.id || slug(s.name, i),
    name: s.name || `Servicio ${i + 1}`,
    duration: parseDurationMinutes(s.duration),
    price: s.price !== undefined ? s.price : null,
  }));
}

/**
 * Fila de organizations (id, name, assistant_config, automation_config)
 * → config que entiende el scheduler. Nunca lanza: siempre devuelve algo usable.
 */
function toSchedulerConfig(org) {
  const ac = org?.assistant_config || {};
  const serviceList = org?.automation_config?.config?.serviceList;
  return {
    name: ac.assistantName || org?.name || 'Negocio',
    timezone: 'Europe/Madrid',
    services: normalizeServices(serviceList, ac.services),
    schedule: normalizeSchedule(ac.schedule) || DEFAULT_SCHEDULE,
    slotInterval: 15,
  };
}

/**
 * Rehidrata TODAS las agendas de negocio en el scheduler desde la BD.
 * Llamar en el arranque (las configs viven en memoria y el deploy las borra).
 * @returns {Promise<number>} nº de agendas cargadas
 */
async function hydrateSchedulerFromDB(deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const scheduler = deps.scheduler || require('./scheduler').scheduler;
  if (!db.enabled) return 0;
  const { data: orgs, error } = await db.client
    .from('organizations')
    .select('id, name, assistant_config, automation_config');
  if (error) throw new Error(error.message);
  let n = 0;
  for (const org of orgs || []) {
    try {
      scheduler.setBusinessConfig(org.id, toSchedulerConfig(org));
      n++;
    } catch (e) {
      log.warn(`No se pudo hidratar la agenda de ${org.id}: ${e.message}`);
    }
  }
  return n;
}

module.exports = { toSchedulerConfig, hydrateSchedulerFromDB, normalizeSchedule, normalizeServices, parseDurationMinutes, DEFAULT_SCHEDULE };
