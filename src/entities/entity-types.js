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

// is_identifier (máx 1 por plantilla): el campo que identifica la COSA en el
// mundo real (matrícula, nº de póliza, nº de expediente…). Reimportar el mismo
// Excel ACTUALIZA la ficha existente en vez de duplicarla (upsert), y el alta
// manual avisa del duplicado. Los sectores sin identificador natural (bonos,
// planes, eventos) NO llevan ninguno — y eso es honesto: ahí no hay upsert.

// ─── Catálogo de plantillas por sector ───────────────────────────────────────
// Cada plantilla: 1 tipo de entidad, ≤8 campos, y SIEMPRE al menos un campo
// fecha con semántica de recordatorio (reminder) — ahí vive el dinero
// recurrente: ITV, vacuna, renovación de póliza, plazo procesal…
//   reminder: { offset_days (negativo = antes), campaign_kind, message_hint }
//   message_hint admite {{entity}} (display_name) y {{value}} (la fecha).
const ENTITY_TEMPLATES = {

  // 🔧 Taller → Vehículos
  // OJO producto (Unai, 2026-07-08): el dinero del taller NO es la ITV en sí
  // (eso es negocio de la estación) — es SU revisión pre-ITV: mirar el coche
  // antes para que pase a la primera. Cada hint vende el servicio DEL TALLER
  // con la fecha como gancho de urgencia, nunca el trámite de un tercero.
  taller: [{
    key: 'vehiculo', label_singular: 'Vehículo', label_plural: 'Vehículos',
    icon: '🚗', color: '#c4f546',
    label_template: '{{marca}} {{modelo}} · {{matricula}}',
    fields: [
      { key: 'matricula',        type: 'text',   label: 'Matrícula', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'marca',            type: 'text',   label: 'Marca',     show_in_list: true, position: 2 },
      { key: 'modelo',           type: 'text',   label: 'Modelo',    position: 3 },
      { key: 'km',               type: 'number', label: 'Kilómetros', position: 4 },
      { key: 'proxima_itv',      type: 'date',   label: 'Próxima ITV', show_in_list: true, position: 5,
        reminder: { offset_days: -30, campaign_kind: 'itv', message_hint: 'A tu {{entity}} le toca la ITV el {{value}}. ¿Te lo revisamos antes para que pases a la primera? Pide cita y te lo dejamos listo.' } },
      { key: 'proxima_revision', type: 'date',   label: 'Próxima revisión', position: 6,
        reminder: { offset_days: -15, campaign_kind: 'revision', message_hint: 'La revisión de {{entity}} toca el {{value}} — resérvanos un hueco y te lo dejamos a punto.' } },
      { key: 'cambio_aceite',    type: 'date',   label: 'Próximo cambio de aceite', position: 7,
        reminder: { offset_days: -15, campaign_kind: 'aceite', message_hint: 'A {{entity}} le toca el cambio de aceite el {{value}} — pásate y te lo hacemos en el día.' } },
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
      { key: 'chip',            type: 'text',   label: 'Nº de chip', position: 4, is_identifier: true },
      { key: 'proxima_vacuna',  type: 'date',   label: 'Próxima vacuna', show_in_list: true, position: 5,
        reminder: { offset_days: -14, campaign_kind: 'vacuna', message_hint: 'A {{entity}} le toca la vacuna el {{value}} — pide cita y lo dejamos protegido y con la cartilla al día.' } },
      { key: 'desparasitacion', type: 'date',   label: 'Próxima desparasitación', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'desparasitacion', message_hint: 'A {{entity}} le toca la desparasitación el {{value}} — pásate y te la llevas puesta en cinco minutos.' } },
      { key: 'revision_anual',  type: 'date',   label: 'Revisión anual', position: 7,
        reminder: { offset_days: -21, campaign_kind: 'revision', message_hint: 'Toca la revisión anual de {{entity}} el {{value}} — ¿te reservamos su hueco de siempre?' } },
      { key: 'notas',           type: 'note',   label: 'Notas (alergias, historial…)', position: 8 },
    ],
  }],

  // 🏠 Inmobiliaria → Propiedades
  inmobiliaria: [{
    key: 'propiedad', label_singular: 'Propiedad', label_plural: 'Propiedades',
    icon: '🏠', color: '#c4f546',
    label_template: '{{direccion}}',
    fields: [
      { key: 'direccion', type: 'text',   label: 'Dirección', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'metros',    type: 'number', label: 'Metros cuadrados (m²)', show_in_list: true, position: 2 },
      { key: 'precio',    type: 'number', label: 'Precio (€)', show_in_list: true, position: 3 },
      { key: 'operacion', type: 'select', label: 'Operación', position: 4,
        options: [{ value: 'venta', label: 'Venta' }, { value: 'alquiler', label: 'Alquiler' }] },
      { key: 'caducidad_certificado_energetico', type: 'date', label: 'Caducidad certificado energético', position: 5,
        reminder: { offset_days: -60, campaign_kind: 'certificado', message_hint: 'El certificado energético de {{entity}} caduca el {{value}} — te gestionamos la renovación para que la operación no se pare.' } },
      { key: 'proxima_revision_precio', type: 'date', label: 'Próxima revisión de precio', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'revision_precio', message_hint: 'Toca revisar el precio de {{entity}} ({{value}}) — te llamamos y lo ajustamos juntos al mercado para venderlo antes.' } },
      { key: 'notas',     type: 'note',   label: 'Notas', position: 7 },
    ],
  }],

  // ⚖️ Abogados → Expedientes
  abogados: [{
    key: 'expediente', label_singular: 'Expediente', label_plural: 'Expedientes',
    icon: '⚖️', color: '#c4f546',
    label_template: 'Exp. {{numero}} · {{tipo}}',
    fields: [
      { key: 'numero',        type: 'text',   label: 'Nº de expediente', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'tipo',          type: 'select', label: 'Tipo', show_in_list: true, position: 2,
        options: [
          { value: 'civil', label: 'Civil' }, { value: 'penal', label: 'Penal' },
          { value: 'laboral', label: 'Laboral' }, { value: 'mercantil', label: 'Mercantil' },
          { value: 'familia', label: 'Familia' }, { value: 'extranjeria', label: 'Extranjería' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'juzgado',       type: 'text',   label: 'Juzgado', position: 3 },
      { key: 'proximo_plazo', type: 'date',   label: 'Próximo plazo procesal', show_in_list: true, position: 4,
        reminder: { offset_days: -7, campaign_kind: 'plazo', message_hint: 'El plazo de {{entity}} vence el {{value}} — si falta algún documento, envíanoslo esta semana y lo presentamos con margen.' } },
      { key: 'proxima_vista', type: 'date',   label: 'Próxima vista', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'vista', message_hint: 'La vista de {{entity}} es el {{value}} — te llamamos unos días antes para prepararla contigo.' } },
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
        reminder: { offset_days: -15, campaign_kind: 'vencimiento', message_hint: '{{entity}} vence el {{value}} — envíanos la documentación estos días y lo dejamos presentado sin prisas.' } },
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
      { key: 'numero',           type: 'text',   label: 'Nº de póliza', show_in_list: true, position: 1, is_identifier: true },
      { key: 'compania',         type: 'text',   label: 'Compañía', required: true, show_in_list: true, position: 2 },
      { key: 'ramo',             type: 'select', label: 'Ramo', show_in_list: true, position: 3,
        options: [
          { value: 'auto', label: 'Auto' }, { value: 'hogar', label: 'Hogar' },
          { value: 'vida', label: 'Vida' }, { value: 'salud', label: 'Salud' },
          { value: 'comercio', label: 'Comercio' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'prima_anual',      type: 'number', label: 'Prima anual (€)', position: 4 },
      { key: 'fecha_renovacion', type: 'date',   label: 'Fecha de renovación', show_in_list: true, position: 5,
        reminder: { offset_days: -30, campaign_kind: 'renovacion', message_hint: 'Tu póliza {{entity}} se renueva el {{value}} — ¿la repasamos antes? Muchas veces podemos mejorarte precio o coberturas.' } },
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
        reminder: { offset_days: -10, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} se renueva el {{value}} — ¿seguimos entrenando? Si quieres cambiar de plan u horario, dínoslo y te lo dejamos hecho.' } },
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
        reminder: { offset_days: -14, campaign_kind: 'examen', message_hint: 'Tu examen de {{entity}} es el {{value}} — ¿reforzamos con una clase de repaso estas semanas?' } },
      { key: 'fin_matricula', type: 'date', label: 'Fin de matrícula', show_in_list: true, position: 4,
        reminder: { offset_days: -15, campaign_kind: 'renovacion', message_hint: 'Tu matrícula de {{entity}} termina el {{value}} — renueva ahora y no pierdes tu plaza ni tu grupo.' } },
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
        reminder: { offset_days: -14, campaign_kind: 'revision_visual', message_hint: 'Te toca la revisión visual el {{value}} — ven y comprobamos tu graduación sin compromiso; si ha cambiado, te lo dejamos perfecto.' } },
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
        reminder: { offset_days: -30, campaign_kind: 'revision', message_hint: 'La revisión obligatoria de {{entity}} toca el {{value}} — pide cita y te la hacemos con el certificado en regla.' } },
      { key: 'fin_garantia',        type: 'date', label: 'Fin de garantía', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'garantia', message_hint: 'La garantía de {{entity}} termina el {{value}} — contrata ahora el mantenimiento y sigue cubierto sin sustos.' } },
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
        reminder: { offset_days: -30, campaign_kind: 'renovacion', message_hint: 'Tu contrato {{entity}} se renueva el {{value}} — lo revisamos contigo y aprovechamos para dejar el sistema al día.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 5 },
    ],
  }],

  // 🧱 Reformas → Obras (fin de garantía = venta de mantenimiento)
  reformas: [{
    key: 'obra', label_singular: 'Obra', label_plural: 'Obras',
    icon: '🧱', color: '#c4f546',
    label_template: 'Obra {{tipo}} · {{direccion}}',
    fields: [
      { key: 'direccion',    type: 'text',   label: 'Dirección', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'tipo',         type: 'text',   label: 'Tipo de obra (baño, cocina…)', show_in_list: true, position: 2 },
      { key: 'estado',       type: 'select', label: 'Estado', show_in_list: true, position: 3,
        options: [
          { value: 'presupuestada', label: 'Presupuestada' }, { value: 'en_curso', label: 'En curso' },
          { value: 'terminada', label: 'Terminada' },
        ] },
      { key: 'fin_previsto', type: 'date',   label: 'Fin previsto', position: 4 },
      { key: 'fin_garantia', type: 'date',   label: 'Fin de garantía', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'garantia', message_hint: 'La garantía de {{entity}} termina el {{value}} — si quieres, pasamos a repasarla y te dejamos cualquier detalle resuelto antes de que venza.' } },
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
      { key: 'numero',    type: 'text', label: 'Número', position: 2, is_identifier: true },
      { key: 'pais',      type: 'text', label: 'País (visados)', position: 3 },
      { key: 'caducidad', type: 'date', label: 'Fecha de caducidad', show_in_list: true, position: 4,
        reminder: { offset_days: -90, campaign_kind: 'caducidad', message_hint: 'Tu {{entity}} caduca el {{value}} — renuévalo con tiempo y cuéntanos tu próximo destino: te dejamos el viaje cuadrado sin sustos en el aeropuerto.' } },
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
        reminder: { offset_days: -14, campaign_kind: 'revision', message_hint: 'Toca revisar tu {{entity}} el {{value}} — pide cita y lo vemos en una visita corta, sin esperas.' } },
      { key: 'proxima_higiene',  type: 'date',   label: 'Próxima higiene / limpieza', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'higiene', message_hint: 'Tu limpieza dental toca el {{value}} — reserva tu hueco y sales con la boca como nueva.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // ── Catálogo COMPLETO (2026-07-08): un tipo de entidad por CADA sector ──────
  // Orden del Fundador: "la CRM tiene que ser ÚNICA para cada sector". La
  // persona sigue siendo contact; aquí vive la COSA que recurre (el bono,
  // la fórmula, el permiso, el expediente) con SU fecha de dinero.
  // Las keys son ÚNICAS a nivel global (no solo por sector): el upsert de
  // copy-on-create choca en (organization_id, key) y una org que cambia de
  // sector no debe heredar el tipo equivocado por colisión de nombre.

  // 🎨 Peluquería → Fichas técnicas (la fórmula del color: les cambia la vida)
  peluqueria: [{
    key: 'ficha_tecnica', label_singular: 'Ficha técnica', label_plural: 'Fichas técnicas',
    icon: '🎨', color: '#c4f546',
    label_template: '{{marca}} · {{formula}}',
    fields: [
      { key: 'formula',           type: 'text',   label: 'Fórmula del color (p. ej. 7.3 + 8.1 a partes iguales)', required: true, show_in_list: true, position: 1 },
      { key: 'marca',             type: 'text',   label: 'Marca del tinte', show_in_list: true, position: 2 },
      { key: 'oxidante',          type: 'select', label: 'Oxidante (volúmenes)', position: 3,
        options: [
          { value: '10vol', label: '10 vol.' }, { value: '20vol', label: '20 vol.' },
          { value: '30vol', label: '30 vol.' }, { value: '40vol', label: '40 vol.' },
        ] },
      { key: 'tiempo_exposicion', type: 'number', label: 'Tiempo de exposición (min)', position: 4 },
      { key: 'alergias',          type: 'text',   label: 'Alergias / prueba de mecha', position: 5 },
      { key: 'proximo_retoque',   type: 'date',   label: 'Próximo retoque de raíces', show_in_list: true, position: 6,
        reminder: { offset_days: -4, campaign_kind: 'retoque', message_hint: 'Tu retoque de raíces toca el {{value}} — tenemos tu fórmula guardada ({{entity}}), ¿te reservamos hueco?' } },
      { key: 'notas',             type: 'note',   label: 'Notas (mechas, matiz, resultado…)', position: 7 },
    ],
  }],

  // 💆 Estética avanzada → Bonos de sesiones ("Bono láser piernas · 3/8")
  estetica_avanzada: [{
    key: 'bono_sesiones', label_singular: 'Bono', label_plural: 'Bonos',
    icon: '💆', color: '#c4f546',
    label_template: 'Bono {{tratamiento}} · {{sesiones_restantes}}/{{sesiones_totales}}',
    fields: [
      { key: 'tratamiento',        type: 'text',   label: 'Tratamiento (facial, radiofrecuencia…)', required: true, show_in_list: true, position: 1 },
      { key: 'zona',               type: 'text',   label: 'Zona', position: 2 },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones del bono', position: 3 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 4 },
      { key: 'caducidad',          type: 'date',   label: 'Caducidad del bono', show_in_list: true, position: 5,
        reminder: { offset_days: -21, campaign_kind: 'caducidad_bono', message_hint: 'Tu {{entity}} caduca el {{value}} y aún te quedan sesiones — ¿reservamos la próxima?' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // ✨ Depilación láser → Bonos por zona (la sesión Y la caducidad avisan)
  laser: [{
    key: 'bono_laser', label_singular: 'Bono láser', label_plural: 'Bonos láser',
    icon: '✨', color: '#c4f546',
    label_template: 'Láser {{zona}} · {{sesiones_restantes}}/{{sesiones_totales}}',
    fields: [
      { key: 'zona',               type: 'select', label: 'Zona', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'piernas', label: 'Piernas' }, { value: 'axilas', label: 'Axilas' },
          { value: 'ingles', label: 'Ingles' }, { value: 'brazos', label: 'Brazos' },
          { value: 'facial', label: 'Facial' }, { value: 'espalda', label: 'Espalda' },
          { value: 'cuerpo_completo', label: 'Cuerpo completo' }, { value: 'otra', label: 'Otra' },
        ] },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones del bono', position: 2 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 3 },
      { key: 'proxima_sesion',     type: 'date',   label: 'Próxima sesión', show_in_list: true, position: 4,
        reminder: { offset_days: -3, campaign_kind: 'sesion', message_hint: 'Tu sesión de {{entity}} es el {{value}} — recuerda venir con la zona rasurada y sin cremas' } },
      { key: 'caducidad',          type: 'date',   label: 'Caducidad del bono', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'caducidad_bono', message_hint: 'Tu {{entity}} caduca el {{value}} — aprovecha las sesiones que te quedan' } },
      { key: 'notas',              type: 'note',   label: 'Notas (fototipo, potencia…)', position: 6 },
    ],
  }],

  // 🧖 Spa / balneario → Bonos y circuitos (que no caduquen sin usar)
  spa: [{
    key: 'bono_spa', label_singular: 'Bono', label_plural: 'Bonos y circuitos',
    icon: '🧖', color: '#c4f546',
    label_template: 'Bono {{nombre}} · {{sesiones_restantes}}/{{sesiones_totales}}',
    fields: [
      { key: 'nombre',             type: 'text',   label: 'Bono o circuito (circuito + masaje, ritual…)', required: true, show_in_list: true, position: 1 },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones del bono', position: 2 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 3 },
      { key: 'caducidad',          type: 'date',   label: 'Caducidad', show_in_list: true, position: 4,
        reminder: { offset_days: -21, campaign_kind: 'caducidad_bono', message_hint: 'Tu {{entity}} caduca el {{value}} — reserva tu momento de relax antes de que expire' } },
      { key: 'importe',            type: 'number', label: 'Importe (€)', position: 5 },
      { key: 'notas',              type: 'note',   label: 'Notas (regalo, para dos…)', position: 6 },
    ],
  }],

  // 🤲 Fisioterapia → Planes de tratamiento (sesiones restantes + revisión)
  fisioterapia: [{
    key: 'plan_tratamiento', label_singular: 'Plan de tratamiento', label_plural: 'Planes de tratamiento',
    icon: '🤲', color: '#c4f546',
    label_template: 'Plan {{motivo}} · {{sesiones_restantes}}/{{sesiones_totales}}',
    fields: [
      { key: 'motivo',             type: 'text',   label: 'Motivo / zona (lumbar, hombro…)', required: true, show_in_list: true, position: 1 },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones del bono', position: 2 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 3 },
      { key: 'proxima_revision',   type: 'date',   label: 'Próxima revisión', show_in_list: true, position: 4,
        reminder: { offset_days: -3, campaign_kind: 'revision', message_hint: 'Toca revisión de tu {{entity}} el {{value}} — así vemos cómo evoluciona' } },
      { key: 'caducidad_bono',     type: 'date',   label: 'Caducidad del bono', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'caducidad_bono', message_hint: 'Tu {{entity}} caduca el {{value}} y aún te quedan sesiones' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🎯 Coaching → Programas (la renovación es la venta)
  coaching: [{
    key: 'programa', label_singular: 'Programa', label_plural: 'Programas',
    icon: '🎯', color: '#c4f546',
    label_template: 'Programa {{nombre}}',
    fields: [
      { key: 'nombre',             type: 'text',   label: 'Nombre del programa', required: true, show_in_list: true, position: 1 },
      { key: 'objetivo',           type: 'text',   label: 'Objetivo', position: 2 },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones incluidas', position: 3 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 4 },
      { key: 'fecha_renovacion',   type: 'date',   label: 'Fecha de renovación', show_in_list: true, position: 5,
        reminder: { offset_days: -15, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} se renueva el {{value}} — buen momento para hablar de la siguiente etapa' } },
      { key: 'importe',            type: 'number', label: 'Importe (€)', position: 6 },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 7 },
    ],
  }],

  // 🐕 Guardería canina → Perros (vacunas al día = requisito para venir)
  guarderia_canina: [{
    key: 'perro', label_singular: 'Perro', label_plural: 'Perros',
    icon: '🐕', color: '#c4f546',
    label_template: '{{nombre}} ({{raza}})',
    fields: [
      { key: 'nombre',              type: 'text',   label: 'Nombre', required: true, show_in_list: true, position: 1 },
      { key: 'raza',                type: 'text',   label: 'Raza', show_in_list: true, position: 2 },
      { key: 'proxima_vacuna',      type: 'date',   label: 'Renovación de vacunas', show_in_list: true, position: 3,
        reminder: { offset_days: -14, campaign_kind: 'vacuna', message_hint: 'A {{entity}} le toca renovar las vacunas el {{value}} — las necesita al día para venir a la guarde' } },
      { key: 'dias_bono_restantes', type: 'number', label: 'Días de bono restantes', show_in_list: true, position: 4 },
      { key: 'alergias',            type: 'text',   label: 'Alergias / medicación', position: 5 },
      { key: 'sociable',            type: 'select', label: 'Con otros perros', position: 6,
        options: [
          { value: 'sociable', label: 'Sociable' }, { value: 'con_cuidado', label: 'Con cuidado' },
          { value: 'mejor_solo', label: 'Mejor solo' },
        ] },
      { key: 'notas',               type: 'note',   label: 'Notas (comida, manías…)', position: 7 },
    ],
  }],

  // 🏡 Residencia de mascotas → Estancias (entrada Y salida avisan solas)
  residencia_mascotas: [{
    key: 'estancia', label_singular: 'Estancia', label_plural: 'Estancias',
    icon: '🏡', color: '#c4f546',
    label_template: 'Estancia de {{mascota}}',
    fields: [
      { key: 'mascota',        type: 'text',    label: 'Nombre de la mascota', required: true, show_in_list: true, position: 1 },
      { key: 'fecha_entrada',  type: 'date',    label: 'Fecha de entrada', show_in_list: true, position: 2,
        reminder: { offset_days: -3, campaign_kind: 'entrada', message_hint: 'La {{entity}} empieza el {{value}} — recuerda traer la cartilla, su comida habitual y su manta' } },
      { key: 'fecha_salida',   type: 'date',    label: 'Fecha de recogida', show_in_list: true, position: 3,
        reminder: { offset_days: -1, campaign_kind: 'recogida', message_hint: 'Mañana {{value}} toca recoger — {{entity}} os espera con ganas' } },
      { key: 'vacunas_al_dia', type: 'boolean', label: 'Vacunas al día', position: 4 },
      { key: 'medicacion',     type: 'text',    label: 'Medicación / pauta', position: 5 },
      { key: 'notas',          type: 'note',    label: 'Notas (alimentación, carácter…)', position: 6 },
    ],
  }],

  // 🧳 Hotel → Grupos y eventos (lo que genuinamente recurre y hay que reconfirmar)
  hotel: [{
    key: 'grupo', label_singular: 'Grupo / evento', label_plural: 'Grupos y eventos',
    icon: '🧳', color: '#c4f546',
    label_template: 'Grupo {{nombre}}',
    fields: [
      { key: 'nombre',        type: 'text',   label: 'Nombre del grupo o evento', required: true, show_in_list: true, position: 1 },
      { key: 'fecha_llegada', type: 'date',   label: 'Fecha de llegada', show_in_list: true, position: 2,
        reminder: { offset_days: -7, campaign_kind: 'reconfirmacion', message_hint: 'El {{entity}} llega el {{value}} — reconfirmamos habitaciones, régimen y horas de entrada' } },
      { key: 'fecha_salida',  type: 'date',   label: 'Fecha de salida', position: 3 },
      { key: 'habitaciones',  type: 'number', label: 'Habitaciones', show_in_list: true, position: 4 },
      { key: 'regimen',       type: 'select', label: 'Régimen', position: 5,
        options: [
          { value: 'solo_alojamiento', label: 'Solo alojamiento' }, { value: 'desayuno', label: 'Alojamiento y desayuno' },
          { value: 'media_pension', label: 'Media pensión' }, { value: 'pension_completa', label: 'Pensión completa' },
        ] },
      { key: 'importe',       type: 'number', label: 'Importe estimado (€)', position: 6 },
      { key: 'notas',         type: 'note',   label: 'Notas (señal, peticiones…)', position: 7 },
    ],
  }],

  // 🩺 Clínica médica → Revisiones y analíticas (neutro: cero datos clínicos)
  clinica: [{
    key: 'revision_medica', label_singular: 'Revisión', label_plural: 'Revisiones',
    icon: '🩺', color: '#c4f546',
    label_template: '{{tipo}}',
    fields: [
      { key: 'tipo',          type: 'select', label: 'Tipo', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'revision_anual', label: 'Revisión anual' }, { value: 'analitica', label: 'Analítica' },
          { value: 'prueba', label: 'Prueba diagnóstica' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'proxima_fecha', type: 'date',   label: 'Próxima fecha', show_in_list: true, position: 2,
        reminder: { offset_days: -21, campaign_kind: 'revision', message_hint: 'Tu {{entity}} toca el {{value}} — llámanos y te damos cita sin esperas' } },
      { key: 'ultima_fecha',  type: 'date',   label: 'Última realizada', position: 3 },
      { key: 'periodicidad',  type: 'select', label: 'Periodicidad', position: 4,
        options: [
          { value: 'anual', label: 'Anual' }, { value: 'semestral', label: 'Semestral' },
          { value: 'trimestral', label: 'Trimestral' },
        ] },
      { key: 'notas',         type: 'note',   label: 'Notas administrativas', position: 5 },
    ],
  }],

  // 🥗 Nutrición → Planes nutricionales (la revisión mensual sostiene el plan)
  nutricion: [{
    key: 'plan_nutricional', label_singular: 'Plan nutricional', label_plural: 'Planes nutricionales',
    icon: '🥗', color: '#c4f546',
    label_template: 'Plan {{objetivo}}',
    fields: [
      { key: 'objetivo',         type: 'text',   label: 'Objetivo del plan (deportivo, hábitos…)', required: true, show_in_list: true, position: 1 },
      { key: 'fecha_inicio',     type: 'date',   label: 'Fecha de inicio', position: 2 },
      { key: 'proxima_revision', type: 'date',   label: 'Próxima revisión', show_in_list: true, position: 3,
        reminder: { offset_days: -3, campaign_kind: 'revision', message_hint: 'Tu revisión del {{entity}} toca el {{value}} — seguimos afinando, ¿te va bien la hora de siempre?' } },
      { key: 'duracion_semanas', type: 'number', label: 'Duración (semanas)', position: 4 },
      { key: 'estado',           type: 'select', label: 'Estado', show_in_list: true, position: 5,
        options: [
          { value: 'activo', label: 'Activo' }, { value: 'pausado', label: 'Pausado' },
          { value: 'finalizado', label: 'Finalizado' },
        ] },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🤸 Pilates → Bonos de clases (renovar antes de perder la plaza)
  pilates: [{
    key: 'bono_clases', label_singular: 'Bono de clases', label_plural: 'Bonos de clases',
    icon: '🤸', color: '#c4f546',
    label_template: 'Bono {{tipo}} · {{clases_restantes}}/{{clases_totales}}',
    fields: [
      { key: 'tipo',             type: 'select', label: 'Tipo de clase', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'suelo', label: 'Suelo' }, { value: 'maquina', label: 'Máquina (reformer)' },
          { value: 'duo', label: 'Dúo' }, { value: 'privada', label: 'Privada' },
        ] },
      { key: 'clases_totales',   type: 'number', label: 'Clases del bono', position: 2 },
      { key: 'clases_restantes', type: 'number', label: 'Clases restantes', show_in_list: true, position: 3 },
      { key: 'caducidad',        type: 'date',   label: 'Caducidad del bono', show_in_list: true, position: 4,
        reminder: { offset_days: -5, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} caduca el {{value}} — renuévalo y no pierdas tu plaza en clase' } },
      { key: 'notas',            type: 'note',   label: 'Notas (lesiones, horario preferido…)', position: 5 },
    ],
  }],

  // 🧘 Yoga → Bonos de clases
  yoga: [{
    key: 'bono_yoga', label_singular: 'Bono de clases', label_plural: 'Bonos de clases',
    icon: '🧘', color: '#c4f546',
    label_template: 'Bono {{tipo}} · {{clases_restantes}}/{{clases_totales}}',
    fields: [
      { key: 'tipo',             type: 'select', label: 'Tipo de clase', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'hatha', label: 'Hatha' }, { value: 'vinyasa', label: 'Vinyasa' },
          { value: 'yin', label: 'Yin' }, { value: 'embarazo', label: 'Embarazo' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'clases_totales',   type: 'number', label: 'Clases del bono', position: 2 },
      { key: 'clases_restantes', type: 'number', label: 'Clases restantes', show_in_list: true, position: 3 },
      { key: 'caducidad',        type: 'date',   label: 'Caducidad del bono', show_in_list: true, position: 4,
        reminder: { offset_days: -5, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} caduca el {{value}} — renuévalo y sigue con tu práctica sin cortes' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 5 },
    ],
  }],

  // 🦶 Podología → Tratamientos periódicos (la quiropodia vuelve cada 6 semanas)
  podologia: [{
    key: 'tratamiento_podal', label_singular: 'Tratamiento', label_plural: 'Tratamientos',
    icon: '🦶', color: '#c4f546',
    label_template: '{{tipo}}',
    fields: [
      { key: 'tipo',                 type: 'select', label: 'Tratamiento', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'quiropodia', label: 'Quiropodia' }, { value: 'plantillas', label: 'Plantillas' },
          { value: 'estudio_pisada', label: 'Estudio de la pisada' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'proxima_revision',     type: 'date',   label: 'Próxima revisión', show_in_list: true, position: 2,
        reminder: { offset_days: -7, campaign_kind: 'revision', message_hint: 'Tu {{entity}} toca revisión el {{value}} — tus pies te lo agradecerán' } },
      { key: 'ultima_visita',        type: 'date',   label: 'Última visita', position: 3 },
      { key: 'periodicidad_semanas', type: 'number', label: 'Cada cuántas semanas', position: 4 },
      { key: 'notas',                type: 'note',   label: 'Notas', position: 5 },
    ],
  }],

  // 📅 Psicología → Planes de sesiones — campos NEUTROS a propósito: cero
  // datos clínicos (RGPD art. 9, categoría especial). Solo administración.
  psicologia: [{
    key: 'plan_sesiones', label_singular: 'Plan de sesiones', label_plural: 'Planes de sesiones',
    icon: '📅', color: '#c4f546',
    label_template: '{{nombre}} · {{sesiones_restantes}}/{{sesiones_totales}}',
    fields: [
      { key: 'nombre',             type: 'text',   label: 'Nombre del plan (p. ej. Bono 5 sesiones)', required: true, show_in_list: true, position: 1 },
      { key: 'sesiones_totales',   type: 'number', label: 'Sesiones incluidas', position: 2 },
      { key: 'sesiones_restantes', type: 'number', label: 'Sesiones restantes', show_in_list: true, position: 3 },
      { key: 'proxima_renovacion', type: 'date',   label: 'Próxima renovación', show_in_list: true, position: 4,
        reminder: { offset_days: -7, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} se renueva el {{value}} — si quieres seguir, te reservamos tu hueco de siempre' } },
      { key: 'modalidad',          type: 'select', label: 'Modalidad', position: 5,
        options: [
          { value: 'presencial', label: 'Presencial' }, { value: 'online', label: 'Online' },
          { value: 'mixta', label: 'Mixta' },
        ] },
      { key: 'notas',              type: 'note',   label: 'Notas administrativas (nunca datos clínicos)', position: 6 },
    ],
  }],

  // 🎉 Restaurante → Eventos y grupos (reconfirmar comensales y señal)
  restaurante: [{
    key: 'evento', label_singular: 'Evento / grupo', label_plural: 'Eventos y grupos',
    icon: '🎉', color: '#c4f546',
    label_template: '{{nombre}}',
    fields: [
      { key: 'nombre',       type: 'text',    label: 'Evento (comida de empresa, comunión…)', required: true, show_in_list: true, position: 1 },
      { key: 'fecha_evento', type: 'date',    label: 'Fecha del evento', show_in_list: true, position: 2,
        reminder: { offset_days: -5, campaign_kind: 'reconfirmacion', message_hint: 'El {{entity}} es el {{value}} — reconfirmamos comensales, menú y señal para tenerlo todo listo' } },
      { key: 'comensales',   type: 'number',  label: 'Comensales', show_in_list: true, position: 3 },
      { key: 'menu',         type: 'text',    label: 'Menú elegido', position: 4 },
      { key: 'senal_pagada', type: 'boolean', label: 'Señal pagada', show_in_list: true, position: 5 },
      { key: 'alergias',     type: 'text',    label: 'Alergias / intolerancias del grupo', position: 6 },
      { key: 'notas',        type: 'note',    label: 'Notas (tarta, decoración…)', position: 7 },
    ],
  }],

  // 📜 Notaría → Expedientes (la firma prevista y los papeles que faltan)
  notaria: [{
    key: 'expediente_notarial', label_singular: 'Expediente', label_plural: 'Expedientes',
    icon: '📜', color: '#c4f546',
    label_template: '{{tipo}} · {{referencia}}',
    fields: [
      { key: 'referencia',              type: 'text',   label: 'Referencia', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'tipo',                    type: 'select', label: 'Tipo', show_in_list: true, position: 2,
        options: [
          { value: 'compraventa', label: 'Compraventa' }, { value: 'herencia', label: 'Herencia' },
          { value: 'poder', label: 'Poder' }, { value: 'testamento', label: 'Testamento' },
          { value: 'constitucion_sociedad', label: 'Constitución de sociedad' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'fecha_firma',             type: 'date',   label: 'Firma prevista', show_in_list: true, position: 3,
        reminder: { offset_days: -3, campaign_kind: 'firma', message_hint: 'La firma de {{entity}} es el {{value}} — recuerda traer el DNI y la documentación pendiente' } },
      { key: 'documentacion_pendiente', type: 'text',   label: 'Documentación pendiente', position: 4 },
      { key: 'estado',                  type: 'select', label: 'Estado', position: 5,
        options: [
          { value: 'en_preparacion', label: 'En preparación' }, { value: 'pendiente_firma', label: 'Pendiente de firma' },
          { value: 'firmado', label: 'Firmado' },
        ] },
      { key: 'notas',                   type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 📐 Arquitectura → Proyectos (la licencia de obra CADUCA — pedir prórroga a tiempo)
  arquitectura: [{
    key: 'proyecto', label_singular: 'Proyecto', label_plural: 'Proyectos',
    icon: '📐', color: '#c4f546',
    label_template: 'Proyecto {{nombre}}',
    fields: [
      { key: 'nombre',             type: 'text',   label: 'Nombre / dirección del proyecto', required: true, show_in_list: true, position: 1, is_identifier: true },
      { key: 'fase',               type: 'select', label: 'Fase', show_in_list: true, position: 2,
        options: [
          { value: 'anteproyecto', label: 'Anteproyecto' }, { value: 'proyecto_basico', label: 'Proyecto básico' },
          { value: 'proyecto_ejecucion', label: 'Proyecto de ejecución' }, { value: 'direccion_obra', label: 'Dirección de obra' },
          { value: 'finalizado', label: 'Finalizado' },
        ] },
      { key: 'caducidad_licencia', type: 'date',   label: 'Caducidad de la licencia de obra', show_in_list: true, position: 3,
        reminder: { offset_days: -60, campaign_kind: 'licencia', message_hint: 'La licencia de obra de {{entity}} caduca el {{value}} — conviene pedir la prórroga con margen' } },
      { key: 'proximo_hito',       type: 'date',   label: 'Próximo hito (visado, visita de obra…)', position: 4,
        reminder: { offset_days: -7, campaign_kind: 'hito', message_hint: 'El {{entity}} tiene un hito el {{value}} — te llamamos estos días para coordinarlo y que no se pare nada.' } },
      { key: 'honorarios',         type: 'number', label: 'Honorarios (€)', position: 5 },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 🚦 Autoescuela → Permisos en curso (el teórico aprobado CADUCA a los 2 años)
  autoescuela: [{
    key: 'permiso', label_singular: 'Permiso en curso', label_plural: 'Permisos en curso',
    icon: '🚦', color: '#c4f546',
    label_template: 'Permiso {{tipo}}',
    fields: [
      { key: 'tipo',              type: 'select', label: 'Permiso', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'b', label: 'B (coche)' }, { value: 'a2', label: 'A2 (moto)' },
          { value: 'a', label: 'A (moto)' }, { value: 'c', label: 'C (camión)' },
          { value: 'd', label: 'D (autobús)' }, { value: 'otro', label: 'Otro' },
        ] },
      { key: 'estado',            type: 'select', label: 'Fase', show_in_list: true, position: 2,
        options: [
          { value: 'teorico', label: 'Preparando teórico' }, { value: 'practicas', label: 'En prácticas' },
          { value: 'examen', label: 'Pendiente de examen' }, { value: 'aprobado', label: 'Aprobado' },
        ] },
      { key: 'caducidad_teorico', type: 'date',   label: 'Caducidad del teórico aprobado', show_in_list: true, position: 3,
        reminder: { offset_days: -60, campaign_kind: 'caducidad_teorico', message_hint: 'Tu teórico aprobado caduca el {{value}} — quedan pocas semanas para sacarte el práctico sin repetir examen' } },
      { key: 'examen_practico',   type: 'date',   label: 'Fecha de examen práctico', position: 4,
        reminder: { offset_days: -3, campaign_kind: 'examen', message_hint: 'Tu examen práctico del {{entity}} es el {{value}} — ¿repasamos con una clase extra?' } },
      { key: 'clases_restantes',  type: 'number', label: 'Clases de bono restantes', position: 5 },
      { key: 'notas',             type: 'note',   label: 'Notas', position: 6 },
    ],
  }],

  // 💊 Farmacia → Tratamientos crónicos / SPD (la dispensación que recurre)
  farmacia: [{
    key: 'tratamiento_cronico', label_singular: 'Tratamiento', label_plural: 'Tratamientos',
    icon: '💊', color: '#c4f546',
    label_template: '{{nombre}}',
    fields: [
      { key: 'nombre',               type: 'text',    label: 'Tratamiento / SPD (p. ej. SPD semanal)', required: true, show_in_list: true, position: 1 },
      { key: 'proxima_dispensacion', type: 'date',    label: 'Próxima dispensación', show_in_list: true, position: 2,
        reminder: { offset_days: -3, campaign_kind: 'dispensacion', message_hint: 'Tu {{entity}} estará listo para recoger el {{value}} — te lo dejamos preparado' } },
      { key: 'periodicidad',         type: 'select',  label: 'Periodicidad', show_in_list: true, position: 3,
        options: [
          { value: 'semanal', label: 'Semanal' }, { value: 'quincenal', label: 'Quincenal' },
          { value: 'mensual', label: 'Mensual' }, { value: 'trimestral', label: 'Trimestral' },
        ] },
      { key: 'receta_electronica',   type: 'boolean', label: 'Receta electrónica', position: 4 },
      { key: 'notas',                type: 'note',    label: 'Notas (sin datos de salud sensibles)', position: 5 },
    ],
  }],

  // 🪪 Reconocimientos médicos → Certificados (la caducidad ES el negocio)
  reconocimientos: [{
    key: 'certificado', label_singular: 'Certificado', label_plural: 'Certificados',
    icon: '🪪', color: '#c4f546',
    label_template: 'Certificado {{tipo}}',
    fields: [
      { key: 'tipo',            type: 'select', label: 'Tipo de certificado', required: true, show_in_list: true, position: 1,
        options: [
          { value: 'carnet_conducir', label: 'Carnet de conducir' }, { value: 'armas', label: 'Licencia de armas' },
          { value: 'seguridad_privada', label: 'Seguridad privada' }, { value: 'embarcaciones', label: 'Embarcaciones' },
          { value: 'otro', label: 'Otro' },
        ] },
      { key: 'clase_permiso',   type: 'text',   label: 'Clase de permiso (B, C+E…)', position: 2 },
      { key: 'fecha_caducidad', type: 'date',   label: 'Fecha de caducidad', show_in_list: true, position: 3,
        reminder: { offset_days: -30, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} caduca el {{value}} — renueva el psicotécnico con nosotros, sin colas y en 20 minutos' } },
      { key: 'fecha_emision',   type: 'date',   label: 'Fecha de emisión', position: 4 },
      { key: 'notas',           type: 'note',   label: 'Notas', position: 5 },
    ],
  }],

  // 🔔 Genérico / Otro → Renovaciones y vencimientos (catch-all útil, no excluido)
  generico: [{
    key: 'renovacion', label_singular: 'Renovación', label_plural: 'Renovaciones y vencimientos',
    icon: '🔔', color: '#c4f546',
    label_template: '{{nombre}}',
    fields: [
      { key: 'nombre',       type: 'text',   label: 'Qué es (cuota, contrato, garantía…)', required: true, show_in_list: true, position: 1 },
      { key: 'descripcion',  type: 'text',   label: 'Descripción', position: 2 },
      { key: 'importe',      type: 'number', label: 'Importe (€)', show_in_list: true, position: 3 },
      { key: 'vencimiento',  type: 'date',   label: 'Fecha de vencimiento', show_in_list: true, position: 4,
        reminder: { offset_days: -15, campaign_kind: 'vencimiento', message_hint: 'Tu {{entity}} vence el {{value}} — ¿lo renovamos?' } },
      { key: 'periodicidad', type: 'select', label: 'Periodicidad', position: 5,
        options: [
          { value: 'mensual', label: 'Mensual' }, { value: 'trimestral', label: 'Trimestral' },
          { value: 'anual', label: 'Anual' }, { value: 'unico', label: 'Único' },
        ] },
      { key: 'notas',        type: 'note',   label: 'Notas', position: 6 },
    ],
  }],
};

// ─── Kill-switch ─────────────────────────────────────────────────────────────
function entitiesFeatureEnabled() {
  return process.env.ENTITIES_DISABLED !== '1';
}

// ─── Vista agrupada por estado (v1) ──────────────────────────────────────────
/**
 * PURA — ¿por qué campo se puede agrupar la lista? El PRIMER select con
 * 2..6 opciones (estado del expediente, fase de la obra, especie de la
 * mascota…). Genérico para las 36 plantillas: sin campo así → null y la
 * lista sigue plana. Con más de 6 opciones las secciones dejan de caber
 * en un móvil (regla touch-first).
 * El cliente (portal.js) replica esta lógica en ES5 — si cambia aquí,
 * cambia allí (entGroupField).
 */
function groupableField(fields) {
  for (const f of (fields || [])) {
    if (f.type === 'select' && Array.isArray(f.options) &&
        f.options.length >= 2 && f.options.length <= 6) return f;
  }
  return null;
}

// ─── Identificador natural (upsert de importación / anti-duplicados) ────────
/** Plantilla del catálogo por key de tipo (las keys son ÚNICAS a nivel global). */
function catalogTemplateByKey(typeKey) {
  for (const arr of Object.values(ENTITY_TEMPLATES)) {
    for (const t of arr) { if (t.key === typeKey) return t; }
  }
  return null;
}

/**
 * PURA — el campo identificador natural del tipo (matrícula, nº de póliza…)
 * o null si el sector no tiene ninguno (bonos, planes, eventos — honesto).
 * Acepta tanto una plantilla del catálogo como una fila de nf_entity_types:
 * las filas sembradas ANTES de esta feature guardan fields sin is_identifier,
 * así que cae al catálogo por key (keys globalmente únicas).
 */
function identifierField(templateOrType) {
  if (!templateOrType) return null;
  for (const f of (templateOrType.fields || [])) {
    if (f.is_identifier) return f;
  }
  const cat = catalogTemplateByKey(templateOrType.key);
  if (cat && cat !== templateOrType) {
    for (const f of (cat.fields || [])) { if (f.is_identifier) return f; }
  }
  return null;
}

// ─── Resolución de plantillas por sector ─────────────────────────────────────
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Plantillas de entidad para un sector (o alias). Primero por clave directa
 * del catálogo de plantillas; si no, por el slug canónico del registro de
 * sectores (así 'veterinario' o 'talleres' también resuelven). Desde
 * 2026-07-08 TODOS los sectores del registro (y 'generico') tienen plantilla:
 * la persona sigue en contacts; aquí vive su bono, su fórmula, su permiso.
 * [] solo para entradas vacías o sectores custom sin equivalente.
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
  groupableField,
  identifierField,
  templatesForSector,
  sectorHasEntityTemplates,
  instantiateTemplate,
  entityTablesExist,
  getOrgEntityTypes,
  ensureOrgEntityTypes,
  invalidateOrgEntityTypes,
};
