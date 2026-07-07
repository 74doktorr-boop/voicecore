// ============================================================
// NodeFlow — Reglas de seguimiento por sector (2026-07-06)
// ------------------------------------------------------------
// El motor de seguimientos que ve y gobierna el dueño:
//   · DEFAULTS del sector (catálogo) — puede activar/desactivar y ajustar
//     el "cuándo" y el canal, sin tocar código.
//   · PERSONALIZADOS — puede añadir los suyos con nombre y tiempos propios.
//
// Persistencia: org_reminder_config.config
//   {
//     <serviceKey>: { days?, channel?, enabled? },   // override de un default
//     _custom: [ { key, label, serviceLabel, trigger, days, serviceFilter?, channel, enabled } ]
//   }
//
// Reglas de negocio DETERMINISTAS (fuera del LLM, charter). Este módulo es
// puro salvo el acceso a BD, que se inyecta para poder testear.
// ============================================================
'use strict';

const { getSectorFollowups, TRIGGERS, CUSTOM_TRIGGERS } = require('./sector-catalog');
const { Logger } = require('../utils/logger');
const log = new Logger('FOLLOWUP-RULES');

const CHANNELS = ['whatsapp', 'sms', 'email'];
const MAX_CUSTOM = 20;
const MIN_DAYS = 1, MAX_DAYS = 3650;

function _slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
function _clampDays(v, def) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

/**
 * Vista de reglas para el portal: defaults del sector (con overrides aplicados)
 * + personalizados. PURA. Cada regla trae su presentación y qué se puede editar.
 */
function buildRulesView(sectorSlug, orgConfig = {}, serviceList = null) {
  const { appliesToServices } = require('./sector-catalog');
  const defaults = getSectorFollowups(sectorSlug);
  const rules = defaults.map(fu => {
    const ov = orgConfig[fu.key] || {};
    // Ligado a SERVICIOS: si el negocio no ofrece nada que case con la regla
    // (p.ej. clínica sin psicotécnicos), NO aplica → apagada por defecto.
    // El dueño manda: un enabled explícito (true o false) siempre gana.
    const applies = appliesToServices(fu, serviceList);
    return {
      key: fu.key,
      label: fu.label,
      serviceLabel: fu.serviceLabel,
      desc: fu.desc,
      trigger: fu.trigger,
      triggerLabel: TRIGGERS[fu.trigger] || fu.trigger,
      days: ov.days != null ? ov.days : (fu.days != null ? fu.days : null),
      serviceFilter: Array.isArray(fu.serviceFilter) ? fu.serviceFilter : [],
      channel: ov.channel || 'whatsapp',
      enabled: ov.enabled === true ? true : ov.enabled === false ? false : applies,
      applies,
      custom: false,
      // los defaults con disparador de fecha/frecuencia no editan "días" a mano
      editableDays: fu.days != null && (fu.trigger === 'from_last_appointment' || fu.trigger === 'from_last_if_no_new' || fu.trigger === 'before_sector_field'),
    };
  });

  const custom = Array.isArray(orgConfig._custom) ? orgConfig._custom : [];
  for (const c of custom) {
    rules.push({
      key: c.key,
      label: c.label,
      serviceLabel: c.serviceLabel || c.label,
      desc: (c.serviceFilter && c.serviceFilter.length ? `Solo tras "${c.serviceFilter.join(', ')}" · ` : '') + (TRIGGERS[c.trigger] || '').replace('N', c.days),
      trigger: c.trigger,
      triggerLabel: TRIGGERS[c.trigger] || c.trigger,
      days: c.days,
      customText: c.customText || '',
      serviceFilter: c.serviceFilter || [],
      channel: c.channel || 'whatsapp',
      enabled: c.enabled !== false,
      custom: true,
      editableDays: true,
    });
  }
  return rules;
}

/**
 * Valida y normaliza el body del PUT a la forma de config persistible.
 * `existing` = config actual: se preservan sus claves reservadas
 * (_dismissedSuggestions) para que guardar reglas no las borre.
 * @returns {{ config: object } | { error: string }}
 */
function normalizeRules(sectorSlug, body = {}, existing = {}) {
  const defaults = getSectorFollowups(sectorSlug);
  const defaultKeys = new Set(defaults.map(f => f.key));
  const config = {};

  // 1) Overrides de defaults
  const overrides = body.overrides || {};
  for (const [key, ov] of Object.entries(overrides)) {
    if (!defaultKeys.has(key) || !ov || typeof ov !== 'object') continue;
    const entry = {};
    if (ov.enabled !== undefined) entry.enabled = !!ov.enabled;
    if (ov.channel !== undefined) { if (!CHANNELS.includes(ov.channel)) return { error: `Canal no válido: ${ov.channel}` }; entry.channel = ov.channel; }
    if (ov.days !== undefined && ov.days !== null && ov.days !== '') entry.days = _clampDays(ov.days);
    if (Object.keys(entry).length) config[key] = entry;
  }

  // 2) Personalizados
  const rawCustom = Array.isArray(body.custom) ? body.custom : [];
  if (rawCustom.length > MAX_CUSTOM) return { error: `Máximo ${MAX_CUSTOM} seguimientos personalizados` };
  const seen = new Set();
  const custom = [];
  for (const c of rawCustom) {
    if (!c || typeof c !== 'object') continue;
    const label = String(c.label || '').trim();
    if (label.length < 2 || label.length > 60) return { error: 'Cada seguimiento necesita un nombre (2–60 caracteres)' };
    if (!CUSTOM_TRIGGERS.includes(c.trigger)) return { error: `Disparador no válido para "${label}"` };
    const days = _clampDays(c.days, null);
    if (days == null) return { error: `Pon los días de "${label}"` };

    // key estable desde el nombre; evita colisión con defaults y entre sí
    let key = 'custom_' + (_slug(label) || 'seguimiento');
    if (c.key && /^custom_[a-z0-9_]+$/.test(c.key)) key = c.key.slice(0, 48);
    let uniq = key, n = 2;
    while (defaultKeys.has(uniq) || seen.has(uniq)) { uniq = key + '_' + n++; }
    seen.add(uniq);

    let serviceFilter;
    if (c.serviceFilter) {
      const arr = (Array.isArray(c.serviceFilter) ? c.serviceFilter : String(c.serviceFilter).split(','))
        .map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 6);
      if (arr.length) serviceFilter = arr;
    }
    const channel = CHANNELS.includes(c.channel) ? c.channel : 'whatsapp';

    // 100% PERSONALIZADO (opcional): el texto ÍNTEGRO del mensaje, escrito por
    // el dueño (viaja en la plantilla-portadora nodeflow_aviso). Admite
    // {detalle} → se sustituye por el dato de la ficha de cada cliente.
    let customText;
    if (c.customText) {
      customText = String(c.customText).trim().slice(0, 250);
      if (customText && customText.length < 10) return { error: `El mensaje de "${label}" es demasiado corto (mín. 10)` };
      if (!customText) customText = undefined;
    }

    // Fecha DEFINIDA POR EL NEGOCIO: el seguimiento vive N días antes de una
    // fecha que el dueño inventa; el campo se crea solo en la ficha de cada
    // cliente (sector_data.custom_<key>) con el nombre de la regla.
    const entry = {
      key: uniq, label, serviceLabel: String(c.serviceLabel || label).slice(0, 80),
      trigger: c.trigger, days, ...(serviceFilter ? { serviceFilter } : {}),
      ...(customText ? { customText } : {}),
      channel, enabled: c.enabled !== false,
    };
    if (c.trigger === 'before_sector_field') entry.field = 'custom_' + uniq.replace(/^custom_/, '');
    custom.push(entry);
  }
  if (custom.length) config._custom = custom;

  // Claves reservadas: TODA clave _interna de la config existente sobrevive al
  // guardado de reglas (marcadores de alertas, descartes…). _custom se rebuild.
  for (const k of Object.keys(existing || {})) {
    if (k.startsWith('_') && k !== '_custom' && config[k] === undefined) config[k] = existing[k];
  }
  if (Array.isArray(existing._dismissedSuggestions)) config._dismissedSuggestions = existing._dismissedSuggestions;
  let cap = existing._frequencyCapDays;
  if (body.frequencyCapDays !== undefined && body.frequencyCapDays !== null && body.frequencyCapDays !== '') {
    const n = Math.round(Number(body.frequencyCapDays));
    if (!Number.isFinite(n) || n < 0 || n > 90) return { error: 'Tope de frecuencia no válido (0–90 días)' };
    cap = n;
  }
  if (cap !== undefined) config._frequencyCapDays = cap;

  return { config };
}

/** Carga la config del dueño. */
async function loadOrgConfig(db, orgId) {
  if (!db.enabled) return {};
  const { data, error } = await db.client.from('org_reminder_config')
    .select('config').eq('org_id', orgId).maybeSingle();
  if (error) log.warn(`loadOrgConfig(${orgId}): ${error.message}`);
  return (data && data.config) || {};
}

/** Guarda la config (validada). @returns {Promise<{ok}|{error}>} */
async function saveRules(orgId, sectorSlug, body, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { error: 'BD no disponible' };
  const existing = await loadOrgConfig(db, orgId);
  const res = normalizeRules(sectorSlug, body, existing);
  if (res.error) return res;
  const { error } = await db.client.from('org_reminder_config')
    .upsert({ org_id: orgId, config: res.config, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) return { error: error.message };
  log.info(`Reglas guardadas (org ${orgId}, sector ${sectorSlug}): ${Object.keys(res.config).filter(k => k !== '_custom').length} overrides, ${(res.config._custom || []).length} personalizados`);
  return { ok: true, config: res.config };
}

/**
 * Estima a cuántos clientes ACTUALES llegaría el motor en los próximos `horizon`
 * días con la config vigente (solo reglas basadas en la última visita — las de
 * fecha dependen de datos por cliente). Da al dueño una cifra tangible.
 * @returns {Promise<{ total, byRule: object, horizon }>}
 */
async function estimateReach(orgId, sectorSlug, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const horizon = opts.horizon || 90;
  const out = { total: 0, byRule: {}, horizon };
  if (!db.enabled) return out;

  const orgConfig = await loadOrgConfig(db, orgId);
  const rules = buildRulesView(sectorSlug, orgConfig)
    .filter(r => r.enabled && (r.trigger === 'from_last_appointment' || r.trigger === 'from_last_if_no_new') && r.days);
  if (!rules.length) return out;

  // Última cita por teléfono (con su servicio) — ventana amplia.
  const sinceDays = Math.max(...rules.map(r => r.days)) + horizon + 5;
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
  let apts = [];
  try {
    const { data } = await db.client.from('nf_appointments')
      .select('phone, service, date, status')
      .eq('organization_id', orgId).gte('date', since)
      .order('date', { ascending: false }).limit(3000);
    apts = data || [];
  } catch (e) { log.warn(`estimateReach: ${e.message}`); return out; }

  const latestByPhone = new Map();
  for (const a of apts) { if (a.phone && !latestByPhone.has(a.phone)) latestByPhone.set(a.phone, a); }

  const now = Date.now(), end = now + horizon * 864e5;
  const counted = new Set();
  for (const r of rules) {
    let n = 0;
    for (const [phone, a] of latestByPhone) {
      if (r.serviceFilter && r.serviceFilter.length && !r.serviceFilter.some(f => (a.service || '').toLowerCase().includes(f))) continue;
      const due = new Date(a.date).getTime() + r.days * 864e5;
      if (due >= now && due <= end) { n++; if (!counted.has(phone)) { counted.add(phone); out.total++; } }
    }
    if (n) out.byRule[r.key] = n;
  }
  return out;
}

module.exports = { buildRulesView, normalizeRules, loadOrgConfig, saveRules, estimateReach, CHANNELS, MAX_CUSTOM };
