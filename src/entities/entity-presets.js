// ============================================================
// NodeFlow — ENTIDADES: presets por sector (el "recetario" de fichas)
// ------------------------------------------------------------
// Lección del recetario de Seguimientos (followup-recipes.js): la
// maquinaria sola no vale nada — el dueño necesita ejemplos CURADOS
// que se añaden con un clic. Cada sector tiene 3-5 fichas típicas
// ("Bono 5 sesiones", "ITV anual", "Póliza hogar") que PRE-RELLENAN
// el formulario de alta: él elige el cliente, ajusta y guarda.
//
// Las fechas son SIEMPRE relativas ({ rel_days: N }) y se resuelven
// en el momento de servirlas (resolvePresetAttrs): jamás una fecha
// horneada en el código. Regla de oro: rel_days + offset_days del
// reminder > 0, para que el aviso automático caiga en el futuro
// (lo garantiza el test de integridad).
//
// Determinista, sin LLM, sin BD: funciones puras testeables.
// ============================================================
'use strict';

/** Marcador de fecha relativa: se resuelve a AAAA-MM-DD al servir. */
function d(relDays) { return { rel_days: relDays }; }

// ─── Catálogo de presets por sector ──────────────────────────────────────────
// intro: 1 línea que explica QUÉ es esta pestaña para SU sector (vocabulario
//        propio: bonos, fórmulas, pólizas… nunca "ITV" a una fisio).
// items: { id, label, description (por qué da dinero), attrs }
//        attrs SOLO con claves que existen en la plantilla del sector
//        (entity-types.js) y valores válidos para validateAttrs.

const ENTITY_PRESETS = {

  taller: {
    intro: 'Guarda cada coche con su ITV, su revisión y su aceite — NodeFlow avisa al dueño antes de la fecha y el coche vuelve a tu taller, no al de la esquina.',
    items: [
      { id: 'tal_itv_anual', label: 'Coche de cliente — ITV anual',
        description: 'El aviso 30 días antes trae la pre-ITV y la reparación a tu taller.',
        attrs: { proxima_itv: d(365) } },
      { id: 'tal_revision_15k', label: 'Revisión de los 15.000 km',
        description: 'La revisión periódica es la visita que mantiene el coche (y el cliente) contigo.',
        attrs: { proxima_revision: d(180) } },
      { id: 'tal_aceite', label: 'Cambio de aceite semestral',
        description: 'Nadie recuerda cuándo le toca el aceite — el taller que avisa, factura.',
        attrs: { cambio_aceite: d(180) } },
      { id: 'tal_furgoneta', label: 'Furgoneta de trabajo — todo al día',
        description: 'La empresa paga sin discutir por no parar la furgoneta: ITV + revisión avisadas.',
        attrs: { proxima_itv: d(180), proxima_revision: d(90) } },
    ],
  },

  veterinaria: {
    intro: 'Cada mascota con sus vacunas y desparasitaciones apuntadas — el aviso al dueño sale solo y la cartilla se queda al día contigo.',
    items: [
      { id: 'vet_vacuna_anual', label: 'Vacuna anual (rabia / polivalente)',
        description: 'La vacuna anual es la visita recurrente más segura de la clínica.',
        attrs: { proxima_vacuna: d(365) } },
      { id: 'vet_desparasitacion', label: 'Desparasitación trimestral',
        description: 'Cuatro visitas al año que nadie recuerda sin aviso — y venta de producto en cada una.',
        attrs: { desparasitacion: d(90) } },
      { id: 'vet_cachorro', label: 'Cachorro — refuerzo en 4 semanas',
        description: 'El cachorro que completa su pauta contigo es cliente toda la vida del animal.',
        attrs: { especie: 'perro', proxima_vacuna: d(28) } },
      { id: 'vet_senior', label: 'Paciente senior — revisión anual',
        description: 'El chequeo geriátrico programado retiene al paciente que más te necesita.',
        attrs: { revision_anual: d(365) } },
    ],
  },

  inmobiliaria: {
    intro: 'Cada inmueble con sus fechas vivas — revisión de precio y certificado energético avisados a tiempo, mandato que no se enfría.',
    items: [
      { id: 'inm_venta_precio', label: 'Piso en venta — revisar precio al mes',
        description: 'El mandato que revisa precio cada 30 días se vende; el que se olvida, caduca.',
        attrs: { operacion: 'venta', proxima_revision_precio: d(30) } },
      { id: 'inm_alquiler_anual', label: 'Alquiler — repaso anual de renta',
        description: 'La actualización anual de renta es facturación recurrente que casi nadie sistematiza.',
        attrs: { operacion: 'alquiler', proxima_revision_precio: d(365) } },
      { id: 'inm_certificado', label: 'Certificado energético — caduca en 10 años',
        description: 'El aviso 2 meses antes te da la renovación (y la conversación de vender otra vez).',
        attrs: { caducidad_certificado_energetico: d(3650) } },
    ],
  },

  abogados: {
    intro: 'Cada expediente con su plazo y su vista apuntados — el aviso llega antes de que venza y ningún caso se te escapa por la agenda.',
    items: [
      { id: 'abo_plazo', label: 'Plazo procesal en 20 días',
        description: 'El aviso una semana antes evita el susto — y el cliente ve un despacho que no falla.',
        attrs: { proximo_plazo: d(20), estado: 'abierto' } },
      { id: 'abo_vista', label: 'Vista señalada en 3 meses',
        description: 'Recordar la vista con 2 semanas prepara al cliente (documentos, testigos) sin llamadas de pánico.',
        attrs: { proxima_vista: d(90), estado: 'en_tramite' } },
      { id: 'abo_extranjeria', label: 'Extranjería — renovación anual',
        description: 'Las renovaciones de residencia recurren cada año: el despacho que avisa se queda el cliente.',
        attrs: { tipo: 'extranjeria', proximo_plazo: d(365), estado: 'abierto' } },
    ],
  },

  asesoria: {
    intro: 'Cada obligación fiscal de tus clientes con su vencimiento — el aviso sale solo y el cierre no se hace con prisas de última hora.',
    items: [
      { id: 'ase_iva', label: 'IVA trimestral',
        description: 'El aviso 15 días antes reparte el trabajo del despacho y te posiciona como el asesor que se adelanta.',
        attrs: { concepto: 'iva_trimestral', periodicidad: 'trimestral', proximo_vencimiento: d(75) } },
      { id: 'ase_renta', label: 'Renta anual',
        description: 'Pedir los papeles con margen es la diferencia entre campaña ordenada y caos de junio.',
        attrs: { concepto: 'renta', periodicidad: 'anual', proximo_vencimiento: d(300) } },
      { id: 'ase_cuentas', label: 'Cuentas anuales',
        description: 'El depósito de cuentas avisado a tiempo evita recargos — y clientes enfadados.',
        attrs: { concepto: 'cuentas_anuales', periodicidad: 'anual', proximo_vencimiento: d(330) } },
      { id: 'ase_sociedades', label: 'Impuesto de sociedades',
        description: 'La cita de sociedades cerrada con antelación es julio sin incendios.',
        attrs: { concepto: 'impuesto_sociedades', periodicidad: 'anual', proximo_vencimiento: d(350) } },
    ],
  },

  seguros: {
    intro: 'Cada póliza con su fecha de renovación — el aviso 30 días antes llega ANTES que el comparador y la cartera no se te fuga.',
    items: [
      { id: 'seg_hogar', label: 'Póliza hogar — renovación anual',
        description: 'La renovación avisada a tiempo se queda contigo; la sorpresa en el recibo se va al comparador.',
        attrs: { ramo: 'hogar', fecha_renovacion: d(365) } },
      { id: 'seg_auto', label: 'Póliza auto — renovación anual',
        description: 'El auto es la póliza que más se compara: adelantarte un mes gana la conversación.',
        attrs: { ramo: 'auto', fecha_renovacion: d(365) } },
      { id: 'seg_salud', label: 'Póliza salud — renovación anual',
        description: 'Salud sube prima cada año: avisar tú primero convierte la subida en revisión de cartera.',
        attrs: { ramo: 'salud', fecha_renovacion: d(365) } },
      { id: 'seg_comercio', label: 'Póliza de comercio / negocio',
        description: 'El comercio asegurado bien atendido trae también su auto, su hogar y su vida.',
        attrs: { ramo: 'comercio', fecha_renovacion: d(365) } },
    ],
  },

  gimnasio: {
    intro: 'Cada membresía con su renovación apuntada — el aviso llega antes de que caduque y la cuota no se pierde por despiste.',
    items: [
      { id: 'gim_mensual', label: 'Cuota mensual',
        description: 'El aviso antes de renovar evita el impago silencioso — la primera causa de baja.',
        attrs: { plan: 'Mensual', fecha_renovacion: d(30), estado: 'activa' } },
      { id: 'gim_trimestral', label: 'Bono trimestral',
        description: 'El trimestral renovado a tiempo son 4 ventas al año en piloto automático.',
        attrs: { plan: 'Trimestral', fecha_renovacion: d(90), estado: 'activa' } },
      { id: 'gim_anual', label: 'Matrícula anual',
        description: 'La renovación anual avisada con 10 días retiene al socio antes de que "se lo piense".',
        attrs: { plan: 'Anual', fecha_renovacion: d(365), estado: 'activa' } },
    ],
  },

  academia: {
    intro: 'Cada matrícula con su examen y su fin de curso — el aviso llega a tiempo para renovar plaza o preparar la convocatoria.',
    items: [
      { id: 'aca_curso', label: 'Matrícula del curso',
        description: 'El aviso antes del fin de matrícula asegura la renovación de plaza para el siguiente curso.',
        attrs: { fin_matricula: d(280) } },
      { id: 'aca_examen', label: 'Examen oficial en 3 meses',
        description: 'El recordatorio a 2 semanas del examen vende clases de refuerzo e intensivos.',
        attrs: { fecha_examen: d(90) } },
      { id: 'aca_intensivo', label: 'Intensivo de verano',
        description: 'La plaza de julio se decide en mayo: el aviso llega antes de que la familia planifique.',
        attrs: { curso: 'Intensivo de verano', fin_matricula: d(60) } },
    ],
  },

  optica: {
    intro: 'Cada graduación con su próxima revisión visual — el aviso sale solo y el cliente vuelve a tu óptica antes de mirar online.',
    items: [
      { id: 'opt_anual', label: 'Revisión visual anual',
        description: 'La revisión anual es la puerta a las segundas gafas y a las de sol graduadas.',
        attrs: { ultima_revision: d(0), proxima_revision: d(365) } },
      { id: 'opt_lentillas', label: 'Lentillas — revisión semestral',
        description: 'El usuario de lentillas revisado cada 6 meses te compra las lentillas a ti, no a internet.',
        attrs: { tipo_lente: 'lentillas', proxima_revision: d(180) } },
      { id: 'opt_progresivas', label: 'Progresivas — revisión a los 2 años',
        description: 'La graduación progresiva cambia a los 2 años: el aviso trae la venta más alta de la óptica.',
        attrs: { tipo_lente: 'progresiva', proxima_revision: d(730) } },
    ],
  },

  clima: {
    intro: 'Cada caldera y cada equipo con su revisión obligatoria y su garantía — el aviso sale solo y el mantenimiento es tuyo cada año.',
    items: [
      { id: 'cli_caldera', label: 'Caldera — revisión obligatoria anual',
        description: 'La revisión anual de gas es obligatoria: quien avisa primero se lleva el contrato.',
        attrs: { tipo: 'caldera', revision_obligatoria: d(365) } },
      { id: 'cli_aire', label: 'Aire acondicionado — puesta a punto',
        description: 'Revisar el aire ANTES del calor evita la avería de julio y llena tu primavera de trabajo.',
        attrs: { tipo: 'aire_acondicionado', revision_obligatoria: d(270) } },
      { id: 'cli_garantia', label: 'Equipo nuevo — fin de garantía (3 años)',
        description: 'Un mes antes de vencer la garantía es EL momento de vender el contrato de mantenimiento.',
        attrs: { fin_garantia: d(1095) } },
    ],
  },

  informatica: {
    intro: 'Cada contrato de mantenimiento, licencia y hosting con su renovación — el aviso sale solo y la cuota recurrente no se cae.',
    items: [
      { id: 'inf_mantenimiento', label: 'Contrato de mantenimiento anual',
        description: 'La renovación avisada con un mes se firma sin negociar; la olvidada se pierde en silencio.',
        attrs: { tipo: 'mantenimiento', fecha_renovacion: d(365) } },
      { id: 'inf_licencia', label: 'Licencias de software',
        description: 'Renovar licencias a tiempo evita el "se me caducó" — y factura gestión cada año.',
        attrs: { tipo: 'licencia', fecha_renovacion: d(365) } },
      { id: 'inf_hosting', label: 'Hosting y dominio',
        description: 'El dominio caducado es una web caída y un cliente furioso: el aviso te hace imprescindible.',
        attrs: { tipo: 'hosting', fecha_renovacion: d(365) } },
    ],
  },

  reformas: {
    intro: 'Cada obra con su fin previsto y su garantía — la revisión antes de que venza genera la recomendación más potente del sector.',
    items: [
      { id: 'ref_terminada', label: 'Obra terminada — garantía de 2 años',
        description: 'La revisión de cortesía antes de vencer la garantía cuesta una visita y trae la siguiente obra.',
        attrs: { estado: 'terminada', fin_garantia: d(730) } },
      { id: 'ref_en_curso', label: 'Obra en curso — fin en 2 meses',
        description: 'La ficha de la obra viva ordena fechas y deja programado el aviso de garantía al terminar.',
        attrs: { estado: 'en_curso', fin_previsto: d(60), fin_garantia: d(790) } },
      { id: 'ref_bano', label: 'Baño reformado — repaso al año',
        description: 'Repasar silicona y ajustes al año del baño abre la conversación de la cocina.',
        attrs: { tipo: 'baño', estado: 'terminada', fin_garantia: d(365) } },
    ],
  },

  agencia_viajes: {
    intro: 'Los pasaportes y visados de tus viajeros con su caducidad — nadie más avisa de esto: el aviso a tiempo salva el viaje y te hace su agencia para siempre.',
    items: [
      { id: 'via_pasaporte', label: 'Pasaporte — caduca en 10 años',
        description: 'El aviso 3 meses antes salva el viaje (muchos países exigen 6 meses de validez).',
        attrs: { tipo: 'pasaporte', caducidad: d(3650) } },
      { id: 'via_dni', label: 'DNI — renovación',
        description: 'El DNI caducado tumba un vuelo europeo: avisar tú es un servicio que se recuerda.',
        attrs: { tipo: 'dni', caducidad: d(3650) } },
      { id: 'via_visado', label: 'Visado — caduca en 6 meses',
        description: 'El visado por caducar es el momento perfecto para vender el siguiente viaje.',
        attrs: { tipo: 'visado', caducidad: d(180) } },
    ],
  },

  dental: {
    intro: 'Cada tratamiento con su revisión y su higiene apuntadas — el aviso sale solo y el sillón no se queda vacío por despiste del paciente.',
    items: [
      { id: 'den_higiene', label: 'Higiene / limpieza semestral',
        description: 'La limpieza cada 6 meses es la visita recurrente que sostiene la agenda de la clínica.',
        attrs: { tipo: 'Limpieza periódica', proxima_higiene: d(180) } },
      { id: 'den_ortodoncia', label: 'Ortodoncia — revisión mensual',
        description: 'La revisión mensual de ortodoncia que no se salta ninguna cita acaba antes y recomienda más.',
        attrs: { tipo: 'Ortodoncia', estado: 'en_curso', proxima_revision: d(30) } },
      { id: 'den_implante', label: 'Implante — revisión anual',
        description: 'El implante revisado cada año dura décadas — y el paciente vuelve con toda su familia.',
        attrs: { tipo: 'Implante', estado: 'completado', proxima_revision: d(365) } },
      { id: 'den_blanqueamiento', label: 'Blanqueamiento — retoque a los 6 meses',
        description: 'El retoque es venta casi segura: ya pagaron una vez por ese resultado.',
        attrs: { tipo: 'Blanqueamiento', estado: 'completado', proxima_revision: d(180) } },
    ],
  },

  peluqueria: {
    intro: 'La fórmula exacta de cada clienta guardada — y el aviso de retoque sale solo, antes de que se le vean las raíces.',
    items: [
      { id: 'pel_color5', label: 'Ficha de color — retoque en 5 semanas',
        description: 'Guardas la fórmula y el aviso llega antes de que asomen las raíces: cita casi automática.',
        attrs: { proximo_retoque: d(35) } },
      { id: 'pel_canas', label: 'Cobertura de canas — retoque en 3 semanas',
        description: 'La clienta de canas es la más puntual del salón si tú llevas la cuenta por ella.',
        attrs: { proximo_retoque: d(21) } },
      { id: 'pel_mechas', label: 'Mechas / balayage — matiz en 8 semanas',
        description: 'El matiz a las 8 semanas mantiene el rubio (y el ticket alto) vivo entre mechas y mechas.',
        attrs: { proximo_retoque: d(56) } },
    ],
  },

  estetica_avanzada: {
    intro: 'Cada bono con sus sesiones y su caducidad — NodeFlow avisa a tu clienta antes de que caduque y ninguna sesión pagada se queda sin usar.',
    items: [
      { id: 'est_bono5', label: 'Bono 5 sesiones (caduca en 3 meses)',
        description: 'El aviso antes de caducar convierte sesiones olvidadas en visitas — y en renovación del bono.',
        attrs: { sesiones_totales: 5, sesiones_restantes: 5, caducidad: d(90) } },
      { id: 'est_bono10', label: 'Bono 10 sesiones (6 meses)',
        description: 'El bono grande fideliza medio año — si las sesiones no se pierden por el camino.',
        attrs: { sesiones_totales: 10, sesiones_restantes: 10, caducidad: d(180) } },
      { id: 'est_facial', label: 'Higiene facial — mantenimiento mensual',
        description: 'El facial mensual recurrente es la base de caja del centro: el aviso lo mantiene vivo.',
        attrs: { tratamiento: 'Higiene facial', sesiones_totales: 1, sesiones_restantes: 1, caducidad: d(45) } },
    ],
  },

  laser: {
    intro: 'Cada bono de láser con su zona, sus sesiones y su caducidad — el aviso de sesión (y el de caducidad) salen solos.',
    items: [
      { id: 'las_piernas', label: 'Bono 8 sesiones — piernas',
        description: 'La sesión cada 6 semanas avisada a tiempo mantiene el ciclo (y el resultado) sin huecos.',
        attrs: { zona: 'piernas', sesiones_totales: 8, sesiones_restantes: 8, proxima_sesion: d(42), caducidad: d(365) } },
      { id: 'las_axilas', label: 'Bono 6 sesiones — axilas',
        description: 'El bono pequeño es la puerta de entrada: bien avisado, acaba en cuerpo completo.',
        attrs: { zona: 'axilas', sesiones_totales: 6, sesiones_restantes: 6, proxima_sesion: d(42), caducidad: d(365) } },
      { id: 'las_repaso', label: 'Repaso anual post-tratamiento',
        description: 'Los folículos rebeldes del año son la excusa perfecta para que la clienta vuelva a tu fichero.',
        attrs: { sesiones_totales: 1, sesiones_restantes: 1, proxima_sesion: d(330) } },
    ],
  },

  spa: {
    intro: 'Cada bono y tarjeta regalo con su caducidad — el aviso sale solo y ningún circuito pagado se queda sin disfrutar.',
    items: [
      { id: 'spa_bono5', label: 'Bono 5 circuitos (6 meses)',
        description: 'El bono avisado antes de caducar se usa entero — y se renueva; el olvidado no vuelve.',
        attrs: { nombre: 'Circuito spa', sesiones_totales: 5, sesiones_restantes: 5, caducidad: d(180) } },
      { id: 'spa_regalo', label: 'Tarjeta regalo — caduca en 1 año',
        description: 'Un tercio de los bonos regalo caduca sin usar: el aviso lo convierte en visita y en cliente propio.',
        attrs: { nombre: 'Tarjeta regalo', sesiones_totales: 1, sesiones_restantes: 1, caducidad: d(365) } },
      { id: 'spa_pareja', label: 'Ritual en pareja — bono 3',
        description: 'El ritual en pareja casi siempre celebra algo: bien avisado, se repite cada año.',
        attrs: { nombre: 'Ritual en pareja', sesiones_totales: 3, sesiones_restantes: 3, caducidad: d(120) } },
    ],
  },

  fisioterapia: {
    intro: 'Cada bono con sus sesiones y su caducidad — y cada plan con su revisión: NodeFlow avisa a tu paciente antes de que se pierda nada.',
    items: [
      { id: 'fis_bono5', label: 'Bono 5 sesiones (caduca en 3 meses)',
        description: 'El aviso antes de caducar recupera sesiones pagadas que se estaban perdiendo — y renueva el bono.',
        attrs: { sesiones_totales: 5, sesiones_restantes: 5, caducidad_bono: d(90) } },
      { id: 'fis_bono10', label: 'Bono 10 sesiones (6 meses)',
        description: 'El bono grande retiene medio año de tratamiento si ninguna sesión se queda por el camino.',
        attrs: { sesiones_totales: 10, sesiones_restantes: 10, caducidad_bono: d(180) } },
      { id: 'fis_lumbalgia', label: 'Plan lumbalgia — revisión en 2 semanas',
        description: 'El paciente que "ya está mejor" recae sin la revisión: el aviso a 2 semanas completa el alta de verdad.',
        attrs: { motivo: 'Lumbalgia', proxima_revision: d(14) } },
      { id: 'fis_deportista', label: 'Descarga deportiva — cada mes',
        description: 'Convertir al lesionado puntual en abonado mensual es la mejor economía de la clínica.',
        attrs: { motivo: 'Descarga deportiva', proxima_revision: d(30) } },
    ],
  },

  coaching: {
    intro: 'Cada programa con sus sesiones y su renovación — el aviso llega en el momento justo de hablar de la siguiente etapa.',
    items: [
      { id: 'coa_3m', label: 'Programa 3 meses — 6 sesiones',
        description: 'La renovación propuesta 2 semanas antes del fin, con el progreso a la vista, se cierra sola.',
        attrs: { nombre: 'Programa trimestral', sesiones_totales: 6, sesiones_restantes: 6, fecha_renovacion: d(90) } },
      { id: 'coa_6m', label: 'Programa 6 meses — 12 sesiones',
        description: 'El proceso largo necesita hitos: la fecha de renovación marca la conversación de continuidad.',
        attrs: { nombre: 'Programa semestral', sesiones_totales: 12, sesiones_restantes: 12, fecha_renovacion: d(180) } },
      { id: 'coa_seguimiento', label: 'Sesión de seguimiento trimestral',
        description: 'El "¿se mantienen los cambios?" a los 3 meses consolida resultados y abre el siguiente proceso.',
        attrs: { nombre: 'Seguimiento trimestral', sesiones_totales: 1, sesiones_restantes: 1, fecha_renovacion: d(90) } },
    ],
  },

  guarderia_canina: {
    intro: 'Cada perro con sus vacunas y su bono de días — el aviso al dueño sale solo y las vacunas llegan al día para venir a la guarde.',
    items: [
      { id: 'gua_vacunas', label: 'Vacunas — renovación anual',
        description: 'Las vacunas al día son requisito para venir: el aviso evita el "no puede entrar hoy".',
        attrs: { proxima_vacuna: d(365) } },
      { id: 'gua_bono10', label: 'Bono 10 días de guardería',
        description: 'El bono de días con las vacunas controladas convierte visitas sueltas en rutina semanal.',
        attrs: { dias_bono_restantes: 10, proxima_vacuna: d(365) } },
      { id: 'gua_cachorro', label: 'Cachorro nuevo — refuerzo en 4 semanas',
        description: 'El cachorro que socializa contigo desde el principio es cliente para toda su vida.',
        attrs: { proxima_vacuna: d(28), sociable: 'con_cuidado' } },
    ],
  },

  residencia_mascotas: {
    intro: 'Cada estancia con su entrada y su recogida — los avisos al dueño (cartilla, comida, manta) salen solos antes de cada fecha.',
    items: [
      { id: 'res_verano', label: 'Estancia de vacaciones (2 semanas)',
        description: 'El aviso de entrada con la lista (cartilla, comida, manta) evita el 90% de las llamadas.',
        attrs: { fecha_entrada: d(45), fecha_salida: d(59), vacunas_al_dia: true } },
      { id: 'res_puente', label: 'Estancia de puente',
        description: 'Las plazas de puente vuelan: la ficha hecha hoy asegura la reserva y sus avisos.',
        attrs: { fecha_entrada: d(21), fecha_salida: d(25) } },
      { id: 'res_navidad', label: 'Estancia de Navidad — reservar YA',
        description: 'Quien viaja en Navidad repite cada año: la reserva anticipada te ahorra el caos de diciembre.',
        attrs: { fecha_entrada: d(150), fecha_salida: d(160) } },
    ],
  },

  hotel: {
    intro: 'Cada grupo y cada evento con su llegada apuntada — la reconfirmación de habitaciones y régimen sale sola una semana antes.',
    items: [
      { id: 'hot_grupo', label: 'Grupo — llegada en 1 mes',
        description: 'La reconfirmación automática 7 días antes evita no-shows y habitaciones bloqueadas de más.',
        attrs: { fecha_llegada: d(30), fecha_salida: d(32) } },
      { id: 'hot_boda', label: 'Boda / banquete con alojamiento',
        description: 'El bloqueo de boda reconfirmado a tiempo convierte el caos de última hora en upselling.',
        attrs: { fecha_llegada: d(90), fecha_salida: d(91), regimen: 'desayuno' } },
      { id: 'hot_empresa', label: 'Empresa — reunión anual',
        description: 'El grupo de empresa bien gestionado repite cada año — con el organizador avisado, no perseguido.',
        attrs: { fecha_llegada: d(60), fecha_salida: d(62), regimen: 'media_pension' } },
    ],
  },

  clinica: {
    intro: 'Cada revisión y analítica con su próxima fecha — el aviso sale solo y el paciente vuelve sin que nadie tenga que llamarle.',
    items: [
      { id: 'cln_anual', label: 'Revisión anual',
        description: 'La revisión anual programada al salir de consulta es la agenda del año que viene ya llena.',
        attrs: { tipo: 'revision_anual', ultima_fecha: d(0), proxima_fecha: d(365), periodicidad: 'anual' } },
      { id: 'cln_analitica', label: 'Analítica semestral',
        description: 'La analítica de control avisada a tiempo retiene al paciente que de otro modo "ya iría".',
        attrs: { tipo: 'analitica', proxima_fecha: d(180), periodicidad: 'semestral' } },
      { id: 'cln_cronico', label: 'Control trimestral (paciente crónico)',
        description: 'El crónico bien seguido no se pierde nunca: mejor medicina y agenda estable.',
        attrs: { tipo: 'otro', proxima_fecha: d(90), periodicidad: 'trimestral' } },
    ],
  },

  nutricion: {
    intro: 'Cada plan nutricional con su próxima revisión — el aviso llega justo cuando el paciente empieza a aflojar, no cuando ya lo dejó.',
    items: [
      { id: 'nut_mensual', label: 'Plan con revisión mensual',
        description: 'La revisión cada 4 semanas es lo que separa un plan que funciona de uno abandonado.',
        attrs: { fecha_inicio: d(0), proxima_revision: d(28), estado: 'activo' } },
      { id: 'nut_deportivo', label: 'Plan deportivo — 12 semanas',
        description: 'El plan con fecha de fin clara y revisiones pautadas se renueva; el indefinido se diluye.',
        attrs: { objetivo: 'Rendimiento deportivo', duracion_semanas: 12, fecha_inicio: d(0), proxima_revision: d(28), estado: 'activo' } },
      { id: 'nut_analitica', label: 'Control con analítica a los 3 meses',
        description: 'Ver la mejora EN NÚMEROS cierra el círculo y renueva el plan casi solo.',
        attrs: { proxima_revision: d(90), estado: 'activo' } },
    ],
  },

  pilates: {
    intro: 'Cada bono de clases con su caducidad — el aviso de renovación llega antes de que el alumno pierda su plaza (y tú, la cuota).',
    items: [
      { id: 'pil_suelo8', label: 'Bono 8 clases suelo (2 meses)',
        description: 'El bono renovado antes de caducar mantiene la plaza fija — la base del estudio.',
        attrs: { tipo: 'suelo', clases_totales: 8, clases_restantes: 8, caducidad: d(60) } },
      { id: 'pil_maquina10', label: 'Bono 10 máquina (3 meses)',
        description: 'El reformer es tu ticket alto: que ninguna clase pagada caduque sin usarse.',
        attrs: { tipo: 'maquina', clases_totales: 10, clases_restantes: 10, caducidad: d(90) } },
      { id: 'pil_privadas', label: 'Clases privadas — bono 5',
        description: 'La privada avisada a tiempo se renueva; la olvidada se convierte en "ya volveré".',
        attrs: { tipo: 'privada', clases_totales: 5, clases_restantes: 5, caducidad: d(90) } },
    ],
  },

  yoga: {
    intro: 'Cada bono de clases con su caducidad — el aviso llega antes de que expire y la práctica (y la cuota) siguen sin cortes.',
    items: [
      { id: 'yog_bono10', label: 'Bono 10 clases (3 meses)',
        description: 'El bono avisado antes de caducar se renueva con la práctica aún caliente.',
        attrs: { clases_totales: 10, clases_restantes: 10, caducidad: d(90) } },
      { id: 'yog_mensual', label: 'Mensualidad — renueva cada 30 días',
        description: 'La mensualidad con aviso 5 días antes evita el mes en blanco que acaba en baja.',
        attrs: { clases_totales: 8, clases_restantes: 8, caducidad: d(30) } },
      { id: 'yog_embarazo', label: 'Yoga embarazo — bono 8',
        description: 'La alumna prenatal bien acompañada vuelve al postnatal — nadie más tiene ese dato.',
        attrs: { tipo: 'embarazo', clases_totales: 8, clases_restantes: 8, caducidad: d(75) } },
    ],
  },

  podologia: {
    intro: 'Cada tratamiento con su próxima revisión — la quiropodia vuelve cada 6 semanas sola, sin que nadie tenga que acordarse.',
    items: [
      { id: 'pod_quiropodia', label: 'Quiropodia — cada 6 semanas',
        description: 'El paciente de quiropodia con aviso puntual es la visita recurrente más fiel de la consulta.',
        attrs: { tipo: 'quiropodia', ultima_visita: d(0), proxima_revision: d(42), periodicidad_semanas: 6 } },
      { id: 'pod_plantillas', label: 'Plantillas — revisión anual',
        description: 'Las plantillas pierden corrección al año: la revisión detecta el recambio a tiempo.',
        attrs: { tipo: 'plantillas', proxima_revision: d(365) } },
      { id: 'pod_diabetico', label: 'Pie de riesgo — control trimestral',
        description: 'El control cada 3 meses es el seguimiento más importante clínicamente — y el más fiel.',
        attrs: { tipo: 'otro', proxima_revision: d(90), periodicidad_semanas: 13 } },
    ],
  },

  psicologia: {
    intro: 'Cada plan de sesiones con su renovación — solo administración, cero datos clínicos: el aviso reserva el hueco de siempre.',
    items: [
      { id: 'psi_bono5', label: 'Bono 5 sesiones',
        description: 'El bono con renovación avisada mantiene la continuidad del proceso sin conversaciones incómodas.',
        attrs: { nombre: 'Bono 5 sesiones', sesiones_totales: 5, sesiones_restantes: 5, proxima_renovacion: d(60), modalidad: 'presencial' } },
      { id: 'psi_bono10', label: 'Bono 10 sesiones',
        description: 'El plan largo con fecha de renovación clara da estabilidad al paciente y a tu agenda.',
        attrs: { nombre: 'Bono 10 sesiones', sesiones_totales: 10, sesiones_restantes: 10, proxima_renovacion: d(120), modalidad: 'presencial' } },
      { id: 'psi_online', label: 'Pack mensual online',
        description: 'El pack online renovado cada mes es ingreso recurrente sin depender de la sala.',
        attrs: { nombre: 'Pack mensual online', sesiones_totales: 4, sesiones_restantes: 4, proxima_renovacion: d(30), modalidad: 'online' } },
    ],
  },

  restaurante: {
    intro: 'Cada evento y cada grupo con su fecha — la reconfirmación de comensales, menú y señal sale sola 5 días antes.',
    items: [
      { id: 'rst_empresa', label: 'Comida de empresa',
        description: 'La reconfirmación automática de comensales y menú evita el no-show del salón entero.',
        attrs: { nombre: 'Comida de empresa', fecha_evento: d(30), senal_pagada: false } },
      { id: 'rst_familiar', label: 'Comunión / celebración familiar',
        description: 'El evento familiar bien gestionado trae a 40 personas — y a sus futuras celebraciones.',
        attrs: { nombre: 'Celebración familiar', fecha_evento: d(45) } },
      { id: 'rst_grupo', label: 'Cena de grupo — fin de semana',
        description: 'El grupo reconfirmado no falla; el que no se reconfirma deja media mesa vacía.',
        attrs: { nombre: 'Cena de grupo', comensales: 12, fecha_evento: d(14) } },
    ],
  },

  notaria: {
    intro: 'Cada expediente con su firma prevista — el aviso con el DNI y la documentación pendiente sale solo 3 días antes.',
    items: [
      { id: 'not_compraventa', label: 'Compraventa — firma en 1 mes',
        description: 'El aviso con la lista de documentación evita la firma aplazada (y la sala bloqueada).',
        attrs: { tipo: 'compraventa', fecha_firma: d(30), estado: 'en_preparacion' } },
      { id: 'not_herencia', label: 'Herencia — firma en 2 meses',
        description: 'La herencia con fechas claras avanza; la que depende de "ya os llamaremos" se eterniza.',
        attrs: { tipo: 'herencia', fecha_firma: d(60), estado: 'en_preparacion' } },
      { id: 'not_testamento', label: 'Testamento — firma en 2 semanas',
        description: 'El recordatorio amable de la firma cierra en días lo que llevaba años pospuesto.',
        attrs: { tipo: 'testamento', fecha_firma: d(14), estado: 'pendiente_firma' } },
    ],
  },

  arquitectura: {
    intro: 'Cada proyecto con su licencia y sus hitos — la licencia de obra CADUCA: el aviso llega con margen para pedir prórroga.',
    items: [
      { id: 'arq_licencia', label: 'Licencia de obra — caduca en 3 años',
        description: 'La prórroga pedida a tiempo salva el proyecto; la licencia caducada lo entierra.',
        attrs: { fase: 'direccion_obra', caducidad_licencia: d(1095) } },
      { id: 'arq_visado', label: 'Visado / hito en 1 mes',
        description: 'Cada hito avisado a la semana mantiene al cliente informado sin que tenga que llamar.',
        attrs: { fase: 'proyecto_ejecucion', proximo_hito: d(30) } },
      { id: 'arq_ite', label: 'ITE / IEE del edificio — inspección',
        description: 'La inspección periódica avisada al administrador te da la siguiente antes del concurso.',
        attrs: { fase: 'finalizado', proximo_hito: d(180) } },
    ],
  },

  autoescuela: {
    intro: 'Cada alumno con su permiso en curso — el teórico aprobado CADUCA a los 2 años: el aviso llega antes de repetir examen.',
    items: [
      { id: 'aut_teorico', label: 'Teórico aprobado — caduca en 2 años',
        description: 'El aviso 2 meses antes rescata al alumno dormido sin que pierda el teórico (ni tú la matrícula).',
        attrs: { estado: 'practicas', caducidad_teorico: d(730) } },
      { id: 'aut_practico', label: 'Examen práctico en 1 mes',
        description: 'El recordatorio 3 días antes vende la clase extra de repaso — y calma nervios.',
        attrs: { estado: 'examen', examen_practico: d(30) } },
      { id: 'aut_bono', label: 'Permiso B — bono 10 clases',
        description: 'El bono con el teórico controlado empuja al alumno a terminar contigo, no a "dejarlo".',
        attrs: { tipo: 'b', estado: 'practicas', clases_restantes: 10, caducidad_teorico: d(730) } },
    ],
  },

  farmacia: {
    intro: 'Cada tratamiento crónico y cada SPD con su próxima dispensación — el aviso "te lo dejamos preparado" sale solo.',
    items: [
      { id: 'far_spd', label: 'SPD semanal (pastillero)',
        description: 'El SPD avisado cada semana fideliza al paciente (y a su familia) de por vida.',
        attrs: { nombre: 'SPD semanal', proxima_dispensacion: d(7), periodicidad: 'semanal' } },
      { id: 'far_cronico', label: 'Tratamiento crónico mensual',
        description: 'El "ya está listo para recoger" mensual ancla en tu farmacia todo lo demás que compra.',
        attrs: { nombre: 'Tratamiento crónico', proxima_dispensacion: d(30), periodicidad: 'mensual' } },
      { id: 'far_dermo', label: 'Dermocosmética — reposición (6 semanas)',
        description: 'Avisar de la reposición antes de que se acabe evita que lo compre online.',
        attrs: { nombre: 'Rutina dermocosmética', proxima_dispensacion: d(42), periodicidad: 'mensual' } },
    ],
  },

  reconocimientos: {
    intro: 'Cada certificado con su caducidad — la renovación ES tu negocio: el aviso llega un mes antes y el cliente vuelve sin buscar otro centro.',
    items: [
      { id: 'rec_carnet', label: 'Carnet de conducir — caduca en 10 años',
        description: 'El aviso un mes antes trae la renovación a tu centro, sin colas y sin comparar.',
        attrs: { tipo: 'carnet_conducir', fecha_emision: d(0), fecha_caducidad: d(3650) } },
      { id: 'rec_carnet65', label: 'Carnet +65 — renovación cada 5 años',
        description: 'El conductor senior renueva más a menudo: es tu cliente más recurrente si le avisas tú.',
        attrs: { tipo: 'carnet_conducir', fecha_caducidad: d(1825) } },
      { id: 'rec_armas', label: 'Licencia de armas',
        description: 'El cazador renueva cada 5 años religiosamente — con quien se lo recuerda.',
        attrs: { tipo: 'armas', fecha_caducidad: d(1825) } },
      { id: 'rec_nautico', label: 'Título náutico / embarcaciones',
        description: 'El náutico es renovación de temporada: el aviso en primavera llega en el momento justo.',
        attrs: { tipo: 'embarcaciones', fecha_caducidad: d(3650) } },
    ],
  },

  generico: {
    intro: 'Cada cuota, contrato o garantía de tus clientes con su vencimiento — el aviso de renovación sale solo antes de la fecha.',
    items: [
      { id: 'gen_mensual', label: 'Cuota mensual',
        description: 'La cuota avisada antes de vencer se renueva sin fricción — y sin impagos silenciosos.',
        attrs: { nombre: 'Cuota mensual', vencimiento: d(30), periodicidad: 'mensual' } },
      { id: 'gen_anual', label: 'Contrato anual',
        description: 'La renovación anual avisada con 15 días se firma; la olvidada se pierde en silencio.',
        attrs: { nombre: 'Contrato anual', vencimiento: d(365), periodicidad: 'anual' } },
      { id: 'gen_trimestral', label: 'Revisión trimestral',
        description: 'El servicio trimestral con aviso automático son 4 ventas al año en piloto automático.',
        attrs: { nombre: 'Revisión trimestral', vencimiento: d(90), periodicidad: 'trimestral' } },
      { id: 'gen_garantia', label: 'Garantía de compra — 2 años',
        description: 'El aviso antes de vencer la garantía es la excusa perfecta para la revisión (y la venta).',
        attrs: { nombre: 'Garantía', vencimiento: d(730), periodicidad: 'unico' } },
    ],
  },
};

// ─── Resolución de fechas relativas (PURA) ───────────────────────────────────

/** ¿Es un marcador de fecha relativa { rel_days }? */
function isRelativeDate(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.rel_days === 'number';
}

/**
 * { rel_days: 90 } + now → 'AAAA-MM-DD' (fecha LOCAL, no UTC: el dueño
 * piensa en días de calendario, no en husos). PURA.
 */
function resolveRelativeDate(spec, now = new Date()) {
  const base = new Date(now.getTime());
  base.setDate(base.getDate() + spec.rel_days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Attrs de un preset con las fechas relativas resueltas A HOY (o al `now`
 * dado). El resto de valores pasa tal cual. PURA — no muta el catálogo.
 */
function resolvePresetAttrs(attrs, now = new Date()) {
  const out = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    out[k] = isRelativeDate(v) ? resolveRelativeDate(v, now) : v;
  }
  return out;
}

// ─── Resolución por sector (mismos alias que las plantillas) ─────────────────

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Presets crudos de un sector (o alias) — null si no hay. */
function presetsForSector(sectorRaw) {
  if (!sectorRaw) return null;
  const direct = ENTITY_PRESETS[_norm(sectorRaw)];
  if (direct) return direct;
  try {
    const { resolveSector } = require('../sectors/sector-registry');
    const slug = resolveSector(sectorRaw).slug;
    return ENTITY_PRESETS[slug] || null;
  } catch (_) { return null; }
}

/**
 * Presets LISTOS PARA SERVIR: fechas relativas resueltas al momento y
 * anclados al tipo de entidad del sector (type = key de la plantilla),
 * para que el portal solo los muestre en la pestaña correcta.
 * @returns {{ type, intro, items: [{id,label,description,attrs}] } | null}
 */
function resolvePresetsForSector(sectorRaw, now = new Date()) {
  const preset = presetsForSector(sectorRaw);
  if (!preset || !preset.items || !preset.items.length) return null;

  const { templatesForSector } = require('./entity-types');
  const templates = templatesForSector(sectorRaw);
  if (!templates.length) return null; // sin plantilla no hay formulario que prellenar

  return {
    type:  templates[0].key,
    intro: preset.intro,
    items: preset.items.map(p => ({
      id:          p.id,
      label:       p.label,
      description: p.description,
      attrs:       resolvePresetAttrs(p.attrs, now),
    })),
  };
}

module.exports = {
  ENTITY_PRESETS,
  isRelativeDate,
  resolveRelativeDate,
  resolvePresetAttrs,
  presetsForSector,
  resolvePresetsForSector,
};
