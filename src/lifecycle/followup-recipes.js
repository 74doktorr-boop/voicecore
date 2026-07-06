// ============================================================
// NodeFlow — Recetario de seguimientos (2026-07-06)
// ------------------------------------------------------------
// Ideas CURADAS de seguimiento que el dueño añade con un clic desde
// la pestaña Reglas. No son los defaults del sector (esos ya vienen
// activos) ni las sugerencias de datos (esas nacen de SU histórico):
// esto es el "menú de ideas" — mejores prácticas del sector con el
// consejo de por qué funcionan.
//
// Cada receta usa SOLO triggers de reglas personalizadas
// (from_last_appointment / from_last_if_no_new), así "+ Añadir" crea
// una regla custom normal que el dueño revisa y guarda. Determinista,
// sin LLM: el copy es fijo y editable por el dueño.
// ============================================================
'use strict';

// Recetas universales: funcionan en cualquier negocio con citas.
const UNIVERSAL = [
  {
    id: 'u_segunda_visita',
    label: 'Asegurar la segunda visita',
    serviceLabel: 'tu segunda visita',
    trigger: 'from_last_if_no_new', days: 15,
    tip: 'El cliente que repite en el primer mes se queda años. Un toque suave a los 15 días de la primera visita duplica la probabilidad de que vuelva.',
  },
  {
    id: 'u_rescate_60',
    label: 'Rescate del cliente dormido',
    serviceLabel: 'tu próxima visita',
    trigger: 'from_last_if_no_new', days: 60,
    tip: 'Recuperar a un cliente que ya te conoce cuesta 5 veces menos que captar uno nuevo. A los 60 días sin volver todavía te recuerda con cariño; a los 6 meses ya es un desconocido.',
  },
  {
    id: 'u_gracias_24h',
    label: 'Agradecimiento tras la visita',
    serviceLabel: 'tu última visita',
    trigger: 'from_last_appointment', days: 2,
    tip: 'Un "gracias por venir, ¿todo bien?" a los 2 días convierte clientes en fans — y es el mejor momento para pedir una reseña en Google.',
  },
];

// Recetas específicas por sector (2-3 por sector; las mejores prácticas).
const BY_SECTOR = {
  peluqueria: [
    { id: 'p_pack_color', label: 'Aviso de raíces', serviceLabel: 'retocar el color', trigger: 'from_last_appointment', days: 21, serviceFilter: ['color', 'tinte', 'mechas'],
      tip: 'Las raíces asoman a las 3 semanas. Avisar justo entonces — antes de que se las vea ella — es el recordatorio mejor recibido de todo el sector.' },
    { id: 'p_evento', label: 'Antes de las fiestas del pueblo', serviceLabel: 'tu cita antes de las fiestas', trigger: 'from_last_if_no_new', days: 50,
      tip: 'Adapta los días para que caiga ~1 semana antes del evento fuerte de tu zona (fiestas, bodas de temporada). La agenda se llena sola.' },
  ],
  dental: [
    { id: 'd_presupuesto', label: 'Presupuesto sin decidir', serviceLabel: 'el presupuesto que te preparamos', trigger: 'from_last_if_no_new', days: 7, serviceFilter: ['presupuesto', 'valoración', 'valoracion'],
      tip: 'La mitad de los presupuestos se pierden por no hacer seguimiento. A la semana, un "¿alguna duda con el presupuesto?" recupera tratamientos enteros.' },
    { id: 'd_blanqueamiento', label: 'Retoque de blanqueamiento', serviceLabel: 'el retoque de tu blanqueamiento', trigger: 'from_last_appointment', days: 180, serviceFilter: ['blanqueamiento'],
      tip: 'El blanqueamiento pierde efecto a los 6 meses. El aviso de retoque es venta casi segura: ya pagaron una vez por ese resultado.' },
  ],
  taller: [
    { id: 't_neumaticos', label: 'Revisión de neumáticos', serviceLabel: 'la revisión de neumáticos', trigger: 'from_last_appointment', days: 180, serviceFilter: ['neumático', 'neumatico', 'rueda'],
      tip: 'Quien cambió 2 ruedas vuelve por las otras 2 a los ~6 meses. Si no se lo recuerdas tú, se las lleva la cadena de turno.' },
    { id: 't_pre_itv', label: 'Pre-ITV', serviceLabel: 'la revisión pre-ITV', trigger: 'from_last_if_no_new', days: 300,
      tip: 'Ofrecer "te lo dejamos listo para pasar la ITV a la primera" convierte un trámite temido en un servicio que se agradece (y se paga).' },
  ],
  estetica_avanzada: [
    { id: 'e_bono_fin', label: 'Última sesión del bono', serviceLabel: 'renovar tu bono', trigger: 'from_last_appointment', days: 25, serviceFilter: ['bono', 'sesión', 'sesion'],
      tip: 'El mejor momento para renovar un bono es antes de que se acabe, con el resultado a la vista. Después, el 40% no vuelve.' },
  ],
  veterinaria: [
    { id: 'v_cachorro', label: 'Revisión del cachorro', serviceLabel: 'la siguiente revisión de tu cachorro', trigger: 'from_last_appointment', days: 30, serviceFilter: ['cachorro', 'vacuna'],
      tip: 'Los cachorros necesitan varias visitas el primer año. Quien las hace todas contigo es cliente para toda la vida del animal.' },
  ],
  fisioterapia: [
    { id: 'f_pack_fin', label: 'Fin del ciclo de sesiones', serviceLabel: 'valorar cómo va tu recuperación', trigger: 'from_last_if_no_new', days: 21,
      tip: 'El paciente que se "encuentra mejor" y deja de venir recae en semanas. Una llamada de control a los 21 días retiene el alta médica de verdad — y el tratamiento completo.' },
  ],
  gimnasio: [
    { id: 'g_enero', label: 'El que vino 2 veces y desapareció', serviceLabel: 'retomar tu entrenamiento', trigger: 'from_last_if_no_new', days: 10,
      tip: 'El 80% de las bajas se veían venir: dejaron de ir 2 semanas antes de darse de baja. A los 10 días sin pisar el gym, un mensaje personal salva la cuota.' },
  ],
  clinica: [
    { id: 'c_analitica', label: 'Resultados y siguiente paso', serviceLabel: 'comentar tus resultados', trigger: 'from_last_appointment', days: 10, serviceFilter: ['analítica', 'analitica', 'prueba'],
      tip: 'Tras una prueba, el paciente espera que alguien le diga "todo bien" o "ven". Si nadie llama, se va a otro centro la próxima vez.' },
  ],
  restaurante: [
    { id: 'r_grupo', label: 'El que reservó para grupo', serviceLabel: 'tu próxima comida de grupo', trigger: 'from_last_appointment', days: 330, serviceFilter: ['grupo', 'celebración', 'celebracion'],
      tip: 'Quien celebró un cumpleaños o comida de empresa contigo repite al año siguiente… si te recuerda. Escríbele un mes antes del aniversario.' },
  ],
  inmobiliaria: [
    { id: 'i_valoracion', label: 'Valoración sin decidir', serviceLabel: 'la valoración de tu inmueble', trigger: 'from_last_if_no_new', days: 14,
      tip: 'Quien pidió valorar su piso está decidiendo agencia. A las 2 semanas, un toque con "¿resolvemos dudas?" gana mandatos que se lleva la competencia por silencio.' },
  ],
  abogados: [
    { id: 'a_documentacion', label: 'Pendiente de traer documentación', serviceLabel: 'la documentación de tu caso', trigger: 'from_last_if_no_new', days: 5,
      tip: 'El expediente que no arranca por papeles pendientes se enfría y el cliente se pierde. Recordárselo a los 5 días mantiene el caso vivo.' },
  ],
  asesoria: [
    { id: 'as_cierre_trimestre', label: 'Antes del cierre de trimestre', serviceLabel: 'preparar tu cierre de trimestre', trigger: 'from_last_appointment', days: 75,
      tip: 'Contactar 2 semanas antes de cada cierre (abril, julio, octubre, enero) evita las prisas de última hora — y te posiciona como el asesor que se adelanta.' },
  ],
  autoescuela: [
    { id: 'au_teorico_aprobado', label: 'Teórico aprobado, prácticas sin empezar', serviceLabel: 'tus clases prácticas', trigger: 'from_last_if_no_new', days: 10,
      tip: 'El alumno que aprueba el teórico y no agenda prácticas en 2 semanas se enfría (y el teórico caduca). Es tu alumno más fácil de reactivar.' },
  ],
  optica: [
    { id: 'o_segundas_gafas', label: 'Segundas gafas / sol graduadas', serviceLabel: 'tus segundas gafas', trigger: 'from_last_appointment', days: 45, serviceFilter: ['gafas', 'graduación', 'graduacion'],
      tip: 'A los 45 días de estrenar gafas, ofrecer las de sol graduadas con su misma graduación es la venta cruzada más natural de la óptica.' },
  ],
  psicologia: [
    { id: 'ps_pausa', label: 'Pausa terapéutica', serviceLabel: 'una sesión de seguimiento', trigger: 'from_last_if_no_new', days: 45,
      tip: 'Tras el alta o una pausa, una sesión de seguimiento a los 45 días consolida el trabajo hecho — y muchos pacientes la agradecen más que ninguna.' },
  ],
};

/**
 * Recetas aplicables a un sector, excluyendo las que ya existen como regla
 * (por etiqueta, para no ofrecer duplicados). PURA.
 * @param {string} sectorSlug
 * @param {Array<string>} existingLabels  etiquetas de reglas actuales (default+custom)
 */
function getRecipes(sectorSlug, existingLabels = []) {
  const have = new Set((existingLabels || []).map(l => String(l || '').trim().toLowerCase()).filter(Boolean));
  const all = [...(BY_SECTOR[sectorSlug] || []), ...UNIVERSAL];
  return all.filter(r => !have.has(r.label.toLowerCase()));
}

module.exports = { getRecipes, UNIVERSAL, BY_SECTOR };
