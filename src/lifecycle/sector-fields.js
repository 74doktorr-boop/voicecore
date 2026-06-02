// ============================================================
// NodeFlow — Sector Required Fields (Lifecycle Wizard)
// Defines which sector_data fields must be filled per sector
// for lifecycle reminders to work. Pure data + logic, no I/O.
// ============================================================

const SECTOR_REQUIRED_FIELDS = {
  taller: [
    { key: 'matricula',               label: 'Matrícula',                  type: 'text',   placeholder: 'ej. 1234 ABC' },
    { key: 'fecha_ultimo_aceite',     label: 'Último cambio de aceite',    type: 'date',   placeholder: 'dd/mm/aaaa' },
    { key: 'fecha_vencimiento_itv',   label: 'ITV vence',                  type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  veterinaria: [
    { key: 'nombre_mascota',          label: 'Nombre de la mascota',       type: 'text',   placeholder: 'ej. Tobi' },
    { key: 'fecha_proxima_vacuna',    label: 'Próxima vacuna',             type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  gimnasio: [
    { key: 'fecha_vencimiento_cuota', label: 'Cuota vence',                type: 'date',   placeholder: 'dd/mm/aaaa' },
  ],
  fisioterapia: [
    { key: 'fecha_alta',              label: 'Fecha de alta',              type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  psicologia: [
    { key: 'frecuencia_sesiones',     label: 'Frecuencia sesiones (días)', type: 'number', placeholder: 'ej. 14' },
  ],
  optica: [
    { key: 'suministro_lentillas_dias', label: 'Días de lentillas',        type: 'number', placeholder: 'ej. 90' },
  ],
  hotel: [
    { key: 'fecha_aniversario',       label: 'Aniversario (MM-DD)',        type: 'text',   placeholder: 'ej. 06-15' },
    { key: 'fecha_cumpleanos',        label: 'Cumpleaños (MM-DD)',         type: 'text',   placeholder: 'ej. 03-22',   optional: true },
  ],
  academia: [
    { key: 'fecha_fin_curso',         label: 'Fin de curso',               type: 'date',   placeholder: 'dd/mm/aaaa' },
  ],
};

/**
 * Get completion status for a contact's sector_data.
 *
 * A contact is 'complete' when all non-optional fields are filled.
 * A contact is 'partial' when some but not all non-optional fields are filled.
 * A contact is 'empty' when zero non-optional fields are filled.
 * Returns 'no_fields' for sectors with no required manual fields (peluqueria, dental, etc.)
 *
 * @param {string} sectorSlug - e.g. 'taller', 'veterinaria'
 * @param {object|null} sectorData - contact's sector_data from DB (may be null/undefined)
 * @returns {{ status: 'complete'|'partial'|'empty'|'no_fields', missing: string[] }}
 */
function getCompletionStatus(sectorSlug, sectorData) {
  var fields = SECTOR_REQUIRED_FIELDS[sectorSlug];
  if (!fields || fields.length === 0) return { status: 'no_fields', missing: [] };

  var data     = sectorData || {};
  var required = fields.filter(function(f) { return !f.optional; });
  var missing  = required.filter(function(f) {
    var v = data[f.key];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length === 0)              return { status: 'complete', missing: [] };
  if (missing.length < required.length)  return { status: 'partial',  missing: missing.map(function(f) { return f.key; }) };
  return                                        { status: 'empty',    missing: missing.map(function(f) { return f.key; }) };
}

module.exports = { SECTOR_REQUIRED_FIELDS, getCompletionStatus };
