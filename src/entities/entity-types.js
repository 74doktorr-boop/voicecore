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
// Cap duro. v0 fue 8 (ficha mínima). v1: 16 — Unai pidió fichas MUCHO más ricas
// por sector (taller: ruedas invierno/verano, A/C, distribución…); cada campo-
// fecha extra es un aviso recurrente que factura. Los campos son OPCIONALES: el
// dueño rellena los que apliquen a cada ficha; los vacíos no generan nada.
const MAX_FIELDS       = 16;
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
      { key: 'cambio_ruedas_invierno', type: 'date', label: 'Cambio a ruedas de invierno', position: 8,
        reminder: { offset_days: -14, campaign_kind: 'ruedas_invierno', message_hint: 'Se acerca el frío: ¿montamos las ruedas de invierno en {{entity}}? Más agarre y seguridad en mojado. Pide cita y te las cambiamos en un momento.' } },
      { key: 'cambio_ruedas_verano', type: 'date', label: 'Cambio a ruedas de verano', position: 9,
        reminder: { offset_days: -14, campaign_kind: 'ruedas_verano', message_hint: 'Llega el buen tiempo — toca devolver {{entity}} a ruedas de verano ({{value}}). Trae las tuyas y te las montamos y equilibramos.' } },
      { key: 'revision_aire', type: 'date', label: 'Revisión aire acondicionado (A/C)', position: 10,
        reminder: { offset_days: -21, campaign_kind: 'aire_acondicionado', message_hint: 'Antes del calor revisamos el A/C de {{entity}} ({{value}}): carga de gas y filtro para que enfríe de verdad. Pide tu cita.' } },
      { key: 'cambio_distribucion', type: 'date', label: 'Cambio de distribución (correa)', position: 11,
        reminder: { offset_days: -30, campaign_kind: 'distribucion', message_hint: 'A {{entity}} le toca la correa de distribución ({{value}}) — es la avería más cara si se rompe. Te la cambiamos con garantía antes de que llegue.' } },
      { key: 'revision_frenos', type: 'date', label: 'Revisión de frenos', position: 12,
        reminder: { offset_days: -14, campaign_kind: 'frenos', message_hint: 'Toca revisar los frenos de {{entity}} ({{value}}) — pastillas y líquido. Pásate y los dejamos a punto para que frene seguro.' } },
      { key: 'cambio_bateria', type: 'date', label: 'Cambio de batería', position: 13,
        reminder: { offset_days: -14, campaign_kind: 'bateria', message_hint: 'La batería de {{entity}} va para {{value}} — antes de que te deje tirado con el frío, te la revisamos y cambiamos si hace falta.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 14 },
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
      { key: 'refuerzo_rabia',  type: 'date',   label: 'Refuerzo antirrábica', position: 8,
        reminder: { offset_days: -14, campaign_kind: 'rabia', message_hint: 'A {{entity}} le toca el refuerzo de la antirrábica el {{value}} — pide cita y lo dejamos con la cartilla y el pasaporte en regla.' } },
      { key: 'antiparasitario', type: 'date',   label: 'Antiparasitario externo (pipeta/collar)', position: 9,
        reminder: { offset_days: -5, campaign_kind: 'antiparasitario', message_hint: 'Toca renovar la protección antiparásitos de {{entity}} ({{value}}) — pásate y te la llevas puesta; así no le pillan pulgas ni garrapatas.' } },
      { key: 'limpieza_dental', type: 'date',   label: 'Limpieza dental', position: 10,
        reminder: { offset_days: -14, campaign_kind: 'limpieza_dental', message_hint: 'La boca de {{entity}} pide una limpieza ({{value}}) — quitamos el sarro antes de que dé problemas y de malos olores. ¿Reservamos?' } },
      { key: 'analitica_senior', type: 'date',  label: 'Analítica de control', position: 11,
        reminder: { offset_days: -14, campaign_kind: 'analitica', message_hint: 'A {{entity}} le toca su analítica de control el {{value}} — una revisión a tiempo detecta cualquier cosa pronto. Pide su cita.' } },
      { key: 'notas',           type: 'note',   label: 'Notas (alergias, historial…)', position: 12 },
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
      { key: 'fin_contrato_alquiler', type: 'date', label: 'Fin de contrato de alquiler', position: 7,
        reminder: { offset_days: -60, campaign_kind: 'alquiler', message_hint: 'El alquiler de {{entity}} termina el {{value}} — hablemos ahora de renovación o de buscar nuevo inquilino para que no quede ni un mes vacía.' } },
      { key: 'proxima_ite', type: 'date', label: 'Próxima ITE (inspección técnica)', position: 8,
        reminder: { offset_days: -60, campaign_kind: 'ite', message_hint: 'A {{entity}} le toca la ITE el {{value}} — te la gestionamos para tener el edificio en regla y la operación sin trabas.' } },
      { key: 'renovacion_seguro_hogar', type: 'date', label: 'Renovación seguro de hogar', position: 9,
        reminder: { offset_days: -30, campaign_kind: 'seguro_hogar', message_hint: 'El seguro de hogar de {{entity}} se renueva el {{value}} — lo revisamos y te buscamos mejor cobertura o precio antes de que se renueve solo.' } },
      { key: 'notas',     type: 'note',   label: 'Notas', position: 10 },
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
      { key: 'fecha_prescripcion', type: 'date', label: 'Fecha de prescripción', position: 7,
        reminder: { offset_days: -30, campaign_kind: 'prescripcion', message_hint: 'Ojo con {{entity}}: la acción prescribe el {{value}} — hay que actuar antes o se pierde el derecho. Te llamamos para no dejar pasar el plazo.' } },
      { key: 'revision_expediente', type: 'date', label: 'Próxima revisión del caso', position: 8,
        reminder: { offset_days: -7, campaign_kind: 'revision', message_hint: 'Toca ponernos al día con {{entity}} ({{value}}) — te llamamos para contarte cómo va y los siguientes pasos.' } },
      { key: 'notas',         type: 'note',   label: 'Notas', position: 9 },
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
      { key: 'caducidad_certificado_digital', type: 'date', label: 'Caducidad certificado digital', position: 6,
        reminder: { offset_days: -30, campaign_kind: 'certificado_digital', message_hint: 'Tu certificado digital caduca el {{value}} — sin él no se pueden presentar impuestos. Te lo renovamos con tiempo para que no te pille en un vencimiento.' } },
      { key: 'revision_cuota_autonomos', type: 'date', label: 'Revisión de cuota de autónomos', position: 7,
        reminder: { offset_days: -15, campaign_kind: 'cuota_autonomos', message_hint: 'Toca revisar tu cuota de autónomos ({{value}}) — miramos si te conviene ajustar la base y cuánto puedes ahorrar este año.' } },
      { key: 'notas',               type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'proximo_recibo',   type: 'date',   label: 'Próximo recibo', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'recibo', message_hint: 'El próximo recibo de {{entity}} se pasa el {{value}} — avísanos si quieres fraccionarlo o revisarlo antes de que te llegue.' } },
      { key: 'revision_coberturas', type: 'date', label: 'Revisión de coberturas', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'coberturas', message_hint: 'Buen momento para repasar las coberturas de {{entity}} ({{value}}) — nos aseguramos de que sigues bien cubierto y sin pagar de más.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'fin_bono',         type: 'date',   label: 'Fin del bono de sesiones', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'bono', message_hint: 'Se te acaba el bono el {{value}} — renuévalo ahora y no pierdes el ritmo (ni tu plaza en las clases).' } },
      { key: 'revision_fisica',  type: 'date',   label: 'Próxima valoración física', position: 7,
        reminder: { offset_days: -7, campaign_kind: 'valoracion', message_hint: 'Toca tu valoración física ({{value}}) — medimos progresos y ajustamos el plan para que sigas viendo resultados. Reserva con tu entrenador.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'proxima_mensualidad', type: 'date', label: 'Próxima mensualidad', position: 5,
        reminder: { offset_days: -5, campaign_kind: 'mensualidad', message_hint: 'La mensualidad de {{entity}} toca el {{value}} — te lo recordamos para que no se corte la matrícula. ¿Todo bien con el pago?' } },
      { key: 'inicio_curso', type: 'date', label: 'Inicio del próximo curso/trimestre', position: 6,
        reminder: { offset_days: -14, campaign_kind: 'inicio_curso', message_hint: 'El próximo curso de {{entity}} empieza el {{value}} — resérvale plaza ya, los grupos buenos se llenan rápido.' } },
      { key: 'notas',         type: 'note', label: 'Notas', position: 7 },
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
      { key: 'reposicion_lentillas', type: 'date', label: 'Reposición de lentillas', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'lentillas', message_hint: 'Se te acaban las lentillas hacia el {{value}} — pásate o te las dejamos preparadas para que no te quedes sin ellas.' } },
      { key: 'renovacion_gafas', type: 'date', label: 'Renovación de gafas', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'gafas', message_hint: 'Tus gafas ya tienen su tiempo ({{value}}) — ven a probar montura nueva; con tu graduación al día se ve mucho mejor.' } },
      { key: 'notas',            type: 'note', label: 'Notas', position: 8 },
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
      { key: 'limpieza_filtros',    type: 'date', label: 'Limpieza de filtros', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'filtros', message_hint: 'Toca limpiar los filtros de {{entity}} ({{value}}) — enfría/calienta mejor, gasta menos luz y evita averías. Pásate y te lo dejamos a punto.' } },
      { key: 'recarga_gas',         type: 'date', label: 'Recarga de gas', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'gas', message_hint: 'A {{entity}} le toca revisar la carga de gas ({{value}}) — si no enfría como antes, suele ser esto. Pide cita antes del calor.' } },
      { key: 'notas',               type: 'note', label: 'Notas', position: 8 },
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
      { key: 'renovacion_licencia', type: 'date', label: 'Renovación de licencia', position: 5,
        reminder: { offset_days: -21, campaign_kind: 'licencia', message_hint: 'La licencia de {{entity}} caduca el {{value}} — la renovamos antes para que no se pare ningún equipo ni te quedes sin soporte.' } },
      { key: 'revision_backup',  type: 'date',   label: 'Revisión de copias de seguridad', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'backup', message_hint: 'Toca comprobar las copias de seguridad de {{entity}} ({{value}}) — nos aseguramos de que si algo falla no pierdes nada. Un backup que no se prueba, no existe.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 7 },
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
      { key: 'revision_post_obra', type: 'date', label: 'Revisión post-obra', position: 6,
        reminder: { offset_days: -7, campaign_kind: 'post_obra', message_hint: 'Han pasado unos meses desde {{entity}} — pasamos a revisar que todo siga perfecto ({{value}}) y ajustamos cualquier detalle de asentamiento, sin coste.' } },
      { key: 'mantenimiento_anual', type: 'date', label: 'Mantenimiento anual', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'mantenimiento', message_hint: 'Toca el repaso anual de {{entity}} ({{value}}) — sellados, juntas y pequeños arreglos para que la reforma dure como el primer día.' } },
      { key: 'notas',        type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'proximo_viaje', type: 'date', label: 'Fecha del próximo viaje', position: 5,
        reminder: { offset_days: -30, campaign_kind: 'viaje', message_hint: 'Se acerca tu viaje ({{value}}) — repasamos que lleves todo (documentación, seguro, traslados) para que solo tengas que disfrutar.' } },
      { key: 'renovacion_seguro_viaje', type: 'date', label: 'Renovación seguro de viaje anual', position: 6,
        reminder: { offset_days: -21, campaign_kind: 'seguro_viaje', message_hint: 'Tu seguro de viaje anual caduca el {{value}} — te lo renovamos para que el próximo vuelo te pille cubierto desde el minuto uno.' } },
      { key: 'notas',     type: 'note', label: 'Notas', position: 7 },
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
      { key: 'revision_ortodoncia', type: 'date', label: 'Revisión de ortodoncia', position: 6,
        reminder: { offset_days: -5, campaign_kind: 'ortodoncia', message_hint: 'Toca tu ajuste de ortodoncia el {{value}} — no lo dejes pasar para que el tratamiento siga a tiempo. Reserva tu hueco.' } },
      { key: 'control_implante', type: 'date', label: 'Control de implante', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'implante', message_hint: 'Toca el control de tu implante ({{value}}) — una revisión rápida y nos aseguramos de que todo está perfecto y te dura años.' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'proximo_alisado',   type: 'date',   label: 'Renovación de alisado/keratina', position: 7,
        reminder: { offset_days: -10, campaign_kind: 'alisado', message_hint: 'Tu alisado va perdiendo efecto ({{value}}) — un retoque a tiempo y sigues con el pelo perfecto. ¿Te reservamos?' } },
      { key: 'proxima_hidratacion', type: 'date', label: 'Próximo tratamiento de hidratación', position: 8,
        reminder: { offset_days: -7, campaign_kind: 'hidratacion', message_hint: 'Toca mimar tu pelo ({{value}}) — un tratamiento de hidratación y lo dejamos suave y con brillo. Pide tu hueco.' } },
      { key: 'notas',             type: 'note',   label: 'Notas (mechas, matiz, resultado…)', position: 9 },
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
      { key: 'proxima_sesion',     type: 'date',   label: 'Próxima sesión', position: 6,
        reminder: { offset_days: -3, campaign_kind: 'sesion', message_hint: 'Tu próxima sesión de {{entity}} es el {{value}} — para ver resultados conviene no espaciarlas. ¿Te confirmo el hueco?' } },
      { key: 'mantenimiento',      type: 'date',   label: 'Sesión de mantenimiento', position: 7,
        reminder: { offset_days: -14, campaign_kind: 'mantenimiento', message_hint: 'Toca tu sesión de mantenimiento de {{entity}} ({{value}}) — así conservas los resultados que tanto te costaron. Reserva ya.' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'sesion_mantenimiento', type: 'date', label: 'Sesión de mantenimiento anual', position: 6,
        reminder: { offset_days: -14, campaign_kind: 'mantenimiento', message_hint: 'Toca tu sesión de mantenimiento de {{entity}} ({{value}}) — una al año y el resultado se mantiene impecable. Pide tu hueco.' } },
      { key: 'revision_resultados', type: 'date', label: 'Revisión de resultados', position: 7,
        reminder: { offset_days: -7, campaign_kind: 'revision', message_hint: 'Buen momento para revisar cómo va {{entity}} ({{value}}) — valoramos resultados y ajustamos las siguientes sesiones, sin coste.' } },
      { key: 'notas',              type: 'note',   label: 'Notas (fototipo, potencia…)', position: 8 },
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
      { key: 'proxima_reserva',    type: 'date',   label: 'Próxima reserva sugerida', position: 6,
        reminder: { offset_days: -5, campaign_kind: 'reserva', message_hint: 'Te mereces un respiro — ¿reservamos tu próximo momento de relax en {{entity}} para el {{value}}? Aún te quedan sesiones.' } },
      { key: 'notas',              type: 'note',   label: 'Notas (regalo, para dos…)', position: 7 },
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
      { key: 'proxima_sesion',     type: 'date',   label: 'Próxima sesión', position: 6,
        reminder: { offset_days: -2, campaign_kind: 'sesion', message_hint: 'Tu próxima sesión de {{entity}} es el {{value}} — la constancia es la que cura. Te espero, ¿confirmas?' } },
      { key: 'revision_alta',      type: 'date',   label: 'Revisión tras el alta', position: 7,
        reminder: { offset_days: -5, campaign_kind: 'seguimiento', message_hint: 'Ya pasó un tiempo desde tu alta de {{entity}} ({{value}}) — pásate para una revisión y nos aseguramos de que la mejora se mantiene.' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'proxima_sesion',     type: 'date',   label: 'Próxima sesión', position: 7,
        reminder: { offset_days: -2, campaign_kind: 'sesion', message_hint: 'Tu próxima sesión de {{entity}} es el {{value}} — trae los avances y seguimos empujando hacia tu objetivo.' } },
      { key: 'revision_objetivos', type: 'date',   label: 'Revisión de objetivos', position: 8,
        reminder: { offset_days: -5, campaign_kind: 'revision', message_hint: 'Toca revisar los objetivos de {{entity}} ({{value}}) — medimos el progreso y decidimos juntos el siguiente paso.' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 9 },
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
      { key: 'fin_bono_dias',       type: 'date',   label: 'Renovación del bono de días', position: 7,
        reminder: { offset_days: -3, campaign_kind: 'bono', message_hint: 'A {{entity}} se le acaban los días de bono ({{value}}) — renuévalo y que no se quede sin su sitio en la guarde.' } },
      { key: 'notas',               type: 'note',   label: 'Notas (comida, manías…)', position: 8 },
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
      { key: 'proxima_estancia', type: 'date',  label: 'Próxima estancia prevista', position: 6,
        reminder: { offset_days: -21, campaign_kind: 'reserva', message_hint: '¿Vacaciones a la vista? Reserva ya la plaza de {{entity}} para el {{value}} — en temporada volamos y no querrás quedarte sin sitio.' } },
      { key: 'notas',          type: 'note',    label: 'Notas (alimentación, carácter…)', position: 7 },
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
      { key: 'fecha_limite_senal', type: 'date', label: 'Fecha límite de señal', position: 7,
        reminder: { offset_days: -3, campaign_kind: 'senal', message_hint: 'Para confirmar {{entity}} necesitamos la señal antes del {{value}} — así te guardamos las habitaciones. ¿Lo dejamos cerrado?' } },
      { key: 'notas',         type: 'note',   label: 'Notas (señal, peticiones…)', position: 8 },
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
      { key: 'proxima_analitica', type: 'date', label: 'Próxima analítica de control', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'analitica', message_hint: 'Toca tu analítica de control ({{value}}) — llámanos y te damos cita en ayunas a primera hora, sin esperas.' } },
      { key: 'chequeo_anual', type: 'date', label: 'Chequeo anual', position: 6,
        reminder: { offset_days: -21, campaign_kind: 'chequeo', message_hint: 'Toca tu chequeo anual ({{value}}) — una revisión completa a tiempo es la mejor inversión en tu salud. ¿Te damos cita?' } },
      { key: 'notas',         type: 'note',   label: 'Notas administrativas', position: 7 },
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
      { key: 'proximo_control',  type: 'date',   label: 'Próximo control de peso', position: 6,
        reminder: { offset_days: -2, campaign_kind: 'control', message_hint: 'Toca tu control de {{entity}} ({{value}}) — vemos cómo vas y ajustamos lo que haga falta. La constancia es el 80%. ¿Confirmas?' } },
      { key: 'fin_plan',         type: 'date',   label: 'Fin del plan', position: 7,
        reminder: { offset_days: -7, campaign_kind: 'renovacion', message_hint: 'Tu {{entity}} termina el {{value}} — hablemos de la siguiente fase para no perder lo conseguido. ¿Seguimos?' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 8 },
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
      { key: 'revision_postural', type: 'date',  label: 'Revisión postural', position: 5,
        reminder: { offset_days: -7, campaign_kind: 'valoracion', message_hint: 'Toca tu revisión postural ({{value}}) — medimos avances y adaptamos los ejercicios para que sigas mejorando. Reserva con tu instructor.' } },
      { key: 'notas',            type: 'note',   label: 'Notas (lesiones, horario preferido…)', position: 6 },
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
      { key: 'proximo_taller',   type: 'date',   label: 'Próximo taller / retiro', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'taller', message_hint: 'Se acerca nuestro taller/retiro ({{value}}) — las plazas vuelan. ¿Te guardamos la tuya para desconectar de verdad?' } },
      { key: 'notas',            type: 'note',   label: 'Notas', position: 6 },
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
      { key: 'renovacion_plantillas', type: 'date', label: 'Renovación de plantillas', position: 5,
        reminder: { offset_days: -14, campaign_kind: 'plantillas', message_hint: 'Tus plantillas ya tienen su uso ({{value}}) — conviene renovarlas para que sigan cuidando tu pisada. Pide cita y te tomamos medidas.' } },
      { key: 'notas',                type: 'note',   label: 'Notas', position: 6 },
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
      { key: 'proxima_sesion',     type: 'date',   label: 'Próxima sesión', position: 6,
        reminder: { offset_days: -1, campaign_kind: 'sesion', message_hint: 'Recordatorio de tu sesión de {{entity}} el {{value}} — aquí te esperamos. Si necesitas cambiarla, avísanos con tiempo.' } },
      { key: 'notas',              type: 'note',   label: 'Notas administrativas (nunca datos clínicos)', position: 7 },
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
      { key: 'fecha_limite_comensales', type: 'date', label: 'Fecha límite de confirmar comensales', position: 7,
        reminder: { offset_days: -2, campaign_kind: 'confirmacion', message_hint: 'Para {{entity}} necesitamos el número final de comensales antes del {{value}} — así lo preparamos todo al detalle. ¿Cuántos seréis?' } },
      { key: 'notas',        type: 'note',    label: 'Notas (tarta, decoración…)', position: 8 },
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
      { key: 'plazo_impuestos',         type: 'date',   label: 'Plazo de liquidación de impuestos', position: 6,
        reminder: { offset_days: -10, campaign_kind: 'impuestos', message_hint: 'Tras {{entity}} hay plazo para liquidar impuestos hasta el {{value}} — te lo recordamos para evitar recargos. ¿Lo gestionamos contigo?' } },
      { key: 'notas',                   type: 'note',   label: 'Notas', position: 7 },
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
      { key: 'proxima_visita_obra', type: 'date',  label: 'Próxima visita de obra', position: 6,
        reminder: { offset_days: -3, campaign_kind: 'visita_obra', message_hint: 'Toca visita de obra de {{entity}} ({{value}}) — coordinamos con la constructora para revisar avances y que todo vaya según proyecto.' } },
      { key: 'notas',              type: 'note',   label: 'Notas', position: 7 },
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
      { key: 'fin_matricula_autoescuela', type: 'date', label: 'Fin de la matrícula', position: 6,
        reminder: { offset_days: -15, campaign_kind: 'matricula', message_hint: 'Tu matrícula para el {{entity}} termina el {{value}} — renuévala y sigue con tus clases sin perder el ritmo (ni la tasa).' } },
      { key: 'notas',             type: 'note',   label: 'Notas', position: 7 },
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
      { key: 'caducidad_receta',     type: 'date',    label: 'Caducidad de la receta', position: 5,
        reminder: { offset_days: -7, campaign_kind: 'receta', message_hint: 'Tu receta de {{entity}} caduca el {{value}} — pide la renovación a tu médico con tiempo y te lo tenemos listo sin cortes.' } },
      { key: 'notas',                type: 'note',    label: 'Notas (sin datos de salud sensibles)', position: 6 },
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
      { key: 'proxima_renovacion_cert', type: 'date', label: 'Próxima renovación (recordatorio)', position: 5,
        reminder: { offset_days: -45, campaign_kind: 'aviso_renovacion', message_hint: 'Se acerca la renovación de tu {{entity}} ({{value}}) — pásate y en 20 minutos lo dejas hecho, sin colas ni papeleo.' } },
      { key: 'notas',           type: 'note',   label: 'Notas', position: 6 },
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
      { key: 'segundo_aviso', type: 'date', label: 'Segundo aviso / recordatorio', position: 6,
        reminder: { offset_days: -3, campaign_kind: 'recordatorio', message_hint: 'Recordatorio: {{entity}} está al caer ({{value}}) — ¿lo dejamos resuelto esta semana?' } },
      { key: 'notas',        type: 'note',   label: 'Notas', position: 7 },
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
 * PURA — plan de (des)activación cuando la org cambia de sector. Un tipo de
 * entidad pertenece al sector actual si su `key` está entre las plantillas de
 * ese sector (las keys son ÚNICAS a nivel global). Los que NO pertenecen se
 * DESACTIVAN (is_active=false, jamás se borran: los datos se conservan y
 * volver al sector los reactiva). Los del sector actual que estén desactivados
 * se REACTIVAN.
 *   @param existing  filas de nf_entity_types de la org (con id, key, is_active)
 *   @param templates plantillas del sector ACTUAL (templatesForSector)
 *   @returns { toDeactivate:[ids], toReactivate:[ids] } — solo lo que CAMBIA.
 * El caller aplica los cambios y siembra las plantillas que falten.
 */
function deactivationPlan(existing, templates) {
  const currentKeys = new Set((templates || []).map(t => t.key));
  const toDeactivate = [];
  const toReactivate = [];
  for (const row of (existing || [])) {
    if (!row || !row.id) continue;
    const belongs = currentKeys.has(row.key);
    if (belongs && row.is_active === false)      toReactivate.push(row.id);
    else if (!belongs && row.is_active !== false) toDeactivate.push(row.id);
  }
  return { toDeactivate, toReactivate };
}

/**
 * PURA — vocabulario del PROPIO tipo para el estado vacío / onboarding, en vez
 * de una lista genérica hardcodeada ("ITV, vacuna, renovación…"). Deriva de la
 * plantilla: los labels de sus campos-fecha (donde vive el dinero recurrente),
 * en minúscula y sin el prefijo "Próxima/o" ni "Fecha de". Cae con gracia si el
 * tipo no tiene campos-fecha usables.
 *   @returns { labelPlural, labelSingular, dateExamples:[..], examplesText }
 * examplesText: "sesiones, revisión, caducidad del bono" (ya listo para pintar).
 */
function emptyStateVocabulary(templateOrType) {
  const t = templateOrType || {};
  const labelPlural   = t.label_plural   || 'fichas';
  const labelSingular = t.label_singular || 'ficha';
  const clean = (label) => String(label || '')
    .replace(/^pr[óo]xim[oa]s?\s+/i, '')      // "Próxima revisión" → "revisión"
    .replace(/^fecha\s+de\s+/i, '')            // "Fecha de renovación" → "renovación"
    .replace(/^[úu]ltim[oa]\s+/i, '')          // "Última visita" → "visita"
    .replace(/\s*\([^)]*\)\s*/g, ' ')          // quita paréntesis aclaratorios
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set();
  const dateExamples = [];
  for (const f of (t.fields || [])) {
    if (f.type !== 'date') continue;
    const c = clean(f.label);
    if (c && !seen.has(c)) { seen.add(c); dateExamples.push(c); }
    if (dateExamples.length >= 3) break;
  }
  // Con al menos un campo-fecha → sus propias palabras; si no, algo honesto y
  // genérico de este tipo (nunca vocabulario de OTRO sector).
  const examplesText = dateExamples.length
    ? dateExamples.join(', ')
    : `fechas importantes de cada ${labelSingular.toLowerCase()}`;
  return { labelPlural, labelSingular, dateExamples, examplesText };
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

  // TODAS las filas de la org (activas Y desactivadas): para saber qué siguen
  // sin pertenecer al sector actual y qué hay que reactivar al volver. La
  // función cacheada solo trae activas → aquí leemos crudo.
  let existing = [];
  try {
    const { data, error } = await db.client
      .from('nf_entity_types')
      .select('id, key, catalog_key, label_singular, label_plural, icon, color, label_template, fields, is_active')
      .eq('organization_id', orgId)
      .order('key');
    if (error) { log.warn(`ensureOrgEntityTypes read(${orgId}): ${error.message}`); return getOrgEntityTypes(orgId, { db }); }
    existing = data || [];
  } catch (e) {
    log.warn(`ensureOrgEntityTypes read(${orgId}): ${e.message}`);
    return getOrgEntityTypes(orgId, { db });
  }

  const existingKeys = new Set(existing.map(t => t.key));
  const missing      = templates.filter(t => !existingKeys.has(t.key));

  // La pestaña de Entidades debe seguir SIEMPRE al sector actual: desactivar
  // los tipos que ya no pertenecen (no borrar — reversible) y reactivar los
  // del sector actual que estuvieran desactivados (volver al sector = datos
  // intactos). Bug real 2026-07-09: al cambiar de sector persistía la pestaña
  // vieja ("Planes de tratamiento" tras salir de fisioterapia).
  const { toDeactivate, toReactivate } = deactivationPlan(existing, templates);
  let touched = false;
  // Defensa en profundidad (revisión post-sesión): acotar SIEMPRE por
  // organization_id además del id. Los ids nacen de una lectura org-scoped y
  // son UUID (no explotable hoy), pero un UPDATE por id sin filtro de tenant
  // es justo el patrón que causa escrituras cross-org si la fuente del id
  // cambia. Toda mutación de entidades es org-scoped; esta se alinea.
  if (toDeactivate.length) {
    const { error } = await db.client.from('nf_entity_types')
      .update({ is_active: false }).eq('organization_id', orgId).in('id', toDeactivate);
    if (error) log.warn(`ensureOrgEntityTypes deactivate(${orgId}): ${error.message}`);
    else { touched = true; log.info(`Entidades: desactivados ${toDeactivate.length} tipos ajenos al sector para org ${orgId}`); }
  }
  if (toReactivate.length) {
    const { error } = await db.client.from('nf_entity_types')
      .update({ is_active: true }).eq('organization_id', orgId).in('id', toReactivate);
    if (error) log.warn(`ensureOrgEntityTypes reactivate(${orgId}): ${error.message}`);
    else { touched = true; log.info(`Entidades: reactivados ${toReactivate.length} tipos del sector para org ${orgId}`); }
  }

  if (missing.length) {
    // slug canónico para el catalog_key (aunque llegara un alias)
    let sectorSlug = _norm(sectorRaw);
    try { sectorSlug = require('../sectors/sector-registry').resolveSector(sectorRaw).slug || sectorSlug; } catch (_) {}
    if (!ENTITY_TEMPLATES[sectorSlug] && ENTITY_TEMPLATES[_norm(sectorRaw)]) sectorSlug = _norm(sectorRaw);

    const rows = missing.map(t => instantiateTemplate(t, orgId, sectorSlug));
    const { error } = await db.client
      .from('nf_entity_types')
      .upsert(rows, { onConflict: 'organization_id,key', ignoreDuplicates: true });
    if (error) log.warn(`ensureOrgEntityTypes seed(${orgId}): ${error.message}`);
    else { touched = true; log.info(`Entidades: sembrados ${rows.map(r => r.key).join(', ')} para org ${orgId} (${sectorSlug})`); }
  }

  if (touched) invalidateOrgEntityTypes(orgId);
  // Devuelve SOLO los tipos activos del sector actual (getOrgEntityTypes filtra
  // is_active=true), garantía de que la pestaña muestra el sector correcto.
  return getOrgEntityTypes(orgId, { db });
}

// ─── Validación de campos personalizados (el negocio edita SU propia ficha) ──
// Normaliza y valida el array de campos que llega del editor del portal: genera
// claves únicas desde la etiqueta, acota tipos/opciones y valida los avisos de
// los campos-fecha (offset NEGATIVO = avisar ANTES). PURA — testeable sin BD.
function validateEntityFields(rawFields) {
  if (!Array.isArray(rawFields) || rawFields.length < 1) {
    return { ok: false, error: 'La ficha necesita al menos un campo.' };
  }
  if (rawFields.length > MAX_FIELDS) {
    return { ok: false, error: `Máximo ${MAX_FIELDS} campos por ficha.` };
  }
  const out = [];
  const seen = new Set();
  let inList = 0;
  for (let i = 0; i < rawFields.length; i++) {
    const f = rawFields[i] || {};
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const label = String(f.label || '').trim().slice(0, 60);
    if (!label) return { ok: false, error: `El campo nº ${i + 1} necesita un nombre.` };

    // Clave: la dada o generada desde la etiqueta; ÚNICA dentro de la ficha.
    const base = _norm(f.key || label).replace(/^_+|_+$/g, '').slice(0, 40) || 'campo';
    let key = base, n = 2;
    while (seen.has(key)) key = `${base}_${n++}`;
    seen.add(key);

    const field = { key, type, label, position: i + 1 };
    if (f.required)      field.required = true;
    if (f.is_identifier) field.is_identifier = true;
    if (f.show_in_list)  { field.show_in_list = true; inList++; }

    if (type === 'select' || type === 'multiselect') {
      const options = (Array.isArray(f.options) ? f.options : [])
        .map(o => ({
          value: _norm(o && (o.value || o.label)).replace(/^_+|_+$/g, '').slice(0, 40),
          label: String((o && (o.label || o.value)) || '').trim().slice(0, 60),
        }))
        .filter(o => o.value && o.label);
      if (options.length < 2) return { ok: false, error: `"${label}" necesita al menos 2 opciones.` };
      field.options = options;
    }

    // Aviso automático (solo campos-fecha): offset_days NEGATIVO = avisar antes.
    if (type === 'date' && f.reminder && (f.reminder.message_hint || f.reminder.offset_days != null)) {
      const off  = Math.round(Number(f.reminder.offset_days));
      const hint = String(f.reminder.message_hint || '').trim().slice(0, 400);
      if (!Number.isFinite(off) || off >= 0) {
        return { ok: false, error: `El aviso de "${label}" debe programarse ANTES de la fecha.` };
      }
      if (!hint) return { ok: false, error: `El aviso de "${label}" necesita un mensaje.` };
      field.reminder = {
        offset_days: off,
        campaign_kind: String(f.reminder.campaign_kind || 'custom_' + key).slice(0, 40),
        message_hint: hint,
      };
    }
    out.push(field);
  }
  if (inList > 5) return { ok: false, error: 'Máximo 5 campos marcados para la vista de lista.' };
  return { ok: true, fields: out };
}

module.exports = {
  ENTITY_TEMPLATES,
  TEMPLATE_VERSION,
  MAX_FIELDS,
  FIELD_TYPES,
  validateEntityFields,
  entitiesFeatureEnabled,
  groupableField,
  identifierField,
  deactivationPlan,
  emptyStateVocabulary,
  templatesForSector,
  sectorHasEntityTemplates,
  instantiateTemplate,
  entityTablesExist,
  getOrgEntityTypes,
  ensureOrgEntityTypes,
  invalidateOrgEntityTypes,
};
