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
const { hydrate, upsertSector, normalizeSectorDef, isCurated } = require('./sector-registry');

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

/**
 * Guarda un borrador de sector como PENDIENTE (active:false) — p.ej. el que
 * genera el onboarding para un vertical nuevo. NO entra en la caché viva hasta
 * que el fundador lo apruebe. Idempotente por slug; no pisa un sector ya activo.
 */
async function saveDraft(db, rawDef) {
  const def = normalizeSectorDef(rawDef);
  if (!def) return { ok: false, error: 'Definición inválida' };
  if (isCurated(def.slug)) return { ok: true, already: true, sector: def }; // ya existe (semilla o activo)
  if (!db || !db.enabled) return { ok: true, persisted: false, pending: true, sector: def };
  try {
    const { data: existing } = await db.client.from(TABLE).select('active').eq('slug', def.slug).maybeSingle();
    if (existing && existing.active) return { ok: true, already: true, sector: def };
    const { error } = await db.client.from(TABLE)
      .upsert({ slug: def.slug, definition: def, active: false, updated_at: new Date().toISOString() }, { onConflict: 'slug' });
    if (error) throw new Error(error.message);
    log.info(`Borrador de sector pendiente: ${def.slug}`);
    return { ok: true, persisted: true, pending: true, sector: def };
  } catch (e) {
    log.warn(`saveDraft(${def.slug}) falló: ${e.message}`);
    return { ok: true, persisted: false, pending: true, sector: def, warning: e.message };
  }
}

/** Borradores pendientes de revisión (active:false). */
async function listPending(db) {
  if (!db || !db.enabled) return [];
  try {
    const { data, error } = await db.client.from(TABLE).select('definition').eq('active', false);
    if (error) throw new Error(error.message);
    return (data || []).map(r => r.definition).filter(Boolean);
  } catch (e) {
    log.warn(`listPending falló: ${e.message}`);
    return [];
  }
}

/** Aprueba un borrador: lo activa en BD y lo mete en la caché viva. */
async function approveSector(db, slug) {
  if (!db || !db.enabled) return { ok: false, error: 'Sin BD' };
  try {
    const { data, error } = await db.client.from(TABLE)
      .update({ active: true, updated_at: new Date().toISOString() }).eq('slug', slug).select('definition').maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, error: 'No existe ese borrador' };
    const def = upsertSector(data.definition); // a la caché viva
    return { ok: !!def, sector: def };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Descarta un borrador pendiente. */
async function discardSector(db, slug) {
  if (!db || !db.enabled) return { ok: false, error: 'Sin BD' };
  try {
    const { error } = await db.client.from(TABLE).delete().eq('slug', slug).eq('active', false);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { hydrateFromDb, saveSector, saveDraft, listPending, approveSector, discardSector, loadCustomSectors, TABLE };
