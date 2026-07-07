// ============================================================
// NodeFlow — Plantillas WhatsApp (Meta UTILITY)
// Única fuente de verdad de las 3 plantillas de avisos al cliente.
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
