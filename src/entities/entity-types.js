// ============================================================
// NodeFlow — ENTIDADES v0: catálogo de plantillas + registro por org
// ------------------------------------------------------------
// La "cosa" del cliente (su coche, su mascota, su póliza) como objeto
// de primera clase. Lección de Twenty CRM (solo conceptos, cero código
// AGPL): los tipos estándar son PLANTILLAS versionadas que se copian
// al crear (copy-on-create) en nf_entity_types, con catalog_key
// 'sector.tipo@v1' para poder reconciliar en v1.
//
// Regla de oro (Product Bible): la PERSONA es contact; la COSA es
// entidad. Máx 1 tipo por sector y ≤8 campos: la plantilla perfecta
// es la que el dueño nunca necesita tocar.
//
// La feature NO-OPea con gracia si las tablas no existen todavía
// (db/migration-entities.sql pendiente de aplicar a mano) o si
// ENTITIES_DISABLED=1 (kill-switch).
// ============================================================
'use strict';

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('ENTITY-TYPES');

const TEMPLATE_VERSION = 'v1';
const MAX_FIELDS       = 8;   // cap duro v0 — añadir campos exige justificación
const FIELD_TYPES      = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'phone', 'note'];

// ─── Catálogo de plantillas por sector ───────────────────────────────────────
// Cada plantilla: 1 tipo de entidad, ≤8 campos, y SIEMPRE al menos un campo
// fecha con semántica de recordatorio (reminder) — ahí vive el dinero
// recurrente: ITV, vacuna, renovación de póliza, plazo procesal…
//   reminder: { offset_days (negativo = antes), campaign_kind, message_hint }
//   message_hint admite {{entity}} (display_name) y {{value}} (la fecha).
const ENTITY_TEMPLATES = {

  // 🔧 Taller → Vehículos
  taller: [{
    key: 'vehiculo', label_singular: 'Vehículo', label_plural: 'Vehículos',
    icon: '🚗', color: '#c4f546',
    label_template: '{{marca}} {{modelo}} · {{matricula}}',
    fields: [
      { key: 'matricula',        type: 'text',   label: 'Matrícula', required: true, show_in_list: true, position: 1 },
      { key: 'marca',            type: 'text',   label: 'Marca',     show_in_list: true, position: 2 },
      { key: 'modelo',           type: 'text',   label: 'Modelo',    position: 3 },
      { key: 'km',               type: 'number', label: 'Kilómetros', position: 4 },
      { key: 'proxima_itv',      type: 'date',   label: 'Próxima ITV', show_in_list: true, position: 5,
        reminder: { offset_days: -30, campaign_kind: 'itv', message_hint: 'La ITV de {{entity}} caduca el {{value}}' } },
      { key: 'proxima_revision', type: 'date',   label: 'Próxima revisión', position: 6,
        reminder: { offset_days: -15, campaign_kind: 'revision', message_hint: 'Revisión de {{entity}} el {{value}}' } },
      { key: 'cambio_aceite',    type: 'date',   label: 'Próximo cambio de aceite', position: 7,
        reminder: { offset_days: -15, campaign_kind: 'aceite', message_hint: 'Cambio de aceite de {{entity}} el {{value}}' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 8 },
    ],
  }],

  // 🐾 Veterinaria → Mascotas
  veterinaria: [{
    key: 'mascota', label_singular: 'Mascota', label_plural: 'Mascotas',
    icon: '🐾', color: '#c4f546',
    label_template: '{{nombre}} ({{especie}})',
    fields: [
      { key: 'nombre',          type: 'text',   label: 'Nombre', required: true, show_in_list: true, position: 1 },
      { key: 'especie',         type: 'select', label: 'Especie', show_in_list: true, position: 2,
        options: [
          { value: 'perro', label: 'Perro' }, { value: 'gato', label: 'Gato' },
          { value: 'conejo', label: 'Conejo' }, { value: 'ave', label: 'Ave' },
          { value: 'reptil', label: 'Reptil' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'raza',            type: 'text',   label: 'Raza', position: 3 },
      { key: 'chip',            type: 'text',   label: 'Nº de chip', position: 4 },
      { key: 'proxima_vacuna',  type: 'date',   label: 'Próxima vacuna', show_in_list: true, position: 5,
        reminder: { offset_days: -14, campaign_kind: 'vacuna', message_hint: 'La vacuna de {{entity}} toca el {{value}}' } },
      { key: 'desparasitacion', type: 'date',   label: 'Próxima desparasitación', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'desparasitacion', message_hint: 'Desparasitación de {{entity}} el {{value}}' } },
      { key: 'revision_anual',  type: 'date',   label: 'Revisión anual', position: 7,
        reminder: { offset_days: -21, campaign_kind: 'revision', message_hint: 'Revisión anual de {{entity}} el {{value}}' } },
      { key: 'notas',           type: 'note',   label: 'Notas (alergias, historial…)', position: 8 },
    ],
  }],

  // 🏠 Inmobiliaria → Propiedades
  inmobiliaria: [{
    key: 'propiedad', label_singular: 'Propiedad', label_plural: 'Propiedades',
    icon: '🏠', color: '#c4f546',
    label_template: '{{direccion}}',
    fields: [
      { key: 'direccion', type: 'text',   label: 'Dirección', required: true, show_in_list: true, position: 1 },
      { key: 'metros',    type: 'number', label: 'Metros cuadrados (m²)', show_in_list: true, position: 2 },
      { key: 'precio',    type: 'number', label: 'Precio (€)', show_in_list: true, position: 3 },
      { key: 'operacion', type: 'select', label: 'Operación', position: 4,
        options: [{ value: 'venta', label: 'Venta' }, { value: 'alquiler', label: 'Alquiler' }] },
      { key: 'caducidad_certificado_energetico', type: 'date', label: 'Caducidad certificado energético', position: 5,
        reminder: { offset_days: -60, campaign_kind: 'certificado', message_hint: 'El certificado energético de {{entity}} caduca el {{value}}' } },
      { key: 'proxima_revision_precio', type: 'date', label: 'Próxima revisión de precio', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'revision_precio', message_hint: 'Revisar el precio de {{entity}} el {{value}}' } },
      { key: 'notas',     type: 'note',   label: 'Notas', position: 7 },
    ],
  }],

  // ⚖️ Abogados → Expedientes
  abogados: [{
    key: 'expediente', label_singular: 'Expediente', label_plural: 'Expedientes',
    icon: '⚖️', color: '#c4f546',
    label_template: 'Exp. {{numero}} · {{tipo}}',
    fields: [
      { key: 'numero',        type: 'text',   label: 'Nº de expediente', required: true, show_in_list: true, position: 1 },
      { key: 'tipo',          type: 'select', label: 'Tipo', show_in_list: true, position: 2,
        options: [
          { value: 'civil', label: 'Civil' }, { value: 'penal', label: 'Penal' },
          { value: 'laboral', label: 'Laboral' }, { value: 'mercantil', label: 'Mercantil' },
          { value: 'familia', label: 'Familia' }, { value: 'extranjeria', label: 'Extranjería' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'juzgado',       type: 'text',   label: 'Juzgado', position: 3 },
      { key: 'proximo_plazo', type: 'date',   label: 'Próximo plazo procesal', show_in_list: true, position: 4,
        reminder: { offset_days: -7, campaign_kind: 'plazo', message_hint: 'Plazo procesal de {{entity}} vence el {{value}}' } },
      { key: 'proxima_vista', type: 'date',   label: 'Próxima vista', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'vista', message_hint: 'Vista de {{entity}} el {{value}}' } },
      { key: 'estado',        type: 'select', label: 'Estado', position: 6,
        options: [
          { value: 'abierto', label: 'Abierto' }, { value: 'en_tramite', label: 'En trámite' },
          { value: 'cerrado', label: 'Cerrado' },
        ] },
      { key: 'notas',         type: 'note',   label: 'Notas', position: 7 },
    ],
  }],

  // 📋 Asesoría / gestoría → Obligaciones fiscales
  asesoria: [{
    key: 'obligacion_fiscal', label_singular: 'Obligación fiscal', label_plural: 'Obligaciones fiscales',
    icon: '📋', color: '#c4f546',
    label_template: '{{concepto}} · {{empresa}}',
    fields: [
      { key: 'concepto', type: 'select', label: 'Concepto', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'iva_trimestral', label: 'IVA trimestral' }, { value: 'renta', label: 'Renta anual' },
          { value: 'cuentas_anuales', label: 'Cuentas anuales' }, { value: 'impuesto_sociedades', label: 'Impuesto de sociedades' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'empresa',             type: 'text',   label: 'Empresa / actividad', show_in_list: true, position: 2 },
      { key: 'nif',                 type: 'text',   label: 'NIF/CIF', position: 3 },
      { key: 'proximo_vencimiento', type: 'date',   label: 'Próximo vencimiento', show_in_list: true, position: 4,
        reminder: { offset_days: -15, campaign_kind: 'vencimiento', message_hint: '{{entity}} vence el {{value}}' } },
      { key: 'periodicidad',        type: 'select', label: 'Periodicidad', position: 5,
        options: [
          { value: 'trimestral', label: 'Trimestral' }, { value: 'anual', label: 'Anual' },
          { value: 'unico', label: 'Único' },
        ] },
      { key: 'notas',               type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🛡️ Seguros / correduría → Pólizas (oro puro: la renovación anual)
  seguros: [{
    key: 'poliza', label_singular: 'Póliza', label_plural: 'Pólizas',
    icon: '🛡️', color: '#c4f546',
    label_template: '{{ramo}} {{compania}} · {{numero}}',
    fields: [
      { key: 'numero',           type: 'text',   label: 'Nº de póliza', show_in_list: true, position: 1 },
      { key: 'compania',         type: 'text',   label: 'Compañía', required: true, show_in_list: true, position: 2 },
      { key: 'ramo',             type: 'select', label: 'Ramo', show_in_list: true, position: 3,
        options: [
          { value: 'auto', label: 'Auto' }, { value: 'hogar', label: 'Hogar' },
          { value: 'vida', label: 'Vida' }, { value: 'salud', label: 'Salud' },
          { value: 'comercio', label: 'Comercio' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'prima_anual',      type: 'number', label: 'Prima anual (€)', position: 4 },
      { key: 'fecha_renovacion', type: 'date',   label: 'Fecha de renovación', show_in_list: true, position: 5,
        reminder: { offset_days: -30, campaign_kind: 'renovacion', message_hint: 'La póliza {{entity}} se renueva el {{value}}' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🏋️ Gimnasio → Membresías
  gimnasio: [{
    key: 'membresia', label_singular: 'Membresía', label_plural: 'Membresías',
    icon: '🏋️', color: '#c4f546',
    label_template: 'Plan {{plan}}',
    fields: [
      { key: 'plan',             type: 'text',   label: 'Plan', required: true, show_in_list: true, position: 1 },
      { key: 'cuota_mensual',    type: 'number', label: 'Cuota mensual (€)', position: 2 },
      { key: 'fecha_alta',       type: 'date',   label: 'Fecha de alta', position: 3 },
      { key: 'fecha_renovacion', type: 'date',   label: 'Fecha de renovación', show_in_list: true, position: 4,
        reminder: { offset_days: -10, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} se renueva el {{value}}' } },
      { key: 'estado',           type: 'select', label: 'Estado', show_in_list: true, position: 5,
        options: [
          { value: 'activa', label: 'Activa' }, { value: 'pausada', label: 'Pausada' },
          { value: 'baja', label: 'Baja' },
        ] },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🎓 Academia → Matrículas
  academia: [{
    key: 'matricula', label_singular: 'Matrícula', label_plural: 'Matrículas',
    icon: '🎓', color: '#c4f546',
    label_template: '{{curso}} ({{nivel}})',
    fields: [
      { key: 'curso',         type: 'text', label: 'Curso', required: true, show_in_list: true, position: 1 },
      { key: 'nivel',         type: 'text', label: 'Nivel', show_in_list: true, position: 2 },
      { key: 'fecha_examen',  type: 'date', label: 'Fecha de examen', position: 3,
        reminder: { offset_days: -14, campaign_kind: 'examen', message_hint: 'Examen de {{entity}} el {{value}}' } },
      { key: 'fin_matricula', type: 'date', label: 'Fin de matrícula', show_in_list: true, position: 4,
        reminder: { offset_days: -15, campaign_kind: 'renovacion', message_hint: 'La matrícula {{entity}} termina el {{value}}' } },
      { key: 'notas',         type: 'note', label: 'Notas', position: 5 },
    ],
  }],

  // 👓 Óptica → Graduaciones
  optica: [{
    key: 'graduacion', label_singular: 'Graduación', label_plural: 'Graduaciones',
    icon: '👓', color: '#c4f546',
    label_template: 'Graduación {{tipo_lente}}',
    fields: [
      { key: 'tipo_lente',       type: 'select', label: 'Tipo de lente', show_in_list: true, position: 1,
        options: [
          { value: 'monofocal', label: 'Monofocal' }, { value: 'progresiva', label: 'Progresiva' },
          { value: 'lentillas', label: 'Lentillas' }, { value: 'sol_graduada', label: 'Sol graduada' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'graduacion_od',    type: 'text', label: 'Graduación ojo derecho', position: 2 },
      { key: 'graduacion_oi',    type: 'text', label: 'Graduación ojo izquierdo', position: 3 },
      { key: 'ultima_revision',  type: 'date', label: 'Última revisión', show_in_list: true, position: 4 },
      { key: 'proxima_revision', type: 'date', label: 'Próxima revisión visual', show_in_list: true, position: 5,
        reminder: { offset_days: -14, campaign_kind: 'revision_visual', message_hint: 'Revisión visual el {{value}}' } },
      { key: 'notas',            type: 'note', label: 'Notas', position: 6 },
    ],
  }],

  // 🔥 Clima / calderas → Equipos (revisión obligatoria anual)
  clima: [{
    key: 'equipo', label_singular: 'Equipo', label_plural: 'Equipos',
    icon: '🔥', color: '#c4f546',
    label_template: '{{tipo}} {{marca}} {{modelo}}',
    fields: [
      { key: 'tipo',                type: 'select', label: 'Tipo de equipo', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'caldera', label: 'Caldera' }, { value: 'aire_acondicionado', label: 'Aire acondicionado' },
          { value: 'bomba_calor', label: 'Bomba de calor' }, { value: 'calentador', label: 'Calentador' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'marca',               type: 'text', label: 'Marca', show_in_list: true, position: 2 },
      { key: 'modelo',              type: 'text', label: 'Modelo', position: 3 },
      { key: 'revision_obligatoria', type: 'date', label: 'Próxima revisión obligatoria', show_in_list: true, position: 4,
        reminder: { offset_days: -30, campaign_kind: 'revision', message_hint: 'La revisión obligatoria de {{entity}} toca el {{value}}' } },
      { key: 'fin_garantia',        type: 'date', label: 'Fin de garantía', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'garantia', message_hint: 'La garantía de {{entity}} termina el {{value}}' } },
      { key: 'notas',               type: 'note', label: 'Notas', position: 6 },
    ],
  }],

  // 💻 Informática → Contratos de mantenimiento
  informatica: [{
    key: 'contrato', label_singular: 'Contrato', label_plural: 'Contratos',
    icon: '💻', color: '#c4f546',
    label_template: '{{tipo}} · {{equipo}}',
    fields: [
      { key: 'equipo',           type: 'text',   label: 'Equipo / sistema', required: true, show_in_list: true, position: 1 },
      { key: 'tipo',             type: 'select', label: 'Tipo de contrato', show_in_list: true, position: 2,
        options: [
          { value: 'mantenimiento', label: 'Mantenimiento' }, { value: 'licencia', label: 'Licencia' },
          { value: 'hosting', label: 'Hosting' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'cuota',            type: 'number', label: 'Cuota (€)', position: 3 },
      { key: 'fecha_renovacion', type: 'date',   label: 'Fecha de renovación', show_in_list: true, position: 4,
        reminder: { offset_days: -30, campaign_kind: 'renovacion', message_hint: 'El contrato {{entity}} se renueva el {{value}}' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 5 },
    ],
  }],

  // 🧱 Reformas → Obras (fin de garantía = venta de mantenimiento)
  reformas: [{
    key: 'obra', label_singular: 'Obra', label_plural: 'Obras',
    icon: '🧱', color: '#c4f546',
    label_template: 'Obra {{tipo}} · {{direccion}}',
    fields: [
      { key: 'direccion',    type: 'text',   label: 'Dirección', required: true, show_in_list: true, position: 1 },
      { key: 'tipo',         type: 'text',   label: 'Tipo de obra (baño, cocina…)', show_in_list: true, position: 2 },
      { key: 'estado',       type: 'select', label: 'Estado', show_in_list: true, position: 3,
        options: [
          { value: 'presupuestada', label: 'Presupuestada' }, { value: 'en_curso', label: 'En curso' },
          { value: 'terminada', label: 'Terminada' },
        ] },
      { key: 'fin_previsto', type: 'date',   label: 'Fin previsto', position: 4 },
      { key: 'fin_garantia', type: 'date',   label: 'Fin de garantía', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'garantia', message_hint: 'La garantía de {{entity}} termina el {{value}} — buen momento para ofrecer mantenimiento' } },
      { key: 'notas',        type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🛂 Agencia de viajes → Documentos de viaje (nadie más avisa de esto)
  agencia_viajes: [{
    key: 'documento_viaje', label_singular: 'Documento de viaje', label_plural: 'Documentos de viaje',
    icon: '🛂', color: '#c4f546',
    label_template: '{{tipo}} {{numero}}',
    fields: [
      { key: 'tipo',      type: 'select', label: 'Tipo de documento', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'pasaporte', label: 'Pasaporte' }, { value: 'dni', label: 'DNI' },
          { value: 'visado', label: 'Visado' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'numero',    type: 'text', label: 'Número', position: 2 },
      { key: 'pais',      type: 'text', label: 'País (visados)', position: 3 },
      { key: 'caducidad', type: 'date', label: 'Fecha de caducidad', show_in_list: true, position: 4,
        reminder: { offset_days: -90, campaign_kind: 'caducidad', message_hint: 'Tu {{entity}} caduca el {{value}} — renuévalo antes de tu próximo viaje' } },
      { key: 'notas',     type: 'note', label: 'Notas', position: 5 },
    ],
  }],

  // 🦷 Dental → Tratamientos (el paciente sigue siendo contact; el
  // tratamiento es la entidad — sin pisar terreno de historia clínica)
  dental: [{
    key: 'tratamiento', label_singular: 'Tratamiento', label_plural: 'Tratamientos',
    icon: '🦷', color: '#c4f546',
    label_template: '{{tipo}}',
    fields: [
      { key: 'tipo',             type: 'text',   label: 'Tratamiento (ortodoncia, implante…)', required: true, show_in_list: true, position: 1 },
      { key: 'piezas',           type: 'text',   label: 'Piezas', position: 2 },
      { key: 'estado',           type: 'select', label: 'Estado', show_in_list: true, position: 3,
        options: [
          { value: 'pendiente', label: 'Pendiente' }, { value: 'en_curso', label: 'En curso' },
          { value: 'completado', label: 'Completado' },
        ] },
      { key: 'proxima_revision', type: 'date',   label: 'Próxima revisión', show_in_list: true, position: 4,
        reminder: { offset_days: -14, campaign_kind: 'revision', message_hint: 'Revisión de tu {{entity}} el {{value}}' } },
      { key: 'proxima_higiene',  type: 'date',   label: 'Próxima higiene / limpieza', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'higiene', message_hint: 'Tu limpieza dental toca el {{value}}' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
    ],
  }],
};

// ─── Kill-switch ─────────────────────────────────────────────────────────────
function entitiesFeatureEnabled() {
  return process.env.ENTITIES_DISABLED !== '1';
}

// ─── Resolución de plantillas por sector ─────────────────────────────────────
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Plantillas de entidad para un sector (o alias). Primero por clave directa
 * del catálogo de plantillas; si no, por el slug canónico del registro de
 * sectores (así 'veterinario' o 'talleres' también resuelven). [] si el
 * sector no tiene entidades — no forzar: en peluquería la persona YA es
 * el objeto.
 */
function templatesForSector(sectorRaw) {
  if (!sectorRaw) return [];
  const direct = ENTITY_TEMPLATES[_norm(sectorRaw)];
  if (direct) return direct;
  try {
    const { resolveSector } = require('../sectors/sector-registry');
    const slug = resolveSector(sectorRaw).slug;
    return ENTITY_TEMPLATES[slug] || [];
  } catch (_) { return []; }
}

/** ¿Tiene este sector plantillas de entidad? (gate del portal y del tool de voz) */
function sectorHasEntityTemplates(sectorRaw) {
  return entitiesFeatureEnabled() && templatesForSector(sectorRaw).length > 0;
}

/**
 * Instancia una plantilla del catálogo como fila de nf_entity_types para
 * una org (copy-on-create). PURA — testeable sin BD.
 */
function instantiateTemplate(template, orgId, sectorSlug) {
  return {
    organization_id: orgId,
    key:             template.key,
    catalog_key:     `${sectorSlug}.${template.key}@${TEMPLATE_VERSION}`,
    label_singular:  template.label_singular,
    label_plural:    template.label_plural,
    icon:            template.icon || null,
    color:           template.color || null,
    label_template:  template.label_template,
    fields:          template.fields,
    is_active:       true,
  };
}

// ─── Detección de tablas (feature apagada hasta aplicar la migración) ────────
// Sonda cacheada: un SELECT barato; 42P01 = la tabla no existe → false.
// TTL corto para que al aplicar la migración la feature aparezca sin reinicio.
let _tablesProbe = { at: 0, exists: false };
const PROBE_TTL_MS = 60 * 1000;

async function entityTablesExist(db) {
  db = db || getDatabase();
  if (!db.enabled) return false;
  if (Date.now() - _tablesProbe.at < PROBE_TTL_MS) return _tablesProbe.exists;
  try {
    const { error } = await db.client.from('nf_entity_types').select('id').limit(1);
    _tablesProbe = { at: Date.now(), exists: !error || error.code !== '42P01' };
  } catch (_) {
    _tablesProbe = { at: Date.now(), exists: false };
  }
  return _tablesProbe.exists;
}

// ─── Registro cacheado por org (lección 1.7 de Twenty) ───────────────────────
// Nunca leer nf_entity_types por request: Map en memoria con TTL 60s +
// invalidación explícita al escribir.
const _typeCache = new Map();  // orgId → { types, at }
const TYPE_TTL_MS = 60 * 1000;

function invalidateOrgEntityTypes(orgId) { _typeCache.delete(orgId); }

/** Tipos de entidad ACTIVOS de una org (cacheado). [] si feature/tablas off. */
async function getOrgEntityTypes(orgId, opts = {}) {
  if (!entitiesFeatureEnabled() || !orgId) return [];
  const hit = _typeCache.get(orgId);
  if (hit && Date.now() - hit.at < TYPE_TTL_MS) return hit.types;

  const db = opts.db || getDatabase();
  if (!db.enabled || !(await entityTablesExist(db))) return [];

  try {
    const { data, error } = await db.client
      .from('nf_entity_types')
      .select('id, key, catalog_key, label_singular, label_plural, icon, color, label_template, fields')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('key');
    if (error) { log.warn(`getOrgEntityTypes(${orgId}): ${error.message}`); return []; }
    const types = data || [];
    _typeCache.set(orgId, { types, at: Date.now() });
    return types;
  } catch (e) {
    log.warn(`getOrgEntityTypes(${orgId}): ${e.message}`);
    return [];
  }
}

/**
 * Copy-on-create: siembra en nf_entity_types las plantillas del sector que
 * la org aún no tenga (idempotente por unique(organization_id, key)).
 * Se dispara perezosamente desde el portal la primera vez que la pestaña
 * pregunta — sin migración de datos, sin botón.
 */
async function ensureOrgEntityTypes(orgId, sectorRaw, opts = {}) {
  if (!entitiesFeatureEnabled() || !orgId) return [];
  const templates = templatesForSector(sectorRaw);
  if (!templates.length) return [];

  const db = opts.db || getDatabase();
  if (!db.enabled || !(await entityTablesExist(db))) return [];

  const existing     = await getOrgEntityTypes(orgId, { db });
  const existingKeys = new Set(existing.map(t => t.key));
  const missing      = templates.filter(t => !existingKeys.has(t.key));
  if (!missing.length) return existing;

  // slug canónico para el catalog_key (aunque llegara un alias)
  let sectorSlug = _norm(sectorRaw);
  try { sectorSlug = require('../sectors/sector-registry').resolveSector(sectorRaw).slug || sectorSlug; } catch (_) {}
  if (!ENTITY_TEMPLATES[sectorSlug] && ENTITY_TEMPLATES[_norm(sectorRaw)]) sectorSlug = _norm(sectorRaw);

  const rows = missing.map(t => instantiateTemplate(t, orgId, sectorSlug));
  const { error } = await db.client
    .from('nf_entity_types')
    .upsert(rows, { onConflict: 'organization_id,key', ignoreDuplicates: true });
  if (error) {
    log.warn(`ensureOrgEntityTypes(${orgId}): ${error.message}`);
    return existing;
  }
  log.info(`Entidades: sembrados ${rows.map(r => r.key).join(', ')} para org ${orgId} (${sectorSlug})`);
  invalidateOrgEntityTypes(orgId);
  return getOrgEntityTypes(orgId, { db });
}

module.exports = {
  ENTITY_TEMPLATES,
  TEMPLATE_VERSION,
  MAX_FIELDS,
  FIELD_TYPES,
  entitiesFeatureEnabled,
  templatesForSector,
  sectorHasEntityTemplates,
  instantiateTemplate,
  entityTablesExist,
  getOrgEntityTypes,
  ensureOrgEntityTypes,
  invalidateOrgEntityTypes,
};
