// ============================================
// NodeFlow — No-Show Email Notification
// Sent when a client misses their appointment
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('NOSHOW-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n) { return (n ?? '').split(' ')[0]; }

/**
 * Sends a no-show recovery email to the client.
 * @param {object} apt    - appointment object from scheduler
 * @param {object} config - { name, ownerPhone, language }
 */
async function sendNoShowEmail(apt, config) {
  if (!apt?.email) {
    log.warn(`sendNoShowEmail: no email for ${apt?.patientName} — skipped`);
    return false;
  }

  const lang     = config?.language || 'es';
  const rawName  = firstName(apt.patientName);
  const name     = esc(rawName);
  const bizName  = esc(config?.name || 'nuestro equipo');
  const phone    = esc(config?.ownerPhone || '');
  const phoneClean = phone.replace(/[^0-9+\-\s]/g, '');
  const service  = esc(apt.service || 'tu cita');

  // Format appointment datetime
  let aptStr = `${apt.date} a las ${apt.time}`;
  try {
    const d = new Date(`${apt.date}T${apt.time}:00`);
    aptStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : 'es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) + ` a las ${apt.time}`;
  } catch(_) {}

  const greeting = lang === 'eu' ? `Kaixo ${name}` : `Hola ${name}`;
  const subject  = lang === 'eu'
    ? `${esc(config?.name || '')}: zure hitzordua falta duzu`
    : `${esc(config?.name || '')}: vimos que no pudiste venir hoy`;

  const bodyLine1 = lang === 'eu'
    ? `Gaur ${service} zure hitzordua zegoen (${esc(aptStr)}), baina ez zara etorri.`
    : `Tenías cita para <strong>${service}</strong> el <strong>${esc(aptStr)}</strong>, pero no pudiste venir.`;

  const bodyLine2 = lang === 'eu'
    ? `Ez kezkatu! Hitzordua beste egun batera aldatu dezakegu.`
    : `¡No te preocupes! A veces surgen imprevistos. ¿Quieres que te busquemos otro hueco?`;

  const ctaLabel = lang === 'eu' ? 'Deitu hurrengo data ezartzeko' : 'Llamar para reagendar';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : 'Para darte de baja de estos avisos, responde a este email.';

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.2);">
  <div style="background:linear-gradient(135deg,#1e1e2e,#2d2d3e);padding:24px 28px;border-bottom:2px solid #f59e0b;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;">NodeFlow · ${bizName}</div>
    <div style="font-size:20px;margin-top:6px;">😔 <span style="color:#fff;font-weight:800;">${lang === 'eu' ? 'Galdu duzun hitzordua' : 'Cita no atendida'}</span></div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 12px;">${greeting},</p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 12px;">${bodyLine1}</p>
    <p style="color:#e2e8f0;font-size:14px;line-height:1.7;margin:0 0 24px;">${bodyLine2}</p>
    ${phoneClean ? `<a href="tel:${phoneClean.replace(/\s/g,'')}" style="display:block;background:#f59e0b;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px;">📞 ${ctaLabel}</a>` : ''}
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">${unsubLabel}</p>
  </div>
</div>
</body></html>`;

  log.info(`No-show email sent to ${apt.email} (apt:${apt.id}, biz:${apt.businessId})`);
  return sendEmail({
    to: apt.email,
    subject,
    html,
  });
}

module.exports = { sendNoShowEmail };
