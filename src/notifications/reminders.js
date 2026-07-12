// ============================================
// NodeFlow — Recordatorios, reseñas y confirmaciones
// ✓ Reminder email 24h antes de la cita
// ✓ Review request email 24h después
// ✓ Generador de enlace WhatsApp de confirmación
// ============================================

const { Logger } = require('../utils/logger');
const { sendEmail } = require('./email');
const { sendTemplate, sendText, isConfigured: waIsConfigured } = require('./client-whatsapp');
const { appointmentsStore } = require('../db/appointments-store');
const { getWaCredentials } = require('../whatsapp/accounts');

const log = new Logger('REMINDERS');

// Transcript de WhatsApp: registra un saliente (fail-open). Resumen legible por
// plantilla (el texto exacto lo renderiza Meta). apt trae businessId + phone.
function _logWaOut(apt, kind, body) {
  try {
    if (!apt || !apt.businessId || !apt.phone) return;
    require('../whatsapp/wa-log').logWaMessage({ orgId: apt.businessId, phone: apt.phone, direction: 'out', body, kind });
  } catch (_) {}
}

const GOOGLE_REVIEW_BASE = 'https://search.google.com/local/writereview?placeid=';

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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
  // HTML-safe variants for email templates (name/service can contain caller-dictated content)
  const nameH        = esc(name);
  const serviceH     = esc(appointment.service || '');
  const bizNameH     = esc(businessName);

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
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Ola <strong style="color:#fff;">${nameH}</strong>, escribímosche para que non esqueczas a túa cita de mañá.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(46,204,138,0.15);">
          <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">A túa cita</p>
          <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}h</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${bizNameH}</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🗓️ ${serviceH}</p>
          ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
        </div>

        <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Se necesitas cancelar ou cambiar a hora, responde a este email ou chámanos directamente.</p>
        <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">Ata mañá! 👋</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${bizNameH} · Recordatorio automático por <a href="https://nodeflow.es/galiza" style="color:#1e8a5e;text-decoration:none;">NodeFlow</a>
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
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Kaixo <strong style="color:#fff;">${nameH}</strong>, biharko hitzordua gogora ekartzeko idazten dizugu.</p>

        <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(231,76,60,0.15);">
          <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">Zure hitzordua</p>
          <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}etan</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${bizNameH}</p>
          <p style="margin:0 0 8px 0;font-size:15px;">🗓️ ${serviceH}</p>
          ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
        </div>

        <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Hitzordua bertan behera utzi edo aldatu nahi baduzu, erantzun mezu honi edo deitu iezaguzu zuzenean.</p>
        <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">Bihar arte! 👋</p>

        <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
          ${bizNameH} · Gogorarazle automatikoa — <a href="https://nodeflow.es" style="color:#e74c3c;text-decoration:none;">NodeFlow</a>
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
      <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Hola <strong style="color:#fff;">${nameH}</strong>, te escribimos para que no se te olvide tu cita de mañana.</p>

      <div style="background:#1a1a24;border-radius:12px;padding:24px;margin-bottom:24px;border:1px solid rgba(162,155,254,0.15);">
        <p style="color:#666680;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px 0;">Tu cita</p>
        <p style="margin:0 0 10px 0;font-size:16px;font-weight:700;">📅 ${dateStr} · ${appointment.time}h</p>
        <p style="margin:0 0 8px 0;font-size:15px;">🏪 ${bizNameH}</p>
        <p style="margin:0 0 8px 0;font-size:15px;">🗓️ ${serviceH}</p>
        ${appointment.price ? `<p style="margin:0;font-size:14px;color:#a0a0b8;">💶 ${appointment.price}€</p>` : ''}
      </div>

      <p style="color:#a0a0b8;font-size:14px;line-height:1.6;">Si necesitas cancelar o cambiar la hora, responde a este email o llámanos directamente.</p>
      <p style="color:#a0a0b8;font-size:14px;margin-bottom:0;">¡Hasta mañana! 👋</p>

      <p style="margin-top:32px;font-size:11px;color:#333350;text-align:center;border-top:1px solid #1a1a24;padding-top:16px;">
        ${bizNameH} · Recordatorio automático por <a href="https://nodeflow.es" style="color:#6c5ce7;text-decoration:none;">NodeFlow</a>
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
  // HTML-safe variants for email templates
  const nameH        = esc(name);
  const bizNameH     = esc(businessName);
  // reviewUrl priority: direct URL from portal config > googlePlaceId > generic search
  const reviewUrl    = businessConfig?.automations?.config?.reviewUrl
    || (businessConfig?.googlePlaceId ? `${GOOGLE_REVIEW_BASE}${businessConfig.googlePlaceId}` : null)
    || `https://www.google.com/search?q=${encodeURIComponent(businessName + ' opiniones')}`;

  // ── Galician template ──────────────────────────────────────────────────────
  if (lang === 'gl') {
    const subject = `⭐ Como foi a túa visita a ${businessName}?`;

    const html = `
      <div style="font-family:'Inter',sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
        <div style="margin-bottom:24px;">
          <p style="font-size:13px;color:#666680;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px 0;">A túa opinión importa</p>
          <h2 style="color:#f9ca24;margin:0;font-size:22px;">⭐ Que tal foi a cita?</h2>
        </div>
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Ola <strong style="color:#fff;">${nameH}</strong>, esperamos que a túa visita a <strong style="color:#fff;">${bizNameH}</strong> fose perfecta.</p>

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
          ${bizNameH} · Mensaxe automática por <a href="https://nodeflow.es/galiza" style="color:#1e8a5e;text-decoration:none;">NodeFlow</a>
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
        <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Kaixo <strong style="color:#fff;">${nameH}</strong>, espero dugu <strong style="color:#fff;">${bizNameH}</strong>-n egon zinela ondo.</p>

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
          ${bizNameH} · Mezu automatikoa — <a href="https://nodeflow.es" style="color:#e74c3c;text-decoration:none;">NodeFlow</a>
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
      <p style="color:#a0a0b8;font-size:15px;margin:0 0 24px 0;">Hola <strong style="color:#fff;">${nameH}</strong>, esperamos que tu visita a <strong style="color:#fff;">${bizNameH}</strong> haya sido perfecta.</p>

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
        ${bizNameH} · Mensaje automático por <a href="https://nodeflow.es" style="color:#6c5ce7;text-decoration:none;">NodeFlow</a>
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
      `📋 ${appointment.service}`,
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
      `📋 ${appointment.service}`,
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
      `📋 ${appointment.service}`,
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

// ── WhatsApp: confirmación INMEDIATA al reservar via Meta template ────────────
// Template: nodeflow_cita_confirmada (solo cuerpo + footer, sin botones)
// Variables: {{1}}=nombre, {{2}}=negocio, {{3}}=fecha, {{4}}=hora, {{5}}=servicio
// Se envía desde el número del NEGOCIO (multi-tenant) en cuanto la llamada
// crea la cita — el cliente cuelga y ya tiene el WhatsApp (petición Unai
// 2026-07-04). deps inyectable para tests; en prod usa los módulos reales.
// Reactivación por WhatsApp (add-on Crecimiento, canal 'whatsapp'). Plantilla
// MARKETING nodeflow_reactivacion ({{1}}=nombre {{2}}=negocio). Misma regla de
// oro que las confirmaciones: si el número propio falla, reintenta por el
// compartido. deps inyectable para test. Requiere plantilla aprobada en Meta.
async function sendWaReactivation(client, config = {}, deps = {}) {
  const _sendTemplate   = deps.sendTemplate    || sendTemplate;
  const _getWaCreds     = deps.getWaCredentials || getWaCredentials;
  const _waIsConfigured = deps.waIsConfigured   || waIsConfigured;

  if (!client || !client.phone) return false;
  const credentials = client.businessId ? await _getWaCreds(client.businessId) : null;
  if (!credentials && !_waIsConfigured()) return false;

  const lang     = config.language || 'es';
  const langCode = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es';
  const name     = firstName(client.name);
  const bizName  = config.name || 'tu negocio';
  const components = [{ type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: bizName }] }];

  try {
    const result = await _sendTemplate(client.phone, 'nodeflow_reactivacion', langCode, components, credentials);
    if (result?.ok) return true;
    if (credentials && _waIsConfigured()) {
      const fb = await _sendTemplate(client.phone, 'nodeflow_reactivacion', langCode, components, null);
      if (fb?.ok) return true;
    }
    return false;
  } catch (e) {
    log.warn(`WA reactivación falló (${client.phone}): ${e.message}`);
    return false;
  }
}

async function sendWaConfirmation(apt, config, deps = {}) {
  const _sendTemplate    = deps.sendTemplate    || sendTemplate;
  const _getWaCreds      = deps.getWaCredentials || getWaCredentials;
  const _waIsConfigured  = deps.waIsConfigured   || waIsConfigured;

  if (!apt.phone) return false;

  const credentials = apt.businessId ? await _getWaCreds(apt.businessId) : null;
  if (!credentials && !_waIsConfigured()) return false;

  const lang         = config?.language || 'es';
  const name         = firstName(apt.patientName);
  const businessName = config?.name || 'el negocio';
  const dateStr      = lang === 'gl' ? formatDateGl(apt.date) : lang === 'eu' ? formatDateEu(apt.date) : formatDate(apt.date);
  const langCode     = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es';

  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: name },
        { type: 'text', text: businessName },
        { type: 'text', text: dateStr },
        { type: 'text', text: apt.time },
        { type: 'text', text: apt.service },
      ],
    },
  ];

  try {
    const result = await _sendTemplate(apt.phone, 'nodeflow_cita_confirmada', langCode, components, credentials);
    if (result?.ok) {
      log.info(`WA confirmation sent → ${apt.id} (${apt.phone}) [${credentials ? 'business' : 'global'}]`);
      _logWaOut(apt, 'confirmacion', `Confirmación de cita: ${apt.service || 'tu cita'} — ${apt.date} ${apt.time}h`);
      return true;
    }
    log.warn(`WA confirmation not ok for ${apt.id}: ${result?.error}`);

    // REGLA DE ORO (#Fase2): si el envío por el número PROPIO del negocio
    // falla (token roto, plantilla aún en revisión…) pero existe el número
    // compartido de NodeFlow, el aviso al cliente NO se pierde: reintenta por
    // el compartido. El número propio es siempre una mejora, jamás un riesgo.
    if (credentials && _waIsConfigured()) {
      const fb = await _sendTemplate(apt.phone, 'nodeflow_cita_confirmada', langCode, components, null);
      if (fb?.ok) {
        log.warn(`WA confirmation → ${apt.id}: número propio falló, enviado por el COMPARTIDO`);
        return true;
      }
    }
  } catch (e) {
    log.warn(`WA confirmation failed for ${apt.id}: ${e.message}`);
  }
  return false;
}

// ── WhatsApp: envía recordatorio de cita via Meta template ───────────────────
// Template: nodeflow_cita_recordatorio (botones CONFIRMAR / CANCELAR)
// Variables esperadas en el cuerpo: {{1}}=nombre, {{2}}=negocio, {{3}}=fecha, {{4}}=hora, {{5}}=servicio
async function sendWaReminder(apt, config) {
  if (!apt.phone) return false;

  // Obtener credenciales del negocio (multi-tenant) o caer en globales
  const credentials = apt.businessId ? await getWaCredentials(apt.businessId) : null;
  if (!credentials && !waIsConfigured()) return false;

  const lang         = config?.language || 'es';
  const name         = firstName(apt.patientName);
  const businessName = config?.name || 'el negocio';
  const dateStr      = lang === 'gl' ? formatDateGl(apt.date) : lang === 'eu' ? formatDateEu(apt.date) : formatDate(apt.date);
  const templateName = 'nodeflow_cita_recordatorio';
  const langCode     = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es';

  try {
    const result = await sendTemplate(apt.phone, templateName, langCode, [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: name },
          { type: 'text', text: businessName },
          { type: 'text', text: dateStr },
          { type: 'text', text: apt.time },
          { type: 'text', text: apt.service },
        ],
      },
    ], credentials);
    if (result?.ok) {
      log.info(`WA reminder sent → ${apt.id} (${apt.phone}) [${credentials ? 'business' : 'global'}]`);
      _logWaOut(apt, 'recordatorio', `Recordatorio de cita: ${apt.service || 'tu cita'} — ${dateStr} ${apt.time}h`);
      return true;
    }
    log.warn(`WA reminder not ok for ${apt.id}: ${result?.error}`);
  } catch (e) {
    log.warn(`WA reminder failed for ${apt.id}: ${e.message}`);
  }
  return false;
}

// ── WhatsApp: envía solicitud de reseña via Meta template ────────────────────
// Template: nodeflow_resena (botón Dejar reseña)
// Variables: {{1}}=nombre, {{2}}=negocio, {{3}}=url_resena
// ¿El cliente de esta cita dijo NO a WhatsApp? Resuelve el contacto por teléfono
// (la cita no siempre trae contact_id) y mira contact_memory.no_whatsapp.
// fail-open (si el lookup falla, no bloquea) — mismo criterio que el resto del motor.
async function _reviewOptedOut(apt) {
  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();
    if (!db.enabled || !apt.businessId || !apt.phone) return false;
    const { phoneVariants } = require('../utils/phone');
    const { data: c } = await db.client.from('contacts')
      .select('id').eq('org_id', apt.businessId).in('phone', phoneVariants(apt.phone)).limit(1).maybeSingle();
    if (!c || !c.id) return false;
    const { getContactMemory } = require('../lifecycle/call-memory');
    const mem = await getContactMemory(c.id, apt.businessId);
    return !!(mem && mem.no_whatsapp);
  } catch (_) { return false; }
}

async function sendWaReview(apt, config, deps = {}) {
  const _sendTemplate   = deps.sendTemplate    || sendTemplate;
  const _getWaCreds     = deps.getWaCredentials || getWaCredentials;
  const _waIsConfigured = deps.waIsConfigured   || waIsConfigured;

  if (!apt.phone) return false;

  // Obtener credenciales del negocio (multi-tenant) o caer en globales
  const credentials = apt.businessId ? await _getWaCreds(apt.businessId) : null;
  if (!credentials && !_waIsConfigured()) return false;

  // Opt-out de WhatsApp: no se pide reseña por WA a quien dijo que no. El email
  // de reseña (respaldo) va por su propia vía. deps.optedOut permite testearlo.
  const optedOut = deps.optedOut !== undefined ? !!deps.optedOut : await _reviewOptedOut(apt);
  if (optedOut) { log.info(`WA review: ${apt.phone} opt-out — no se envía`); return false; }

  const name         = firstName(apt.patientName);
  const businessName = config?.name || 'el negocio';
  const lang         = config?.language || 'es';
  const reviewUrl    = config?.automations?.config?.reviewUrl
    || (config?.googlePlaceId ? `${GOOGLE_REVIEW_BASE}${config.googlePlaceId}` : null)
    || `https://www.google.com/search?q=${encodeURIComponent(businessName + ' opiniones')}`;
  const langCode     = lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es';

  // 1) Plantilla dedicada nodeflow_resena (bonita, con botón cuando Meta la apruebe).
  try {
    const result = await _sendTemplate(apt.phone, 'nodeflow_resena', langCode, [
      { type: 'body', parameters: [
        { type: 'text', text: name }, { type: 'text', text: businessName }, { type: 'text', text: reviewUrl },
      ] },
    ], credentials);
    if (result?.ok) {
      log.info(`WA review sent → ${apt.id} (${apt.phone}) [${credentials ? 'business' : 'global'}]`);
      _logWaOut(apt, 'resena', `Petición de reseña: ${reviewUrl}`);
      return true;
    }
    log.warn(`WA review nodeflow_resena not ok for ${apt.id}: ${result?.error} — probando portadora`);
  } catch (e) {
    log.warn(`WA review nodeflow_resena failed for ${apt.id}: ${e.message}`);
  }

  // 2) Fallback a la portadora nodeflow_aviso (SÍ aprobada) con el texto de reseña.
  // nodeflow_resena puede no estar aprobada en Meta (mismatch de parámetros #132000,
  // descubierto en envío real 2026-07-12); así el aviso de reseña no se pierde —
  // mismo patrón que no-show y avisos de entidad. Un cliente solo-teléfono también
  // la recibe (antes solo salía por email).
  try {
    const { templateLanguage } = require('../whatsapp/templates');
    const reviewMsg = `¿Qué tal fue tu visita? Si te ha gustado, ¿nos dejas una reseña en Google? Nos ayudas muchísimo y solo lleva 30 segundos: ${reviewUrl}`;
    const params = [{ type: 'body', parameters: [
      { type: 'text', text: name }, { type: 'text', text: businessName }, { type: 'text', text: reviewMsg },
    ] }];
    let r = await _sendTemplate(apt.phone, 'nodeflow_aviso', templateLanguage('nodeflow_aviso', lang), params, credentials);
    if (!r?.ok && credentials && _waIsConfigured()) {
      r = await _sendTemplate(apt.phone, 'nodeflow_aviso', templateLanguage('nodeflow_aviso', lang), params, null);
    }
    if (r?.ok) {
      log.info(`WA review (portadora nodeflow_aviso) sent → ${apt.id} (${apt.phone})`);
      _logWaOut(apt, 'resena', `Petición de reseña: ${reviewUrl}`);
      return true;
    }
    log.warn(`WA review portadora not ok for ${apt.id}: ${r?.error}`);
  } catch (e) {
    log.warn(`WA review portadora failed for ${apt.id}: ${e.message}`);
  }
  return false;
}

// ── Cron check: reminders ─────────────────────────────────────────────────────
// Canal primario: WhatsApp (template con botones CONFIRMAR/CANCELAR)
// Canal secundario: Email (fallback si WA no configurado o cliente sin teléfono)
// flowManager is optional — if omitted, defaults apply for all businesses

async function checkAndSendReminders(scheduler, flowManager = null) {
  const now = Date.now();
  let sent = 0;

  for (const [, apt] of scheduler.appointments) {
    // Necesita al menos email O teléfono para enviar algo
    if (apt.status === 'cancelled' || apt.reminder_sent) continue;
    if (!apt.email && !apt.phone) continue;

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

      // Canal 1: WhatsApp (template con botones — necesita aprobación Meta)
      let ok = await sendWaReminder(apt, config);
      // Canal 2: Email (siempre intentarlo como complementario o fallback)
      if (apt.email) {
        const emailOk = await sendAppointmentReminder(apt, config);
        ok = ok || emailOk;
      }
      if (ok) {
        apt.reminder_sent = true;
        appointmentsStore.patch(apt.id, { reminder_sent: true, updatedAt: new Date().toISOString() });
        sent++;
      }
    }
  }

  if (sent > 0) log.info(`Reminder run: ${sent} sent`);
  return sent;
}

// ── Cron check: review requests ───────────────────────────────────────────────
// Canal primario: WhatsApp (template con botón reseña)
// Canal secundario: Email
async function checkAndSendReviews(scheduler, flowManager = null) {
  const now = Date.now();
  let sent = 0;

  for (const [, apt] of scheduler.appointments) {
    if (apt.status === 'cancelled' || apt.review_requested) continue;
    if (!apt.email && !apt.phone) continue;

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

      // Canal 1: WhatsApp
      let ok = await sendWaReview(apt, config);
      // Canal 2: Email (complementario o fallback)
      if (apt.email) {
        const emailOk = await sendReviewRequest(apt, config);
        ok = ok || emailOk;
      }
      if (ok) {
        apt.review_requested = true;
        appointmentsStore.patch(apt.id, { review_requested: true, updatedAt: new Date().toISOString() });
        sent++;
      }
    }
  }

  if (sent > 0) log.info(`Review run: ${sent} sent`);
  return sent;
}

module.exports = {
  sendAppointmentReminder,
  sendReviewRequest,
  sendWaReactivation,
  sendWaConfirmation,
  sendWaReminder,
  sendWaReview,
  generateWhatsAppConfirmation,
  checkAndSendReminders,
  checkAndSendReviews,
  formatDate,
  formatDateGl,
  formatDateEu,
};
