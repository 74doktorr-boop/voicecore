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

// Basque date formatter — uses standard euskera day/month names
function formatDateEu(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days   = ['igandea','astelehena','asteartea','asteazkena','osteguna','ostirala','larunbata'];
  const months = ['urtarrilak','otsailak','martxoak','apirilak','maiatzak','ekainak','uztailak','abuztuak','irailak','urriak','azaroak','abenduak'];
  return `${days[date.getDay()]} ${d}, ${months[m - 1]}`;
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

  // ── Basque template ────────────────────────────────────────────────────────
  if (lang === 'eu') {
    const dateStr = formatDateEu(appointment.date);
    const subject = `⏰ Bihar hitzordua duzu — ${businessName}`;

    const html = `
      <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
        <div style="margin-bottom:24px;">
          <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">Hitzordu-gogorarazlea</p>
          <h2 style="color:#e74c3c;margin:0;font-size:22px;">⏰ Bihar hitzordua duzu!</h2>
        </div>
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Kaixo <strong style="color:#fff;">${name}</strong>, biharko hitzordua gogora ekartzeko idazten dizugu.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(231,76,60,0.15);">
          <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">Zure hitzordua</p>
          <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}etan</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${businessName}</p>
          <p style="margin:0 0 8px 0;font-size:15px;">✂️ ${appointment.service}</p>
          ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
        </div>

        <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Hitzordua bertan behera utzi edo aldatu nahi baduzu, erantzun mezu honi edo deitu iezaguzu zuzenean.</p>
        <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">Bihar arte! 👋</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${businessName} · Gogorarazle automatikoa — <a href="https://nodeflow.es" style="color:#e74c3c;text-decoration:none;">NodeFlow</a>
        </p>
      </div>
    `;

    const text = `Kaixo ${name},\n\nGogorarazlea: bihar hitzordua duzu ${dateStr} ${appointment.time}etan.\nZerbitzua: ${appointment.service}\nNegozioa: ${businessName}\n\nBertan behera utzi nahi baduzu, erantzun mezu honi.\n\nBihar arte!`;

    const ok = await sendEmail({ to: appointment.email, subject, html, text });
    if (ok) log.info(`Reminder [eu] sent → ${appointment.id} (${appointment.email})`);
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

  // ── Basque review template ─────────────────────────────────────────────────
  if (lang === 'eu') {
    const subject = `⭐ Nola joan zen ${businessName}-ko bisita?`;

    const html = `
      <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
        <div style="margin-bottom:24px;">
          <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">Zure iritzia garrantzitsua da</p>
          <h2 style="color:#f9ca24;margin:0;font-size:22px;">⭐ Nola joan zen hitzordua?</h2>
        </div>
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Kaixo <strong style="color:#fff;">${name}</strong>, espero dugu <strong style="color:#fff;">${businessName}</strong>-n egon zinela ondo.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:28px;margin-bottom:24px;text-align:center;border:1px solid rgba(249,202,36,0.12);">
          <p style="color:#a0a0b8;font-size:14px;line-height:1.7;margin:0 0 20px 0;">
            Esperientzia gustatu bazaizu, Google-n iritzi bat uzteak asko laguntzen digu jende gehiagora iristeko.<br>
            <strong style="color:#f9ca24;">30 segundu bakarrik behar dituzu.</strong>
          </p>
          <a href="${reviewUrl}"
             style="display:inline-block;background:#f9ca24;color:#1a1a24;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:800;font-size:15px;letter-spacing:-.2px;">
            ⭐ Google-n iritzia utzi
          </a>
          <p style="margin:16px 0 0 0;font-size:12px;color:#444460;">Egin klik botoian eta aukeratu zure esperientziarentzako izarrak.</p>
        </div>

        <p style="color:#666680;font-size:13px;text-align:center;">Hobetu daitekeen zerbait? Esan iezaguzu mezu honi erantzunda.</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${businessName} · Mezu automatikoa — <a href="https://nodeflow.es" style="color:#e74c3c;text-decoration:none;">NodeFlow</a>
        </p>
      </div>
    `;

    const text = `Kaixo ${name},\n\nEspero dugu ${businessName}-n egon zinela ondo.\n\nGustatu bazaizu, Google-n iritzi bat uzteak asko lagunduko liguke (30 segundo):\n${reviewUrl}\n\nHobetu daitekeen zerbait? Erantzun mezu honi.\n\nEskerrik asko!`;

    const ok = await sendEmail({ to: appointment.email, subject, html, text });
    if (ok) log.info(`Review request [eu] sent → ${appointment.id} (${appointment.email})`);
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
  } else if (lang === 'eu') {
    const dateStr = formatDateEu(appointment.date);
    msg = [
      `Kaixo ${name} 👋`,
      ``,
      `*${businessName}*-n duzun hitzordua baieztatzen dizut:`,
      ``,
      `📅 *${dateStr}* ${appointment.time}etan`,
      `✂️ ${appointment.service}`,
      appointment.price ? `💶 ${appointment.price}€` : null,
      ``,
      `Bertan behera utzi edo aldatu nahi baduzu, erantzun mezu honi. Laster arte!`,
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

// BUG-47 FIX: Parse appointment datetime in Europe/Madrid timezone, not server local time.
// Without this, on a UTC server an appointment at 10:00 Madrid time (UTC+2 in summer)
// would be treated as 10:00 UTC → reminders sent 2 hours too late.
function madridDateTimeToMs(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute]     = (timeStr || '00:00').split(':').map(Number);
  // Get noon UTC on that day, then compare to Madrid noon to derive the DST-aware offset
  const refUtc   = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const madridNoon = new Date(refUtc.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const offsetMs   = refUtc.getTime() - madridNoon.getTime(); // Madrid → UTC offset (negative when ahead)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  return localAsUtc + offsetMs; // UTC timestamp for the Madrid local datetime
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

    const aptTime = madridDateTimeToMs(apt.date, apt.time); // BUG-47
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

    const aptTime = madridDateTimeToMs(apt.date, apt.time); // BUG-47
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
