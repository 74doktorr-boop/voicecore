// ============================================================
// NodeFlow — Registro canónico de sectores (2026-07-04)
// ------------------------------------------------------------
// Fuente ÚNICA de verdad por vertical. Antes el "conocimiento de
// sector" estaba desperdigado (switch del prompt-generator + campos
// de sector-fields). Aquí cada sector declara sus TRES pilares:
//
//   · normas[]        → reglas de comportamiento propias del sector,
//                       que se inyectan en el prompt del asistente.
//   · metricChecks[]  → qué debe verificar el AUDITOR en ese sector
//                       (lo que significa "bien hecho" aquí, no en general).
//   · requiredFields  → parámetros que el negocio debe capturar
//                       (se reutilizan de sector-fields.js).
//
// El bucle de mejora se vuelve sector-aware leyendo de aquí: el auditor
// juzga con metricChecks del sector, el agregador agrupa por sector y las
// reglas aprobadas se aplican a las normas DE ESE sector, no a todos.
// Determinista, sin I/O — testeable.
// ============================================================
'use strict';

const { SECTOR_REQUIRED_FIELDS } = require('../lifecycle/sector-fields');

// Sector por defecto: lo que aplica a cualquier negocio sin vertical propia.
const GENERICO = {
  slug: 'generico',
  label: 'Negocio',
  aliases: [],
  norms: [],
  metricChecks: [],
};

// Los ~32 sectores del prompt-generator, curados a fondo (Fase 5, 2026-07-04):
// normas de comportamiento reales + métricas propias por vertical. Los slugs
// coinciden con los del prompt-generator para que TODA org resuelva a su sector.
const SECTORS = {
  // ── Restauración / hostelería ────────────────────────────────
  restaurante: {
    slug: 'restaurante', label: 'Restaurante',
    aliases: ['bar', 'cafeteria', 'gastrobar', 'asador', 'marisqueria', 'pizzeria'],
    norms: [
      'Para CUALQUIER reserva pregunta SIEMPRE el número de comensales y la hora — sin eso no hay reserva.',
      'Pregunta si hay niños (trona) o alergias/intolerancias cuando encaje, y si prefieren terraza o interior.',
      'No confirmes mesa sin tener comensales + hora; con grupos grandes avisa de que el equipo puede llamar para confirmar.',
    ],
    metricChecks: [
      { key: 'guests_captured', label: '¿Capturó el número de comensales?' },
      { key: 'time_captured',   label: '¿Capturó la hora/fecha de la reserva?' },
      { key: 'special_needs',   label: '¿Sondeó necesidades (niños, alergias, terraza)?' },
    ],
  },
  hotel: {
    slug: 'hotel', label: 'Hotel / alojamiento',
    aliases: ['hostal', 'pension', 'apartamentos', 'casa_rural', 'alojamiento'],
    norms: [
      'Pregunta SIEMPRE las fechas de entrada y salida y el número de personas — sin eso no hay disponibilidad.',
      'Aclara el tipo de habitación/alojamiento y cuántas noches; menciona check-in/out si está configurado.',
      'No confirmes una reserva sin fechas + personas; para peticiones especiales, registra el lead.',
    ],
    metricChecks: [
      { key: 'dates_captured',  label: '¿Capturó fechas de entrada y salida?' },
      { key: 'guests_captured', label: '¿Capturó el número de personas?' },
    ],
  },
  // ── Salud / clínicas (sin diagnóstico por teléfono) ──────────
  dental: {
    slug: 'dental', label: 'Clínica dental',
    aliases: ['dentista', 'odontologia', 'odontologo', 'clinica_dental'],
    norms: [
      'Si es una primera visita, pregúntalo y para qué motivo (revisión, limpieza, dolor, urgencia).',
      'Ante dolor agudo o urgencia dental, priorízalo: ofrece el hueco más cercano posible.',
      'Si el paciente pregunta por su seguro/mutua y está configurado, díselo; si no lo sabes, ofrece confirmarlo.',
      'NUNCA des diagnósticos ni consejos clínicos: eso lo hace el profesional en consulta.',
    ],
    metricChecks: [
      { key: 'first_visit_asked', label: '¿Preguntó si es primera visita y el motivo?' },
      { key: 'urgency_triaged',   label: '¿Detectó y priorizó una urgencia o dolor?' },
      { key: 'no_medical_advice', label: '¿Evitó dar diagnóstico o consejo clínico?' },
    ],
  },
  clinica: {
    slug: 'clinica', label: 'Clínica médica',
    aliases: ['medico', 'consulta_medica', 'centro_medico', 'clinica_medica'],
    norms: [
      'Pregunta la especialidad o el profesional que busca y si es primera visita o revisión.',
      'Ante síntomas graves o urgencia, no gestiones cita normal: indícale que acuda a urgencias o llame al 112 si procede, y registra el aviso.',
      'Pregunta por seguro/mutua si está configurado.',
      'NUNCA des diagnósticos, dosis ni consejos médicos: deriva siempre al profesional.',
    ],
    metricChecks: [
      { key: 'specialty_captured', label: '¿Capturó la especialidad o profesional?' },
      { key: 'urgency_triaged',    label: '¿Reaccionó bien ante una urgencia médica?' },
      { key: 'no_medical_advice',  label: '¿Evitó dar diagnóstico o consejo médico?' },
    ],
  },
  fisioterapia: {
    slug: 'fisioterapia', label: 'Fisioterapia',
    aliases: ['fisio', 'rehabilitacion', 'osteopatia'],
    norms: [
      'Pregunta el motivo y la zona (lesión, dolor de espalda, recuperación) y si es primera sesión o seguimiento.',
      'Si viene con parte médico o seguro, tenlo en cuenta; menciona seguros si están configurados.',
      'NUNCA des diagnóstico ni pauta de tratamiento por teléfono: lo valora el fisioterapeuta.',
    ],
    metricChecks: [
      { key: 'reason_captured',   label: '¿Capturó el motivo/zona a tratar?' },
      { key: 'first_visit_asked', label: '¿Distinguió primera sesión vs. seguimiento?' },
      { key: 'no_medical_advice', label: '¿Evitó dar diagnóstico o pauta clínica?' },
    ],
  },
  podologia: {
    slug: 'podologia', label: 'Podología',
    aliases: ['podologo', 'podologa'],
    norms: [
      'Pregunta el motivo (uñas, callosidades, plantillas, dolor al caminar) y si es primera visita.',
      'Si menciona que es diabético o tiene problemas de circulación, recógelo (es relevante para la consulta).',
      'No des diagnóstico ni tratamiento por teléfono: lo valora el podólogo.',
    ],
    metricChecks: [
      { key: 'reason_captured',   label: '¿Capturó el motivo de la consulta?' },
      { key: 'no_medical_advice', label: '¿Evitó dar diagnóstico o tratamiento?' },
    ],
  },
  optica: {
    slug: 'optica', label: 'Óptica',
    aliases: ['optico', 'gafas', 'audiologia'],
    norms: [
      'Pregunta el motivo (graduación/revisión, gafas nuevas, lentillas, gafas de sol) y si trae receta.',
      'Menciona seguros ópticos o marcas si están configurados; para reparaciones, registra el lead.',
      'No des recomendación óptica clínica: el optometrista gradúa en consulta.',
    ],
    metricChecks: [
      { key: 'reason_captured', label: '¿Capturó el motivo (graduación, gafas, lentillas)?' },
      { key: 'prescription_asked', label: '¿Preguntó si trae receta cuando aplica?' },
    ],
  },
  farmacia: {
    slug: 'farmacia', label: 'Farmacia',
    aliases: ['parafarmacia', 'botica'],
    norms: [
      'Si preguntan por un medicamento, aclara si lo tienen o hay que encargarlo, y si necesita receta.',
      'Informa de servicios (SPD, toma de tensión, reserva de producto) si están configurados.',
      'NUNCA des consejo médico ni sustituyas la indicación del médico; para dudas de salud, deriva al farmacéutico o al médico.',
    ],
    metricChecks: [
      { key: 'product_or_service', label: '¿Aclaró disponibilidad del producto/servicio?' },
      { key: 'no_medical_advice',  label: '¿Evitó dar consejo médico indebido?' },
    ],
  },
  veterinaria: {
    slug: 'veterinaria', label: 'Veterinaria',
    aliases: ['veterinario', 'clinica_veterinaria', 'vet'],
    norms: [
      'Pregunta el nombre y la especie/raza de la mascota y el motivo (revisión, vacuna, síntoma).',
      'Ante una urgencia (accidente, no come, dificultad para respirar), priorízala; si hay urgencias 24h configuradas, deriva al veterinario de guardia.',
      'No des diagnóstico ni medicación por teléfono: lo valora el veterinario.',
    ],
    metricChecks: [
      { key: 'pet_captured',      label: '¿Capturó la mascota (nombre/especie) y el motivo?' },
      { key: 'urgency_triaged',   label: '¿Detectó y priorizó una urgencia?' },
      { key: 'no_medical_advice', label: '¿Evitó dar diagnóstico o medicación?' },
    ],
  },
  // ── Bienestar / estética ─────────────────────────────────────
  peluqueria: {
    slug: 'peluqueria', label: 'Peluquería',
    aliases: ['barberia', 'estilismo', 'salon_belleza'],
    norms: [
      'Pregunta SIEMPRE qué servicio quiere (corte, tinte, mechas, peinado) — la duración y el hueco dependen de ello.',
      'Si el servicio es largo (tinte, mechas, alisado), tenlo en cuenta al ofrecer horario.',
      'Si menciona un profesional concreto, respétalo al buscar hueco.',
    ],
    metricChecks: [
      { key: 'service_captured', label: '¿Capturó qué servicio quiere?' },
      { key: 'duration_aware',   label: '¿Tuvo en cuenta la duración al ofrecer hora?' },
    ],
  },
  estetica_avanzada: {
    slug: 'estetica_avanzada', label: 'Estética avanzada',
    aliases: ['estetica', 'centro_estetico', 'belleza'],
    norms: [
      'Pregunta qué tratamiento le interesa; si es la primera vez, ofrece una consulta de valoración.',
      'NUNCA prometas resultados concretos ni tiempos garantizados: depende de cada persona y lo valora la profesional.',
      'Ten en cuenta la duración del tratamiento al ofrecer hora.',
    ],
    metricChecks: [
      { key: 'treatment_captured', label: '¿Capturó el tratamiento de interés?' },
      { key: 'no_overpromise',     label: '¿Evitó prometer resultados garantizados?' },
    ],
  },
  laser: {
    slug: 'laser', label: 'Depilación láser / medicina estética',
    aliases: ['depilacion_laser', 'medicina_estetica'],
    norms: [
      'Pregunta la zona a tratar; para tratamientos médico-estéticos ofrece consulta de valoración previa.',
      'NUNCA prometas resultados ni número de sesiones garantizado: lo valora el profesional según cada caso.',
      'No des indicaciones médicas por teléfono.',
    ],
    metricChecks: [
      { key: 'area_captured',  label: '¿Capturó la zona a tratar?' },
      { key: 'no_overpromise', label: '¿Evitó prometer resultados garantizados?' },
    ],
  },
  spa: {
    slug: 'spa', label: 'Spa / balneario',
    aliases: ['balneario', 'circuito_spa', 'wellness'],
    norms: [
      'Pregunta qué experiencia o tratamiento busca y si es individual o en pareja/grupo.',
      'Ten en cuenta la duración de circuitos y tratamientos al ofrecer hora.',
      'Sondea si hay alguna condición (embarazo, lesión) cuando encaje, para recomendaciones de seguridad.',
    ],
    metricChecks: [
      { key: 'experience_captured', label: '¿Capturó la experiencia/tratamiento?' },
      { key: 'party_captured',      label: '¿Aclaró si es individual o en pareja/grupo?' },
    ],
  },
  nutricion: {
    slug: 'nutricion', label: 'Nutrición / dietética',
    aliases: ['dietetica', 'nutricionista', 'dietista'],
    norms: [
      'Pregunta el objetivo general (perder peso, deporte, salud/patología) y si es primera consulta o seguimiento.',
      'NO des pautas ni dietas por teléfono: el plan lo diseña el profesional en consulta.',
      'Con patologías (diabetes, alergias), recoge el dato pero deriva al profesional.',
    ],
    metricChecks: [
      { key: 'goal_captured',     label: '¿Capturó el objetivo del cliente?' },
      { key: 'no_medical_advice', label: '¿Evitó dar pautas/dietas por teléfono?' },
    ],
  },
  // ── Psico / coaching (confidencialidad, sin terapia telefónica)
  psicologia: {
    slug: 'psicologia', label: 'Psicología',
    aliases: ['psicologo', 'psicologa', 'psicoterapia', 'terapia'],
    norms: [
      'Trata la llamada con tacto y confidencialidad; NO indagues en detalles sensibles, basta el motivo general para asignar profesional.',
      'Pregunta si es primera consulta o seguimiento y si prefiere presencial u online (si aplica).',
      'NUNCA hagas terapia ni des consejo psicológico por teléfono. Ante riesgo (crisis, autolesión), indica recursos de urgencia (112 / 024) y registra el aviso como prioritario.',
    ],
    metricChecks: [
      { key: 'handled_sensitively', label: '¿Trató el motivo con tacto y sin indagar de más?' },
      { key: 'no_therapy_advice',   label: '¿Evitó hacer terapia/consejo por teléfono?' },
      { key: 'crisis_safety',       label: '¿Reaccionó con seguridad si hubo señales de crisis?' },
    ],
  },
  coaching: {
    slug: 'coaching', label: 'Coaching',
    aliases: ['coach', 'mentoring', 'desarrollo_personal'],
    norms: [
      'Pregunta el área o el objetivo (profesional, personal, equipos) y si busca sesión individual o programa.',
      'Aclara duración y modalidad (presencial/online) si está configurado.',
      'No hagas coaching por teléfono: registra el interés y que el profesional le contacte.',
    ],
    metricChecks: [
      { key: 'goal_captured', label: '¿Capturó el objetivo/área del cliente?' },
      { key: 'modality_captured', label: '¿Aclaró modalidad (individual/programa, online)?' },
    ],
  },
  // ── Mascotas (alojamiento) ───────────────────────────────────
  guarderia_canina: {
    slug: 'guarderia_canina', label: 'Guardería canina',
    aliases: ['guarderia_perros', 'daycare_canino'],
    norms: [
      'Pregunta el nombre, tamaño/raza del perro y si está vacunado y desparasitado (requisito habitual).',
      'Aclara los días/horas que necesita y comprueba disponibilidad de plazas si está configurado.',
      'Si el perro tiene necesidades especiales (medicación, comportamiento), recógelo.',
    ],
    metricChecks: [
      { key: 'pet_captured',       label: '¿Capturó datos del perro (nombre, tamaño)?' },
      { key: 'vaccination_asked',  label: '¿Preguntó por vacunación cuando aplica?' },
    ],
  },
  residencia_mascotas: {
    slug: 'residencia_mascotas', label: 'Residencia de mascotas',
    aliases: ['residencia_canina', 'residencia_perros', 'hotel_mascotas'],
    norms: [
      'Pregunta las fechas exactas de la estancia (entrada y salida) y el animal (especie, tamaño).',
      'Comprueba que las vacunas están al día (requisito) y recoge medicación o dieta especial.',
      'No confirmes plaza sin fechas; con temporada alta, avisa de que el equipo confirmará disponibilidad.',
    ],
    metricChecks: [
      { key: 'dates_captured',    label: '¿Capturó las fechas de la estancia?' },
      { key: 'vaccination_asked', label: '¿Comprobó vacunas/necesidades especiales?' },
    ],
  },
  // ── Deporte / formación ──────────────────────────────────────
  gimnasio: {
    slug: 'gimnasio', label: 'Gimnasio',
    aliases: ['fitness', 'crossfit', 'centro_deportivo'],
    norms: [
      'Aclara qué busca (alta/cuota, una clase concreta, información) y ofrécele una clase o día de prueba si procede.',
      'Si pregunta por una clase, dile el horario si está configurado y comprueba plazas.',
      'Para altas y bajas de cuota, registra el lead: lo gestiona el equipo.',
    ],
    metricChecks: [
      { key: 'intent_captured', label: '¿Aclaró qué busca (alta, clase, info)?' },
      { key: 'trial_offered',   label: '¿Ofreció prueba cuando encajaba?' },
    ],
  },
  yoga: {
    slug: 'yoga', label: 'Yoga',
    aliases: ['centro_yoga', 'yoga_studio'],
    norms: [
      'Pregunta el nivel (principiante, intermedio) y el tipo de clase que le interesa; ofrece una clase de prueba.',
      'Menciona packs/bonos si están configurados y comprueba plazas de la clase.',
      'Recoge si tiene alguna lesión o está embarazada, para recomendar clase adecuada.',
    ],
    metricChecks: [
      { key: 'level_captured', label: '¿Capturó el nivel/tipo de clase?' },
      { key: 'trial_offered',  label: '¿Ofreció clase de prueba?' },
    ],
  },
  pilates: {
    slug: 'pilates', label: 'Pilates',
    aliases: ['centro_pilates', 'pilates_maquina', 'reformer'],
    norms: [
      'Pregunta el nivel y si busca pilates de suelo o de máquina (reformer); ofrece una clase de prueba.',
      'Comprueba plazas (las clases de máquina suelen ser reducidas) y menciona bonos si están configurados.',
      'Recoge lesiones o embarazo para asignar la clase adecuada.',
    ],
    metricChecks: [
      { key: 'level_captured', label: '¿Capturó nivel y tipo (suelo/máquina)?' },
      { key: 'trial_offered',  label: '¿Ofreció clase de prueba?' },
    ],
  },
  autoescuela: {
    slug: 'autoescuela', label: 'Autoescuela',
    aliases: ['autoescuelas', 'permiso_conducir'],
    norms: [
      'Pregunta qué carnet quiere (B, A, etc.) y si empieza de cero o ya tiene teórico/prácticas.',
      'Informa de precios de matrícula/clase práctica si están configurados; para matrículas, registra el lead.',
      'No prometas plazos de aprobado ni de examen: dependen de Tráfico.',
    ],
    metricChecks: [
      { key: 'license_captured', label: '¿Capturó el carnet que quiere?' },
      { key: 'stage_captured',   label: '¿Aclaró si empieza de cero o continúa?' },
    ],
  },
  reconocimientos: {
    slug: 'reconocimientos', label: 'Centro de reconocimientos médicos',
    aliases: ['reconocimiento_medico', 'reconocimientos_medicos', 'psicotecnico', 'psicotecnicos',
              'crc', 'centro_medico_conductores', 'certificado_medico', 'revision_medica_carnet'],
    norms: [
      'Pregunta QUÉ tipo de reconocimiento necesita: carnet de conducir (y qué permiso: B, C, D…), armas, náutica, grúa/perros peligrosos, u otro.',
      'Aclara si es RENOVACIÓN o primera obtención. Si el cliente no lo sabe, no insistas: ofrece confirmarlo en el centro.',
      'Muchos centros atienden por orden de llegada SIN cita; ofrece cita solo si el centro la usa. Informa del horario y de qué traer (DNI, y las gafas o lentillas si las usa).',
      'Informa del precio del reconocimiento si está configurado (suele ser tarifa cerrada por tipo).',
      'NUNCA valores el estado de salud del cliente ni anticipes si pasará o no las pruebas: eso lo decide el personal médico en el centro.',
    ],
    metricChecks: [
      { key: 'exam_type_captured',   label: '¿Identificó el tipo de reconocimiento (carnet/armas/náutica…)?' },
      { key: 'renewal_or_new',       label: '¿Aclaró si es renovación o primera vez?' },
      { key: 'no_medical_judgement', label: '¿Evitó valorar la salud o anticipar el resultado?' },
    ],
  },
  academia: {
    slug: 'academia', label: 'Academia / clases',
    aliases: ['academia_idiomas', 'clases_particulares', 'refuerzo', 'formacion'],
    norms: [
      'Pregunta qué curso/asignatura o idioma busca y el nivel o la edad del alumno.',
      'Ofrece una clase de prueba o evaluación de nivel si procede; menciona precios si están configurados.',
      'Para matrículas, registra el lead con el curso de interés.',
    ],
    metricChecks: [
      { key: 'course_captured', label: '¿Capturó curso/asignatura de interés?' },
      { key: 'level_captured',  label: '¿Capturó nivel o edad del alumno?' },
    ],
  },
  // ── Profesionales / servicios (confidencial, sin asesorar) ───
  abogados: {
    slug: 'abogados', label: 'Despacho de abogados',
    aliases: ['abogado', 'abogada', 'bufete', 'despacho_juridico'],
    norms: [
      'Pregunta el área legal (laboral, penal, familia, civil, extranjería…) para asignar al abogado adecuado; trata el caso con confidencialidad y sin indagar de más.',
      'Si es urgente (detención, plazo que vence), márcalo como prioritario y registra el aviso.',
      'NUNCA des asesoramiento legal ni valores el caso por teléfono: lo hace el abogado en consulta.',
    ],
    metricChecks: [
      { key: 'legal_area_captured', label: '¿Capturó el área legal del caso?' },
      { key: 'no_legal_advice',     label: '¿Evitó dar asesoramiento legal por teléfono?' },
      { key: 'urgency_triaged',     label: '¿Detectó urgencias (plazos, detención)?' },
    ],
  },
  notaria: {
    slug: 'notaria', label: 'Notaría',
    aliases: ['notario', 'notaria_publica'],
    norms: [
      'Pregunta el tipo de trámite (compraventa, poder, herencia, constitución de sociedad) para orientar.',
      'Indica, si lo sabes, qué documentación suele hacer falta y que se confirmará al agendar; para casos concretos, registra el lead.',
      'No des asesoramiento jurídico-fiscal por teléfono.',
    ],
    metricChecks: [
      { key: 'procedure_captured', label: '¿Capturó el tipo de trámite?' },
      { key: 'no_legal_advice',    label: '¿Evitó asesorar por teléfono?' },
    ],
  },
  asesoria: {
    slug: 'asesoria', label: 'Asesoría / gestoría',
    aliases: ['gestoria', 'asesor_fiscal', 'consultoria'],
    norms: [
      'Pregunta el tipo de servicio (fiscal, laboral, contable, autónomos) y si es autónomo o empresa.',
      'Menciona si dan servicio online si está configurado; para altas, registra el lead.',
      'No des asesoramiento fiscal/laboral concreto por teléfono: lo hace el asesor.',
    ],
    metricChecks: [
      { key: 'service_captured', label: '¿Capturó el tipo de servicio (fiscal, laboral…)?' },
      { key: 'profile_captured', label: '¿Aclaró si es autónomo o empresa?' },
    ],
  },
  // ── Viajes / hogar / inmobiliario ────────────────────────────
  agencia_viajes: {
    slug: 'agencia_viajes', label: 'Agencia de viajes',
    aliases: ['viajes', 'agencia_de_viajes'],
    norms: [
      'Pregunta el destino (o tipo de viaje), las fechas aproximadas y el número de viajeros.',
      'Sondea presupuesto orientativo y preferencias (todo incluido, vuelo+hotel) para orientar; registra el lead con estos datos.',
      'No cierres precios ni disponibilidad por teléfono si no los tienes: el agente prepara la propuesta.',
    ],
    metricChecks: [
      { key: 'destination_dates', label: '¿Capturó destino y fechas aproximadas?' },
      { key: 'travellers_captured', label: '¿Capturó el número de viajeros?' },
    ],
  },
  reformas: {
    slug: 'reformas', label: 'Reformas',
    aliases: ['reforma', 'construccion', 'obras'],
    norms: [
      'Pregunta qué tipo de obra/reforma quiere (cocina, baño, integral, local) y dónde (piso/local, población).',
      'Explica que para presupuestar suele hacer falta una visita; registra el lead con estos datos.',
      'No des precios cerrados por teléfono: dependen de la visita y los materiales.',
    ],
    metricChecks: [
      { key: 'work_type_captured', label: '¿Capturó el tipo de obra y ubicación?' },
      { key: 'visit_offered',      label: '¿Encaminó a visita/presupuesto sin cerrar precio?' },
    ],
  },
  arquitectura: {
    slug: 'arquitectura', label: 'Arquitectura',
    aliases: ['arquitecto', 'estudio_arquitectura', 'aparejador'],
    norms: [
      'Pregunta el tipo de proyecto (vivienda, reforma, licencia, certificado) y en qué fase está.',
      'Encamina a una reunión o visita de valoración; registra el lead con el proyecto.',
      'No des presupuestos ni plazos cerrados por teléfono.',
    ],
    metricChecks: [
      { key: 'project_captured', label: '¿Capturó el tipo de proyecto y su fase?' },
      { key: 'meeting_offered',  label: '¿Encaminó a reunión/valoración?' },
    ],
  },
  inmobiliaria: {
    slug: 'inmobiliaria', label: 'Inmobiliaria',
    aliases: ['inmobiliarias', 'agencia_inmobiliaria', 'real_estate'],
    norms: [
      'Aclara si quiere comprar, vender o alquilar, y el tipo de inmueble y la zona.',
      'Para compra/alquiler, sondea presupuesto orientativo; para venta, encamina a una valoración. Registra el lead con estos datos.',
      'No des valoraciones ni precios cerrados por teléfono.',
    ],
    metricChecks: [
      { key: 'operation_captured', label: '¿Aclaró compra/venta/alquiler?' },
      { key: 'property_zone',      label: '¿Capturó tipo de inmueble y zona?' },
    ],
  },
  taller: {
    slug: 'taller', label: 'Taller mecánico',
    aliases: ['mecanico', 'chapa_pintura', 'neumaticos', 'taller_coches'],
    norms: [
      'Pregunta SIEMPRE la matrícula y qué necesita (revisión, ITV, ruido, avería concreta).',
      'Si el coche no arranca o es peligroso conducir, trátalo como urgente y ofrece lo antes posible.',
      'No des diagnósticos mecánicos por teléfono: el mecánico lo valora al ver el coche.',
    ],
    metricChecks: [
      { key: 'plate_captured',   label: '¿Capturó la matrícula?' },
      { key: 'service_captured', label: '¿Capturó qué necesita el vehículo?' },
      { key: 'urgency_triaged',  label: '¿Detectó una urgencia (coche no arranca)?' },
    ],
  },
};

/** Normaliza un slug: minúsculas, sin acentos, guiones bajos. */
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ── Sectores DATO (2026-07-04): la semilla (SECTORS, 32 curados en código) se
// mezcla con sectores CUSTOM cargados en caliente desde BD/otra fuente. Añadir
// o afinar un vertical deja de ser un deploy: es una fila. resolveSector sigue
// siendo SÍNCRONO (lee la caché en memoria) para no romper a sus llamadores.
let _custom = {};        // slug → def (normalizada)
let _index = null;       // alias/slug (normalizado) → slug canónico

function _all() { return { ...SECTORS, ..._custom }; }
function _buildIndex() {
  const idx = {};
  for (const s of Object.values(_all())) {
    idx[_norm(s.slug)] = s.slug;
    for (const a of s.aliases || []) if (!idx[_norm(a)]) idx[_norm(a)] = s.slug;
  }
  return idx;
}
function _getIndex() { return _index || (_index = _buildIndex()); }

/**
 * Normaliza un candidato a sector (venga de un LLM o de la BD) a la forma
 * canónica y segura. Descarta lo mal formado; nunca confía a ciegas.
 * @returns {object|null}
 */
function normalizeSectorDef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slug = _norm(raw.slug || raw.label);
  if (!slug) return null;
  const label = String(raw.label || slug).trim().slice(0, 60);
  const aliases = Array.from(new Set((Array.isArray(raw.aliases) ? raw.aliases : [])
    .map(a => _norm(a)).filter(a => a && a !== slug))).slice(0, 12);
  const norms = (Array.isArray(raw.norms) ? raw.norms : [])
    .map(n => String(n || '').trim()).filter(Boolean).slice(0, 6);
  const seenKeys = new Set();
  const metricChecks = (Array.isArray(raw.metricChecks) ? raw.metricChecks : [])
    .map(m => ({ key: _norm(m && m.key || m && m.label), label: String(m && m.label || '').trim() }))
    .filter(m => m.key && m.label && !seenKeys.has(m.key) && seenKeys.add(m.key)).slice(0, 5);
  if (!norms.length || !metricChecks.length) return null; // un sector sin normas ni métricas no aporta
  const requiredFields = Array.isArray(raw.requiredFields) ? raw.requiredFields : [];
  const def = { slug, label, aliases, norms, metricChecks, requiredFields, custom: true };
  if (raw.defaultMode === 'citas' || raw.defaultMode === 'contacto') def.defaultMode = raw.defaultMode;
  return def;
}

/**
 * Resuelve un slug de sector (o alias) a su entrada canónica. Lo desconocido
 * cae a GENERICO — nunca null. Incluye requiredFields (custom del propio def o,
 * si no, de sector-fields.js para los de semilla).
 */
function resolveSector(slug) {
  const all = _all();
  const key = _getIndex()[_norm(slug)];
  const base = (key && all[key]) || GENERICO;
  const req = (base.requiredFields && base.requiredFields.length)
    ? base.requiredFields
    : (SECTOR_REQUIRED_FIELDS[base.slug] || []);
  return { ...base, requiredFields: req };
}

/** ¿Tiene este sector normas/métricas propias (no cae a genérico)? */
function isCurated(slug) {
  return resolveSector(slug).slug !== 'generico';
}

// Sectores que por defecto NO agendan cita: informan y captan el lead para que
// el equipo llame (presupuestos, servicios a medida). El resto agenda ('citas').
const CONTACTO_SECTORS = new Set([
  'abogados', 'notaria', 'asesoria', 'reformas', 'arquitectura',
  'agencia_viajes', 'inmobiliaria',
]);

/**
 * Modo por defecto sugerido para un sector al dar de alta: 'citas' (agenda) o
 * 'contacto' (informa + capta lead). El dueño puede cambiarlo. Un sector custom
 * puede declarar su propio defaultMode; si no, se infiere.
 */
function defaultModeFor(slug) {
  const s = resolveSector(slug);
  if (s.defaultMode === 'citas' || s.defaultMode === 'contacto') return s.defaultMode;
  if (s.slug === 'generico') return 'contacto'; // negocio desconocido: no ofrezcas agenda a ciegas
  return CONTACTO_SECTORS.has(s.slug) ? 'contacto' : 'citas';
}

/**
 * Carga sectores CUSTOM (de BD) en la caché. Reemplaza el conjunto custom
 * entero. Los mal formados se descartan. Invalida el índice.
 */
function hydrate(list) {
  _custom = {};
  for (const raw of (Array.isArray(list) ? list : [])) {
    const def = normalizeSectorDef(raw);
    if (def && !SECTORS[def.slug]) _custom[def.slug] = def; // la semilla no se pisa
  }
  _index = null;
  return Object.keys(_custom).length;
}

/**
 * Alta/edición de UN sector custom en caliente (tras aprobación del fundador).
 * Devuelve la def normalizada (para persistirla) o null si no es válida.
 * No pisa un sector de la semilla.
 */
function upsertSector(raw) {
  const def = normalizeSectorDef(raw);
  if (!def || SECTORS[def.slug]) return null;
  _custom[def.slug] = def;
  _index = null;
  return def;
}

/** Lista completa (semilla + custom) para el selector/onboarding. */
function allSectors() {
  return Object.values(_all())
    .map(s => ({ slug: s.slug, label: s.label, aliases: s.aliases || [], custom: !!s.custom }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

module.exports = {
  resolveSector, isCurated, defaultModeFor, normalizeSectorDef, hydrate, upsertSector, allSectors,
  SECTORS, GENERICO,
};
