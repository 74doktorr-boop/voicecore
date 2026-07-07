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

// Recetas específicas por sector (3-4 por sector, los 33 cubiertos —
// ampliado 2026-07-07 a petición de Unai). serviceFilter = palabras que
// ligan la idea a un servicio del negocio: si no lo ofrece, no la ve.
const BY_SECTOR = {
  peluqueria: [
    { id: 'p_pack_color', label: 'Aviso de raíces', serviceLabel: 'retocar el color', trigger: 'from_last_appointment', days: 21, serviceFilter: ['color', 'tinte', 'mechas'],
      tip: 'Las raíces asoman a las 3 semanas. Avisar justo entonces — antes de que se las vea ella — es el recordatorio mejor recibido de todo el sector.' },
    { id: 'p_evento', label: 'Antes de las fiestas del pueblo', serviceLabel: 'tu cita antes de las fiestas', trigger: 'from_last_if_no_new', days: 50,
      tip: 'Adapta los días para que caiga ~1 semana antes del evento fuerte de tu zona (fiestas, bodas de temporada). La agenda se llena sola.' },
    { id: 'p_novia', label: 'Prueba de peinado de eventos', serviceLabel: 'la prueba de tu peinado', trigger: 'from_last_appointment', days: 300, serviceFilter: ['novia', 'evento', 'recogido', 'boda'],
      tip: 'Quien vino para una boda o evento vuelve a tener eventos cada año. Un "¿este año también te ponemos guapa?" al aniversario trae los servicios más caros.' },
    { id: 'p_barba', label: 'Mantenimiento de barba', serviceLabel: 'perfilar la barba', trigger: 'from_last_appointment', days: 15, serviceFilter: ['barba', 'arreglo', 'afeitado'],
      tip: 'La barba pide perfilado cada 2-3 semanas, más a menudo que el corte. Es la visita puente que duplica la frecuencia del cliente masculino.' },
  ],
  taller: [
    { id: 't_neumaticos', label: 'Revisión de neumáticos', serviceLabel: 'la revisión de neumáticos', trigger: 'from_last_appointment', days: 180, serviceFilter: ['neumático', 'neumatico', 'rueda'],
      tip: 'Quien cambió 2 ruedas vuelve por las otras 2 a los ~6 meses. Si no se lo recuerdas tú, se las lleva la cadena de turno.' },
    { id: 't_pre_itv', label: 'Pre-ITV', serviceLabel: 'la revisión pre-ITV', trigger: 'from_last_if_no_new', days: 300,
      tip: 'Ofrecer "te lo dejamos listo para pasar la ITV a la primera" convierte un trámite temido en un servicio que se agradece (y se paga).' },
    { id: 't_frenos', label: 'Frenos tras pastillas nuevas', serviceLabel: 'revisar los discos de freno', trigger: 'from_last_appointment', days: 365, serviceFilter: ['freno', 'pastilla'],
      tip: 'Pastillas nuevas hoy = discos a revisar al año. El cliente no lleva esa cuenta; el taller que se la lleva se queda el coche entero.' },
    { id: 't_km_verano', label: 'Puesta a punto antes del viaje', serviceLabel: 'la puesta a punto para el viaje', trigger: 'from_last_if_no_new', days: 150,
      tip: 'Ajusta los días para que caiga en junio o antes de Semana Santa: "revisión de niveles, ruedas y frenos antes de la operación salida" se vende sola.' },
  ],
  dental: [
    { id: 'd_presupuesto', label: 'Presupuesto sin decidir', serviceLabel: 'el presupuesto que te preparamos', trigger: 'from_last_if_no_new', days: 7, serviceFilter: ['presupuesto', 'valoración', 'valoracion'],
      tip: 'La mitad de los presupuestos se pierden por no hacer seguimiento. A la semana, un "¿alguna duda con el presupuesto?" recupera tratamientos enteros.' },
    { id: 'd_blanqueamiento', label: 'Retoque de blanqueamiento', serviceLabel: 'el retoque de tu blanqueamiento', trigger: 'from_last_appointment', days: 180, serviceFilter: ['blanqueamiento'],
      tip: 'El blanqueamiento pierde efecto a los 6 meses. El aviso de retoque es venta casi segura: ya pagaron una vez por ese resultado.' },
    { id: 'd_ferula', label: 'Revisión de férula de descarga', serviceLabel: 'revisar tu férula', trigger: 'from_last_appointment', days: 365, serviceFilter: ['férula', 'ferula', 'bruxismo'],
      tip: 'La férula se desgasta y pierde ajuste al año. Revisarla a tiempo evita que el paciente deje de usarla — y abre la puerta a renovarla.' },
    { id: 'd_niños_vuelta_cole', label: 'Revisión infantil en septiembre', serviceLabel: 'la revisión de los peques', trigger: 'from_last_appointment', days: 350, serviceFilter: ['infantil', 'niño', 'nino', 'odontopediatría', 'odontopediatria'],
      tip: 'La revisión de los niños se agenda sola si el aviso llega con la vuelta al cole. Los padres lo agradecen: un recordatorio menos en su cabeza.' },
  ],
  estetica_avanzada: [
    { id: 'e_bono_fin', label: 'Última sesión del bono', serviceLabel: 'renovar tu bono', trigger: 'from_last_appointment', days: 25, serviceFilter: ['bono', 'sesión', 'sesion'],
      tip: 'El mejor momento para renovar un bono es antes de que se acabe, con el resultado a la vista. Después, el 40% no vuelve.' },
    { id: 'e_radiofrec', label: 'Mantenimiento de radiofrecuencia', serviceLabel: 'tu sesión de mantenimiento', trigger: 'from_last_appointment', days: 40, serviceFilter: ['radiofrecuencia', 'reafirmante', 'facial'],
      tip: 'Los tratamientos reafirmantes piden mantenimiento cada 4-6 semanas para sostener el resultado. Sin aviso, la clienta "lo deja para el mes que viene" para siempre.' },
    { id: 'e_pre_verano', label: 'Operación pre-verano', serviceLabel: 'tu puesta a punto antes del verano', trigger: 'from_last_if_no_new', days: 120,
      tip: 'Ajusta los días para que el aviso caiga en abril-mayo: la demanda de mayo-junio se reserva un mes antes, y quien reserva contigo ya no mira más.' },
  ],
  veterinaria: [
    { id: 'v_cachorro', label: 'Revisión del cachorro', serviceLabel: 'la siguiente revisión de tu cachorro', trigger: 'from_last_appointment', days: 30, serviceFilter: ['cachorro', 'vacuna'],
      tip: 'Los cachorros necesitan varias visitas el primer año. Quien las hace todas contigo es cliente para toda la vida del animal.' },
    { id: 'v_senior', label: 'Chequeo del paciente senior', serviceLabel: 'el chequeo geriátrico', trigger: 'from_last_appointment', days: 180, serviceFilter: ['senior', 'geriátrico', 'geriatrico', 'chequeo', 'analítica', 'analitica'],
      tip: 'A partir de los 7-8 años, el chequeo pasa de anual a semestral. Proponerlo tú marca la diferencia entre "veterinario" y "el veterinario de confianza".' },
    { id: 'v_dental_mascota', label: 'Limpieza dental de la mascota', serviceLabel: 'la limpieza dental de tu mascota', trigger: 'from_last_appointment', days: 365, serviceFilter: ['dental', 'limpieza', 'boca'],
      tip: 'La salud bucal es el servicio más infrautilizado en veterinaria: casi nadie la pide, casi todos la necesitan. El aviso anual educa y llena agenda.' },
  ],
  fisioterapia: [
    { id: 'f_pack_fin', label: 'Fin del ciclo de sesiones', serviceLabel: 'valorar cómo va tu recuperación', trigger: 'from_last_if_no_new', days: 21,
      tip: 'El paciente que se "encuentra mejor" y deja de venir recae en semanas. Una llamada de control a los 21 días retiene el alta médica de verdad — y el tratamiento completo.' },
    { id: 'f_deportista', label: 'Descarga mensual del deportista', serviceLabel: 'tu descarga muscular', trigger: 'from_last_appointment', days: 30, serviceFilter: ['descarga', 'deportiva', 'deporte', 'masaje'],
      tip: 'El que entrena fuerte necesita descarga cada 4-6 semanas. Convertir al lesionado puntual en abonado mensual es la mejor economía de la clínica.' },
    { id: 'f_espalda_oficina', label: 'Revisión postural semestral', serviceLabel: 'tu revisión postural', trigger: 'from_last_if_no_new', days: 180,
      tip: 'El dolor de espalda de oficina siempre vuelve. Un "¿cómo va esa espalda?" a los 6 meses llega justo cuando empieza a molestar otra vez.' },
  ],
  gimnasio: [
    { id: 'g_enero', label: 'El que vino 2 veces y desapareció', serviceLabel: 'retomar tu entrenamiento', trigger: 'from_last_if_no_new', days: 10,
      tip: 'El 80% de las bajas se veían venir: dejaron de ir 2 semanas antes de darse de baja. A los 10 días sin pisar el gym, un mensaje personal salva la cuota.' },
    { id: 'g_pt_prueba', label: 'Tras la sesión de prueba con entrenador', serviceLabel: 'tu plan de entrenamiento personal', trigger: 'from_last_appointment', days: 3, serviceFilter: ['personal', 'entrenador', 'pt'],
      tip: 'La sesión de prueba se convierte en bono si el seguimiento llega en 72h, con la motivación aún caliente. A la semana ya se enfrió.' },
    { id: 'g_objetivo_90', label: 'Revisión de objetivos a los 3 meses', serviceLabel: 'revisar tus objetivos', trigger: 'from_last_appointment', days: 90,
      tip: 'Quien ve progreso medido se queda. Una revisión de objetivos trimestral (peso, marcas, fotos) es la mejor herramienta anti-baja que existe.' },
  ],
  clinica: [
    { id: 'c_analitica', label: 'Resultados y siguiente paso', serviceLabel: 'comentar tus resultados', trigger: 'from_last_appointment', days: 10, serviceFilter: ['analítica', 'analitica', 'prueba'],
      tip: 'Tras una prueba, el paciente espera que alguien le diga "todo bien" o "ven". Si nadie llama, se va a otro centro la próxima vez.' },
    { id: 'c_cronico', label: 'Control del paciente crónico', serviceLabel: 'tu control periódico', trigger: 'from_last_appointment', days: 90, serviceFilter: ['control', 'crónico', 'cronico', 'tensión', 'tension'],
      tip: 'El crónico bien seguido no se pierde nunca. Un control trimestral proactivo es mejor medicina y mejor negocio que esperar a que empeore.' },
    { id: 'c_certificado_deportivo', label: 'Renovación de certificado deportivo', serviceLabel: 'renovar tu certificado', trigger: 'from_last_appointment', days: 350, serviceFilter: ['certificado', 'deportivo', 'federado'],
      tip: 'Los certificados deportivos caducan al año, justo antes de la temporada. El aviso llega cuando el club se lo está pidiendo — cita asegurada.' },
  ],
  reconocimientos: [
    { id: 'rec_acompanante', label: 'El acompañante también conduce', serviceLabel: 'tu renovación', trigger: 'from_last_appointment', days: 30,
      tip: 'Quien vino a renovar suele venir acompañado de alguien que también conduce. Un "si alguien de casa tiene el carnet a punto de caducar, tráelo" multiplica cada visita.' },
    { id: 'rec_arma_nautico', label: 'Otros permisos (armas, náutico)', serviceLabel: 'renovar tu otro permiso', trigger: 'from_last_appointment', days: 340, serviceFilter: ['arma', 'náutico', 'nautico', 'seguridad'],
      tip: 'El del carnet de conducir a veces también tiene licencia de armas o náutica. Preguntarlo una vez = renovaciones recurrentes para siempre.' },
    { id: 'rec_empresa', label: 'Reconocimientos de empresa', serviceLabel: 'los reconocimientos de tu plantilla', trigger: 'from_last_appointment', days: 350, serviceFilter: ['empresa', 'laboral'],
      tip: 'Una empresa con reconocimientos anuales vale por 50 clientes particulares. El aviso anual al responsable de RRHH renueva el contrato solo.' },
  ],
  podologia: [
    { id: 'pod_diabetico', label: 'Pie diabético — control trimestral', serviceLabel: 'tu control de pie diabético', trigger: 'from_last_appointment', days: 90, serviceFilter: ['diabético', 'diabetico'],
      tip: 'El paciente diabético necesita control cada 3 meses sí o sí. Es el seguimiento más importante clínicamente — y el más fiel.' },
    { id: 'pod_plantillas', label: 'Revisión de plantillas', serviceLabel: 'revisar tus plantillas', trigger: 'from_last_appointment', days: 365, serviceFilter: ['plantilla', 'estudio', 'pisada'],
      tip: 'Las plantillas pierden corrección al año (y los pies de los niños cambian antes). La revisión anual detecta el recambio a tiempo.' },
    { id: 'pod_runner', label: 'El corredor antes de su carrera', serviceLabel: 'tu puesta a punto de corredor', trigger: 'from_last_if_no_new', days: 120,
      tip: 'Ajusta los días para que caiga ~1 mes antes de la carrera popular de tu zona (Behobia, maratón local): uñas, durezas y pisada a punto.' },
  ],
  farmacia: [
    { id: 'far_spd', label: 'Recarga del pastillero (SPD)', serviceLabel: 'la recarga de tu pastillero', trigger: 'from_last_appointment', days: 28, serviceFilter: ['spd', 'pastillero', 'dosificación', 'dosificacion'],
      tip: 'El servicio de dosificación personalizada se renueva cada 4 semanas exactas. El aviso puntual fideliza al paciente (y a su familia) de por vida.' },
    { id: 'far_tension', label: 'Control de tensión mensual', serviceLabel: 'tu control de tensión', trigger: 'from_last_appointment', days: 30, serviceFilter: ['tensión', 'tension', 'presión', 'presion'],
      tip: 'Quien se toma la tensión contigo cada mes compra en tu farmacia todo lo demás. El control periódico es el ancla de la fidelidad.' },
    { id: 'far_dermo', label: 'Rutina dermo: reposición', serviceLabel: 'reponer tu tratamiento', trigger: 'from_last_appointment', days: 45, serviceFilter: ['dermo', 'crema', 'cosmética', 'cosmetica'],
      tip: 'Un tratamiento facial dura 6-8 semanas. Avisar de la reposición antes de que se acabe evita que lo compre online — y mantiene la rutina que le funciona.' },
  ],
  laser: [
    { id: 'las_zona_nueva', label: 'Una zona más', serviceLabel: 'empezar una zona nueva', trigger: 'from_last_appointment', days: 60,
      tip: 'La clienta contenta con las axilas se anima con las piernas. Proponer la segunda zona a los 2 meses, con resultados visibles, es la venta más fácil del centro.' },
    { id: 'las_repaso_anual', label: 'Repaso anual post-tratamiento', serviceLabel: 'tu repaso anual', trigger: 'from_last_if_no_new', days: 330,
      tip: 'Terminado el tratamiento, siempre quedan folículos rebeldes al año. El repaso anual mantiene el resultado perfecto — y a la clienta en tu fichero.' },
    { id: 'las_pre_verano', label: 'Empezar en otoño para lucir en verano', serviceLabel: 'empezar tu tratamiento', trigger: 'from_last_if_no_new', days: 90,
      tip: 'El láser necesita 6-8 sesiones: quien empieza en octubre luce en junio. Ese argumento en el aviso de otoño llena las semanas flojas del año.' },
  ],
  spa: [
    { id: 'spa_regalo_recibido', label: 'El que vino con tarjeta regalo', serviceLabel: 'tu próxima escapada de relax', trigger: 'from_last_if_no_new', days: 45,
      tip: 'Quien vino con un bono regalo no es cliente todavía — es un invitado. El seguimiento a los 45 días con una oferta suya lo convierte en cliente propio.' },
    { id: 'spa_pareja', label: 'Aniversario del circuito en pareja', serviceLabel: 'vuestro circuito en pareja', trigger: 'from_last_appointment', days: 330, serviceFilter: ['pareja', 'circuito', 'romántico', 'romantico'],
      tip: 'El circuito en pareja casi siempre celebra algo (aniversario, San Valentín). Escribir un mes antes de que se cumpla el año repite la ocasión — y la venta.' },
    { id: 'spa_ritual_estacion', label: 'Ritual de cambio de estación', serviceLabel: 'tu ritual de temporada', trigger: 'from_last_if_no_new', days: 90,
      tip: 'Cada cambio de estación es una excusa de cuidado (hidratación en invierno, exfoliación en verano). Un aviso trimestral con el ritual del momento mantiene el hábito.' },
  ],
  yoga: [
    { id: 'yog_prueba', label: 'Tras la clase de prueba', serviceLabel: 'tu siguiente clase', trigger: 'from_last_if_no_new', days: 4,
      tip: 'La clase de prueba caduca en la cabeza en una semana. Un mensaje a los 4 días ("¿qué te pareció? esta semana tienes X y Y") convierte pruebas en matrículas.' },
    { id: 'yog_retiro', label: 'Interesados en el próximo retiro', serviceLabel: 'el próximo retiro', trigger: 'from_last_appointment', days: 120, serviceFilter: ['retiro', 'taller', 'intensivo'],
      tip: 'Quien fue a un retiro o taller repite si se entera a tiempo. Avísale con 2 meses de antelación, antes de anunciarlo en redes: se sienten VIP y llenan plazas.' },
    { id: 'yog_lesion_estres', label: 'El que vino por estrés', serviceLabel: 'retomar tu práctica', trigger: 'from_last_if_no_new', days: 30,
      tip: 'Quien llegó "por estrés" y lo deja, sigue estresado. Un mensaje amable al mes ("tu esterilla te echa de menos") reactiva sin presionar.' },
  ],
  pilates: [
    { id: 'pil_valoracion', label: 'Revaloración postural', serviceLabel: 'tu revaloración postural', trigger: 'from_last_appointment', days: 90,
      tip: 'Medir el progreso cada 3 meses (foto postural, movilidad) demuestra el valor de lo invisible. El alumno que VE su mejora no se borra.' },
    { id: 'pil_embarazo', label: 'Post-parto: vuelta progresiva', serviceLabel: 'tu vuelta post-parto', trigger: 'from_last_if_no_new', days: 100, serviceFilter: ['embarazo', 'prenatal', 'postparto', 'post-parto'],
      tip: 'La alumna de pilates prenatal es tu mejor candidata al post-parto ~3 meses después. Nadie más tiene ese dato: úsalo con cariño.' },
    { id: 'pil_maquina_suelo', label: 'Del suelo a la máquina', serviceLabel: 'probar la clase de máquina', trigger: 'from_last_appointment', days: 60, serviceFilter: ['máquina', 'maquina', 'reformer'],
      tip: 'El alumno de suelo que prueba el reformer casi siempre se queda (y la clase vale más). Invitarle a los 2 meses, con técnica ya asentada, es el momento.' },
  ],
  psicologia: [
    { id: 'ps_pausa', label: 'Pausa terapéutica', serviceLabel: 'una sesión de seguimiento', trigger: 'from_last_if_no_new', days: 45,
      tip: 'Tras el alta o una pausa, una sesión de seguimiento a los 45 días consolida el trabajo hecho — y muchos pacientes la agradecen más que ninguna.' },
    { id: 'ps_primera_sin_segunda', label: 'Primera sesión sin continuidad', serviceLabel: 'tu segunda sesión', trigger: 'from_last_if_no_new', days: 12,
      tip: 'Dar el paso de ir UNA vez costó meses; volver cuesta un empujón. Un mensaje cálido a los 12 días ("aquí estamos cuando quieras seguir") rescata procesos enteros.' },
    { id: 'ps_pareja_revision', label: 'Revisión de terapia de pareja', serviceLabel: 'vuestra sesión de revisión', trigger: 'from_last_if_no_new', days: 60, serviceFilter: ['pareja'],
      tip: 'Las parejas que terminan bien agradecen una revisión a los 2 meses: mantiene las herramientas vivas y previene la recaída en viejos patrones.' },
  ],
  nutricion: [
    { id: 'nut_abandono_3sem', label: 'La semana 3 — el muro', serviceLabel: 'tu sesión de refuerzo', trigger: 'from_last_if_no_new', days: 18,
      tip: 'La semana 3 es donde se abandona toda dieta: la novedad pasó y el resultado aún no llegó. Un refuerzo justo ahí salva más planes que ninguna consulta.' },
    { id: 'nut_analitica_control', label: 'Analítica de control a los 3 meses', serviceLabel: 'tu analítica de control', trigger: 'from_last_appointment', days: 90, serviceFilter: ['analítica', 'analitica', 'colesterol'],
      tip: 'Quien empezó por colesterol/glucosa necesita ver la mejora EN NÚMEROS. La analítica trimestral cierra el círculo y renueva el plan.' },
    { id: 'nut_navidades', label: 'Plan de rescate post-fiestas', serviceLabel: 'tu plan de vuelta', trigger: 'from_last_if_no_new', days: 75,
      tip: 'Ajusta los días para caer el 7-10 de enero (o después de fiestas locales): es el día del año con más motivación por metro cuadrado.' },
  ],
  optica: [
    { id: 'o_segundas_gafas', label: 'Segundas gafas / sol graduadas', serviceLabel: 'tus segundas gafas', trigger: 'from_last_appointment', days: 45, serviceFilter: ['gafas', 'graduación', 'graduacion'],
      tip: 'A los 45 días de estrenar gafas, ofrecer las de sol graduadas con su misma graduación es la venta cruzada más natural de la óptica.' },
    { id: 'o_ninos_curso', label: 'Revisión infantil antes del curso', serviceLabel: 'la revisión visual de los peques', trigger: 'from_last_appointment', days: 350, serviceFilter: ['infantil', 'niño', 'nino'],
      tip: 'La vista de los niños cambia cada curso y nadie se acuerda hasta que suspenden. El aviso de agosto-septiembre es un clásico que funciona siempre.' },
    { id: 'o_audio', label: 'Revisión auditiva al de gafas', serviceLabel: 'tu revisión auditiva', trigger: 'from_last_appointment', days: 200, serviceFilter: ['audio', 'audífono', 'audifono', 'auditiva'],
      tip: 'Tu cliente de gafas +55 es candidato natural a revisión auditiva gratuita. Es el puente entre secciones que más factura genera por aviso.' },
  ],
  hotel: [
    { id: 'h_puente_proximo', label: 'El huésped del puente', serviceLabel: 'tu próxima escapada', trigger: 'from_last_appointment', days: 90,
      tip: 'Quien vino en un puente viaja en todos los puentes. Escribirle ~1 mes antes del siguiente con "te guardamos tu habitación" convierte estancias sueltas en costumbre.' },
    { id: 'h_experiencia', label: 'La experiencia que no probó', serviceLabel: 'tu próxima visita con experiencia incluida', trigger: 'from_last_appointment', days: 60, serviceFilter: ['spa', 'cena', 'experiencia', 'masaje'],
      tip: 'El huésped que no probó el spa o la cena degustación tiene una razón concreta para volver. Ofrécesela con nombre y apellido.' },
    { id: 'h_grupo_evento', label: 'El organizador de grupos', serviceLabel: 'vuestra próxima reunión', trigger: 'from_last_appointment', days: 300, serviceFilter: ['grupo', 'evento', 'empresa', 'sala'],
      tip: 'Quien organizó un evento contigo organiza más. El aviso anual al organizador (no al asistente) renueva bloques enteros de habitaciones.' },
  ],
  academia: [
    { id: 'ac_hermanos', label: '¿Y el hermano?', serviceLabel: 'la plaza para el hermano', trigger: 'from_last_appointment', days: 60,
      tip: 'La mitad de tus alumnos tienen hermanos en edad de apuntarse. Preguntarlo (con un pequeño descuento familiar) es la captación más barata que existe.' },
    { id: 'ac_examen_oficial', label: 'Antes de la convocatoria oficial', serviceLabel: 'preparar tu examen oficial', trigger: 'from_last_if_no_new', days: 100, serviceFilter: ['examen', 'oficial', 'b1', 'b2', 'certificado'],
      tip: 'Ajusta los días para escribir ~2 meses antes de las convocatorias oficiales (Cambridge, EOI): "¿te presentas? te preparamos" llena los intensivos.' },
    { id: 'ac_verano', label: 'Intensivo de verano', serviceLabel: 'el intensivo de verano', trigger: 'from_last_if_no_new', days: 240,
      tip: 'El alumno de invierno es tu candidato natural al intensivo de julio. Avisar en mayo, antes de que la familia planifique el verano, es la clave.' },
  ],
  restaurante: [
    { id: 'r_grupo', label: 'El que reservó para grupo', serviceLabel: 'tu próxima comida de grupo', trigger: 'from_last_appointment', days: 330, serviceFilter: ['grupo', 'celebración', 'celebracion'],
      tip: 'Quien celebró un cumpleaños o comida de empresa contigo repite al año siguiente… si te recuerda. Escríbele un mes antes del aniversario.' },
    { id: 'r_menu_temporada', label: 'Cambio de carta de temporada', serviceLabel: 'probar la nueva carta', trigger: 'from_last_if_no_new', days: 90,
      tip: 'Cada cambio de carta es una excusa legítima para escribir a quien hace 3 meses que no viene: "ya está la carta de otoño, esta semana te guardamos mesa".' },
    { id: 'r_empresa_navidad', label: 'Comidas de empresa (reservar pronto)', serviceLabel: 'vuestra comida de empresa', trigger: 'from_last_appointment', days: 320, serviceFilter: ['empresa', 'grupo', 'navidad'],
      tip: 'Las comidas de Navidad se deciden en octubre. Escribir al organizador del año pasado ANTES de que otro restaurante lo haga asegura el salón lleno.' },
  ],
  abogados: [
    { id: 'a_documentacion', label: 'Pendiente de traer documentación', serviceLabel: 'la documentación de tu caso', trigger: 'from_last_if_no_new', days: 5,
      tip: 'El expediente que no arranca por papeles pendientes se enfría y el cliente se pierde. Recordárselo a los 5 días mantiene el caso vivo.' },
    { id: 'a_revision_contratos', label: 'Revisión anual de contratos', serviceLabel: 'la revisión anual de tus contratos', trigger: 'from_last_appointment', days: 365, serviceFilter: ['contrato', 'mercantil', 'empresa'],
      tip: 'El cliente de empresa necesita revisar contratos y condiciones cada año (y no lo hace). El despacho que se lo propone factura recurrente, no por incendios.' },
    { id: 'a_herencia_pendiente', label: 'Herencia consultada y aparcada', serviceLabel: 'retomar tu tema de herencia', trigger: 'from_last_if_no_new', days: 30, serviceFilter: ['herencia', 'sucesión', 'sucesion', 'testamento'],
      tip: 'Las consultas de herencia se aparcan por dolor, no por desinterés. Un toque respetuoso al mes ("cuando quieras, lo retomamos con calma") gana el caso.' },
  ],
  asesoria: [
    { id: 'as_cierre_trimestre', label: 'Antes del cierre de trimestre', serviceLabel: 'preparar tu cierre de trimestre', trigger: 'from_last_appointment', days: 75,
      tip: 'Contactar 2 semanas antes de cada cierre (abril, julio, octubre, enero) evita las prisas de última hora — y te posiciona como el asesor que se adelanta.' },
    { id: 'as_autonomo_nuevo', label: 'Primer trimestre del autónomo nuevo', serviceLabel: 'tu primera presentación de impuestos', trigger: 'from_last_appointment', days: 60, serviceFilter: ['alta', 'autónomo', 'autonomo'],
      tip: 'El autónomo recién dado de alta está perdido en su primer trimestre. Acompañarlo proactivamente lo convierte en cliente de por vida (y te recomienda).' },
    { id: 'as_renta_documentos', label: 'Documentación para la renta', serviceLabel: 'preparar tu declaración', trigger: 'from_last_if_no_new', days: 300,
      tip: 'Ajusta los días para caer en marzo: "ve juntando estos papeles para la renta" te adelanta a la campaña y reparte el trabajo del despacho.' },
  ],
  notaria: [
    { id: 'not_testamento_pareja', label: 'El testamento del cónyuge', serviceLabel: 'el testamento de tu pareja', trigger: 'from_last_appointment', days: 30, serviceFilter: ['testamento'],
      tip: 'Quien hace testamento casi nunca viene con el de su pareja hecho. Sugerirlo al mes, con la reflexión aún fresca, resuelve lo que llevan años posponiendo.' },
    { id: 'not_poder_revision', label: 'Revisar poderes antiguos', serviceLabel: 'revisar tus poderes', trigger: 'from_last_if_no_new', days: 365, serviceFilter: ['poder', 'poderes'],
      tip: 'Los poderes de hace años suelen estar desfasados (apoderados que ya no están, facultades que sobran). La revisión anual es un servicio que nadie ofrece.' },
    { id: 'not_empresa_actas', label: 'Renovación de cargos societarios', serviceLabel: 'la renovación de cargos', trigger: 'from_last_appointment', days: 350, serviceFilter: ['sociedad', 'mercantil', 'constitución', 'constitucion'],
      tip: 'Las sociedades que constituiste renuevan cargos y necesitan actas periódicas. El recordatorio anual te mantiene como SU notaría, no una cualquiera.' },
  ],
  inmobiliaria: [
    { id: 'i_valoracion', label: 'Valoración sin decidir', serviceLabel: 'la valoración de tu inmueble', trigger: 'from_last_if_no_new', days: 14,
      tip: 'Quien pidió valorar su piso está decidiendo agencia. A las 2 semanas, un toque con "¿resolvemos dudas?" gana mandatos que se lleva la competencia por silencio.' },
    { id: 'i_comprador_activo', label: 'El comprador que no encontró', serviceLabel: 'las novedades que encajan contigo', trigger: 'from_last_if_no_new', days: 21,
      tip: 'El comprador que visitó y no compró sigue buscando en Idealista. Cada 3 semanas, un "ha entrado algo que encaja con lo que buscabas" te mantiene primero.' },
    { id: 'i_inquilino_propietario', label: 'Del inquilino al propietario', serviceLabel: 'valorar la compra de tu vivienda', trigger: 'from_last_appointment', days: 300, serviceFilter: ['alquiler', 'arrendamiento'],
      tip: 'El inquilino que colocaste hace un año es comprador potencial hoy. Nadie más tiene ese dato — es tu cartera de compradores durmiente.' },
  ],
  reformas: [
    { id: 'ref_presupuesto_vivo', label: 'Presupuesto entregado — decisión', serviceLabel: 'el presupuesto de tu reforma', trigger: 'from_last_if_no_new', days: 10,
      tip: 'Las reformas se deciden en semanas y se pierden por silencio. A los 10 días, "¿dudas con el presupuesto? podemos ajustar partidas" reabre la conversación.' },
    { id: 'ref_otra_estancia', label: 'La siguiente estancia', serviceLabel: 'tu próxima reforma', trigger: 'from_last_appointment', days: 300,
      tip: 'Quien reformó la cocina reforma el baño en 1-2 años. El aviso al año ("¿le toca al baño?") llega antes de que pidan presupuestos a otros.' },
    { id: 'ref_garantia_revision', label: 'Revisión de fin de garantía', serviceLabel: 'la revisión de tu reforma', trigger: 'from_last_appointment', days: 330,
      tip: 'Ofrecer una revisión antes de que venza la garantía (repasar silicona, ajustes) cuesta una visita y genera la recomendación más potente del sector.' },
  ],
  arquitectura: [
    { id: 'arq_licencia_seguimiento', label: 'Proyecto entregado, obra sin empezar', serviceLabel: 'el arranque de tu proyecto', trigger: 'from_last_if_no_new', days: 45,
      tip: 'El cliente con proyecto visado que no arranca la obra se pierde entre trámites. Un seguimiento a los 45 días ("¿cómo va la licencia?") retiene la dirección de obra.' },
    { id: 'arq_ite_iee', label: 'Aviso de ITE / IEE del edificio', serviceLabel: 'la inspección de tu edificio', trigger: 'from_last_appointment', days: 350, serviceFilter: ['ite', 'iee', 'inspección', 'inspeccion', 'comunidad'],
      tip: 'Las comunidades donde ya trabajaste tienen inspecciones periódicas obligatorias. El recordatorio anual al administrador te da la siguiente antes de que salga a concurso.' },
    { id: 'arq_eficiencia', label: 'Certificado energético caducado', serviceLabel: 'renovar tu certificado energético', trigger: 'from_last_appointment', days: 350, serviceFilter: ['energético', 'energetico', 'certificado'],
      tip: 'Los certificados energéticos caducan a los 10 años, pero quien vende/alquila lo necesita YA. El aviso anual a tu cartera pesca justo a los que están en ello.' },
  ],
  autoescuela: [
    { id: 'au_teorico_aprobado', label: 'Teórico aprobado, prácticas sin empezar', serviceLabel: 'tus clases prácticas', trigger: 'from_last_if_no_new', days: 10,
      tip: 'El alumno que aprueba el teórico y no agenda prácticas en 2 semanas se enfría (y el teórico caduca). Es tu alumno más fácil de reactivar.' },
    { id: 'au_carnet_moto', label: 'Del B al carnet de moto', serviceLabel: 'tu carnet de moto', trigger: 'from_last_appointment', days: 200, serviceFilter: ['moto', 'a2'],
      tip: 'El alumno que se sacó el B es tu mejor candidato al A2 unos meses después (sobre todo si llega el buen tiempo). Ya te conoce: la venta está medio hecha.' },
    { id: 'au_perdida_puntos', label: 'Cursos de recuperación de puntos', serviceLabel: 'tu curso de recuperación', trigger: 'from_last_if_no_new', days: 365, serviceFilter: ['puntos', 'recuperación', 'recuperacion'],
      tip: 'Tu base de ex-alumnos es tu mercado para los cursos de puntos. Un recordatorio anual de que existes para eso trae matrículas sin captación.' },
  ],
  coaching: [
    { id: 'coa_cierre_proceso', label: 'Sesión de cierre a los 3 meses', serviceLabel: 'tu sesión de seguimiento', trigger: 'from_last_if_no_new', days: 90,
      tip: 'El proceso terminado necesita un "¿se mantienen los cambios?" a los 3 meses. Consolida resultados, genera testimonios y muchas veces abre el siguiente proceso.' },
    { id: 'coa_nuevo_ciclo', label: 'Arranque de año / septiembre', serviceLabel: 'tu nueva etapa', trigger: 'from_last_if_no_new', days: 180,
      tip: 'Enero y septiembre son los meses de los propósitos. Ajusta los días para llegar justo entonces a tu cartera dormida: la motivación ya la traen ellos.' },
    { id: 'coa_equipo', label: 'Del individual al equipo', serviceLabel: 'una sesión para tu equipo', trigger: 'from_last_appointment', days: 120, serviceFilter: ['empresa', 'equipo', 'directivo'],
      tip: 'El directivo que hizo proceso individual es la puerta al coaching de su equipo. Proponérselo a los 4 meses, con su propia mejora como aval, funciona.' },
  ],
  agencia_viajes: [
    { id: 'via_mismo_puente', label: 'El viajero de puentes', serviceLabel: 'tu escapada del próximo puente', trigger: 'from_last_appointment', days: 80,
      tip: 'Quien viaja en puente repite en el siguiente. Escribir ~5 semanas antes de cada puente con 2-3 propuestas cerradas ahorra la parte difícil: decidir.' },
    { id: 'via_luna_miel_aniversario', label: 'Aniversario del gran viaje', serviceLabel: 'vuestro viaje de aniversario', trigger: 'from_last_appointment', days: 330, serviceFilter: ['luna de miel', 'novios', 'aniversario'],
      tip: 'La pareja de la luna de miel celebra aniversarios toda la vida. "Hace un año estabais en Bali — ¿repetimos destino soñado?" es oro emocional.' },
    { id: 'via_imserso_senior', label: 'Temporada senior', serviceLabel: 'tu próximo viaje de temporada', trigger: 'from_last_if_no_new', days: 300, serviceFilter: ['imserso', 'senior', 'circuito'],
      tip: 'El viajero senior planifica con la campaña (otoño). El aviso anual antes de que abran plazas te convierte en su gestor de siempre.' },
  ],
  guarderia_canina: [
    { id: 'gua_puente_reserva', label: 'Reservar el puente ANTES', serviceLabel: 'la plaza de tu peludo para el puente', trigger: 'from_last_appointment', days: 70,
      tip: 'Las plazas de puente vuelan. Avisar a tus habituales ~1 mes antes de cada puente ("te guardo la plaza de siempre") llena el cupo con cero esfuerzo.' },
    { id: 'gua_guarderia_dia', label: 'De vacaciones a guardería de día', serviceLabel: 'días sueltos de guardería', trigger: 'from_last_appointment', days: 40, serviceFilter: ['día', 'dia', 'diurna'],
      tip: 'El cliente de estancias vacacionales no sabe que existes entre semana. Ofrecer días sueltos (teletrabajo, viajes cortos) convierte 2 estancias/año en ingresos mensuales.' },
    { id: 'gua_socializacion', label: 'El cachorro que necesita socializar', serviceLabel: 'las sesiones de socialización', trigger: 'from_last_appointment', days: 21, serviceFilter: ['cachorro', 'socialización', 'socializacion'],
      tip: 'El dueño de cachorro primerizo agradece que le eduques: sesiones cortas de socialización a las 3 semanas crean el hábito de dejártelo siempre.' },
  ],
  residencia_mascotas: [
    { id: 'res_verano_early', label: 'Reserva de verano anticipada', serviceLabel: 'la plaza de verano de tu mascota', trigger: 'from_last_appointment', days: 280,
      tip: 'Julio y agosto se llenan en primavera. El aviso de marzo-abril a los clientes del verano pasado ("¿mismas fechas?") asegura la ocupación antes de anunciar nada.' },
    { id: 'res_navidad', label: 'Plazas de Navidad', serviceLabel: 'la plaza de Navidad', trigger: 'from_last_appointment', days: 320,
      tip: 'Quien viaja en Navidad repite cada año. Reservarle la plaza en noviembre, antes del pico de llamadas, fideliza y te ahorra el caos de diciembre.' },
    { id: 'res_visita_previa', label: 'Visita de adaptación para nuevos', serviceLabel: 'una visita de adaptación', trigger: 'from_last_if_no_new', days: 30,
      tip: 'El cliente que preguntó pero no reservó tiene miedo, no desinterés. Invitarle a una visita de adaptación gratuita al mes derriba la barrera.' },
  ],
  generico: [
    { id: 'gen_referido', label: 'El momento de pedir recomendación', serviceLabel: 'contarle a un conocido', trigger: 'from_last_appointment', days: 7,
      tip: 'La semana siguiente a una buena experiencia es EL momento de pedir que te recomienden. Después, el entusiasmo (y el favor) se olvidan.' },
    { id: 'gen_frecuencia_natural', label: 'Su frecuencia natural', serviceLabel: 'tu próxima visita', trigger: 'from_last_if_no_new', days: 45,
      tip: 'Mira cada cuánto vuelve tu buen cliente típico y pon aquí esos días + 1 semana. El aviso llega justo cuando "le tocaba" y se le había pasado.' },
  ],
};

/**
 * Recetas aplicables a un sector, excluyendo las que ya existen como regla
 * (por etiqueta, para no ofrecer duplicados) y — si se pasa serviceList —
 * las ligadas a servicios que el negocio NO ofrece (cada negocio ve SU
 * recetario, no el del sector genérico). PURA.
 * @param {string} sectorSlug
 * @param {Array<string>} existingLabels  etiquetas de reglas actuales (default+custom)
 * @param {Array|null} [serviceList]      servicios del negocio (null = no restringir)
 */
function getRecipes(sectorSlug, existingLabels = [], serviceList = null) {
  const have = new Set((existingLabels || []).map(l => String(l || '').trim().toLowerCase()).filter(Boolean));
  const { appliesToServices } = require('./sector-catalog');
  const all = [...(BY_SECTOR[sectorSlug] || []), ...UNIVERSAL];
  return all
    .filter(r => !have.has(r.label.toLowerCase()))
    .filter(r => appliesToServices(r, serviceList));
}

module.exports = { getRecipes, UNIVERSAL, BY_SECTOR };
