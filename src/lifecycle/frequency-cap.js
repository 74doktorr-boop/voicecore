// ============================================================
// NodeFlow — Tope de frecuencia de seguimientos (2026-07-06)
// ------------------------------------------------------------
// El miedo nº1 al encender automatismos: "¿y si le llego dos veces la
// misma semana?". Este tope lo quita. Da igual cuántas reglas coincidan
// para un cliente: NodeFlow no le manda dos avisos dentro de la ventana.
//
// Se aplica en el DESPACHO (última puerta): si el cliente ya recibió un
// seguimiento hace menos de `cap` días, el aviso NO se descarta — se
// POSPONE hasta que pase la ventana. Llega igual, pero sin agobiar.
//
// Config por negocio: org_reminder_config.config._frequencyCapDays
//   · número de días (default 7)
//   · 0 = desactivado (el dueño manda)
// Cache corto por org para no golpear la BD en cada recordatorio.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('FREQ-CAP');

const MAX_CAP = 90;
const DEFAULT_CAP_DAYS = (() => {
  const n = Math.round(Number(process.env.FOLLOWUP_FREQ_CAP_DAYS));
  return Number.isFinite(n) && n >= 0 && n <= MAX_CAP ? n : 7;
})();

/** Resuelve el tope (en días) desde la config del negocio. PURA. 0 = off. */
function resolveCap(orgConfig) {
  const v = orgConfig && orgConfig._frequencyCapDays;
  if (v === 0) return 0;
  const n = Math.round(Number(v));
  if (Number.isFinite(n) && n >= 0 && n <= MAX_CAP) return n;
  return DEFAULT_CAP_DAYS;
}

/** Nueva fecha de envío tras un aviso previo: sent + cap días. PURA. */
function nextSlotAfter(sentAtISO, capDays, now = new Date()) {
  const base = new Date(sentAtISO);
  const t = base.getTime() + capDays * 864e5;
  // nunca en el pasado (si el previo fue justo dentro de la ventana)
  return new Date(Math.max(t, now.getTime() + 60 * 1000));
}

// Cache por org (TTL 60s) para no releer la config en cada recordatorio del lote.
const _cache = new Map();
async function getCapDays(orgId, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled || !orgId) return DEFAULT_CAP_DAYS;
  const now = Date.now();
  const hit = _cache.get(orgId);
  if (hit && now - hit.ts < 60000) return hit.cap;
  let cap = DEFAULT_CAP_DAYS;
  try {
    const { data } = await db.client.from('org_reminder_config')
      .select('config').eq('org_id', orgId).maybeSingle();
    cap = resolveCap((data && data.config) || {});
  } catch (e) { log.warn(`getCapDays(${orgId}): ${e.message}`); }
  _cache.set(orgId, { cap, ts: now });
  return cap;
}

/**
 * ¿Hay que posponer este recordatorio por el tope? Consulta el último aviso
 * ENVIADO al contacto dentro de la ventana. Devuelve la nueva fecha o null.
 */
async function holdUntil(db, reminder, capDays, now = new Date()) {
  if (!capDays || capDays <= 0) return null;
  const since = new Date(now.getTime() - capDays * 864e5).toISOString();
  const { data: recent } = await db.client.from('scheduled_reminders')
    .select('sent_at')
    .eq('org_id', reminder.org_id)
    .eq('contact_id', reminder.contact_id)
    .eq('status', 'sent')
    .gte('sent_at', since)
    .neq('id', reminder.id)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recent || !recent.sent_at) return null;
  return nextSlotAfter(recent.sent_at, capDays, now);
}

/** Limpia la cache (para tests). */
function _clearCache() { _cache.clear(); }

module.exports = { resolveCap, nextSlotAfter, getCapDays, holdUntil, DEFAULT_CAP_DAYS, MAX_CAP, _clearCache };
