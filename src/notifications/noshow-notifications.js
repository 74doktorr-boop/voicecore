// ============================================
// NodeFlow — No-Show Email Notification v2
// Sector-aware, trilingual (es/eu/gl)
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('NOSHOW-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstName(n) { return (n ?? '').split(' ')[0]; }

// ─── Sector config ────────────────────────────────────────────────────────────

const SECTOR_CONFIG = {
  peluqueria:   { emoji: '✂️', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  estetica:     { emoji: '💅', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  dental:       { emoji: '🦷', color: '#0891b2', light: '#f0f9ff', dark: '#0c4a6e' },
  clinica:      { emoji: '🏥', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  veterinaria:  { emoji: '🐾', color: '#d97706', light: '#fffbeb', dark: '#78350f' },
  taller:       { emoji: '🔧', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  gimnasio:     { emoji: '💪', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  fisioterapia: { emoji: '🏃', color: '#0284c7', light: '#f0f9ff', dark: '#0c4a6e' },
  optica:       { emoji: '👓', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  psicologia:   { emoji: '🧠', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  restaurante:  { emoji: '🍽️', color: '#dc2626', light: '#fff5f5', dark: '#7f1d1d' },
  farmacia:     { emoji: '💊', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  academia:     { emoji: '📚', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  asesoria:     { emoji: '📊', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  yoga:         { emoji: '🧘', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  pilates:      { emoji: '🏃', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  nutricion:    { emoji: '🥗', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  default:      { emoji: '📅', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
};

// ─── Per-sector no-show copy ──────────────────────────────────────────────────

const NOSHOW_COPY = {
  peluqueria: {
    es: { hook: 'Reservamos tu hueco para nada', body: 'El estilista tenía ese rato solo para ti. Pasa, son cosas de la vida — ¿lo reagendamos para esta semana?' },
    eu: { hook: 'Zure tartea alferrik gorde genuen', body: 'Estilista zuri bakarrik denbora hori gordea zuen. Gertatzen da — aste honetan berregiten dugu?' },
  },
  estetica: {
    es: { hook: 'Tu tratamiento sigue esperando', body: 'La cabina y el horario estaban reservados para ti. Sabemos que surgen imprevistos — ¿buscamos otro hueco esta semana?' },
  },
  dental: {
    es: { hook: 'Tu revisión dental sigue pendiente', body: 'El dentista tenía ese hueco bloqueado para ti. Si el dolor o los nervios te frenaron, te entendemos. ¿Lo reagendamos sin compromiso?' },
  },
  clinica: {
    es: { hook: 'Tu cita médica quedó libre', body: 'Reservamos ese hueco para ti con el médico. Tu salud es lo primero — ¿lo dejamos para la semana que viene?' },
  },
  veterinaria: {
    es: { hook: 'La consulta de tu mascota quedó libre', body: 'El veterinario tenía ese tiempo para vosotros. Las emergencias ocurren — ¿lo reagendamos para esta semana?' },
  },
  taller: {
    es: { hook: 'El hueco del taller quedó sin usar', body: 'Bloqueamos tiempo y el elevador para tu coche. Sabemos que el día a día complica las cosas — ¿volvemos a intentarlo?' },
  },
  gimnasio: {
    es: { hook: 'Te echamos de menos en la sesión', body: 'La clase de hoy tenía tu plaza reservada. Sin drama — los hábitos se construyen día a día. ¿Reservamos la próxima sesión?' },
  },
  fisioterapia: {
    es: { hook: 'Tu sesión de fisio quedó libre', body: 'El fisioterapeuta tenía ese rato reservado para ti. Los tratamientos funcionan mejor cuando no se interrumpen — ¿lo reagendamos?' },
  },
  restaurante: {
    es: { hook: 'Guardamos vuestra mesa sin noticias', body: 'Teníamos mesa y sillas listas para vosotros. Se entiende que pueden surgir contratiempos — ¿repetimos con una nueva reserva?' },
  },
  psicologia: {
    es: { hook: 'Tu sesión de hoy quedó libre', body: 'Estaba aquí esperándote. Si hoy no fue el día, no pasa nada — lo importante es que sigas. ¿Lo dejamos para esta semana?' },
  },
  default: {
    es: { hook: 'Vimos que no pudiste venir hoy', body: '¡No te preocupes! Pasan estas cosas. Si quieres, te buscamos otro hueco para que podamos atenderte.' },
    eu: { hook: 'Gaur ezin izan duzula etorri ikusi dugu', body: 'Ez kezkatu! Gertatzen da. Nahi baduzu, beste data bat bilatzen dizugu.' },
  },
};

function getNoShowCopy(sector, lang) {
  const s = NOSHOW_COPY[sector] || NOSHOW_COPY.default;
  const l = s[lang] || s.es || NOSHOW_COPY.default.es;
  return l;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * @param {object} apt    - { email, patientName, date, time, service, id, businessId }
 * @param {object} config - { name, ownerPhone, language, sector }
 */
async function sendNoShowEmail(apt, config) {
  if (!apt?.email) {
    log.warn(`sendNoShowEmail: no email for ${apt?.patientName} — skipped`);
    return false;
  }

  const lang      = config?.language || 'es';
  const sector    = config?.sector   || 'default';
  const sc        = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const copy      = getNoShowCopy(sector, lang);
  const rawName   = firstName(apt.patientName);
  const name      = esc(rawName);
  const bizName   = esc(config?.name || 'nuestro equipo');
  const phone     = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');
  const service   = esc(apt.service || 'tu cita');

  // Format appointment datetime
  let aptStr = `${apt.date} a las ${apt.time}`;
  try {
    const d = new Date(`${apt.date}T${apt.time}:00`);
    aptStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) + ` a las ${apt.time}`;
  } catch(_) {}

  const greeting  = lang === 'eu' ? `Kaixo ${name}` : lang === 'gl' ? `Ola ${name}` : `Hola ${name}`;
  const ctaCall   = lang === 'eu' ? 'Deitu reagendatzeko' : lang === 'gl' ? 'Chamar para reagendar' : 'Llamar para reagendar';
  const ctaWa     = lang === 'eu' ? 'WhatsApp bidez' : 'Por WhatsApp';
  const serviceLabel = lang === 'eu' ? 'Zerbitzua' : lang === 'gl' ? 'Servizo' : 'Servicio';
  const dateLabel    = lang === 'eu' ? 'Eguna' : lang === 'gl' ? 'Data' : 'Fecha';
  const unsubLabel   = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : lang === 'gl'
    ? 'Para non recibir máis avisos, responde a este correo.'
    : 'Para darte de baja de estos avisos, responde a este email.';

  // WhatsApp deep link
  const waText = encodeURIComponent(lang === 'eu'
    ? `Kaixo, ${rawName} naiz. Hitzordua galdu nuen eta berrezarri nahi nuke.`
    : `Hola, soy ${rawName}. Se me pasó la cita y me gustaría reagendarla.`);
  const waLink = phone ? `https://wa.me/34${phone.replace(/\D/g,'')}?text=${waText}` : '';

  const subject = lang === 'eu'
    ? `${esc(config?.name || '')}: zure hitzordua — ${service}`
    : `${esc(config?.name || '')}: ${copy.hook}`;

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

    <!-- HEADER -->
    <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:22px 28px;border-bottom:3px solid ${sc.color};">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:17px;font-weight:900;color:#0f0f23;letter-spacing:-.03em;">${bizName}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">
              ${lang === 'eu' ? 'Hitzordua falta duzu' : lang === 'gl' ? 'Cita non atendida' : 'Cita no atendida'}
            </div>
          </td>
          <td align="right" style="font-size:32px;">${sc.emoji}</td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:28px 28px 24px;">

      <!-- Hook title -->
      <p style="font-size:20px;font-weight:900;color:#0f0f23;margin:0 0 8px;letter-spacing:-.02em;">${esc(copy.hook)}</p>

      <!-- Greeting + body -->
      <p style="font-size:15px;color:#334155;margin:0 0 20px;line-height:1.7;">
        ${greeting}, ${esc(copy.body)}
      </p>

      <!-- Appointment box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${sc.light};border-left:4px solid ${sc.color};border-radius:0 10px 10px 0;margin:0 0 24px;">
        <tr><td style="padding:14px 18px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:${sc.dark};padding:3px 0;">
                <strong>${serviceLabel}:</strong> ${service}
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:${sc.dark};padding:3px 0;">
                <strong>${dateLabel}:</strong> ${esc(aptStr)}
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- CTAs -->
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaCall}</a>
            </td></tr></table>
          </td>` : ''}
          ${waLink ? `<td>
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#25d366;">
              <a href="${waLink}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">💬 ${ctaWa}</a>
            </td></tr></table>
          </td>` : ''}
        </tr>
      </table>

    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:16px 28px;border-top:1px solid #e8e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">${unsubLabel}</p>
      <p style="font-size:10px;color:#cbd5e1;margin:6px 0 0;">
        Gestionado por <a href="https://nodeflow.es" style="color:${sc.color};text-decoration:none;">NodeFlow IA</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${copy.hook}`,
    ``,
    `${greeting}, ${copy.body}`,
    ``,
    `${serviceLabel}: ${apt.service || 'tu cita'}`,
    `${dateLabel}: ${aptStr}`,
    ``,
    phone ? `📞 Llamar: ${phone}` : '',
    waLink ? `💬 WhatsApp: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(Boolean).join('\n');

  log.info(`No-show email sent to ${apt.email} (apt:${apt.id}, biz:${apt.businessId}, sector:${sector})`);
  return sendEmail({ to: apt.email, subject, html, text });
}

module.exports = { sendNoShowEmail };
