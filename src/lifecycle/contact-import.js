// ============================================================
// NodeFlow — Importación masiva de clientes con caducidad (2026-07-06)
// ------------------------------------------------------------
// El "oro" de Osakin (y de cualquier clínica con psicotécnicos):
// subes el export de la clínica (Nombre, Teléfono, Caduca_el, Tipo)
// y el sistema crea los contactos con sector_data.caducidad → el
// reminder-engine programa la renovación ~1 mes antes de cada fecha.
//
// Sin export el motor arranca vacío y se llena a cuentagotas. Con él,
// da renovaciones desde el día 1. NO es un recall masivo a destiempo:
// cada aviso cae en la fecha exacta que el propio cliente necesita.
//
// parseImportCsv() es PURA (testeable sin BD). importContacts() hace
// el upsert + recalcula. Cabeceras flexibles, fechas dd/mm/aaaa o ISO.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('CONTACT-IMPORT');

const DATE_FIELD = 'fecha_caducidad_psicotecnico';
const TYPE_FIELD = 'tipo_psicotecnico';

// Normaliza una cabecera: minúsculas, sin acentos, sin separadores.
function _norm(h) {
  return String(h || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s_.-]/g, '');
}

const COLS = {
  name:      ['nombre', 'name', 'cliente', 'nombreyapellidos'],
  phone:     ['telefono', 'phone', 'movil', 'tel', 'tlf', 'celular', 'numero'],
  caducidad: ['caducael', 'caducidad', 'caduca', 'fecha', 'vencimiento', 'fechacaducidad', 'expira', 'fechacaduca'],
  tipo:      ['tipo', 'type', 'permiso', 'categoria', 'carnet'],
};

function _matchCol(header) {
  const n = _norm(header);
  for (const [key, aliases] of Object.entries(COLS)) {
    if (aliases.includes(n)) return key;
  }
  return null;
}

// Parte una línea CSV respetando comillas dobles. Acepta , o ; como separador.
function _splitLine(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Normaliza fecha a ISO YYYY-MM-DD. Acepta dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd.
function _toISO(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);      // ISO
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);           // dd/mm/aaaa
  if (m) {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// Teléfono: deja dígitos (guarda + si internacional). Válido si 9 dígitos (ES) o 10-15.
function _cleanPhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const digits = s.replace(/\D/g, '');
  if (digits.length === 9) return '+34' + digits;         // fijo/móvil español sin prefijo
  if (digits.length >= 10 && digits.length <= 15) return s.startsWith('+') ? s : '+' + digits;
  return null;
}

/**
 * Parsea un CSV de export de clínica. PURA.
 * @returns {{ rows: Array, errors: Array, total: number, columns: object }}
 *   rows: [{ name, phone, sectorData: { [DATE_FIELD], [TYPE_FIELD] } }]
 *   errors: [{ line, reason, raw }]
 */
function parseImportCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');            // quita BOM
  const lines = clean.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return { rows: [], errors: [], total: 0, columns: {} };

  // Detecta separador por la cabecera (; frecuente en Excel-ES).
  const sep = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';
  const header = _splitLine(lines[0], sep);
  const colIdx = {};
  header.forEach((h, i) => { const key = _matchCol(h); if (key && colIdx[key] === undefined) colIdx[key] = i; });

  const rows = [], errors = [];
  if (colIdx.phone === undefined) {
    return { rows, errors: [{ line: 1, reason: 'No encuentro la columna de teléfono', raw: lines[0] }], total: 0, columns: colIdx };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = _splitLine(lines[i], sep);
    const phone = _cleanPhone(cells[colIdx.phone]);
    if (!phone) { errors.push({ line: i + 1, reason: 'Teléfono inválido', raw: lines[i] }); continue; }

    const sectorData = {};
    if (colIdx.caducidad !== undefined) {
      const iso = _toISO(cells[colIdx.caducidad]);
      if (cells[colIdx.caducidad] && !iso) { errors.push({ line: i + 1, reason: 'Fecha de caducidad inválida', raw: lines[i] }); continue; }
      if (iso) sectorData[DATE_FIELD] = iso;
    }
    if (colIdx.tipo !== undefined && cells[colIdx.tipo]) sectorData[TYPE_FIELD] = cells[colIdx.tipo].slice(0, 60);

    rows.push({
      name: colIdx.name !== undefined ? (cells[colIdx.name] || '').slice(0, 120) : '',
      phone,
      sectorData,
    });
  }
  return { rows, errors, total: rows.length, columns: colIdx };
}

const WINDOW_DAYS = 30;   // avisar ~1 mes antes de la caducidad

/**
 * Fecha en que NodeFlow avisará, dada una caducidad. PURA.
 *  · caducidad ya pasada        → null (no molestar)
 *  · aviso normal (30d antes)   → esa fecha
 *  · caduca dentro de <30 días  → mañana (inminente: no perderlo por poco)
 * @returns {{ when: Date, urgent: boolean } | null}
 */
function plannedReminder(caducidadISO, now = new Date()) {
  if (!caducidadISO) return null;
  const cad = new Date(caducidadISO);
  if (isNaN(cad.getTime()) || cad <= now) return null;
  const aviso = new Date(cad); aviso.setDate(aviso.getDate() - WINDOW_DAYS);
  if (aviso > now) return { when: aviso, urgent: false };
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  return { when: tomorrow, urgent: true };
}

/** Cuántas renovaciones se programarán (normales + inminentes). Para el preview. */
function countScheduled(rows) {
  let n = 0;
  for (const r of rows) {
    if (r.sectorData && plannedReminder(r.sectorData[DATE_FIELD])) n++;
  }
  return n;
}

/**
 * Upsert de contactos + recálculo de recordatorios. Idempotente por (org_id, phone).
 * @returns {Promise<{ imported, created, updated, scheduled, skipped, errors }>}
 */
async function importContacts(orgId, rows, opts = {}) {
  const db = opts.db || require('../db/database').getDatabase();
  const schedule = opts.scheduleReminder || require('./reminder-engine').scheduleReminder;
  const out = { imported: 0, created: 0, updated: 0, scheduled: 0, urgent: 0, skipped: 0, errors: [] };
  if (!db.enabled || !orgId || !Array.isArray(rows)) return out;

  for (const r of rows) {
    try {
      // ¿existe ya? (para no pisar su sector_data ni su nombre bueno)
      const { data: existing } = await db.client.from('contacts')
        .select('id, name, sector_data').eq('org_id', orgId).eq('phone', r.phone).maybeSingle();

      let contactId;
      if (existing) {
        contactId = existing.id;
        const mergedSector = Object.assign({}, existing.sector_data || {}, r.sectorData);
        const patch = { sector_data: mergedSector, updated_at: new Date().toISOString() };
        if (!existing.name && r.name) patch.name = r.name;   // solo rellena si estaba vacío
        await db.client.from('contacts').update(patch).eq('id', contactId).eq('org_id', orgId);
        out.updated++;
      } else {
        const { data: ins, error } = await db.client.from('contacts')
          .insert({ org_id: orgId, phone: r.phone, name: r.name || null, sector_data: r.sectorData, call_count: 0 })
          .select('id').maybeSingle();
        if (error || !ins) { out.skipped++; out.errors.push({ phone: r.phone, reason: (error && error.message) || 'insert' }); continue; }
        contactId = ins.id;
        out.created++;
      }
      out.imported++;

      // Programa la renovación según su caducidad (normal ~30d antes, o ya si es inminente).
      try {
        const plan = plannedReminder(r.sectorData && r.sectorData[DATE_FIELD]);
        if (plan) {
          await schedule({ orgId, contactId, serviceKey: 'renovacion_psicotecnico', scheduledFor: plan.when, channel: 'whatsapp' });
          out.scheduled++;
          if (plan.urgent) out.urgent++;
        }
      } catch (e) { log.warn(`schedule(${contactId}): ${e.message}`); }
    } catch (e) {
      out.skipped++; out.errors.push({ phone: r.phone, reason: e.message });
    }
  }
  return out;
}

module.exports = { parseImportCsv, importContacts, countScheduled, plannedReminder, DATE_FIELD, TYPE_FIELD };
