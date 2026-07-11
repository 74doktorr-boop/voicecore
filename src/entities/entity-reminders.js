// ============================================================
// NodeFlow — ENTIDADES v0: materializador nocturno de recordatorios
// ------------------------------------------------------------
// Los campos-fecha con semántica de recordatorio (proxima_itv,
// fecha_renovacion, proximo_plazo…) se MATERIALIZAN cada noche en
// scheduled_reminders (columnas reales indexadas): el hot path del
// motor de envío jamás consulta JSONB (riesgo 3 del diseño).
//
// Idempotente por (entity_id, service_key, día) — mismo espíritu de
// dedupe que reminder-engine (cancel-obsoleto + insert), reforzado por
// el índice único parcial uq_reminder_entity_field_day.
// Leader-gated: se invoca desde runAutomations (src/scheduling/cron.js),
// que ya solo corre en el líder.
// ============================================================
'use strict';

const { getDatabase }         = require('../db/database');
const { computeDisplayName }  = require('./entities');
const { Logger }              = require('../utils/logger');

const log = new Logger('ENTITY-REMINDERS');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** service_key de un recordatorio de entidad: 'entity:vehiculo:proxima_itv'. */
function entityServiceKey(typeKey, fieldKey) {
  return `entity:${typeKey}:${fieldKey}`;
}

/**
 * PURA — plan de recordatorios de UNA entidad según su tipo:
 * por cada campo date con reminder y valor, la fecha objetivo es
 * valor + offset_days (negativo = antes). Solo fechas FUTURAS.
 * @returns Array<{ serviceKey, fieldKey, scheduledFor: Date, messagePreview }>
 */
function buildEntityReminderPlan(entityType, entity, now = new Date()) {
  const plan  = [];
  const attrs = entity.attrs || {};

  for (const f of (entityType.fields || [])) {
    if (f.type !== 'date') continue;
    // Fase 2: un campo puede tener VARIAS antelaciones (f.reminders = lista).
    // Retrocompatible: si solo hay el `reminder` único de siempre, lo envolvemos.
    const avisos = (Array.isArray(f.reminders) && f.reminders.length)
      ? f.reminders.filter(Boolean)
      : (f.reminder ? [f.reminder] : []);
    if (!avisos.length) continue;

    const value = attrs[f.key];
    if (!value || !DATE_RE.test(String(value))) continue;

    const base        = entityServiceKey(entityType.key, f.key);
    const isBiz       = (r) => r.recipient === 'business' || r.recipient === 'negocio';
    const clientCount = avisos.filter(r => !isBiz(r)).length;
    const bizCount    = avisos.length - clientCount;
    const fechaBonita = new Date(`${value}T12:00:00`).toLocaleDateString('es-ES');
    const displayName = entity.display_name
      || computeDisplayName(entityType.label_template, attrs, entityType.label_singular);

    for (const rem of avisos) {
      // Aviso a las 09:00 del día objetivo (como el resto del motor)
      const target = new Date(`${value}T09:00:00`);
      if (isNaN(target.getTime())) continue;
      const off = Number(rem.offset_days) || 0;
      target.setDate(target.getDate() + off);
      if (target <= now) continue; // nunca programar en pasado

      // Destinatario: al cliente (por defecto) o al NEGOCIO (aviso interno al
      // dueño: "mañana viene X", "el bono se agota"). Fase 2B.
      const toBusiness = isBiz(rem);

      // serviceKey distinto por aviso (o el dedupe (entidad+serviceKey+día) los
      // colapsaría). Sufijo ':oN' SOLO si hay varios del MISMO destinatario: así,
      // al añadir un aviso al negocio a un campo que ya tenía uno al cliente, el
      // del cliente CONSERVA su clave (no se re-materializa). Los avisos al
      // negocio llevan ':biz' → el dispatch los enruta al WhatsApp del dueño.
      const groupMulti = toBusiness ? bizCount > 1 : clientCount > 1;
      let serviceKey = base;
      if (groupMulti) serviceKey += `:o${Math.abs(off)}`;
      if (toBusiness) serviceKey += ':biz';

      // message_hint es una FRASE completa → marcador 'TXT:' (el scheduler la
      // envía íntegra vía plantilla-portadora nodeflow_aviso). Sin hint:
      // fragmento-etiqueta.
      const messagePreview = rem.message_hint
        ? 'TXT:' + rem.message_hint
            .replace(/\{\{\s*entity\s*\}\}/gi, displayName)
            .replace(/\{\{\s*value\s*\}\}/gi, fechaBonita)
            .slice(0, 240)
        : `${f.label || f.key} — ${displayName} (${fechaBonita})`;

      plan.push({ serviceKey, fieldKey: f.key, scheduledFor: target, messagePreview, recipient: toBusiness ? 'business' : 'client' });
    }
  }
  return plan;
}

/** Clave de dedupe por DÍA (resistente a derivas de huso/hora). */
function _dayKey(iso) { return String(iso || '').slice(0, 10); }

/**
 * Aplica el plan de UNA entidad contra scheduled_reminders (compartido por
 * el barrido nocturno y la sincronización inmediata tras un cambio de fecha):
 *  - dueño con no_whatsapp/cooling-off → skip (no se le escribe)
 *  - pendiente igual (mismo entity+campo+día) → skip (idempotente)
 *  - pendiente obsoleto (la fecha cambió) → cancelled + insert nuevo
 * @param pending Map `${entityId}|${serviceKey}` → { id, day } (se muta)
 */
async function _applyEntityPlan({ db, orgId, type, entity, pending, now, out }) {
  let plan = buildEntityReminderPlan(type, entity, now);
  if (!plan.length) return;

  // Opt-out / cooling-off del CLIENTE: una vez por entidad. Bloquea los avisos
  // AL CLIENTE, pero NO los internos al negocio (recipient=business): el dueño
  // debe seguir recibiendo su "mañana viene X" aunque el cliente no quiera
  // recibir mensajes.
  let blocked = false;
  try {
    const { getContactMemory, isCoolingOff } = require('../lifecycle/call-memory');
    const memory = await getContactMemory(entity.contact_id, orgId);
    blocked = !!(memory && (memory.no_whatsapp || isCoolingOff(memory)));
  } catch (_) {}
  if (blocked) {
    const bizOnly = plan.filter(i => i.recipient === 'business');
    out.skipped += (plan.length - bizOnly.length);
    plan = bizOnly;
    if (!plan.length) return;
  }

  for (const item of plan) {
    const dedupeKey = `${entity.id}|${item.serviceKey}`;
    const existing  = pending.get(dedupeKey);
    const newDay    = _dayKey(item.scheduledFor.toISOString());

    if (existing && existing.day === newDay) { out.skipped++; continue; } // ya está — idempotente

    if (existing) {
      // La fecha del campo cambió → cancelar el obsoleto (patrón reminder-engine)
      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'entity_date_changed', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .eq('status', 'pending')
        .then(undefined, e => log.warn(`cancel obsoleto falló: ${e.message}`));
      out.cancelled++;
    }

    const { error: insErr } = await db.client.from('scheduled_reminders').insert({
      org_id:          orgId,
      contact_id:      entity.contact_id,
      entity_id:       entity.id,
      service_key:     item.serviceKey,
      channel:         'whatsapp',
      scheduled_for:   item.scheduledFor.toISOString(),
      status:          'pending',
      message_preview: item.messagePreview,
    });
    if (insErr) {
      // 23505 = carrera contra el índice único parcial → ya existe, OK
      if (String(insErr.code) === '23505') out.skipped++;
      else log.warn(`insert reminder ${item.serviceKey} (${entity.id}): ${insErr.message}`);
    } else {
      pending.set(dedupeKey, { id: null, day: newDay });
      out.created++;
    }
  }
}

/**
 * Sincronización INMEDIATA de los avisos de UNA entidad (v1): cuando la IA
 * o el portal cambian una fecha, el 🔔 del timeline debe reflejarlo YA —
 * no a la noche. Mismo dedupe/cancel/insert que el barrido (helper común).
 * Sin contacto vinculado no hay a quién avisar → solo cancela lo obsoleto.
 */
async function syncEntityRemindersNow({ orgId, entityType, entity, db, now }) {
  const out = { created: 0, cancelled: 0, skipped: 0 };
  const { entitiesFeatureEnabled, entityTablesExist } = require('./entity-types');
  if (!entitiesFeatureEnabled() || !orgId || !entity || !entityType) return out;

  db = db || getDatabase();
  if (!db.enabled || !(await entityTablesExist(db))) return out;
  now = now || new Date();

  try {
    // Pendientes actuales de ESTA entidad (para detectar obsoletos)
    const { data: pendingRows } = await db.client
      .from('scheduled_reminders')
      .select('id, entity_id, service_key, scheduled_for')
      .eq('org_id', orgId)
      .eq('entity_id', entity.id)
      .eq('status', 'pending')
      .limit(50);
    const pending = new Map();
    for (const r of (pendingRows || [])) {
      pending.set(`${r.entity_id}|${r.service_key}`, { id: r.id, day: _dayKey(r.scheduled_for) });
    }

    if (entity.contact_id) {
      await _applyEntityPlan({ db, orgId, type: entityType, entity, pending, now, out });
    } else {
      // Sin dueño: cancelar pendientes de campos cuya fecha ya no cuadra
      // los hará el barrido nocturno; aquí no hay nada seguro que crear.
      out.skipped = pending.size;
    }
  } catch (e) {
    log.warn(`syncEntityRemindersNow(${orgId}/${entity.id}): ${e.message}`);
  }

  if (out.created || out.cancelled) {
    log.info(`Entidad ${entity.id}: avisos re-materializados ya (${out.created} creados, ${out.cancelled} reprogramados)`);
  }
  return out;
}

/**
 * Barrido nocturno: para cada org con tipos de entidad, materializa los
 * campos-fecha en scheduled_reminders. Reutiliza el 100% del envío
 * existente — aquí solo se escriben filas.
 *  - Sin contacto vinculado → skip (no hay a quién avisar; un coche no
 *    tiene WhatsApp).
 *  - Respeta do-not-contact (contact_memory.no_whatsapp) y cooling-off.
 *  - Pendiente igual (mismo entity+campo+día) → skip.
 *  - Pendiente obsoleto (la fecha cambió) → cancelled + insert nuevo.
 * @returns {Promise<{orgs, scanned, created, cancelled, skipped}>}
 */
async function materializeEntityReminders(opts = {}) {
  const out = { orgs: 0, scanned: 0, created: 0, cancelled: 0, skipped: 0 };
  const { entitiesFeatureEnabled, entityTablesExist } = require('./entity-types');
  if (!entitiesFeatureEnabled()) return out;

  const db = opts.db || getDatabase();
  if (!db.enabled || !(await entityTablesExist(db))) return out;
  const now = opts.now || new Date();

  // Tipos activos de TODAS las orgs (v0: pocas orgs con la feature; cap sano)
  const { data: types, error: typesErr } = await db.client
    .from('nf_entity_types')
    .select('id, organization_id, key, label_singular, label_template, fields')
    .eq('is_active', true)
    .limit(500);
  if (typesErr || !types?.length) return out;

  const byOrg = new Map();
  for (const t of types) {
    if (!byOrg.has(t.organization_id)) byOrg.set(t.organization_id, []);
    byOrg.get(t.organization_id).push(t);
  }

  for (const [orgId, orgTypes] of byOrg) {
    out.orgs++;
    try {
      // Pendientes de entidad ya materializados en esta org (para dedupe)
      const { data: pendingRows } = await db.client
        .from('scheduled_reminders')
        .select('id, entity_id, service_key, scheduled_for')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .not('entity_id', 'is', null)
        .limit(5000);
      // entity_id+service_key → { id, day }
      const pending = new Map();
      for (const r of (pendingRows || [])) {
        pending.set(`${r.entity_id}|${r.service_key}`, { id: r.id, day: _dayKey(r.scheduled_for) });
      }

      for (const type of orgTypes) {
        const hasReminderField = (type.fields || []).some(f => f.type === 'date'
          && (f.reminder || (Array.isArray(f.reminders) && f.reminders.length)));
        if (!hasReminderField) continue;

        const { data: entities } = await db.client
          .from('nf_entities')
          .select('id, contact_id, display_name, attrs')
          .eq('organization_id', orgId)
          .eq('entity_type_id', type.id)
          .eq('is_archived', false)
          .not('contact_id', 'is', null)
          .limit(2000);

        for (const entity of (entities || [])) {
          out.scanned++;
          await _applyEntityPlan({ db, orgId, type, entity, pending, now, out });
        }
      }
    } catch (e) {
      log.warn(`materialize org ${orgId}: ${e.message}`);
    }
  }

  if (out.created || out.cancelled) {
    log.info(`Entidades → recordatorios: ${out.created} creados, ${out.cancelled} reprogramados, ${out.skipped} ya al día (${out.scanned} entidades, ${out.orgs} orgs)`);
  }
  return out;
}

module.exports = {
  entityServiceKey,
  buildEntityReminderPlan,
  materializeEntityReminders,
  syncEntityRemindersNow,
};
