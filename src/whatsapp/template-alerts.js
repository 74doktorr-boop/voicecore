// ============================================================
// NodeFlow — Avisos de estado de plantillas (2026-07-07)
// Meta empuja message_template_status_update por el webhook cuando
// aprueba/rechaza/pausa una plantilla. En vez de que Unai pregunte
// "¿aprobaron?", el sistema le avisa al instante — y le recuerda
// qué flag encender cuando la plantilla desbloquea una feature.
// ============================================================
'use strict';

const { Logger } = require('../utils/logger');
const log = new Logger('TPL-ALERTS');

// Plantillas que desbloquean una feature gateada por env → el aviso de
// aprobación incluye el interruptor exacto para encenderla.
const UNLOCKS = {
  nodeflow_como_fue_v2: 'WA_COMO_FUE_BUTTONS=1 (botones 👍/👎 + máquina de reseñas)',
  nodeflow_hueco_libre: 'WA_WAITLIST_AUTOOFFER=1 (oferta automática de huecos a la lista de espera)',
};

/**
 * Construye el mensaje humano para un update de plantilla. PURA.
 * @param {{event?:string, message_template_name?:string, message_template_language?:string, reason?:string, other_info?:object}} value
 * @returns {{notify:boolean, text:string, event:string, name:string}}
 */
function buildTemplateStatusMessage(value = {}) {
  const event = String(value.event || '').toUpperCase();
  const name = value.message_template_name || '(sin nombre)';
  const lang = value.message_template_language || '';
  const out = { notify: false, text: '', event, name };

  if (event === 'APPROVED') {
    out.notify = true;
    out.text = `✅ *Plantilla APROBADA por Meta*\n${name}${lang ? ` [${lang}]` : ''}\n` +
      (UNLOCKS[name] ? `\n🔓 Desbloquea una feature — enciende en EasyPanel:\n${UNLOCKS[name]}` : '\nYa se puede usar en envíos.');
    return out;
  }
  if (event === 'REJECTED') {
    const reason = value.reason || value.other_info?.title || 'sin motivo indicado';
    out.notify = true;
    out.text = `❌ *Plantilla RECHAZADA por Meta*\n${name}${lang ? ` [${lang}]` : ''}\n📄 Motivo: ${reason}\n\nHay que reformularla y reenviarla.`;
    return out;
  }
  if (event === 'PAUSED' || event === 'DISABLED' || event === 'FLAGGED') {
    out.notify = true;
    out.text = `⚠️ *Plantilla ${event} por Meta*\n${name}${lang ? ` [${lang}]` : ''}\n` +
      `Meta la ha limitado (normalmente por quejas/baja calidad). Los envíos con ella pueden fallar — revisar en el panel de Meta.`;
    return out;
  }
  // PENDING u otros estados intermedios: sin ruido.
  return out;
}

/**
 * Procesa el update: construye el mensaje y avisa a Unai (WhatsApp del
 * founder + email como respaldo). Nunca lanza.
 */
async function handleTemplateStatusUpdate(value, deps = {}) {
  const msg = buildTemplateStatusMessage(value);
  log.info(`Plantilla ${msg.name}: ${msg.event}${msg.notify ? ' → avisando' : ''}`);
  if (!msg.notify) return { notified: false, ...msg };

  const sendWhatsApp = deps.sendWhatsApp || require('../notifications/whatsapp').sendWhatsApp;
  const sendEmail = deps.sendEmail || require('../notifications/email').sendEmail;
  let notified = false;
  try { await sendWhatsApp(msg.text); notified = true; } catch (e) { log.warn(`aviso WA falló: ${e.message}`); }
  try {
    await sendEmail({
      to: process.env.NOTIFY_EMAIL || 'unai@nodeflow.es',
      subject: `${msg.event === 'APPROVED' ? '✅' : msg.event === 'REJECTED' ? '❌' : '⚠️'} Plantilla ${msg.name}: ${msg.event}`,
      text: msg.text.replace(/\*/g, ''),
      html: `<pre style="font-family:inherit;white-space:pre-wrap;font-size:14px">${
        msg.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*/g, '')
      }</pre>`,
    });
    notified = true;
  } catch (e) { log.warn(`aviso email falló: ${e.message}`); }
  return { notified, ...msg };
}

module.exports = { buildTemplateStatusMessage, handleTemplateStatusUpdate, UNLOCKS };
