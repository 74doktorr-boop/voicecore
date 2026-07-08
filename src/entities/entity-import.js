// ============================================================
// NodeFlow — ENTIDADES v1: IMPORTACIÓN MÁGICA (su Excel → fichas)
// ------------------------------------------------------------
// "Su Excel → 200 vehículos avisando solos en 5 minutos": el
// desbloqueador de adopción. El dueño pega (o sube) su listado y
// el sistema detecta las columnas, las casa con los campos de SU
// plantilla de sector y crea las fichas — con el dueño vinculado
// por teléfono para que los avisos 🔔 salgan solos.
//
// TODO lo de este fichero es PURO (sin BD, sin LLM):
//   · parseCsv         — separador , ; o TAB (pegar desde Excel = TSV),
//                        BOM, comillas. Reutiliza el splitter de
//                        lifecycle/contact-import (un parser en la casa).
//   · suggestMapping   — cabecera → campo por matching determinista de
//                        tokens (mismo espíritu que resolveDateField).
//   · convertCell      — la celda cruda al tipo del campo (fechas
//                        dd/mm/aaaa, números con coma, sí/no, selects
//                        por etiqueta). validateAttrs sigue siendo el
//                        único juez: aquí solo se traduce.
//   · buildImportRows  — valida fila a fila (skip+motivo), marca
//                        is_draft si faltan required y extrae el
//                        teléfono del cliente para el vínculo.
// La escritura (org-scoped SIEMPRE) vive en routes-portal.
// ============================================================
'use strict';

const { splitCsvLine, toISODate, cleanCsvPhone } = require('../lifecycle/contact-import');
const { validateAttrs, normalizeIdentifier } = require('./entities');
const { draftIsComplete } = require('./entity-ai');

const MAX_IMPORT_ROWS = 500;   // cap duro por importación (v1)

// ─── Normalización (espejo de entity-ai: minúsculas, sin acentos) ───────────

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Palabras que no distinguen columnas ('fecha de la próxima ITV' ≈ 'ITV')
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'a', 'en',
  'mi', 'su', 'tu', 'que', 'y', 'o', 'fecha', 'dia',
  'proximo', 'proxima', 'proximos', 'proximas', 'ultimo', 'ultima', 'siguiente',
]);

function _tokens(s) {
  return _norm(s).split('_').filter(t => t && !STOPWORDS.has(t));
}

// ─── Parser CSV/TSV ──────────────────────────────────────────────────────────

/**
 * PURA — parsea el texto pegado/subido. Primera línea = cabeceras.
 * Detecta el separador contando en la cabecera: TAB (pegar celdas desde
 * Excel llega como TSV), ';' (Excel-ES exporta CSV con ;) o ','.
 * Limitación v1 heredada de contact-import: no soporta saltos de línea
 * DENTRO de una celda entrecomillada.
 * @returns {{ headers: string[], rows: string[][], sep: string }}
 */
function parseCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [], sep: ',' };

  const head = lines[0];
  const counts = [
    ['\t', head.split('\t').length],
    [';',  head.split(';').length],
    [',',  head.split(',').length],
  ];
  counts.sort((a, b) => b[1] - a[1]);       // más columnas gana; TAB desempata
  const sep = counts[0][1] > 1 ? counts[0][0] : ',';

  const headers = splitCsvLine(head, sep);
  const rows = lines.slice(1).map(l => splitCsvLine(l, sep));
  return { headers, rows, sep };
}

// ─── Sugerencia de mapeo cabecera → destino ──────────────────────────────────
// Destinos: key de campo de la plantilla | '_phone' (teléfono del cliente,
// para el vínculo) | '_name' (nombre del cliente) | '' (no usar).

const PHONE_ALIASES = new Set([
  'telefono', 'phone', 'movil', 'tel', 'tlf', 'celular', 'telefonocliente',
  'telefonodelcliente', 'movilcliente', 'telefonodueno', 'telefonopropietario',
  'numerodetelefono', 'whatsapp',
]);
const NAME_ALIASES = new Set([
  'cliente', 'dueno', 'duena', 'propietario', 'propietaria', 'titular',
  'nombrecliente', 'nombredelcliente', 'clientenombre', 'nombredueno',
  'nombredeldueno', 'nombrepropietario', 'contacto', 'nombrecontacto',
  'nombreyapellidos', 'paciente',
]);
const PHONE_TOKENS = new Set(['telefono', 'phone', 'movil', 'tel', 'tlf', 'celular', 'whatsapp']);
const NAME_TOKENS  = new Set(['cliente', 'dueno', 'duena', 'propietario', 'propietaria', 'titular']);

/**
 * PURA — sugiere el mapeo de cada cabecera contra los campos del tipo.
 * Determinista, cero LLM. Prioridad por columna:
 *   1) key/label EXACTOS del campo (gana a todo: en veterinaria, «Nombre»
 *      es el campo nombre de la mascota, no el del cliente)
 *   2) alias exacto de teléfono/nombre del cliente
 *   3) tokens significativos con hit ÚNICO ('Fecha ITV' → proxima_itv)
 *   4) token suelto de teléfono/cliente ('Teléfono del dueño' → _phone)
 * Cada destino se asigna UNA vez (primera columna que lo gana).
 * @returns {string[]} un destino por cabecera ('' = no usar)
 */
function suggestMapping(headers, fields) {
  const used = new Set();
  const take = (target) => { used.add(target); return target; };

  return (headers || []).map(h => {
    const n = _norm(h);
    if (!n) return '';
    const flat = n.replace(/_/g, '');   // 'nombre_del_cliente' → 'nombredelcliente'

    // 1) exacto contra key/label
    for (const f of (fields || [])) {
      if (used.has(f.key)) continue;
      if (_norm(f.key) === n || _norm(f.label) === n) return take(f.key);
    }
    // 2) alias exacto de columnas del cliente (sin separadores)
    if (PHONE_ALIASES.has(flat) && !used.has('_phone')) return take('_phone');
    if (NAME_ALIASES.has(flat)  && !used.has('_name'))  return take('_name');

    // 3) tokens con hit único (inclusión en ambos sentidos, como resolveDateField;
    //    la inclusión exige ≥2 letras por lado — sin esto, el token 'n' de
    //    «Nº de chip» casaba con cualquier palabra que llevara una n)
    const tokMatch = (t, x) => t === x || (t.length >= 2 && x.length >= 2 && (x.includes(t) || t.includes(x)));
    const qT = _tokens(h);
    if (qT.length) {
      const hits = (fields || []).filter(f => {
        if (used.has(f.key)) return false;
        const ft = [..._tokens(f.key), ..._tokens(f.label)];
        return qT.every(t => ft.some(x => tokMatch(t, x)));
      });
      if (hits.length === 1) return take(hits[0].key);
    }
    // 4) token suelto de teléfono/cliente
    if (qT.some(t => PHONE_TOKENS.has(t)) && !used.has('_phone')) return take('_phone');
    if (qT.some(t => NAME_TOKENS.has(t))  && !used.has('_name'))  return take('_name');

    return '';
  });
}

/**
 * PURA — sanea un mapeo que llega del cliente: solo '' | '_phone' | '_name'
 * | key real del tipo, y cada destino UNA sola vez. Todo lo demás → ''.
 */
function sanitizeMapping(mapping, fields) {
  const validKeys = new Set((fields || []).map(f => f.key));
  const used = new Set();
  return (Array.isArray(mapping) ? mapping : []).map(raw => {
    const t = String(raw || '');
    if (!t) return '';
    const ok = t === '_phone' || t === '_name' || validKeys.has(t);
    if (!ok || used.has(t)) return '';
    used.add(t);
    return t;
  });
}

// ─── Conversión de celda al tipo del campo ───────────────────────────────────

/**
 * PURA — traduce la celda cruda a lo que espera validateAttrs. NUNCA valida:
 * si no puede traducir (fecha rara, opción desconocida) devuelve el crudo y
 * validateAttrs — el único juez — señala el error con su mensaje.
 */
function convertCell(field, raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  switch (field.type) {
    case 'date':
      return toISODate(v) || v;                                     // dd/mm/aaaa → ISO
    case 'number':
      return v.replace(/[€\s]/g, '').replace(',', '.');             // '12,5 €' → '12.5'
    case 'boolean': {
      const n = _norm(v);
      if (['si', 'yes', 'true', '1', 'x'].includes(n)) return 'true';
      if (['no', 'false', '0'].includes(n)) return 'false';
      return v;
    }
    case 'select': {
      const n = _norm(v);
      for (const o of (field.options || [])) {
        if (_norm(o.value) === n || _norm(o.label) === n) return o.value;  // 'Perro' → 'perro'
      }
      return v;
    }
    case 'multiselect': {
      const parts = v.split(/[,;/|]/).map(s => s.trim()).filter(Boolean);
      return parts.map(p => {
        const n = _norm(p);
        for (const o of (field.options || [])) {
          if (_norm(o.value) === n || _norm(o.label) === n) return o.value;
        }
        return p;
      });
    }
    default:
      return v;   // text / phone / note
  }
}

// ─── Construcción y validación de filas ──────────────────────────────────────

/**
 * PURA — convierte las filas crudas en filas listas para insertar:
 *   · fila 100% vacía → se ignora en silencio (Excel deja colas de filas)
 *   · sin NINGÚN dato en columnas mapeadas → skip con motivo
 *   · valor inválido (fecha rota, opción desconocida) → skip con el
 *     mensaje de validateAttrs (valores presentes SIEMPRE estrictos)
 *   · required ausentes → la ficha entra como BORRADOR (is_draft=true,
 *     el badge «completar ficha» del portal) — mejor a medias que perdida
 *   · teléfono del cliente: normalizado aquí (+34 si son 9 dígitos);
 *     inválido no tumba la fila, solo se queda sin vínculo
 * Cap MAX_IMPORT_ROWS filas; el resto se reporta en truncated.
 * @returns {{ rows: Array<{row, attrs, isDraft, phone, contactName}>,
 *             skipped: Array<{row, reason}>, truncated: number }}
 */
function buildImportRows({ rows, mapping, fields }) {
  const out = { rows: [], skipped: [], truncated: 0 };
  const fieldByKey = new Map((fields || []).map(f => [f.key, f]));
  const all = Array.isArray(rows) ? rows : [];
  const slice = all.slice(0, MAX_IMPORT_ROWS);
  out.truncated = Math.max(0, all.length - slice.length);

  slice.forEach((cells, i) => {
    const line = i + 2;   // 1-based + cabecera: la fila que el dueño ve en su Excel
    if ((cells || []).every(c => !String(c == null ? '' : c).trim())) return;

    const rawAttrs = {};
    let phone = null, contactName = '';
    (mapping || []).forEach((target, col) => {
      if (!target) return;
      const raw = (cells || [])[col];
      if (target === '_phone') { phone = cleanCsvPhone(raw); return; }
      if (target === '_name')  { contactName = String(raw || '').trim().slice(0, 120); return; }
      const f = fieldByKey.get(target);
      if (!f) return;
      const v = convertCell(f, raw);
      if (v !== '') rawAttrs[f.key] = v;
    });

    if (!Object.keys(rawAttrs).length) {
      out.skipped.push({ row: line, reason: 'Sin datos en las columnas elegidas' });
      return;
    }

    // partial:true — los required pueden faltar (→ borrador), pero lo
    // presente se valida igual de estricto que un alta manual.
    const v = validateAttrs(fields || [], rawAttrs, { partial: true });
    if (!v.ok) {
      out.skipped.push({ row: line, reason: v.errors[0].error });
      return;
    }
    const attrs = { ...v.attrs };
    for (const k of Object.keys(attrs)) { if (attrs[k] === null) delete attrs[k]; }

    const isDraft = !draftIsComplete(fields || [], attrs);
    if (isDraft) attrs.is_draft = true;

    out.rows.push({ row: line, attrs, isDraft, phone, contactName });
  });

  return out;
}

// ─── Upsert por identificador (reimportar NO duplica) ────────────────────────

/**
 * PURA — reparte las filas listas de buildImportRows entre INSERTAR y
 * ACTUALIZAR según el campo identificador del tipo (matrícula, nº póliza…):
 *   · sin idField (sector sin identificador natural) → todo inserta, como antes
 *   · fila sin valor en el identificador → inserta (no hay con qué casar)
 *   · identificador ya visto EN EL MISMO archivo → skip con motivo (dos
 *     inserts del mismo id sí duplicarían; la primera fila gana)
 *   · identificador que casa con una entidad existente (normalizado:
 *     «1234-ABC» == «1234 abc») → update sobre esa entidad
 * @param {Array}    rows           filas de buildImportRows ({row, attrs, …})
 * @param {object}   idField        campo identificador ({key, label}) o null
 * @param {Map|null} existingIndex  identificador normalizado → entidad viva
 * @returns {{ inserts: [], updates: Array<{row, entity}>, skipped: [] }}
 */
function resolveImportActions({ rows, idField, existingIndex }) {
  const out = { inserts: [], updates: [], skipped: [] };
  if (!idField) { out.inserts = (rows || []).slice(); return out; }

  const seen = new Map();   // identificador normalizado → nº de fila que lo trajo
  for (const r of (rows || [])) {
    const norm = normalizeIdentifier(r.attrs ? r.attrs[idField.key] : '');
    if (!norm) { out.inserts.push(r); continue; }
    if (seen.has(norm)) {
      out.skipped.push({ row: r.row, reason: `«${idField.label || idField.key}» repetido en el archivo (igual que la fila ${seen.get(norm)})` });
      continue;
    }
    seen.set(norm, r.row);
    const existing = existingIndex ? existingIndex.get(norm) : null;
    if (existing) out.updates.push({ row: r, entity: existing });
    else out.inserts.push(r);
  }
  return out;
}

module.exports = {
  MAX_IMPORT_ROWS,
  parseCsv,
  suggestMapping,
  sanitizeMapping,
  convertCell,
  buildImportRows,
  resolveImportActions,
};
