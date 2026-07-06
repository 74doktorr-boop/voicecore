// ============================================================
// NodeFlow — Catálogo de seguimientos por sector (2026-07-06)
// ------------------------------------------------------------
// FUENTE ÚNICA de los seguimientos que trae cada sector "de fábrica".
// Cada entrada mezcla dos cosas en un solo sitio (antes estaban en dos):
//   · presentación → label, serviceLabel (texto del mensaje), desc
//   · motor        → trigger, days, serviceFilter, field, onlyIfCompleted…
//
// El reminder-engine deriva sus SECTOR_DEFAULTS de aquí (toEngineDefaults),
// así no hay split-brain: se añade un seguimiento en un único lugar.
//
// El dueño ve estos defaults en el portal, los activa/desactiva, ajusta
// el "cuándo", y puede AÑADIR seguimientos propios (ver followup-rules).
// ============================================================
'use strict';

// Campos que entiende el motor (calculateScheduledFor). El resto es copy.
const ENGINE_KEYS = ['trigger', 'days', 'serviceFilter', 'field', 'onlyIfCompleted', 'frequencyField', 'daysOffset'];

// Disparadores admitidos, con una explicación en cristiano para la UI.
const TRIGGERS = {
  from_last_appointment: 'A los N días de su última cita',
  from_last_if_no_new:   'A los N días de su última cita, solo si no ha vuelto',
  before_sector_field:   'N días antes de una fecha del cliente (caducidad, cuota…)',
  from_sector_field:     'N días después de una fecha del cliente',
  custom_frequency:      'Según la frecuencia guardada del cliente',
};

// Disparadores que un dueño puede elegir para un seguimiento PERSONALIZADO.
// (los basados en fechas de sector requieren datos que no todos tienen)
const CUSTOM_TRIGGERS = ['from_last_appointment', 'from_last_if_no_new'];

// ── Catálogo ────────────────────────────────────────────────
// days = número de días del disparador. serviceLabel = cómo se nombra el
// servicio dentro del mensaje ("Ha llegado el momento de {serviceLabel}").
const SECTOR_CATALOG = {
  peluqueria: {
    label: 'Peluquería',
    followups: [
      { key: 'corte_pelo',  label: 'Recordar corte de pelo',   serviceLabel: 'tu corte de pelo',       desc: 'A los 24 días del último corte',           trigger: 'from_last_appointment', days: 24, serviceFilter: ['corte', 'pelo', 'cabello'] },
      { key: 'color_tinte', label: 'Recordar tinte',           serviceLabel: 'el tinte',               desc: 'A los 35 días del último tinte',           trigger: 'from_last_appointment', days: 35, serviceFilter: ['color', 'tinte'] },
      { key: 'tratamiento', label: 'Recordar tratamiento',     serviceLabel: 'tu tratamiento capilar', desc: 'A los 28 días del último tratamiento',     trigger: 'from_last_appointment', days: 28, serviceFilter: ['tratamiento'] },
      { key: 'permanente',  label: 'Recordar permanente',      serviceLabel: 'la permanente',          desc: 'A los 70 días de la última permanente',    trigger: 'from_last_appointment', days: 70, serviceFilter: ['permanente'] },
    ],
  },
  taller: {
    label: 'Taller',
    followups: [
      { key: 'cambio_aceite', label: 'Cambio de aceite',  serviceLabel: 'el cambio de aceite de tu vehículo', desc: 'Al año del último cambio',        trigger: 'from_sector_field',  days: 335, field: 'fecha_ultimo_aceite' },
      { key: 'itv',           label: 'Aviso de ITV',       serviceLabel: 'la ITV de tu vehículo',              desc: '60 días antes de vencer la ITV',  trigger: 'before_sector_field', days: 60,  field: 'fecha_vencimiento_itv' },
      { key: 'revision',      label: 'Revisión anual',     serviceLabel: 'la revisión del vehículo',           desc: 'Al año de la última revisión',    trigger: 'from_last_appointment', days: 335 },
    ],
  },
  dental: {
    label: 'Clínica dental',
    followups: [
      { key: 'revision_anual',   label: 'Revisión anual',           serviceLabel: 'tu revisión anual',            desc: 'A los ~11 meses de la última revisión',      trigger: 'from_last_appointment', days: 330, serviceFilter: ['revisión', 'revision', 'check'] },
      { key: 'limpieza',         label: 'Limpieza dental',          serviceLabel: 'tu limpieza dental',           desc: 'Cada ~6 meses',                              trigger: 'from_last_appointment', days: 165, serviceFilter: ['limpieza'] },
      { key: 'ortodoncia',       label: 'Seguimiento de ortodoncia', serviceLabel: 'tu seguimiento de ortodoncia', desc: 'A los 25 días (si completó la cita)',       trigger: 'from_last_appointment', days: 25,  serviceFilter: ['ortodoncia'], onlyIfCompleted: true },
      { key: 'post_tratamiento', label: 'Revisión post-tratamiento', serviceLabel: 'tu revisión post-tratamiento', desc: 'A los 12 días de implante/extracción',      trigger: 'from_last_appointment', days: 12,  serviceFilter: ['extracción', 'implante', 'endodoncia'], onlyIfCompleted: true },
    ],
  },
  estetica_avanzada: {
    label: 'Estética',
    followups: [
      { key: 'facial',               label: 'Tratamiento facial',   serviceLabel: 'tu tratamiento facial',   desc: 'A los 28 días', trigger: 'from_last_appointment', days: 28, serviceFilter: ['facial'] },
      { key: 'depilacion_laser',     label: 'Depilación láser',     serviceLabel: 'tu sesión de depilación láser', desc: 'A los 35 días', trigger: 'from_last_appointment', days: 35, serviceFilter: ['láser', 'laser'] },
      { key: 'depilacion_cera',      label: 'Depilación con cera',  serviceLabel: 'tu depilación',           desc: 'A los 28 días', trigger: 'from_last_appointment', days: 28, serviceFilter: ['cera'] },
      { key: 'tratamiento_corporal', label: 'Tratamiento corporal', serviceLabel: 'tu tratamiento corporal', desc: 'A los 21 días', trigger: 'from_last_appointment', days: 21, serviceFilter: ['corporal'] },
    ],
  },
  veterinaria: {
    label: 'Veterinaria',
    followups: [
      { key: 'vacuna_anual',    label: 'Vacuna anual',        serviceLabel: 'la vacuna anual',            desc: '14 días antes de la próxima vacuna',  trigger: 'before_sector_field', days: 14,  field: 'fecha_proxima_vacuna' },
      { key: 'desparasitacion', label: 'Desparasitación',     serviceLabel: 'la desparasitación',         desc: 'Cada ~70 días',                       trigger: 'from_last_appointment', days: 70, serviceFilter: ['desparasitación', 'desparasitacion'] },
      { key: 'revision_anual',  label: 'Revisión anual',      serviceLabel: 'tu revisión anual',          desc: 'Al año de la última revisión',        trigger: 'from_last_appointment', days: 330, serviceFilter: ['revisión', 'revision', 'chequeo'] },
      { key: 'post_cirugia',    label: 'Revisión post-cirugía', serviceLabel: 'la revisión post-cirugía', desc: 'A los 10 días (si completó la cita)', trigger: 'from_last_appointment', days: 10, serviceFilter: ['cirugía', 'cirugia', 'operación'], onlyIfCompleted: true },
    ],
  },
  gimnasio: {
    label: 'Gimnasio',
    followups: [
      { key: 'renovacion_cuota', label: 'Renovación de cuota', serviceLabel: 'la renovación de tu cuota', desc: '5 días antes de vencer la cuota', trigger: 'before_sector_field', days: 5, field: 'fecha_vencimiento_cuota' },
    ],
  },
  fisioterapia: {
    label: 'Fisioterapia',
    followups: [
      { key: 'seguimiento_post', label: 'Seguimiento post-sesión', serviceLabel: 'tu seguimiento',           desc: 'A los 14 días (si completó la cita)', trigger: 'from_last_appointment', days: 14, onlyIfCompleted: true },
      { key: 'mantenimiento',    label: 'Sesión de mantenimiento', serviceLabel: 'tu sesión de mantenimiento', desc: 'A los 90 días del alta',            trigger: 'from_sector_field',  days: 90, field: 'fecha_alta' },
    ],
  },
  psicologia: {
    label: 'Psicología',
    followups: [
      { key: 'sesion_habitual', label: 'Próxima sesión', serviceLabel: 'tu próxima sesión', desc: 'Según la frecuencia del paciente', trigger: 'custom_frequency', frequencyField: 'frecuencia_sesiones', onlyIfCompleted: true },
    ],
  },
  nutricion: {
    label: 'Nutrición',
    followups: [
      { key: 'revision_mensual', label: 'Revisión mensual', serviceLabel: 'tu revisión mensual', desc: 'A los 28 días',                       trigger: 'from_last_appointment', days: 28 },
      { key: 'reactivacion',     label: 'Reactivación',     serviceLabel: 'tu próxima visita',   desc: 'A los 42 días si no ha vuelto',       trigger: 'from_last_if_no_new',   days: 42 },
    ],
  },
  optica: {
    label: 'Óptica',
    followups: [
      { key: 'revision_vista',       label: 'Revisión de vista',      serviceLabel: 'tu revisión de vista',        desc: 'Al año de la última graduación',    trigger: 'from_last_appointment', days: 330, serviceFilter: ['revisión', 'graduación'] },
      { key: 'reposicion_lentillas', label: 'Reposición de lentillas', serviceLabel: 'la reposición de tus lentillas', desc: '5 días antes de agotar el suministro', trigger: 'from_sector_field', field: 'suministro_lentillas_dias', daysOffset: -5 },
    ],
  },
  hotel: {
    label: 'Hotel',
    followups: [
      { key: 'aniversario',  label: 'Aniversario',    serviceLabel: 'tu próximo aniversario', desc: '21 días antes del aniversario', trigger: 'before_sector_field', days: 21, field: 'fecha_aniversario' },
      { key: 'cumpleanos',   label: 'Cumpleaños',     serviceLabel: 'tu cumpleaños',          desc: '21 días antes del cumpleaños',  trigger: 'before_sector_field', days: 21, field: 'fecha_cumpleanos' },
      { key: 'recuperacion', label: 'Recuperación',   serviceLabel: 'una nueva visita',       desc: 'A los 270 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 270 },
    ],
  },
  academia: {
    label: 'Academia',
    followups: [
      { key: 'renovacion_matricula', label: 'Renovación de matrícula', serviceLabel: 'la renovación de matrícula', desc: '21 días antes de fin de curso', trigger: 'before_sector_field', days: 21, field: 'fecha_fin_curso' },
    ],
  },
  clinica: {
    label: 'Centro médico / clínica',
    followups: [
      { key: 'renovacion_psicotecnico', label: 'Renovación de psicotécnico', serviceLabel: 'la renovación de tu psicotécnico', desc: '30 días antes de la caducidad', trigger: 'before_sector_field', days: 30, field: 'fecha_caducidad_psicotecnico' },
      { key: 'revision_anual',          label: 'Revisión anual',             serviceLabel: 'tu revisión anual',               desc: 'Al año de la última revisión',  trigger: 'from_last_appointment', days: 330, serviceFilter: ['revisión', 'revision', 'chequeo'] },
    ],
  },
  reconocimientos: {
    label: 'Centro de reconocimientos (CRC)',
    followups: [
      { key: 'renovacion_psicotecnico', label: 'Renovación de psicotécnico', serviceLabel: 'la renovación de tu psicotécnico', desc: '30 días antes de la caducidad', trigger: 'before_sector_field', days: 30, field: 'fecha_caducidad_psicotecnico' },
    ],
  },
  podologia: {
    label: 'Podología',
    followups: [
      { key: 'quiropodia',   label: 'Quiropodia periódica', serviceLabel: 'tu quiropodia',     desc: 'Cada ~6 semanas',                  trigger: 'from_last_appointment', days: 40, serviceFilter: ['quiropodia', 'pies'] },
      { key: 'reactivacion', label: 'Reactivación',         serviceLabel: 'tu próxima visita', desc: 'A los 60 días si no ha vuelto',    trigger: 'from_last_if_no_new',   days: 60 },
    ],
  },
  farmacia: {
    label: 'Farmacia',
    followups: [
      { key: 'fin_tratamiento', label: 'Fin de tratamiento', serviceLabel: 'la renovación de tu tratamiento', desc: '5 días antes de acabar el tratamiento', trigger: 'before_sector_field', days: 5, field: 'fecha_fin_tratamiento' },
    ],
  },
  laser: {
    label: 'Depilación láser',
    followups: [
      { key: 'proxima_sesion', label: 'Próxima sesión de láser', serviceLabel: 'tu próxima sesión de láser', desc: 'A las ~6 semanas (si completó la sesión)', trigger: 'from_last_appointment', days: 42, onlyIfCompleted: true },
    ],
  },
  spa: {
    label: 'Spa / bienestar',
    followups: [
      { key: 'sesion_mensual', label: 'Sesión de relax mensual', serviceLabel: 'tu próxima sesión de relax', desc: 'A los 35 días de la última visita', trigger: 'from_last_appointment', days: 35 },
    ],
  },
  yoga: {
    label: 'Yoga',
    followups: [
      { key: 'fin_bono',     label: 'Fin de bono',   serviceLabel: 'la renovación de tu bono',  desc: '5 días antes de agotarse el bono',  trigger: 'before_sector_field', days: 5, field: 'fecha_fin_bono' },
      { key: 'reactivacion', label: 'Reactivación',  serviceLabel: 'tu próxima clase',          desc: 'A los 21 días si no ha vuelto',     trigger: 'from_last_if_no_new', days: 21 },
    ],
  },
  pilates: {
    label: 'Pilates',
    followups: [
      { key: 'fin_bono',     label: 'Fin de bono',   serviceLabel: 'la renovación de tu bono',  desc: '5 días antes de agotarse el bono',  trigger: 'before_sector_field', days: 5, field: 'fecha_fin_bono' },
      { key: 'reactivacion', label: 'Reactivación',  serviceLabel: 'tu próxima clase',          desc: 'A los 21 días si no ha vuelto',     trigger: 'from_last_if_no_new', days: 21 },
    ],
  },
  restaurante: {
    label: 'Restaurante',
    followups: [
      { key: 'recuperacion', label: 'Invitar a volver', serviceLabel: 'tu próxima visita', desc: 'A los 45 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 45 },
    ],
  },
  abogados: {
    label: 'Despacho de abogados',
    followups: [
      { key: 'seguimiento_consulta', label: 'Seguimiento de consulta', serviceLabel: 'el seguimiento de tu consulta', desc: 'A los 7 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 7 },
    ],
  },
  asesoria: {
    label: 'Asesoría / gestoría',
    followups: [
      { key: 'seguimiento_tramite', label: 'Seguimiento de trámite',  serviceLabel: 'el seguimiento de tu trámite', desc: 'A los 10 días si no ha vuelto',       trigger: 'from_last_if_no_new', days: 10 },
      { key: 'revision_trimestral', label: 'Recordatorio trimestral', serviceLabel: 'tu cita del trimestre',        desc: 'A los ~80 días de la última visita',  trigger: 'from_last_appointment', days: 80 },
    ],
  },
  notaria: {
    label: 'Notaría',
    followups: [
      { key: 'seguimiento_expediente', label: 'Seguimiento de expediente', serviceLabel: 'el seguimiento de tu expediente', desc: 'A los 10 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 10 },
    ],
  },
  inmobiliaria: {
    label: 'Inmobiliaria',
    followups: [
      { key: 'seguimiento_visita', label: 'Seguimiento tras visita', serviceLabel: 'el seguimiento de tu visita', desc: 'A los 5 días de visitar el inmueble',  trigger: 'from_last_appointment', days: 5 },
      { key: 'fin_contrato',       label: 'Fin de contrato',         serviceLabel: 'la renovación de tu contrato', desc: '45 días antes de vencer el contrato', trigger: 'before_sector_field', days: 45, field: 'fecha_fin_contrato' },
    ],
  },
  reformas: {
    label: 'Reformas / construcción',
    followups: [
      { key: 'seguimiento_presupuesto', label: 'Seguimiento de presupuesto', serviceLabel: 'el presupuesto que te preparamos', desc: 'A los 5 días si no ha respondido', trigger: 'from_last_if_no_new', days: 5 },
    ],
  },
  arquitectura: {
    label: 'Arquitectura',
    followups: [
      { key: 'seguimiento_propuesta', label: 'Seguimiento de propuesta', serviceLabel: 'la propuesta que te preparamos', desc: 'A los 10 días si no ha respondido', trigger: 'from_last_if_no_new', days: 10 },
    ],
  },
  autoescuela: {
    label: 'Autoescuela',
    followups: [
      { key: 'alumno_parado', label: 'Alumno parado', serviceLabel: 'tu próxima clase', desc: 'A los 14 días sin venir a clase', trigger: 'from_last_if_no_new', days: 14 },
    ],
  },
  coaching: {
    label: 'Coaching',
    followups: [
      { key: 'proxima_sesion', label: 'Próxima sesión', serviceLabel: 'tu próxima sesión', desc: 'A los 21 días (si completó la sesión)', trigger: 'from_last_appointment', days: 21, onlyIfCompleted: true },
    ],
  },
  agencia_viajes: {
    label: 'Agencia de viajes',
    followups: [
      { key: 'aniversario_viaje', label: 'Aniversario del viaje', serviceLabel: 'tu próxima escapada', desc: 'Al año del último viaje ("¿repetimos?")', trigger: 'from_last_appointment', days: 335 },
    ],
  },
  guarderia_canina: {
    label: 'Guardería canina',
    followups: [
      { key: 'reserva_recurrente', label: 'Reserva recurrente', serviceLabel: 'la próxima estancia de tu peludo', desc: 'A los 30 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 30 },
    ],
  },
  residencia_mascotas: {
    label: 'Residencia de mascotas',
    followups: [
      { key: 'temporada_vacaciones', label: 'Próximas vacaciones', serviceLabel: 'la próxima estancia de tu mascota', desc: 'Al año de la última estancia', trigger: 'from_last_appointment', days: 330 },
    ],
  },
  generico: {
    label: 'Negocio',
    followups: [
      { key: 'reactivacion', label: 'Reactivación de clientes', serviceLabel: 'tu próxima visita', desc: 'A los 60 días si no ha vuelto', trigger: 'from_last_if_no_new', days: 60 },
    ],
  },
};

// ── Derivados ───────────────────────────────────────────────

/** Extrae solo los campos que entiende el motor de una entrada del catálogo. */
function _engineFields(fu) {
  const out = {};
  for (const k of ENGINE_KEYS) if (fu[k] !== undefined) out[k] = fu[k];
  return out;
}

/** { sector: { key: {engine fields} } } — lo que consume reminder-engine. */
function toEngineDefaults() {
  const out = {};
  for (const [sector, def] of Object.entries(SECTOR_CATALOG)) {
    out[sector] = {};
    for (const fu of def.followups) out[sector][fu.key] = _engineFields(fu);
  }
  return out;
}

/** Seguimientos de un sector con toda su presentación (para el portal). */
function getSectorFollowups(sector) {
  const def = SECTOR_CATALOG[sector];
  return def ? def.followups.map(f => ({ ...f })) : [];
}

/** Texto del servicio para el mensaje, dado sector + serviceKey (con fallback). */
function serviceLabelFor(sector, key) {
  const def = SECTOR_CATALOG[sector];
  const fu = def && def.followups.find(f => f.key === key);
  if (fu) return fu.serviceLabel;
  return String(key || '').replace(/_/g, ' ') || 'tu próxima cita';
}

module.exports = {
  SECTOR_CATALOG,
  TRIGGERS,
  CUSTOM_TRIGGERS,
  toEngineDefaults,
  getSectorFollowups,
  serviceLabelFor,
};
