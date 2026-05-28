// ============================================
// NodeFlow — Critical Date Reminder Email (System C)
// ============================================

const { sendEmail }           = require('./email');
const { CRITICAL_DATE_TYPES } = require('../scheduling/critical-dates');
const { Logger }              = require('../utils/logger');

const log = new Logger('CRIT-DATE-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n = '') { return n.split(' ')[0]; }

function _urgencyLabel(daysUntil, lang) {
  if (daysUntil <= 7) {
    return lang === 'eu' ? '⚠️ URGENTEA' : lang === 'gl' ? '⚠️ URXENTE' : '⚠️ URGENTE';
  }
  if (daysUntil <= 15) {
    return lang === 'eu' ? '📢 Gogora egiozu' : lang === 'gl' ? '📢 Lembra' : '📢 Recuerda';
  }
  return lang === 'eu' ? '📅 Gogorarazle' : lang === 'gl' ? '📅 Recordatorio' : '📅 Recordatorio';
}

function _urgencyColor(daysUntil) {
  if (daysUntil <= 7) return '#ef4444';
  if (daysUntil <= 15) return '#f59e0b';
  return '#a855f7';
}

/**
 * @param {object} criticalDate  - CriticalDatesStore entry
 * @param {number} daysUntilDue  - how many days until dueDate (30|15|7 or custom)
 * @param {object} config        - { name, ownerPhone, language }
 */
async function sendCriticalDateReminder(criticalDate, daysUntilDue, config) {
  if (!criticalDate?.clientEmail) {
    log.warn(`sendCriticalDateReminder: no email for ${criticalDate?.clientName} — skipped`);
    return false;
  }

  const lang       = config?.language || 'es';
  const name       = firstName(criticalDate.clientName);
  const bizName    = esc(config?.name || 'tu negocio');
  const phone      = esc(config?.ownerPhone || '');
  const typeInfo   = CRITICAL_DATE_TYPES[criticalDate.type] || { label: criticalDate.type, emoji: '📅', sectors: [] };
  const urgColor   = _urgencyColor(daysUntilDue);
  const urgLabel   = _urgencyLabel(daysUntilDue, lang);
  const notes      = esc(criticalDate.notes || '');

  // Format due date
  let dueDateStr = criticalDate.dueDate;
  try {
    const d = new Date(criticalDate.dueDate + 'T12:00:00');
    dueDateStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch(_) {}

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;

  const daysLabel = (() => {
    if (lang === 'eu') return `${daysUntilDue} egun barru`;
    if (lang === 'gl') return `en ${daysUntilDue} días`;
    return `en ${daysUntilDue} días`;
  })();

  const actionLabel = lang === 'eu' ? `Deitu ${bizName}` : lang === 'gl' ? `Chamar a ${bizName}` : `Llamar a ${bizName}`;

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:linear-gradient(135deg,#1c1c28,#0c0c1a);padding:20px 28px;border-bottom:3px solid ${urgColor};">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;">NodeFlow · ${urgLabel}</div>
    <div style="font-size:20px;margin-top:6px;">${typeInfo.emoji} <span style="color:#fff;font-weight:800;">${esc(typeInfo.label)}</span></div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 16px;">${greeting},</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;margin-bottom:20px;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;">Fecha límite</p>
      <p style="color:${urgColor};font-size:18px;font-weight:800;margin:0 0 4px;">${dueDateStr}</p>
      <p style="color:#64748b;font-size:12px;margin:0;">${daysLabel}</p>
      ${notes ? `<p style="color:#94a3b8;font-size:12px;margin:12px 0 0;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;">${notes}</p>` : ''}
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">
      ${esc(bizName)} te recuerda esta fecha para que puedas gestionarla a tiempo.
    </p>
    <a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:${urgColor};color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;">📞 ${actionLabel}</a>
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">Recordatorio automático de NodeFlow IA · Para darte de baja responde a este email.</p>
  </div>
</div>
</body></html>`;

  const subject = daysUntilDue <= 7
    ? `⚠️ ${typeInfo.emoji} ${typeInfo.label} — quedan ${daysUntilDue} días`
    : `📅 ${typeInfo.emoji} ${typeInfo.label} — en ${daysUntilDue} días`;

  log.info(`Sending critical date reminder to ${criticalDate.clientEmail} — ${criticalDate.type} in ${daysUntilDue}d`);
  return sendEmail({ to: criticalDate.clientEmail, subject, html });
}

module.exports = { sendCriticalDateReminder };
