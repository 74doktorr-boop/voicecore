// ============================================
// NodeFlow — Post-call email notifications
// System A: booking confirmation, owner summary, followup
// ============================================

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('CALL-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function firstName(name = '') { return name.split(' ')[0]; }

// ── 1. Booking confirmation to client ─────────────────────────────────────────

/**
 * @param {object} appointment   - { patientName, email, service, date, time, phone, price? }
 * @param {object} config        - { name, ownerPhone, language, address? }
 */
async function sendBookingConfirmationEmail(appointment, config) {
  if (!appointment?.email) {
    log.warn('sendBookingConfirmationEmail: no email in appointment — skipped');
    return false;
  }

  const lang       = config?.language || 'es';
  const name       = firstName(appointment.patientName);
  const bizName    = esc(config?.name || 'tu negocio');
  const service    = esc(appointment.service || '');
  const date       = esc(appointment.date    || '');
  const time       = esc(appointment.time    || '');
  const phone      = esc(config?.ownerPhone  || '');
  const address    = esc(config?.address     || '');

  const gcalBase   = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const gcalTitle  = encodeURIComponent(`${appointment.service || 'Cita'} — ${config?.name || ''}`);
  const gcalStart  = (date + 'T' + time.replace(':','') + '00').replace(/-/g,'');
  // Calculate end time: use appointment.duration (minutes) or default 30 min
  const durationMin = appointment.duration || 30;
  const [h, m]     = time.split(':').map(Number);
  const totalMin   = h * 60 + m + durationMin;
  const endH       = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
  const endM       = String(totalMin % 60).padStart(2, '0');
  const gcalEnd    = (date + 'T' + endH + endM + '00').replace(/-/g,'');
  const gcalLink   = `${gcalBase}&text=${gcalTitle}&dates=${gcalStart}/${gcalEnd}&ctz=Europe%2FMadrid`;

  // Spanish template
  if (lang === 'es' || lang === 'gl') {
    const greeting = lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
    const confirmed = lang === 'gl' ? 'A túa cita está confirmada' : 'Tu cita está confirmada';
    const addCal   = lang === 'gl' ? 'Engadir ao calendario' : 'Añadir al calendario';
    const cancel   = lang === 'gl' ? 'Para cancelar ou cambiar, responde a este email ou chama ao' : 'Para cancelar o cambiar, responde a este email o llama al';

    const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#07071200;margin:0;padding:0;">
<div style="max-width:520px;margin:32px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px 32px;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em;">NodeFlow</div>
    <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">${confirmed}</div>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#e2e8f0;font-size:16px;margin:0 0 20px;">${greeting} 👋</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Negocio</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${bizName}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Servicio</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${service}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Fecha</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${date}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Hora</td><td style="color:#a855f7;font-size:15px;font-weight:800;text-align:right;">${time}h</td></tr>
        ${address ? `<tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Dirección</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${address}</td></tr>` : ''}
      </table>
    </div>
    <a href="${gcalLink}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:16px;">📅 ${addCal}</a>
    <p style="color:#64748b;font-size:12px;margin:0;">${cancel} <strong style="color:#94a3b8;">${phone}</strong></p>
  </div>
</div>
</body></html>`;

    const subject = lang === 'gl'
      ? `✅ Cita confirmada — ${config?.name || 'o teu negocio'}`
      : `✅ Cita confirmada — ${config?.name || 'tu negocio'}`;

    return sendEmail({ to: appointment.email, subject, html });
  }

  // Basque template
  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:520px;margin:32px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px 32px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">NodeFlow</div>
    <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">Zure hitzordua baieztatuta dago</div>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#e2e8f0;font-size:16px;margin:0 0 20px;">Kaixo ${esc(name)} 👋</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Negozioa</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${bizName}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Zerbitzua</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${service}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Data</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${date}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Ordua</td><td style="color:#a855f7;font-size:15px;font-weight:800;text-align:right;">${time}</td></tr>
      </table>
    </div>
    <a href="${gcalLink}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:16px;">📅 Egutegiari gehitu</a>
    <p style="color:#64748b;font-size:12px;margin:0;">Aldaketak egiteko, erantzun email hau edo deitu <strong style="color:#94a3b8;">${phone}</strong></p>
  </div>
</div>
</body></html>`;

  return sendEmail({ to: appointment.email, subject: `✅ Hitzordua baieztatuta — ${config?.name || ''}`, html });
}

// ── 2. Call summary to business owner ─────────────────────────────────────────

// Email al que van los AVISOS del negocio. El dueño puede cambiarlo en el portal
// (Ajustes → notifyEmail); ese valor MANDA sobre el email de alta (owner_email),
// que se queda para login/facturación. Bug real 2026-07-12: se cambió el email
// en el portal y los avisos seguían yendo al de alta porque este envío leía
// owner_email directamente.
function ownerNotifyEmail(config) {
  const notify = config && config.automations && config.automations.config && config.automations.config.notifyEmail;
  return (notify && String(notify).trim()) || (config && config.ownerEmail) || null;
}

/**
 * @param {object} callData  - session.toJSON() result
 * @param {object} config    - { name, ownerEmail, ownerPhone, language, automations }
 */
async function sendCallSummaryToOwner(callData, config) {
  const to = ownerNotifyEmail(config);
  if (!to) {
    log.warn('sendCallSummaryToOwner: no ownerEmail/notifyEmail in config — skipped');
    return false;
  }

  const outcome      = callData.outcome    || 'abandoned';
  const caller       = esc(callData.callerNumber || 'desconocido');
  const dur          = esc(callData.durationFormatted || '0:00');
  const turns        = callData.turnCount  || 0;
  const bizName      = esc(config.name     || 'tu negocio');
  const apt          = callData.bookedAppointment;
  const outcomeBadge = outcome === 'booked' ? '✅ RESERVA' : outcome === 'info' ? 'ℹ️ CONSULTA' : '❌ ABANDONADA';

  let aptRows = '';
  if (apt) {
    aptRows = `
    <tr style="background:rgba(124,58,237,.08);">
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Cliente</td>
      <td style="color:#e2e8f0;font-size:12px;font-weight:600;padding:5px 8px;">${esc(apt.patientName)}</td>
    </tr>
    <tr>
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Servicio</td>
      <td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.service)}</td>
    </tr>
    <tr style="background:rgba(124,58,237,.08);">
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Fecha / Hora</td>
      <td style="color:#a855f7;font-size:13px;font-weight:700;padding:5px 8px;">${esc(apt.date)} a las ${esc(apt.time)}h</td>
    </tr>`;
    if (apt.email) aptRows += `<tr><td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Email</td><td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.email)}</td></tr>`;
    if (apt.phone) aptRows += `<tr style="background:rgba(124,58,237,.08);"><td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Teléfono</td><td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.phone)}</td></tr>`;
  }

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:540px;margin:24px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:#13131a;padding:20px 28px;border-bottom:1px solid rgba(255,255,255,.06);">
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;">NodeFlow · Resumen de llamada</span>
    <div style="font-size:18px;font-weight:800;color:#fff;margin-top:4px;">${bizName}</div>
  </div>
  <div style="padding:24px 28px;">
    <div style="display:inline-block;background:${outcome==='booked'?'rgba(34,197,94,.12)':outcome==='info'?'rgba(59,130,246,.1)':'rgba(239,68,68,.1)'};border:1px solid ${outcome==='booked'?'rgba(34,197,94,.3)':outcome==='info'?'rgba(59,130,246,.3)':'rgba(239,68,68,.3)'};border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;color:${outcome==='booked'?'#4ade80':outcome==='info'?'#60a5fa':'#f87171'};margin-bottom:20px;">${outcomeBadge}</div>
    <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,.03);border-radius:10px;overflow:hidden;">
      <tr style="background:rgba(255,255,255,.04);">
        <td style="color:#94a3b8;font-size:12px;padding:8px 12px;">Número</td>
        <td style="color:#e2e8f0;font-size:12px;font-weight:600;padding:8px 12px;">${caller}</td>
      </tr>
      <tr>
        <td style="color:#94a3b8;font-size:12px;padding:8px 12px;">Duración</td>
        <td style="color:#e2e8f0;font-size:12px;padding:8px 12px;">${dur} · ${turns} turnos</td>
      </tr>
      ${aptRows}
    </table>
    ${apt && config.ownerPhone ? `<a href="https://wa.me/${(config.ownerPhone||'').replace(/\D/g,'')}?text=${encodeURIComponent(`Hola, te confirmo la cita de ${apt.patientName} el ${apt.date} a las ${apt.time}h`)}" style="display:block;margin-top:16px;background:#25d366;color:#fff;text-decoration:none;text-align:center;padding:12px;border-radius:10px;font-weight:700;font-size:14px;">📲 Enviar confirmación WA al cliente</a>` : ''}
  </div>
</div>
</body></html>`;

  const subject = outcome === 'booked'
    ? `📞 Nueva reserva — ${callData.callerNumber} · ${apt?.date || ''}`
    : `📞 Llamada ${outcomeBadge} — ${callData.callerNumber} (${dur})`;

  return sendEmail({ to, subject, html });
}

// ── 3. Follow-up email to client (info calls only) ────────────────────────────

const SECTOR_COLORS = {
  peluqueria: '#7c3aed', estetica: '#db2777', dental: '#0891b2',
  clinica: '#059669', veterinaria: '#d97706', taller: '#475569',
  gimnasio: '#7c3aed', fisioterapia: '#0284c7', optica: '#7c3aed',
  psicologia: '#6d28d9', restaurante: '#dc2626', farmacia: '#059669',
  default: '#7c3aed',
};

const SECTOR_FOLLOWUP = {
  peluqueria:   { body: 'Si tienes alguna duda sobre el servicio o quieres reservar otra cita, llámanos o escríbenos directamente.', ctaBook: 'Reservar cita →' },
  estetica:     { body: 'Cuando quieras retomar tu tratamiento o reservar una nueva sesión, aquí estaremos.', ctaBook: 'Reservar sesión →' },
  dental:       { body: 'Cualquier duda sobre tu tratamiento o para pedir cita, contacta con nosotros cuando quieras.', ctaBook: 'Pedir cita →' },
  clinica:      { body: 'Si tienes alguna pregunta sobre tu consulta o quieres pedir cita, estamos disponibles.', ctaBook: 'Pedir cita →' },
  veterinaria:  { body: 'Si tu mascota necesita algo más o quieres reservar una revisión, aquí estamos.', ctaBook: 'Reservar revisión →' },
  taller:       { body: 'Si tienes alguna duda sobre el presupuesto o quieres traer el coche, llámanos.', ctaBook: 'Pedir cita →' },
  gimnasio:     { body: 'Si quieres apuntarte, probar una clase o tienes alguna pregunta, aquí estamos.', ctaBook: 'Reservar clase →' },
  fisioterapia: { body: 'Si quieres reservar tu primera cita o tienes dudas sobre el tratamiento, llámanos.', ctaBook: 'Reservar cita →' },
  restaurante:  { body: 'Para reservas o cualquier consulta, contáctanos cuando quieras.', ctaBook: 'Hacer reserva →' },
  default:      { body: 'Si necesitas algo más o quieres reservar una cita, aquí estamos para ayudarte.', ctaBook: 'Contactar →' },
};

/**
 * @param {object} callData  - session.toJSON() - { clientEmail, clientName?, callerNumber }
 * @param {object} config    - { name, ownerPhone, language, sector }
 */
async function sendCallFollowUpEmail(callData, config) {
  if (!callData?.clientEmail) {
    log.warn('sendCallFollowUpEmail: no clientEmail in callData — skipped');
    return false;
  }

  const lang     = config?.language || 'es';
  const sector   = config?.sector   || 'default';
  const color    = SECTOR_COLORS[sector] || SECTOR_COLORS.default;
  const copy     = SECTOR_FOLLOWUP[sector] || SECTOR_FOLLOWUP.default;
  const bizName  = esc(config?.name || 'nuestro negocio');
  const rawName  = firstName(callData.clientName || '');
  const name     = rawName ? esc(rawName) : null;
  const phone    = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');

  const greeting = lang === 'eu'
    ? (name ? `Kaixo ${name}` : 'Kaixo')
    : (name ? `Hola ${name}` : 'Hola');

  const waText = encodeURIComponent(lang === 'eu'
    ? `Kaixo, ${bizName}-ri buruz informazioa nahi nuke.`
    : `Hola, he llamado antes a ${config?.name || 'vuestro negocio'} y tenía una consulta.`);
  const rawPhone = phone.replace(/\D/g, '');
  const waPhone  = rawPhone.startsWith('34') || rawPhone.startsWith('00') ? rawPhone : '34' + rawPhone;
  const waLink   = phone ? `https://wa.me/${waPhone}?text=${waText}` : '';

  const subject = lang === 'eu'
    ? `Eskerrik asko deitu izanagatik — ${config?.name || ''}`
    : `Gracias por llamar a ${config?.name || 'nosotros'}`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <tr><td style="background:linear-gradient(135deg,${color},${color}cc);border-radius:16px 16px 0 0;padding:24px 28px;">
      <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-.02em;">${bizName}</div>
      <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:3px;">
        ${lang === 'eu' ? 'Eskerrik asko deitu izanagatik' : 'Gracias por tu llamada'}
      </div>
    </td></tr>

    <tr><td style="background:#ffffff;padding:26px 28px 22px;">
      <p style="font-size:16px;font-weight:700;color:#0f0f23;margin:0 0 10px;">${greeting} 👋</p>
      <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 24px;">
        ${lang === 'eu'
          ? `Zure deia jasota dugu. ${esc(copy.body.replace('Cuando quieras', 'Nahi duzunean').replace('aquí estamos', 'hemen gaude').replace('llámanos', 'deitu iezaguzu'))}`
          : esc(copy.body)}
      </p>

      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:13px 22px;color:#fff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${lang === 'eu' ? 'Deitu' : copy.ctaBook}</a>
            </td></tr></table>
          </td>` : ''}
          ${waLink ? `<td>
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#25d366;">
              <a href="${waLink}" style="display:inline-block;padding:13px 20px;color:#fff;text-decoration:none;font-size:14px;font-weight:700;">💬 WhatsApp</a>
            </td></tr></table>
          </td>` : ''}
        </tr>
      </table>
    </td></tr>

    <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:14px 28px;border-top:1px solid #e8e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">
        ${lang === 'eu' ? 'NodeFlow IAk sortutako mezua automatikoki' : 'Mensaje generado automáticamente por'} <a href="https://nodeflow.es" style="color:${color};text-decoration:none;">NodeFlow IA</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = `${greeting},\n\n${copy.body}\n\n${phone ? `📞 ${phone}` : ''}\n${waLink ? `💬 WhatsApp: ${waLink}` : ''}\n\n— ${config?.name || 'NodeFlow'}`;

  return sendEmail({ to: callData.clientEmail, subject, html, text });
}

module.exports = { sendBookingConfirmationEmail, sendCallSummaryToOwner, sendCallFollowUpEmail, ownerNotifyEmail };
