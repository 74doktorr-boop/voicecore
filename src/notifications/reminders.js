// ============================================
// NodeFlow — Recordatorios, reseñas y confirmaciones
// ✓ Reminder email 24h antes de la cita
// ✓ Review request email 24h después
// ✓ Generador de enlace WhatsApp de confirmación
// ============================================

const { Logger } = require('../utils/logger');
const { sendEmail } = require('./email');

const log = new Logger('REMINDERS');

const GOOGLE_REVIEW_BASE = 'https://search.google.com/local/writereview?placeid=';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}

// Galician date formatter — uses standard galego day/month names
function formatDateGl(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days   = ['domingo','luns','martes','mércores','xoves','venres','sábado'];
  const months = ['xaneiro','febreiro','marzo','abril','maio','xuño','xullo','agosto','setembro','outubro','novembro','decembro'];
  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}

function firstName(fullName = '') {
  return fullName.split(' ')[0];
}

// ── Reminder email (24h before appointment) ──────────────────────────────────

async function sendAppointmentReminder(appointment, businessConfig) {
  if (!appointment.email) {
    log.warn(`No email on apt ${appointment.id} — reminder skipped`);
    return false;
  }

  const lang         = businessConfig?.language || 'es';
  const name         = firstName(appointment.patientName);
  const businessName = businessConfig?.name || (lang === 'gl' ? 'o teu negocio' : 'tu negocio');

  // ── Galician template ──────────────────────────────────────────────────────
  if (lang === 'gl') {
    const dateStr = formatDateGl(appointment.date);
    const subject = `⏰ Lembra a túa cita de mañá — ${businessName}`;

    const html = `
      <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
        <div style="margin-bottom:24px;">
          <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">Recordatorio de cita</p>
          <h2 style="color:#2ecc8a;margin:0;font-size:22px;">⏰ Mañá tes cita!</h2>
        </div>
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Ola <strong style="color:#fff;">${name}</strong>, escribímosche para que non esqueczas a túa cita de mañá.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(46,204,138,0.15);">
          <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">A túa cita</p>
          <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}h</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${businessName}</p>
          <p style="margin:0 0 8px 0;font-size:15px;">✂️ ${appointment.service}</p>
          ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
        </div>

        <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Se necesitas cancelar ou cambiar a hora, responde a este email ou chámanos directamente.</p>
        <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">Ata mañá! 👋</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${businessName} · Recordatorio automático por <a href="https://nodeflow.es/galiza" style="color:#1e8a5e;text-decoration:none;">NodeFlow</a>
        </p>
      </div>
    `;

    const text = `Ola ${name},\n\nRecordatorio: tes cita mañá ${dateStr} ás ${appointment.time}h.\nServizo: ${appointment.service}\nNegocio: ${businessName}\n\nSe necesitas cancelar, responde a este email.\n\nAta mañá!`;

    const ok = await sendEmail({ to: appointment.email, subject, html, text });
    if (ok) log.info(`Reminder [gl] sent → ${appointment.id} (${appointment.email})`);
    return ok;
  }

  // ── Spanish template (default) ─────────────────────────────────────────────
  const dateStr = formatDate(appointment.date);
  const subject = `⏰ Recuerda tu cita mañana — ${businessName}`;

  const html = `
    <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <div style="margin-bottom:24px;">
        <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">Recordatorio de cita</p>
        <h2 style="color:#a29bfe;margin:0;font-size:22px;">⏰ ¡Mañana tienes cita!</h2>
      </div>
      <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Hola <strong style="color:#fff;">${name}</strong>, te escribimos para que no se te olvide tu cita de mañana.</p>

      <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(162,155,254,0.15);">
        <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">Tu cita</p>
        <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}h</p>
        <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${businessName}</p>
        <p style="margin:0 0 8px 0;font-size:15px;">✂️ ${appointment.service}</p>
        ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
      </div>

      <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Si necesitas cancelar o cambiar la hora, responde a este email o llámanos directamente.</p>
      <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">¡Hasta mañana! 👋</p>

      <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
        ${businessName} · Recordatorio automático por <a href="https://nodeflow.es" style="color:#6c5ce7;text-decoration:none;">NodeFlow</a>
      </p>
    </div>
  `;

  const text = `Hola ${name},\n\nRecordatorio: tienes cita mañana ${dateStr} a las ${appointment.time}h.\nServicio: ${appointment.service}\nNegocio: ${businessName}\n\nSi necesitas cancelar, responde a este email.\n\n¡Hasta mañana!`;

  const ok = await sendEmail({ to: appointment.email, subject, html, text });
  if (ok) log.info(`Reminder sent → ${appointment.id} (${appointment.email})`);
  return ok;
}

// ── Review request email (24h after appointment) ─────────────────────────────

async function sendReviewRequest(appointment, businessConfig) {
  if (!appointment.email) return false;

  const lang         = businessConfig?.language || 'es';
  const name         = firstName(appointment.patientName);
  const businessName = businessConfig?.name || (lang === 'gl' ? 'o negocio' : 'el negocio');
  const reviewUrl    = businessConfig?.googlePlaceId
    ? `${GOOGLE_REVIEW_BASE}${businessConfig.googlePlaceId}`
    : `https://www.google.com/search?q=${encodeURIComponent(businessName)}`;

  // ── Galician template ──────────────────────────────────────────────────────
  if (lang === 'gl') {
    const subject = `⭐ Como foi a túa visita a ${businessName}?`;

    const html = `
      <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
        <div style="margin-bottom:24px;">
          <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">A túa opinión importa</p>
          <h2 style="color:#f9ca24;margin:0;font-size:22px;">⭐ Que tal foi a cita?</h2>
        </div>
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Ola <strong style="color:#fff;">${name}</strong>, esperamos que a túa visita a <strong style="color:#fff;">${businessName}</strong> fose perfecta.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:28px;margin-bottom:24px;text-align:center;border:1px solid rgba(249,202,36,0.12);">
          <p style="color:#a0a0b8;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
            Se che gustou a experiencia, deixarnos unha recensión en Google axúdanos moitísimo a chegar a máis persoas.<br>
            <strong style="color:#f9ca24;">Só che levará 30 segundos.</strong>
          </p>
          <a href="${reviewUrl}"
             style="display:inline-block;background:#f9ca24;color:#1a1a24;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;letter-spacing:-.2px;">
            ⭐ Deixar recensión en Google
          </a>
          <p style="margin:16px 0 0 0;font-size:12px;color:#444460;">Fai clic no botón e selecciona as estrelas que merece a túa experiencia.</p>
        </div>

        <p style="color:#666680;font-size:13px;text-align:center;">Algo mellorable? Cóntanos respondendo a este email — o teu feedback axúdanos.</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${businessName} · Mensaxe automática por <a href="https://nodeflow.es/galiza" style="color:#1e8a5e;text-decoration:none;">NodeFlow</a>
        </p>
      </div>
    `;

    const text = `Ola ${name},\n\nEsperamos que a túa visita a ${businessName} fose xenial.\n\nSe che gustou, axudaríanos moitísimo unha recensión en Google (só 30 segundos):\n${reviewUrl}\n\nAlgo mellorable? Responde a este email.\n\nGrazas!`;

    const ok = await sendEmail({ to: appointment.email, subject, html, text });
    if (ok) log.info(`Review request [gl] sent → ${appointment.id} (${appointment.email})`);
    return ok;
  }

  // ── Spanish template (default) ─────────────────────────────────────────────
  const subject = `⭐ ¿Cómo fue tu visita a ${businessName}?`;

  const html = `
    <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <div style="margin-bottom:24px;">
        <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">Tu opinión importa</p>
        <h2 style="color:#f9ca24;margin:0;font-size:22px;">⭐ ¿Qué tal fue la cita?</h2>
      </div>
      <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Hola <strong style="color:#fff;">${name}</strong>, esperamos que tu visita a <strong style="color:#fff;">${businessName}</strong> haya sido perfecta.</p>

      <div style="background:#1a1a24;border-radius:12px;padding:28px;margin-bottom:24px;text-align:center;border:1px solid rgba(249,202,36,0.12);">
        <p style="color:#a0a0b8;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
          Si te ha gustado la experiencia, dejarnos una reseña en Google nos ayuda muchísimo a llegar a más personas.<br>
          <strong style="color:#f9ca24;">Solo te llevará 30 segundos.</strong>
        </p>
        <a href="${reviewUrl}"
           style="display:inline-block;background:#f9ca24;color:#1a1a24;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;letter-spacing:-.2px;">
          ⭐ Dejar reseña en Google
        </a>
        <p style="margin:16px 0 0 0;font-size:12px;color:#444460;">Haz clic en el botón y selecciona las estrellas que merece tu experiencia.</p>
      </div>

      <p style="color:#666680;font-size:13px;text-align:center;">¿Algo mejorable? Cuéntanoslo respondiendo a este email — tu feedback nos ayuda.</p>

      <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
        ${businessName} · Mensaje automático por <a href="https://nodeflow.es" style="color:#6c5ce7;text-decoration:none;">NodeFlow</a>
      </p>
    </div>
  `;

  const text = `Hola ${name},\n\nEsperamos que tu visita a ${businessName} haya sido genial.\n\nSi te ha gustado, nos ayudaría muchísimo una reseña en Google (solo 30 segundos):\n${reviewUrl}\n\n¿Algo mejorable? Responde a este email.\n\n¡Gracias!`;

  const ok = await sendEmail({ to: appointment.email, subject, html, text });
  if (ok) log.info(`Review request sent → ${appointment.id} (${appointment.email})`);
  return ok;
}

// ── WhatsApp confirmation link generator ─────────────────────────────────────

function generateWhatsAppConfirmation(appointment, businessConfig, ownerPhone) {
  const lang         = businessConfig?.language || 'es';
  const name         = firstName(appointment.patientName);
  const businessName = businessConfig?.name || (lang === 'gl' ? 'o negocio' : 'el negocio');

  let msg;

  if (lang === 'gl') {
    const dateStr = formatDateGl(appointment.date);
    msg = [
      `Ola ${name} 👋`,
      ``,
      `Confírmoche a túa cita en *${businessName}*:`,
      ``,
      `📅 *${dateStr}* ás *${appointment.time}h*`,
      `✂️ ${appointment.service}`,
      appointment.price ? `💶 ${appointment.price}€` : null,
      ``,
      `Se necesitas cancelar ou cambiar a hora, responde a esta mensaxe. Ata pronto!`,
    ].filter(l => l !== null).join('\n');
  } else {
    const dateStr = formatDate(appointment.date);
    msg = [
      `Hola ${name} 👋`,
      ``,
      `Te confirmo tu cita en *${businessName}*:`,
      ``,
      `📅 *${dateStr}* a las *${appointment.time}h*`,
      `✂️ ${appointment.service}`,
      appointment.price ? `💶 ${appointment.price}€` : null,
      ``,
      `Si necesitas cancelar o cambiar la hora, responde a este mensaje. ¡Hasta pronto!`,
    ].filter(l => l !== null).join('\n');
  }

  const phone = (ownerPhone || process.env.OWNER_PHONE || '34666351319').replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ── Cron check: reminders ─────────────────────────────────────────────────────
// Sends reminder to appointments in the configured window (default 24h ±4h)
// flowManager is optional — if omitted, defaults apply for all businesses

async function checkAndSendReminders(scheduler, flowManager = null) {
  const now = Date.now();
  let sent = 0;

  for (const [, apt] of scheduler.appointments) {
    if (apt.status === 'cancelled' || apt.reminder_sent || !apt.email) continue;

    // Skip if reminders disabled for this business
    if (flowManager && !flowManager.isEnabled(apt.businessId, 'reminders')) continue;

    const hoursBefore   = flowManager ? flowManager.getHoursBefore(apt.businessId) : 24;
    const targetMs      = hoursBefore * 3600 * 1000;
    const WINDOW_START  = targetMs - 4 * 3600 * 1000;
    const WINDOW_END    = targetMs + 4 * 3600 * 1000;

    const aptTime = new Date(`${apt.date}T${apt.time}:00`).getTime();
    const diff    = aptTime - now;

    if (diff >= WINDOW_START && diff <= WINDOW_END) {
      const schedulerCfg = scheduler.getBusinessConfig(apt.businessId);
      const config       = flowManager
        ? flowManager.mergeConfig(apt.businessId, schedulerCfg)
        : schedulerCfg;
      const ok = await sendAppointmentReminder(apt, config);
      if (ok) { apt.reminder_sent = true; sent++; }
    }
  }

  if (sent > 0) log.info(`Reminder run: ${sent} sent`);
  return sent;
}

// ── Cron check: review requests ───────────────────────────────────────────────
// Sends review request to appointments completed in the configured window (default 24h ±12h)

async function checkAndSendReviews(scheduler, flowManager = null) {
  const now = Date.now();
  let sent = 0;

  for (const [, apt] of scheduler.appointments) {
    if (apt.status === 'cancelled' || apt.review_requested || !apt.email) continue;

    // Skip if reviews disabled for this business
    if (flowManager && !flowManager.isEnabled(apt.businessId, 'reviews')) continue;

    const hoursAfter   = flowManager ? flowManager.getHoursAfter(apt.businessId) : 24;
    const targetMs     = hoursAfter * 3600 * 1000;
    const WINDOW_START = targetMs - 4 * 3600 * 1000;
    const WINDOW_END   = targetMs + 12 * 3600 * 1000;

    const aptTime = new Date(`${apt.date}T${apt.time}:00`).getTime();
    const elapsed = now - aptTime;

    if (elapsed >= WINDOW_START && elapsed <= WINDOW_END) {
      const schedulerCfg = scheduler.getBusinessConfig(apt.businessId);
      const config       = flowManager
        ? flowManager.mergeConfig(apt.businessId, schedulerCfg)
        : schedulerCfg;
      const ok = await sendReviewRequest(apt, config);
      if (ok) { apt.review_requested = true; sent++; }
    }
  }

  if (sent > 0) log.info(`Review run: ${sent} sent`);
  return sent;
}

module.exports = {
  sendAppointmentReminder,
  sendReviewRequest,
  generateWhatsAppConfirmation,
  checkAndSendReminders,
  checkAndSendReviews,
};
