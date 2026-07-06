// ============================================================
// NodeFlow — Reglas aprendidas: APROBAR → APLICAR (2026-07-06)
// ------------------------------------------------------------
// El bucle de mejora detectaba patrones y proponía "reglas candidatas",
// pero morían en el email del fundador (puerta humana sin herramienta).
// Este módulo cierra el bucle SIN perder la seguridad:
//
//   1. El agregador semanal PERSISTE las candidatas aquí (upsertCandidates).
//   2. El fundador las revisa en el admin y APRUEBA / RECHAZA.
//   3. Antes de aplicar puede PROBARLAS con el replay-gate (llamadas reales
//      re-jugadas contra el prompt + la regla; el auditor puntúa).
//   4. Una regla 'active' se inyecta en el prompt de ESE sector (o 'global').
//
// Jamás auto-mutación: solo se aplica lo que el humano aprueba. Determinista
// y fail-open: sin BD o sin tabla, no rompe nada (devuelve vacío).
//
// Tabla: nf_learned_rules (ver db/pending-migrations.md).
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('LEARNED-RULES');

const TABLE = 'nf_learned_rules';
const CACHE_TTL_MS = 60 * 1000;

/** Clave normalizada de una regla (para deduplicar "la misma" dicha distinto). */
function ruleKey(text) {
  return String(text || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')       // sin acentos
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function _db(deps) { return deps.db || require('../db/database').getDatabase(); }

/**
 * Persiste reglas candidatas del agregador. Dedup por (sector, ruleKey):
 * si ya existe candidata, refresca contador; si ya se decidió (active/rejected),
 * NO la resucita. Nunca lanza. @returns nº de NUEVAS candidatas.
 */
async function upsertCandidates(sector, rules, deps = {}) {
  const db = _db(deps);
  if (!db.enabled || !Array.isArray(rules) || !rules.length) return 0;
  const sec = sector || 'global';
  let added = 0;
  for (const r of rules) {
    const text = (r && r.rule) || (typeof r === 'string' ? r : '');
    const key = ruleKey(text);
    if (!key) continue;
    try {
      const { data: existing } = await db.client.from(TABLE)
        .select('id, status').eq('sector', sec).eq('rule_key', key).maybeSingle();
      if (existing) {
        if (existing.status === 'candidate') {
          await db.client.from(TABLE).update({
            count: r.count || 1, recurrent: !!r.recurrent, last_seen_at: new Date().toISOString(),
          }).eq('id', existing.id);
        }
        continue; // decididas (active/rejected) no se tocan
      }
      const { error } = await db.client.from(TABLE).insert({
        sector: sec, rule_key: key, text: String(text).slice(0, 300),
        status: 'candidate', count: r.count || 1, recurrent: !!r.recurrent,
      });
      if (!error) added++;
    } catch (e) { log.warn(`upsertCandidates(${sec}): ${e.message}`); }
  }
  if (added) { log.info(`${added} regla(s) candidata(s) nuevas en '${sec}'`); _invalidate(); }
  return added;
}

async function listRules({ status = null, sector = null } = {}, deps = {}) {
  const db = _db(deps);
  if (!db.enabled) return [];
  let q = db.client.from(TABLE).select('*').order('created_at', { ascending: false }).limit(300);
  if (status) q = q.eq('status', status);
  if (sector) q = q.eq('sector', sector);
  const { data } = await q;
  return data || [];
}

async function getRule(id, deps = {}) {
  const db = _db(deps);
  if (!db.enabled) return null;
  const { data } = await db.client.from(TABLE).select('*').eq('id', id).maybeSingle();
  return data || null;
}

/** Cambia el estado de una regla. active → se aplica (invalida caché). */
async function setStatus(id, status, deps = {}) {
  const db = _db(deps);
  if (!db.enabled) return { ok: false, error: 'sin BD' };
  if (!['candidate', 'active', 'rejected'].includes(status)) return { ok: false, error: 'estado inválido' };
  const patch = { status };
  if (status === 'active') patch.approved_at = new Date().toISOString();
  const { error } = await db.client.from(TABLE).update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  _invalidate();
  return { ok: true };
}

// ── Reglas ACTIVAS por sector (+ global) → bloque para el prompt. Cache 60s. ──
let _cache = null, _cacheAt = 0;
function _invalidate() { _cache = null; }

async function _activeMap(deps = {}) {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const db = _db(deps);
  if (!db.enabled) return {};
  try {
    const { data } = await db.client.from(TABLE).select('sector, text').eq('status', 'active');
    const map = {};
    for (const r of (data || [])) (map[r.sector] = map[r.sector] || []).push(r.text);
    _cache = map; _cacheAt = Date.now();
    return map;
  } catch (e) { log.warn(`_activeMap: ${e.message}`); return {}; }
}

/**
 * Bloque de reglas aprendidas ACTIVAS para inyectar en el prompt de un sector.
 * Incluye las 'global' + las del sector. '' si no hay ninguna. Nunca lanza.
 */
async function activeRulesBlock(sector, deps = {}) {
  try {
    const map = await _activeMap(deps);
    const rules = [].concat(map.global || [], (sector && map[sector]) || []);
    if (!rules.length) return '';
    return '\n\nMEJORAS APRENDIDAS (aprobadas para tu negocio — respétalas siempre):\n' +
      rules.map(r => `- ${r}`).join('\n');
  } catch (_) { return ''; }
}

module.exports = { ruleKey, upsertCandidates, listRules, getRule, setStatus, activeRulesBlock, _invalidate };
