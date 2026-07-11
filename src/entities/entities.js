// ============================================================
// NodeFlow — ENTIDADES v0: CRUD + validación de attrs
// ------------------------------------------------------------
// Regla del Engineering Charter: la validación vive AQUÍ (código),
// no en el LLM ni en la BD. validateAttrs y computeDisplayName son
// funciones PURAS — testeables sin Supabase.
// Todas las operaciones son org-scoped SIEMPRE (organization_id en
// cada query): una org jamás ve entidades de otra.
// ============================================================
'use strict';

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('ENTITIES');

// ─── Validación pura de attrs contra las definiciones de campo ───────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Valida (y limpia) attrs contra las definiciones de campo del tipo.
 * - claves desconocidas: se DESCARTAN (nunca entran a la BD)
 * - partial=true (PATCH): no exige required en campos ausentes
 * - '' / null en un campo = borrar el valor (se guarda null)
 * @returns {{ ok: boolean, errors: Array<{field, error}>, attrs: object }}
 */
function validateAttrs(fields, attrs, opts = {}) {
  const partial = !!opts.partial;
  const errors  = [];
  const clean   = {};
  const input   = (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) ? attrs : {};

  for (const f of (fields || [])) {
    const has = Object.prototype.hasOwnProperty.call(input, f.key);
    let v = has ? input[f.key] : undefined;

    // Vacío = sin valor
    if (v === '' || v === null) v = undefined;
    if (typeof v === 'string') v = v.trim() || undefined;

    if (v === undefined) {
      if (f.required && !partial) {
        errors.push({ field: f.key, error: `«${f.label || f.key}» es obligatorio` });
      } else if (has) {
        clean[f.key] = null; // borrado explícito en PATCH
      }
      continue;
    }

    switch (f.type) {
      case 'text':
      case 'phone':
        clean[f.key] = String(v).slice(0, 300);
        break;
      case 'note':
        clean[f.key] = String(v).slice(0, 4000);
        break;
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (!isFinite(n)) errors.push({ field: f.key, error: `«${f.label || f.key}» debe ser un número` });
        else clean[f.key] = n;
        break;
      }
      case 'date': {
        const s = String(v).slice(0, 10);
        if (!_isValidDate(s)) errors.push({ field: f.key, error: `«${f.label || f.key}» debe ser una fecha válida (AAAA-MM-DD)` });
        else clean[f.key] = s;
        break;
      }
      case 'boolean':
        clean[f.key] = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'select': {
        const valid = new Set((f.options || []).map(o => o.value));
        const s = String(v);
        if (valid.size && !valid.has(s)) errors.push({ field: f.key, error: `«${f.label || f.key}» tiene un valor no permitido` });
        else clean[f.key] = s;
        break;
      }
      case 'multiselect': {
        const valid = new Set((f.options || []).map(o => o.value));
        const arr = Array.isArray(v) ? v : [v];
        const bad = valid.size ? arr.filter(x => !valid.has(String(x))) : [];
        if (bad.length) errors.push({ field: f.key, error: `«${f.label || f.key}» tiene valores no permitidos` });
        else clean[f.key] = arr.map(String);
        break;
      }
      default:
        // Tipo desconocido: se descarta en silencio (cap de 8 tipos v0)
        break;
    }
  }

  return { ok: errors.length === 0, errors, attrs: clean };
}

/**
 * Computa el display_name desde el label_template ('{{marca}} {{modelo}} ·
 * {{matricula}}') y los attrs. Desnormalizado al escribir (lección 1.3 de
 * Twenty): chips, listas y buscador universales sin conocer el tipo.
 * PURA. Nunca devuelve vacío: cae al fallback.
 */
function computeDisplayName(labelTemplate, attrs, fallback = 'Sin nombre') {
  const a = attrs || {};
  let out = String(labelTemplate || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const v = a[key];
    if (v === undefined || v === null || v === '') return '';
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
  // Limpia separadores huérfanos ("· " sin matrícula) y espacios dobles
  out = out.replace(/\s*[·|,-]\s*$/g, '').replace(/^\s*[·|,-]\s*/g, '')
           .replace(/\s+[·|]\s+(?=[·|]|$)/g, ' ').replace(/\(\s*\)/g, '')
           .replace(/\s{2,}/g, ' ').trim();
  return out || fallback;
}

/** Normaliza una matrícula/nº chip para comparar: mayúsculas, solo [A-Z0-9]. */
function normalizePlate(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * PURA — normaliza el valor de un campo identificador para comparar:
 * sin acentos, mayúsculas, solo [A-Z0-9]. «1234-ABC» == «1234 abc»,
 * «Calle José 5, 2ºB» == «calle jose 5 2b». '' si no hay valor.
 */
function normalizeIdentifier(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Busca una entidad viva del tipo cuyo attrs[fieldKey] normalizado coincida
 * con value (anti-duplicados del alta manual y upsert de importación).
 * Pagina en BD y compara en código: la normalización no vive en PostgREST.
 * @returns la entidad {id, contact_id, display_name, attrs} o null
 */
async function findEntityByIdentifier({ orgId, entityTypeId, fieldKey, value, db }) {
  db = db || getDatabase();
  if (!db.enabled) return null;
  const target = normalizeIdentifier(value);
  if (!target) return null;

  const PAGE = 1000, MAX_SCAN = 10000;
  for (let from = 0; from < MAX_SCAN; from += PAGE) {
    const { data, error } = await db.client.from('nf_entities')
      .select('id, contact_id, display_name, attrs')
      .eq('organization_id', orgId)
      .eq('entity_type_id', entityTypeId)
      .eq('is_archived', false)
      .range(from, from + PAGE - 1);
    if (error) {
      log.warn(`findEntityByIdentifier(${orgId}): ${error.message}`);
      return null;
    }
    for (const e of (data || [])) {
      if (normalizeIdentifier((e.attrs || {})[fieldKey]) === target) return e;
    }
    if (!data || data.length < PAGE) break;
  }
  return null;
}

// ─── Timeline de eventos (best effort, jamás rompe la operación) ─────────────

async function _logEvent(db, { orgId, entityId, kind, title, properties, actor }) {
  try {
    await db.client.from('nf_entity_events').insert({
      organization_id: orgId,
      entity_id:       entityId,
      kind,
      title:           title || null,
      properties:      properties || {},
      actor:           actor || 'staff',
    });
  } catch (e) { log.warn(`event ${kind} no registrado: ${e.message}`); }
}

/** Diff plano {campo:{antes,despues}} solo de las claves que cambian. */
function diffAttrs(before, after) {
  const diff = {};
  for (const k of Object.keys(after || {})) {
    const a = before ? before[k] : undefined;
    const b = after[k];
    if (JSON.stringify(a === undefined ? null : a) !== JSON.stringify(b)) {
      diff[k] = { antes: a === undefined ? null : a, despues: b };
    }
  }
  return diff;
}

// ─── CRUD org-scoped ─────────────────────────────────────────────────────────

/**
 * Lista entidades de un tipo (org-scoped). q busca en display_name y, si
 * parece matrícula/chip, también por atributo normalizado.
 */
async function listEntities({ orgId, entityTypeId, q, limit = 200, db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, entities: [] };

  let query = db.client
    .from('nf_entities')
    .select('id, entity_type_id, contact_id, display_name, attrs, created_at, updated_at')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(Math.min(limit, 500));

  if (entityTypeId) query = query.eq('entity_type_id', entityTypeId);

  if (q) {
    // Sanitizado PostgREST (mismo criterio que /contacts, BUG-48): fuera
    // caracteres con significado en la sintaxis de filtros (, ( ) etc.)
    const safeQ = String(q).replace(/[^a-zA-Z0-9 .@+\-_áéíóúàèìòùäëïöüñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇ]/g, '').slice(0, 80);
    if (safeQ) query = query.ilike('display_name', `%${safeQ}%`);
  }

  const { data, error } = await query;
  if (error) {
    log.warn(`listEntities(${orgId}): ${error.message}`);
    return { ok: false, entities: [], error: error.message };
  }
  return { ok: true, entities: data || [] };
}

/** Una entidad por id — SIEMPRE con organization_id (cero cross-tenant). */
async function getEntity({ orgId, entityId, db }) {
  db = db || getDatabase();
  if (!db.enabled) return null;
  const { data } = await db.client
    .from('nf_entities')
    .select('id, entity_type_id, contact_id, display_name, attrs, is_archived, created_at, updated_at')
    .eq('organization_id', orgId)
    .eq('id', entityId)
    .maybeSingle();
  return data || null;
}

/**
 * Crea una entidad validando attrs contra el tipo. Registra evento 'created'.
 * @param entityType fila de nf_entity_types (con fields y label_template)
 */
async function createEntity({ orgId, entityType, attrs, contactId, actor = 'staff', db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, error: 'db_disabled' };

  const v = validateAttrs(entityType.fields || [], attrs, { partial: false });
  if (!v.ok) return { ok: false, errors: v.errors };

  // Plan por sesiones: si el dueño puso la CADENCIA (+ primera sesión + total),
  // se calculan solos próxima sesión / restantes / caducidad. No-op si no la usa.
  v.attrs = require('./session-plan').reconcilePlanAttrs(v.attrs);

  const display = computeDisplayName(entityType.label_template, v.attrs, entityType.label_singular);
  const { data, error } = await db.client.from('nf_entities').insert({
    organization_id: orgId,
    entity_type_id:  entityType.id,
    contact_id:      contactId || null,
    display_name:    display,
    attrs:           v.attrs,
  }).select().single();

  if (error) {
    log.warn(`createEntity(${orgId}): ${error.message}`);
    return { ok: false, error: error.message };
  }

  await _logEvent(db, {
    orgId, entityId: data.id, kind: 'created',
    title: `${entityType.label_singular} creado: ${display}`, actor,
  });
  return { ok: true, entity: data };
}

/**
 * Actualiza attrs (merge parcial) y/o contact_id. Recomputa display_name al
 * escribir (mitiga el riesgo 4 del diseño: etiqueta rancia) y registra el
 * diff como evento 'field_change'.
 */
async function updateEntity({ orgId, entityType, entityId, attrs, contactId, actor = 'staff', db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, error: 'db_disabled' };

  const current = await getEntity({ orgId, entityId, db });
  if (!current) return { ok: false, error: 'not_found' };

  const patch = { updated_at: new Date().toISOString() };
  let merged  = current.attrs || {};

  if (attrs && typeof attrs === 'object') {
    const v = validateAttrs(entityType.fields || [], attrs, { partial: true });
    if (!v.ok) return { ok: false, errors: v.errors };
    merged = { ...merged, ...v.attrs };
    // null = borrar el valor
    for (const k of Object.keys(merged)) { if (merged[k] === null) delete merged[k]; }
    // Recalcular los derivados del plan por sesiones con el estado completo
    // (cadencia + primera sesión + hechas). No-op si no se usa la cadencia.
    merged = require('./session-plan').reconcilePlanAttrs(merged);
    // Borrador de la IA que se completa: al tener todos los required, el
    // badge «completar ficha» se apaga SOLO (regla en código, no en la UI).
    if (merged.is_draft) {
      const { draftIsComplete } = require('./entity-ai');
      if (draftIsComplete(entityType.fields || [], merged)) delete merged.is_draft;
    }
    patch.attrs        = merged;
    patch.display_name = computeDisplayName(entityType.label_template, merged, entityType.label_singular);
  }
  if (contactId !== undefined) patch.contact_id = contactId || null;

  const { data, error } = await db.client.from('nf_entities')
    .update(patch)
    .eq('organization_id', orgId)
    .eq('id', entityId)
    .select().single();

  if (error) {
    log.warn(`updateEntity(${orgId}/${entityId}): ${error.message}`);
    return { ok: false, error: error.message };
  }

  if (patch.attrs) {
    const diff = diffAttrs(current.attrs || {}, patch.attrs);
    if (Object.keys(diff).length) {
      await _logEvent(db, {
        orgId, entityId, kind: 'field_change',
        title: `Datos actualizados: ${Object.keys(diff).join(', ')}`,
        properties: diff, actor,
      });
    }
  }
  return { ok: true, entity: data };
}

/**
 * Crea una ficha BORRADOR desde la voz (create_entity_draft): el llamante
 * menciona un coche/mascota nuevo y la IA la abre con lo que haya recogido.
 * Los required de TEXTO pueden faltar (validación partial) — se marca
 * attrs.is_draft=true y el portal enseña «completar ficha». Los valores
 * presentes se validan IGUAL de estrictos (tipos, opciones, fechas).
 */
async function createEntityDraft({ orgId, entityType, attrs, contactId, actor = 'ai', db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, error: 'db_disabled' };

  const v = validateAttrs(entityType.fields || [], attrs, { partial: true });
  if (!v.ok) return { ok: false, errors: v.errors };
  const clean = { ...v.attrs };
  for (const k of Object.keys(clean)) { if (clean[k] === null) delete clean[k]; }

  const { draftIsComplete } = require('./entity-ai');
  if (!draftIsComplete(entityType.fields || [], clean)) clean.is_draft = true;

  const display = computeDisplayName(entityType.label_template, clean, entityType.label_singular);
  const { data, error } = await db.client.from('nf_entities').insert({
    organization_id: orgId,
    entity_type_id:  entityType.id,
    contact_id:      contactId || null,
    display_name:    display,
    attrs:           clean,
  }).select().single();

  if (error) {
    log.warn(`createEntityDraft(${orgId}): ${error.message}`);
    return { ok: false, error: error.message };
  }

  await _logEvent(db, {
    orgId, entityId: data.id, kind: 'created',
    title: `${entityType.label_singular} creado durante una llamada: ${display}`,
    properties: clean.is_draft ? { is_draft: true } : {},
    actor,
  });
  return { ok: true, entity: data, isDraft: !!clean.is_draft };
}

/**
 * Nota manual en el timeline de la ficha («añadir nota» de la ficha viva).
 * Verifica pertenencia org-scoped ANTES de escribir (cero cross-tenant).
 */
async function addEntityNote({ orgId, entityId, text, actor = 'staff', db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, error: 'db_disabled' };

  const clean = String(text || '').trim().slice(0, 500);
  if (!clean) return { ok: false, error: 'Escribe la nota antes de guardar' };

  const entity = await getEntity({ orgId, entityId, db });
  if (!entity) return { ok: false, error: 'not_found' };

  const { error } = await db.client.from('nf_entity_events').insert({
    organization_id: orgId,
    entity_id:       entityId,
    kind:            'note',
    title:           clean,
    actor:           actor === 'ai' ? 'ai' : 'staff',
  });
  if (error) return { ok: false, error: error.message };

  // La ficha "se mueve": sube en las listas ordenadas por updated_at
  await db.client.from('nf_entities')
    .update({ updated_at: new Date().toISOString() })
    .eq('organization_id', orgId).eq('id', entityId)
    .then(undefined, () => {});
  return { ok: true };
}

/** Archiva (borrado suave — desaparece de listas y del materializador). */
async function archiveEntity({ orgId, entityId, actor = 'staff', db }) {
  db = db || getDatabase();
  if (!db.enabled) return { ok: false, error: 'db_disabled' };

  const { error } = await db.client.from('nf_entities')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('id', entityId);
  if (error) return { ok: false, error: error.message };

  // Cancela recordatorios pendientes nacidos de esta entidad (org-scoped:
  // defensa en profundidad, como el resto de mutaciones de entidad).
  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', failed_reason: 'entity_archived', updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('entity_id', entityId)
    .in('status', ['pending', 'postponed'])
    .then(undefined, () => {});

  await _logEvent(db, { orgId, entityId, kind: 'note', title: 'Ficha archivada', actor });
  return { ok: true };
}

/**
 * Búsqueda para el tool de voz: display_name ILIKE + matrícula/chip exactos
 * normalizados ("1234 ABC" == "1234abc"). Determinista, org-scoped, compacta.
 */
async function searchEntities({ orgId, q, typeKey, limit = 3, db }) {
  db = db || getDatabase();
  if (!db.enabled || !q) return [];

  const { getOrgEntityTypes } = require('./entity-types');
  const types = await getOrgEntityTypes(orgId, { db });
  if (!types.length) return [];
  const wanted   = typeKey ? types.filter(t => t.key === typeKey) : types;
  const typeIds  = wanted.map(t => t.id);
  if (!typeIds.length) return [];
  const typeById = new Map(wanted.map(t => [t.id, t]));

  const safeQ = String(q).replace(/[^a-zA-Z0-9 .@+\-_áéíóúàèìòùäëïöüñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇ]/g, '').slice(0, 80);
  const results = [];
  const seen = new Set();

  // 1) por nombre (trigram/ILIKE sobre display_name)
  if (safeQ) {
    const { data } = await db.client.from('nf_entities')
      .select('id, entity_type_id, contact_id, display_name, attrs')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('entity_type_id', typeIds)
      .ilike('display_name', `%${safeQ}%`)
      .limit(limit);
    for (const e of (data || [])) { if (!seen.has(e.id)) { seen.add(e.id); results.push(e); } }
  }

  // 2) por atributo identificador exacto normalizado (matrícula, chip, nº)
  const plate = normalizePlate(q);
  if (plate.length >= 4 && results.length < limit) {
    const { data } = await db.client.from('nf_entities')
      .select('id, entity_type_id, contact_id, display_name, attrs')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('entity_type_id', typeIds)
      .limit(400);
    const ID_KEYS = ['matricula', 'chip', 'numero', 'nif'];
    for (const e of (data || [])) {
      if (seen.has(e.id) || results.length >= limit) continue;
      const hit = ID_KEYS.some(k => e.attrs && e.attrs[k] && normalizePlate(e.attrs[k]) === plate);
      if (hit) { seen.add(e.id); results.push(e); }
    }
  }

  return results.slice(0, limit).map(e => ({ ...e, _type: typeById.get(e.entity_type_id) || null }));
}

module.exports = {
  validateAttrs,
  computeDisplayName,
  normalizePlate,
  normalizeIdentifier,
  findEntityByIdentifier,
  diffAttrs,
  listEntities,
  getEntity,
  createEntity,
  createEntityDraft,
  addEntityNote,
  updateEntity,
  archiveEntity,
  searchEntities,
};
