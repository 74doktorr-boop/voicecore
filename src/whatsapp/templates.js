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
        text: 'Hola {{1}}, tu cita en {{2}} ha sido confirmada para el {{3}} a las {{4}}. Servicio: {{5}}.',
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
        text: 'Hola {{1}}, te recordamos tu cita en {{2}} mañana {{3}} a las {{4}}. Servicio: {{5}}.',
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

module.exports = { WA_TEMPLATES };
