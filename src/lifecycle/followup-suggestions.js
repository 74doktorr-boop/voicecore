// ============================================================
// NodeFlow — Sugerencias de seguimiento por sector (2026-07-06)
// ------------------------------------------------------------
// El motor de seguimientos deja de ser algo que el dueño monta a mano:
// NodeFlow MIRA sus datos reales y le PROPONE ajustes. Él aprueba.
//
// Dos tipos de sugerencia, ambos DETERMINISTAS (matemática sobre citas,
// nada de LLM — charter):
//   1) timing   → "tus clientes de tinte vuelven a los 48 días, no 35;
//                  ¿ajusto el aviso?" (mediana real de retorno por servicio)
//   2) coverage → "hay muchas citas de 'mechas' sin ningún seguimiento;
//                  ¿creo uno a los N días?" (servicio frecuente sin regla)
//
// computeSuggestions() es PURA (citas + config → sugerencias). Las capas
// con BD (get/apply/dismiss) son finas y reutilizan buildRulesView +
// normalizeRules, así aplicar una sugerencia = guardar reglas validadas.
// Lo aplicado se autorresuelve (deja de sugerirse); lo descartado se
// recuerda en config._dismissedSuggestions.
// ============================================================
'use strict';

const { buildRulesView, normalizeRules, loadOrgConfig } = require('./followup-rules');
const { Logger } = require('../utils/logger');
const log = new Logger('FOLLOWUP-SUGGEST');

const MIN_TIMING_SAMPLES  = 6;   // nº mínimo de retornos para fiarse de la mediana
const MIN_COVERAGE_VISITS = 8;   // citas de un servicio sin regla para proponerla
const DIFF_ABS_DAYS = 7;         // diferencia mínima absoluta para sugerir cambio
const DIFF_REL      = 0.15;      // …y relativa (15%)
const GAP_MIN = 1, GAP_MAX = 730; // descarta huecos absurdos (errores de datos)
const FROM_LAST = new Set(['from_last_appointment', 'from_last_if_no_new']);

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Huecos de retorno por servicio: para cada cliente, días entre citas
 * consecutivas, etiquetados con el servicio de la cita de vuelta. PURA.
 * @returns {Array<{ service: string, gap: number }>}
 */
function returnGaps(appointments) {
  const byPhone = new Map();
  for (const a of appointments || []) {
    if (!a || !a.phone || !a.date) continue;
    if (!byPhone.has(a.phone)) byPhone.set(a.phone, []);
    byPhone.get(a.phone).push(a);
  }
  const gaps = [];
  for (const list of byPhone.values()) {
    list.sort((x, y) => new Date(x.date) - new Date(y.date));
    for (let i = 1; i < list.length; i++) {
      const gap = Math.round((new Date(list[i].date) - new Date(list[i - 1].date)) / 864e5);
      if (gap >= GAP_MIN && gap <= GAP_MAX) gaps.push({ service: String(list[i].service || '').toLowerCase(), gap });
    }
  }
  return gaps;
}

function _matches(filter, service) {
  if (!filter || !filter.length) return true;
  return filter.some(f => service.includes(f));
}

/**
 * Calcula sugerencias a partir de la config vigente + el histórico de citas.
 * PURA. @returns {Array<Suggestion>}
 */
function computeSuggestions(sectorSlug, orgConfig, appointments, opts = {}) {
  const rules = buildRulesView(sectorSlug, orgConfig);
  const gaps = returnGaps(appointments);
  const dismissed = new Set(Array.isArray(orgConfig._dismissedSuggestions) ? orgConfig._dismissedSuggestions : []);
  const out = [];

  // ── 1) Timing: comparar días configurados vs mediana real de retorno ──
  const activeFromLast = rules.filter(r => r.enabled && FROM_LAST.has(r.trigger) && r.editableDays && r.days != null);
  for (const r of activeFromLast) {
    const sample = gaps.filter(g => _matches(r.serviceFilter, g.service)).map(g => g.gap);
    if (sample.length < MIN_TIMING_SAMPLES) continue;
    const obs = median(sample);
    const diff = Math.abs(obs - r.days);
    if (diff < DIFF_ABS_DAYS || diff / r.days < DIFF_REL) continue;
    const id = 'timing:' + r.key;
    if (dismissed.has(id)) continue;
    const dir = obs > r.days ? 'más tarde' : 'antes';
    out.push({
      id, type: 'timing', ruleKey: r.key,
      title: `Ajustar "${r.label}"`,
      detail: `Tus clientes vuelven a los ${obs} días de media (${dir} de lo que avisas ahora, ${r.days}). Ajústalo para llegar en el momento justo.`,
      currentDays: r.days, suggestedDays: obs, sampleSize: sample.length,
    });
  }

  // ── 2) Coverage: servicio frecuente sin ninguna regla que lo cubra ──
  // Si hay una regla activa SIN filtro (cubre todo), no proponemos altas.
  const hasCatchAll = activeFromLast.some(r => !r.serviceFilter || !r.serviceFilter.length);
  if (!hasCatchAll) {
    const activeFilters = rules.filter(r => r.enabled).map(r => r.serviceFilter).filter(f => f && f.length);
    const counts = new Map(), sampleByService = new Map();
    for (const g of gaps) {
      counts.set(g.service, (counts.get(g.service) || 0) + 1);
      if (!sampleByService.has(g.service)) sampleByService.set(g.service, []);
      sampleByService.get(g.service).push(g.gap);
    }
    // también contar servicios de citas sin retorno (una sola visita cuenta como 1)
    for (const a of appointments || []) {
      const s = String((a && a.service) || '').toLowerCase();
      if (s && !counts.has(s)) counts.set(s, 0);
    }
    const suggestedNew = [];
    for (const [service, count] of counts) {
      if (!service) continue;
      const totalVisits = (appointments || []).filter(a => String((a && a.service) || '').toLowerCase() === service).length;
      if (totalVisits < MIN_COVERAGE_VISITS) continue;
      if (activeFilters.some(f => f.some(k => service.includes(k) || k.includes(service)))) continue; // ya cubierto
      const sample = sampleByService.get(service) || [];
      const obs = median(sample) || 30;
      const id = 'coverage:' + service.replace(/[^a-z0-9]+/g, '_');
      if (dismissed.has(id)) continue;
      suggestedNew.push({
        id, type: 'coverage',
        title: `Crear seguimiento para "${service}"`,
        detail: `Tienes ${totalVisits} citas de "${service}" y ningún seguimiento. Podrías recordarles volver ${sample.length >= MIN_TIMING_SAMPLES ? `a los ${obs} días (su cadencia real)` : `pasado un tiempo`}.`,
        label: `Recordar ${service}`, serviceLabel: `tu ${service}`, serviceFilter: [service],
        suggestedDays: obs, sampleSize: totalVisits,
      });
    }
    // los más frecuentes primero, tope 3 para no abrumar
    suggestedNew.sort((a, b) => b.sampleSize - a.sampleSize);
    out.push(...suggestedNew.slice(0, 3));
  }

  return out.slice(0, 6);
}

// ── Reconstruye el body del PUT desde la vista de reglas vigente ──
function _rulesToBody(rules) {
  const overrides = {}, custom = [];
  for (const r of rules) {
    if (r.custom) {
      custom.push({ key: r.key, label: r.label, serviceLabel: r.serviceLabel, trigger: r.trigger, days: r.days, serviceFilter: r.serviceFilter, channel: r.channel, enabled: r.enabled });
    } else {
      overrides[r.key] = { enabled: r.enabled, channel: r.channel, ...(r.editableDays && r.days != null ? { days: r.days } : {}) };
    }
  }
  return { overrides, custom };
}

async function _appointmentsFor(db, orgId) {
  try {
    const since = new Date(Date.now() - 540 * 864e5).toISOString().slice(0, 10);
    const { data } = await db.client.from('nf_appointments')
      .select('phone, service, date, status').eq('organization_id', orgId)
      .gte('date', since).order('date', { ascending: true }).limit(5000);
    return data || [];
  } catch (e) { log.warn(`_appointmentsFor(${orgId}): ${e.message}`); return []; }
}

/** Sugerencias vigentes para un negocio. */
async function getSuggestions(orgId, sectorSlug, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return [];
  const orgConfig = await loadOrgConfig(db, orgId);
  const appts = await _appointmentsFor(db, orgId);
  return computeSuggestions(sectorSlug, orgConfig, appts, opts);
}

/** Aplica una sugerencia (recalculada en servidor por seguridad). */
async function applySuggestion(orgId, sectorSlug, id, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { error: 'BD no disponible' };
  const orgConfig = await loadOrgConfig(db, orgId);
  const appts = await _appointmentsFor(db, orgId);
  const sug = computeSuggestions(sectorSlug, orgConfig, appts, opts).find(s => s.id === id);
  if (!sug) return { error: 'La sugerencia ya no está disponible' };

  const body = _rulesToBody(buildRulesView(sectorSlug, orgConfig));
  if (sug.type === 'timing') {
    body.overrides[sug.ruleKey] = { ...(body.overrides[sug.ruleKey] || {}), days: sug.suggestedDays, enabled: true };
  } else { // coverage
    body.custom.push({ label: sug.label, serviceLabel: sug.serviceLabel, trigger: 'from_last_appointment', days: sug.suggestedDays, serviceFilter: sug.serviceFilter, channel: 'whatsapp', enabled: true });
  }
  const res = normalizeRules(sectorSlug, body);
  if (res.error) return res;
  if (Array.isArray(orgConfig._dismissedSuggestions)) res.config._dismissedSuggestions = orgConfig._dismissedSuggestions;

  const { error } = await db.client.from('org_reminder_config')
    .upsert({ org_id: orgId, config: res.config, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) return { error: error.message };
  log.info(`Sugerencia aplicada (org ${orgId}): ${id}`);
  return { ok: true, applied: sug };
}

/** Descarta una sugerencia para que no reaparezca. */
async function dismissSuggestion(orgId, id, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  if (!db.enabled) return { error: 'BD no disponible' };
  const orgConfig = await loadOrgConfig(db, orgId);
  const set = new Set(Array.isArray(orgConfig._dismissedSuggestions) ? orgConfig._dismissedSuggestions : []);
  set.add(String(id).slice(0, 80));
  orgConfig._dismissedSuggestions = [...set].slice(-100);
  const { error } = await db.client.from('org_reminder_config')
    .upsert({ org_id: orgId, config: orgConfig, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) return { error: error.message };
  return { ok: true };
}

module.exports = {
  computeSuggestions, returnGaps, median,
  getSuggestions, applySuggestion, dismissSuggestion,
  MIN_TIMING_SAMPLES, MIN_COVERAGE_VISITS,
};
