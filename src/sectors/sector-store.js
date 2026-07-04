// ============================================================
// NodeFlow — Persistencia de sectores custom (2026-07-04)
// ------------------------------------------------------------
// Los sectores de la SEMILLA viven en código (32 curados). Los que se
// aprueban en caliente (auto-borrador → aprobación) se guardan en la
// tabla nf_sectors y se re-hidratan al arrancar. FAIL-OPEN: si la tabla
// no existe todavía, el sistema funciona igual con la semilla (solo se
// pierden los custom hasta crear la tabla). Cero I/O bloqueante en boot.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('SECTOR-STORE');
const { hydrate, upsertSector } = require('./sector-registry');

const TABLE = 'nf_sectors';

/** Lee las defs de sectores custom activas de BD (fail-open → []). */
async function loadCustomSectors(db) {
  if (!db || !db.enabled) return [];
  try {
    const { data, error } = await db.client.from(TABLE).select('definition').eq('active', true);
    if (error) throw new Error(error.message);
    return (data || []).map(r => r.definition).filter(Boolean);
  } catch (e) {
    log.warn(`Sectores custom no cargados (${e.message}). ¿Falta la tabla ${TABLE}? Se usa solo la semilla.`);
    return [];
  }
}

/** Carga los sectores custom de BD en la caché del registro. */
async function hydrateFromDb(db) {
  const defs = await loadCustomSectors(db);
  const n = hydrate(defs);
  if (n) log.info(`${n} sector(es) custom cargado(s) de BD`);
  return n;
}

/**
 * Aprueba y guarda un sector custom: valida + lo mete en caché EN CALIENTE y lo
 * persiste. Si la persistencia falla (tabla ausente), queda en caché igualmente
 * (persisted:false) para no bloquear la operación.
 */
async function saveSector(db, rawDef) {
  const def = upsertSector(rawDef); // normaliza + a caché; null si inválido o pisa semilla
  if (!def) return { ok: false, error: 'Definición inválida o pisa un sector de la semilla' };
  if (db && db.enabled) {
    try {
      const { error } = await db.client.from(TABLE)
        .upsert({ slug: def.slug, definition: def, active: true }, { onConflict: 'slug' });
      if (error) throw new Error(error.message);
      return { ok: true, persisted: true, sector: def };
    } catch (e) {
      log.warn(`Sector "${def.slug}" en caché pero NO persistido: ${e.message}`);
      return { ok: true, persisted: false, sector: def, warning: e.message };
    }
  }
  return { ok: true, persisted: false, sector: def };
}

module.exports = { hydrateFromDb, saveSector, loadCustomSectors, TABLE };
