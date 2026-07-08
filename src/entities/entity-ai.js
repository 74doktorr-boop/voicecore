// ============================================================
// NodeFlow — ENTIDADES v1: reglas deterministas para que la IA
// escriba en la ficha SIN romper nada (Engineering Charter: las
// reglas de negocio viven en código, jamás en el LLM).
// ------------------------------------------------------------
// Qué puede hacer la IA — y NADA más:
//   · update_entity_date  → SOLO campos tipo 'date' del tipo, con
//     fecha validada aquí (parser determinista + aritmética en código).
//   · create_entity_draft → crear una ficha borrador vinculada al
//     llamante; los required de texto pueden faltar (is_draft=true,
//     el portal enseña «completar ficha»).
// La IA NUNCA borra, NUNCA toca campos que no sean fecha (salvo en
// el alta del borrador, donde validateAttrs limpia y descarta).
// Funciones PURAS: testeables sin BD ni LLM.
// ============================================================
'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza para casar por voz: minúsculas, sin acentos, espacios→_. */
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Palabras vacías del habla ('la itv', 'el próximo cambio…'): no distinguen
// campos y solo meten ruido en el matching. 'proximo/a' también: casi todos
// los campos-fecha lo llevan.
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en',
  'mi', 'su', 'tu', 'que', 'y', 'o', 'fecha', 'dia',
  'proximo', 'proxima', 'proximos', 'proximas', 'ultimo', 'ultima', 'siguiente',
]);

function _tokens(s) {
  return _norm(s).split('_').filter(t => t && !STOPWORDS.has(t));
}

/**
 * PURA — resuelve QUÉ campo-fecha quiere tocar la IA. Casa por key/label
 * exactos y después por tokens significativos ('la itv' → proxima_itv,
 * 'el aceite' → cambio_aceite). Ambiguo o sin match → null: mejor preguntar
 * que escribir donde no toca.
 * Devuelve SOLO campos type==='date' (el candado de seguridad vive aquí:
 * aunque el LLM pida 'notas', jamás lo obtendrá).
 * @returns {object|null} la definición del campo, o null
 */
function resolveDateField(fields, fieldRaw) {
  const dateFields = (fields || []).filter(f => f.type === 'date');
  if (!dateFields.length) return null;
  const q = _norm(fieldRaw);
  if (!q) return dateFields.length === 1 ? dateFields[0] : null;

  // 1) key exacta o label exacto
  for (const f of dateFields) {
    if (_norm(f.key) === q || _norm(f.label) === q) return f;
  }

  // 2) tokens significativos: todos los del habla deben casar con alguno
  //    del campo (inclusión en ambos sentidos: 'revi' ~ 'revision')
  const qTokens = _tokens(fieldRaw);
  if (!qTokens.length) return null;
  const hits = dateFields.filter(f => {
    const ft = [..._tokens(f.key), ..._tokens(f.label)];
    return qTokens.every(t => ft.some(x => x.includes(t) || t.includes(x)));
  });
  return hits.length === 1 ? hits[0] : null; // 0 o ambiguo → preguntar
}

/** Etiquetas de los campos-fecha (para que la IA pregunte con las palabras del negocio). */
function dateFieldLabels(fields) {
  return (fields || []).filter(f => f.type === 'date').map(f => f.label || f.key);
}

/**
 * PURA — aritmética de calendario EN CÓDIGO (los LLM fallan sumando años:
 * "pasó la ITV hoy → próxima dentro de 1 año" lo calcula esto, no el modelo).
 * Suma años/meses/días a una fecha ISO. Fin de mes seguro: 31-ene +1 mes →
 * 28/29-feb (clamp), nunca 2/3-mar.
 * @returns {string|null} ISO YYYY-MM-DD o null si la base no es válida
 */
function advanceDate(baseIso, { years = 0, months = 0, days = 0 } = {}) {
  if (!DATE_RE.test(String(baseIso || ''))) return null;
  const [y, m, d] = String(baseIso).split('-').map(Number);
  // Mediodía UTC: inmune a DST y husos
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  if (isNaN(base.getTime())) return null;

  const ty = y + (Number(years) || 0);
  const tmRaw = (m - 1) + (Number(months) || 0);
  const tyFinal = ty + Math.floor(tmRaw / 12);
  const tmFinal = ((tmRaw % 12) + 12) % 12;
  // Clamp al último día del mes destino (31-ene + 1 mes = 28/29-feb)
  const lastDay = new Date(Date.UTC(tyFinal, tmFinal + 1, 0, 12)).getUTCDate();
  const target  = new Date(Date.UTC(tyFinal, tmFinal, Math.min(d, lastDay), 12));
  target.setUTCDate(target.getUTCDate() + (Number(days) || 0));
  if (isNaN(target.getTime())) return null;
  return target.toISOString().slice(0, 10);
}

/**
 * PURA — resuelve la fecha objetivo de update_entity_date:
 * parsea lo hablado con el parser determinista de la casa ("hoy",
 * "el martes", "2027-03-01") y aplica el avance opcional en código
 * (plus_years/plus_months/plus_days: "la pasó hoy, la próxima en 1 año").
 * @returns {{ ok:true, iso:string } | { ok:false, error:string }}
 */
function resolveTargetDate({ dateRaw, plusYears, plusMonths, plusDays, todayIso }) {
  const { parseSpanishDate } = require('../scheduling/date-parser');
  const base = parseSpanishDate(dateRaw || 'hoy', todayIso);
  if (!base) {
    return { ok: false, error: `No he podido interpretar la fecha "${dateRaw || ''}". Pide el día concreto (por ejemplo "hoy", "el 15 de marzo" o "2027-03-15") y vuelve a intentarlo.` };
  }
  const iso = advanceDate(base, { years: plusYears, months: plusMonths, days: plusDays });
  if (!iso) return { ok: false, error: 'No he podido calcular la fecha. Pide el día concreto y vuelve a intentarlo.' };
  return { ok: true, iso };
}

/**
 * PURA — ¿la ficha tiene todos sus required rellenos? Cuando un borrador
 * de la IA se completa desde el portal, el badge «completar ficha» debe
 * apagarse SOLO (regla en código: updateEntity la aplica al merge).
 */
function draftIsComplete(fields, attrs) {
  const a = attrs || {};
  for (const f of (fields || [])) {
    if (!f.required) continue;
    const v = a[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return false;
  }
  return true;
}

module.exports = { resolveDateField, dateFieldLabels, advanceDate, resolveTargetDate, draftIsComplete };
