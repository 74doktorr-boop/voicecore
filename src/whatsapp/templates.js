// ============================================================
// NodeFlow — Plantillas WhatsApp (Meta UTILITY)
// Única fuente de verdad de las plantillas de avisos al cliente.
// La usan: el alta manual (scripts/wa-submit-templates.js) y el
// alta automática al conectar un número propio (meta-connect.js).
// Variables del cuerpo: {{1}}=nombre {{2}}=negocio {{3}}=fecha
//   {{4}}=hora {{5}}=servicio (según plantilla).
// ============================================================
'use strict';

const WA_TEMPLATES = [
  {
    name: 'nodeflow_cita_confirmada',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        // OJO Meta: una plantilla no puede EMPEZAR ni TERMINAR en variable —
        // el cierre "¡Te esperamos!" no es adorno, es requisito del alta.
        text: 'Hola {{1}}, tu cita en {{2}} ha sido confirmada para el {{3}} a las {{4}}. Servicio: {{5}}. ¡Te esperamos!',
        example: { body_text: [['María', 'Clínica Osakin', '5 de julio', '10:00', 'Fisioterapia']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Sistema de citas inteligente' },
    ],
  },
  {
    name: 'nodeflow_cita_recordatorio',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        // OJO Meta: no puede terminar en variable (ver nota en cita_confirmada).
        text: 'Hola {{1}}, te recordamos tu cita en {{2}} mañana {{3}} a las {{4}}. Servicio: {{5}}. ¿Podrás venir?',
        example: { body_text: [['María', 'Clínica Osakin', '5 de julio', '10:00', 'Fisioterapia']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'CONFIRMAR' },
          { type: 'QUICK_REPLY', text: 'CANCELAR' },
        ],
      },
    ],
  },
  {
    name: 'nodeflow_resena',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola {{1}}! ¿Qué tal tu experiencia en {{2}}? Tu opinión nos ayuda mucho. Déjanos una reseña, solo te llevará un momento.',
        example: { body_text: [['María', 'Clínica Osakin']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Dejar reseña', url: 'https://g.page/r/{{1}}', example: ['example/review'] },
        ],
      },
    ],
  },
  {
    // Seguimiento del MOTOR por sector ("ha llegado el momento de X"): es la
    // plantilla que envía el lifecycle-scheduler para recordatorios de servicio
    // (renovación de psicotécnico, corte a los 24 días, ITV…). Sin ella dada
    // de alta, TODO el canal WhatsApp del motor de seguimientos falla.
    name: 'nodeflow_recordatorio_servicio',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}} 👋 Te escribimos desde {{2}}. Ha llegado el momento de {{3}}. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.',
        example: { body_text: [['María', 'Clínica Osakin', 'la renovación de tu psicotécnico']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más avisos' },
    ],
  },
  {
    // AVISO 100% PERSONALIZADO: la plantilla-portadora de los seguimientos
    // con texto libre del dueño ({{3}} = su frase entera, con {detalle} de
    // la ficha ya sustituido). Personalización total dentro de las reglas
    // de Meta. MARKETING → opt-out obligatorio.
    name: 'nodeflow_aviso',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, un mensaje de {{2}}: {{3}} Puedes respondernos por aquí o llamarnos cuando quieras.',
        example: { body_text: [['María', 'Fisioterapia Lasarte', '¿cómo va la lumbalgia? Si vuelve a molestar, te reservamos hueco esta semana.']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más avisos' },
    ],
  },
  {
    // POST-SERVICIO ("¿qué tal fue?"): a los ~3 días de una cita completada.
    // Doble valor: caza al insatisfecho ANTES de la reseña negativa y abre
    // conversación (la respuesta llega al webhook → aviso al dueño).
    name: 'nodeflow_como_fue',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, somos {{2}}. ¿Qué tal fue {{3}}? Si necesitas cualquier ajuste o tienes alguna duda, respóndenos por aquí y te ayudamos encantados.',
        example: { body_text: [['María', 'Taller Garaia', 'la reparación de tu coche']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más avisos' },
    ],
  },
  // NOTA (2026-07-07, oportunidad 7): Meta NO admite euskera (eu) ni gallego
  // (gl) como idioma de plantilla de WhatsApp (sí catalán) — verificado por
  // API. Por eso el motor no tiene variantes eu/gl aquí: templateLanguage cae
  // a 'es' y el WhatsApp automático sale con marco español. La localización a
  // eu/gl SÍ ocurre en SMS/email (texto libre, ver fallbackText en scheduler)
  // y en los mensajes propios del dueño, que puede escribirlos en su lengua
  // dentro de la plantilla-portadora nodeflow_aviso ({{3}} = texto libre).
  {
    // POST-SERVICIO v2 con BOTONES (2026-07-07): responder cuesta un tap →
    // dispara la tasa de respuesta del check-in. 👍 abre la máquina de
    // reseñas (ventana 24h); 👎 alerta urgente al dueño (circuito Fase B).
    // Se activa con WA_COMO_FUE_BUTTONS=1 cuando Meta la apruebe.
    name: 'nodeflow_como_fue_v2',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, somos {{2}}. ¿Qué tal fue {{3}}? Nos encantaría saberlo — y si necesitas cualquier ajuste, respóndenos por aquí.',
        example: { body_text: [['María', 'Taller Garaia', 'la reparación de tu coche']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Todo genial' },
          { type: 'QUICK_REPLY', text: 'Se puede mejorar' },
        ],
      },
    ],
  },
  {
    // HUECO LIBRE (2026-07-07): al cancelarse una cita, se ofrece el hueco al
    // primer candidato de la lista de espera. {{3}}=fecha {{4}}=hora {{5}}=servicio.
    // Botones: acepta / rechaza. UTILITY (es transaccional: responde a su
    // solicitud de estar en lista). Gateado por WA_WAITLIST_AUTOOFFER=1.
    name: 'nodeflow_hueco_libre',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: '¡Hola {{1}}! Se ha liberado un hueco en {{2}}: {{3}} a las {{4}} para {{5}}. Estabas en lista de espera — ¿lo quieres? Responde y te lo reservamos.',
        example: { body_text: [['María', 'Clínica Osakin', 'el jueves 10 de julio', '17:00', 'Fisioterapia']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Lo quiero' },
          { type: 'QUICK_REPLY', text: 'Ahora no' },
        ],
      },
    ],
  },
  {
    // PROMOCIONES del negocio (botón 📣 del portal): el dueño escribe el texto
    // ({{3}}) y llega a sus clientes elegibles. MARKETING → opt-out obligatorio.
    name: 'nodeflow_promo',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, desde {{2}} queremos contarte algo: {{3}} Si te interesa, responde a este mensaje y te atendemos al momento.',
        example: { body_text: [['María', 'Peluquería Ainhoa', 'este mes el tinte + corte tiene un 15% de descuento.']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más mensajes' },
    ],
  },
  {
    // PRE-ITV (2026-07-08, motor de entidades): la fecha de ITV del vehículo
    // es el gancho de urgencia, pero el CTA es el servicio DEL TALLER (la
    // revisión pre-ITV) — vendemos su hueco, no el trámite. {{3}}=vehículo
    // ("tu Golf", "la furgoneta"). MARKETING → opt-out obligatorio.
    name: 'nodeflow_pre_itv',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        // OJO Meta: no puede empezar ni terminar en variable (ver cita_confirmada).
        text: 'Hola {{1}}, te escribimos de {{2}}: a {{3}} le toca pronto la ITV. Si quieres, te lo revisamos antes para que pases a la primera y sin sustos. Responde a este mensaje y te damos hueco esta misma semana.',
        example: { body_text: [['María', 'Taller Garaia', 'tu Volkswagen Golf']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más avisos' },
    ],
  },
  {
    // HUECO URGENTE (2026-07-08, motor de entidades): variante del hueco libre
    // pero dirigida por URGENCIA de ficha (ITV/vacuna/revisión que vence), no
    // por lista de espera → es una oferta, MARKETING. {{3}}=cuándo es el hueco
    // ("mañana jueves a las 10:00"), {{4}}=para qué ("la revisión pre-ITV").
    name: 'nodeflow_hueco_urgente',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, buenas noticias desde {{2}}: se nos ha quedado libre un hueco {{3}} y hemos pensado en ti para {{4}}. ¿Lo quieres? Responde a este mensaje y te lo guardamos ahora mismo.',
        example: { body_text: [['María', 'Taller Garaia', 'mañana jueves a las 10:00', 'la revisión pre-ITV de tu coche']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más avisos' },
    ],
  },
  {
    // GARANTÍA / REVISIÓN QUE VENCE (2026-07-08, motor de entidades): aviso
    // transaccional sobre algo que el cliente YA tiene contratado (su garantía,
    // su plan de revisiones) → UTILITY, sin opt-out de marketing. {{3}}=qué
    // vence ("la garantía de tu caldera"), {{4}}=fecha de vencimiento.
    name: 'nodeflow_garantia',
    category: 'UTILITY',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, te avisamos desde {{2}}: {{3}} vence el {{4}}. Si quieres que lo revisemos antes de esa fecha para que no pierdas la cobertura, responde a este mensaje y te reservamos cita.',
        example: { body_text: [['María', 'Instalaciones Bidasoa', 'la garantía de tu caldera', '15 de agosto']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Sistema de citas inteligente' },
    ],
  },
  {
    // CUMPLEAÑOS DE MASCOTA (2026-07-08, motor de entidades): el toque cálido
    // que ninguna clínica tiene tiempo de hacer a mano. {{3}}=nombre de la
    // mascota. El CTA es suave (chequeo/mimo), la felicitación es el mensaje.
    // MARKETING → opt-out obligatorio.
    name: 'nodeflow_cumple_mascota',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, desde {{2}} queremos felicitar a alguien muy especial: ¡{{3}} cumple años! 🎉 Dale un achuchón de nuestra parte. Y si quieres celebrarlo con un chequeo o una sesión de mimos, responde por aquí y le buscamos hueco.',
        example: { body_text: [['María', 'Clínica Veterinaria Txakur', 'Pintxo']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más mensajes' },
    ],
  },
  {
    // Reactivación de clientes antiguos (add-on Crecimiento, canal 'whatsapp').
    // OJO: categoría MARKETING (win-back), NO utility — Meta la revisa distinto
    // y exige opt-out. Requiere aprobación de Meta antes de poder enviarse.
    name: 'nodeflow_reactivacion',
    category: 'MARKETING',
    language: 'es',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}, hace un tiempo que no te vemos por {{2}} y nos encantaría volver a atenderte. ¿Te reservamos una cita cuando te venga bien? Responde a este mensaje y te ayudamos.',
        example: { body_text: [['María', 'Clínica Osakin']] },
      },
      { type: 'FOOTER', text: 'NodeFlow — Responde BAJA para no recibir más mensajes' },
    ],
  },
];

/**
 * Idioma SEGURO para enviar una plantilla: el preferido del cliente solo si
 * esa plantilla está dada de alta en ese idioma; si no, el idioma aprobado.
 * (Meta rechaza el envío si pides una combinación plantilla+idioma que no
 * existe — un cliente con preferencia 'eu' rompería el envío entero.)
 */
function templateLanguage(name, preferred) {
  const approved = WA_TEMPLATES.filter(t => t.name === name).map(t => t.language);
  if (!approved.length) return 'es';
  return approved.includes(preferred) ? preferred : approved[0];
}

module.exports = { WA_TEMPLATES, templateLanguage };
