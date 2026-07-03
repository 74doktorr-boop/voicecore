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

/** "15€" | "15 euros" | 15 | "consultar" → número o null (jamás string).
 *  Bug real (APT-1002, 2026-07-03): el precio "15€" viajó como string hasta
 *  la columna NUMERIC de nf_appointments → insert rechazado → la cita del
 *  cliente existía solo en memoria y el siguiente deploy la habría borrado. */
function parsePriceEuros(raw) {
  if (typeof raw === 'number' && isFinite(raw)) return raw;
  const m = String(raw || '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

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
    // Cierres a medianoche o nocturnos: "00:00-00:00" significa TODO el día
    // (bug real 2026-07-03: el dueño puso L-D 00:00-00:00 y el asistente lo
    // leyó como cerrado). Un cierre menor que la apertura ("09:00-02:00")
    // se recorta a fin de día — los tramos que cruzan medianoche de verdad
    // van con la capacidad/seats en la revisión del scheduler.
    let close = val.close;
    if (close <= val.open) close = '24:00';
    const day = { open: val.open, close };
    if (val.afternoon_open && val.afternoon_close) {
      day.afternoon_open = val.afternoon_open;
      day.afternoon_close = val.afternoon_close <= val.afternoon_open ? '24:00' : val.afternoon_close;
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
    price: parsePriceEuros(s.price),
  }));
}

/**
 * Texto libre del portal ("Corte 15€ 30 min\nTinte 45€") → serviceList
 * estructurado. Bug real (2026-07-03): el cliente editó sus servicios en el
 * portal (assistant_config.services) pero la lista ESTRUCTURADA
 * (automation_config.serviceList) siguió siendo la antigua — y es la que se
 * inyecta como "precios estructurados" en cada llamada. La IA ofrecía
 * servicios que el negocio ya no tenía. Una edición del dueño = UNA verdad.
 * @returns {Array|null} serviceList o null si no hay nada aprovechable
 */
function parseServicesText(input) {
  if (Array.isArray(input)) {
    // UI estructurada del futuro: normalizar y pasar
    return input.filter(s => s && (s.name || typeof s === 'string'))
      .map(s => (typeof s === 'string' ? { name: s.trim() } : s));
  }
  const text = String(input || '').trim();
  if (!text) return null;
  const lines = text.split(/\r?\n|;|·/).map(l => l.trim()).filter(Boolean);
  return lines.map(line => {
    const price = line.match(/(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/i);
    const dur = line.match(/(\d+\s*(?:min|h(?:oras?)?)|(?:\d+\s*h\s*\d+))/i);
    let name = line
      .replace(price ? price[0] : '', '')
      .replace(dur ? dur[0] : '', '')
      .replace(/[-–—:,]+\s*$/g, '').replace(/^\s*[-–—:,]+/g, '')
      .replace(/\s{2,}/g, ' ').trim();
    if (!name) name = line;
    const item = { name };
    if (price) item.price = price[1].replace(',', '.') + '€';
    if (dur) item.duration = dur[1];
    return item;
  });
}

/**
 * Siembra ÚNICA: texto libre legacy → serviceList SOLO si la tabla está
 * vacía. La tabla estructurada es LA fuente de verdad (#8, 2026-07-03):
 * guardar la pestaña Asistente regeneraba serviceList desde el textarea y
 * pisaba lo que el dueño había editado en la tabla de Configuración.
 * @returns {Array|null} lista a escribir, o null = no tocar nada
 */
function seedServiceListFromText(existingList, text) {
  if (Array.isArray(existingList) && existingList.length > 0) return null;
  const parsed = parseServicesText(text);
  return (parsed && parsed.length) ? parsed : null;
}

/**
 * Tras CUALQUIER guardado de config en el portal: re-hidrata la agenda del
 * scheduler y invalida el asistente cacheado. Antes solo lo hacía
 * PUT /assistant — guardar la TABLA de servicios (PATCH /config) no
 * refrescaba las duraciones hasta el siguiente deploy.
 * @returns {Promise<boolean>} true si la org existía y se sincronizó
 */
async function syncOrgRuntime(businessId, deps = {}) {
  const db = deps.db || require('../db/database').getDatabase();
  const scheduler = deps.scheduler || require('./scheduler').scheduler;
  const invalidate = deps.invalidate || require('../assistants/org-assistant').invalidateOrgAssistant;
  if (!db.enabled) return false;
  const { data: org } = await db.client
    .from('organizations').select('id, name, assistant_config, automation_config')
    .eq('id', businessId).single();
  if (!org) return false;
  scheduler.setBusinessConfig(businessId, toSchedulerConfig(org));
  invalidate(businessId);
  return true;
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

module.exports = { toSchedulerConfig, hydrateSchedulerFromDB, normalizeSchedule, normalizeServices, parseDurationMinutes, parsePriceEuros, parseServicesText, seedServiceListFromText, syncOrgRuntime, DEFAULT_SCHEDULE };
