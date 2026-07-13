// ============================================
// NodeFlow — Email notifications via Resend
// https://resend.com  —  RESEND_API_KEY en .env
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('EMAIL');

// BUG-41 FIX: Escape user-provided data before inserting into HTML templates.
// Without this, a business name like "<script>alert(1)</script>" would execute in the email client.
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _resend = null;

function getResend() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.warn('RESEND_API_KEY no configurado — emails solo se loguearán');
    return null;
  }
  try {
    const { Resend } = require('resend');
    _resend = new Resend(key);
    log.info('Resend email inicializado');
    return _resend;
  } catch (e) {
    log.warn(`resend SDK no disponible: ${e.message}`);
    return null;
  }
}

// ── Adjunto: guía de bienvenida en PDF ───────────────────────────────────────
// El PDF estático se pre-genera desde public/guia.html con:
//   node scripts/generate-guia-pdf.js   (npm run guia:pdf)
// Regenéralo cada vez que cambie guia.html. Aquí lo leemos una vez y lo cacheamos
// como base64 para adjuntarlo en el email de bienvenida vía Resend.
const fs   = require('fs');
const path = require('path');
const GUIA_PDF_PATH = path.join(__dirname, '..', '..', 'public', 'guia-nodeflow.pdf');
let _guiaPdfAttachment; // undefined = sin intentar; null = no disponible

function getGuiaPdfAttachment() {
  if (_guiaPdfAttachment !== undefined) return _guiaPdfAttachment;
  try {
    const content = fs.readFileSync(GUIA_PDF_PATH).toString('base64');
    _guiaPdfAttachment = { filename: 'Guia-NodeFlow.pdf', content };
    log.info('Adjunto guía PDF cargado para emails de bienvenida');
  } catch (e) {
    _guiaPdfAttachment = null;
    log.warn(`Guía PDF no disponible (${GUIA_PDF_PATH}): ${e.message} — el email irá solo con enlace`);
  }
  return _guiaPdfAttachment;
}

async function sendEmail({ to, subject, html, text, attachments }) {
  const resend = getResend();

  if (!resend) {
    log.info(`[EMAIL NO ENVIADO] To: ${to} | Subject: ${subject}`);
    log.info(`[EMAIL CONTENT]\n${text || html}`);
    return false;
  }

  try {
    const payload = {
      from: 'NodeFlow <unai@nodeflow.es>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    };
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments;
    }
    const { data, error } = await resend.emails.send(payload);

    if (error) {
      log.error(`Resend error a ${to}: ${error.message}`);
      return false;
    }

    log.info(`Email enviado a ${to}: ${subject} (id: ${data?.id})`);
    return true;
  } catch (e) {
    log.error(`Error enviando email a ${to}`, { error: e.message });
    return false;
  }
}

// ── Templates ──────────────────────────────────────────────────────────────

function formatHorario(horario = {}) {
  const days = { lun:'Lun', mar:'Mar', mie:'Mié', jue:'Jue', vie:'Vie', sab:'Sáb', dom:'Dom' };
  const order = ['lun','mar','mie','jue','vie','sab','dom'];
  const lines = [];
  let group = null;

  for (const key of order) {
    const d = horario[key] || { on: false };
    const slot = d.on ? `${d.from || '09:00'}-${d.to || '18:00'}` : 'cerrado';
    if (!group) {
      group = { start: key, end: key, slot };
    } else if (group.slot === slot) {
      group.end = key;
    } else {
      lines.push(group); group = { start: key, end: key, slot };
    }
  }
  if (group) lines.push(group);

  return lines.map(g =>
    g.start === g.end
      ? `${days[g.start]}: ${g.slot}`
      : `${days[g.start]}-${days[g.end]}: ${g.slot}`
  ).join(' | ');
}

/**
 * Notificación interna a Unai cuando llega un nuevo cliente
 */
async function notifyNuevoCliente(registro) {
  // BUG-44 FIX: Guard against null/undefined fields
  if (!registro) { log.warn('notifyNuevoCliente llamado con registro null'); return false; }

  const to      = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
  const plan    = registro.plan === 'pro' ? 'Pro — 99€/mes' : 'Negocio — 49€/mes';
  const horario = formatHorario(registro.horario);

  // BUG-41 FIX: Escape all user-controlled data before inserting into HTML
  const eNegocio  = esc(registro.negocio);
  const eSector   = esc(registro.sector);
  const eContacto = esc(registro.contacto);
  const eTelefono = esc(registro.telefono);
  const eEmail    = esc(registro.email);
  const eCiudad   = esc(registro.ciudad);
  const ePlan     = esc(plan);
  const eVoz      = esc(registro.voz);
  const eIdioma   = esc(registro.idioma);
  const eSaludo   = esc(registro.saludo);
  const eHorario  = esc(horario);

  const subject = `🎉 Nuevo cliente NodeFlow — ${registro.negocio}`;

  const text = [
    `NUEVO CLIENTE NODEFLOW`,
    ``,
    `Negocio:   ${registro.negocio}`,
    `Sector:    ${registro.sector}`,
    `Contacto:  ${registro.contacto}`,
    `Teléfono:  ${registro.telefono}`,
    `Email:     ${registro.email}`,
    `Ciudad:    ${registro.ciudad}`,
    ``,
    `Plan:      ${plan}`,
    `Voz:       ${registro.voz}`,
    `Idioma:    ${registro.idioma}`,
    ``,
    `Saludo:    ${registro.saludo}`,
    `Horario:   ${horario}`,
    ``,
    `ID registro: ${registro.id}`,
    `Fecha:       ${registro.created_at}`,
  ].join('\n');

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
      <h2 style="color:#6c5ce7;margin-bottom:4px;">🎉 Nuevo cliente</h2>
      <p style="color:#666;margin-top:0;font-size:14px;">Acaba de pagar su suscripción a NodeFlow</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;width:120px;">Negocio</td><td style="padding:8px 12px;font-weight:600;">${eNegocio}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Sector</td><td style="padding:8px 12px;">${eSector}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Contacto</td><td style="padding:8px 12px;">${eContacto}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Teléfono</td><td style="padding:8px 12px;">${eTelefono}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Email</td><td style="padding:8px 12px;">${eEmail}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Ciudad</td><td style="padding:8px 12px;">${eCiudad}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;font-weight:600;color:#6c5ce7;">Plan</td><td style="padding:8px 12px;font-weight:700;color:#6c5ce7;">${ePlan}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Voz</td><td style="padding:8px 12px;">${eVoz}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Idioma</td><td style="padding:8px 12px;">${eIdioma}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Saludo</td><td style="padding:8px 12px;font-style:italic;">&ldquo;${eSaludo}&rdquo;</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Horario</td><td style="padding:8px 12px;font-size:13px;">${eHorario}</td></tr>
        ${registro.nodeflow_number ? `<tr style="background:#e8f5e9;"><td style="padding:8px 12px;color:#2e7d32;font-weight:700;">✅ Número NodeFlow</td><td style="padding:8px 12px;font-weight:800;font-size:16px;color:#1b5e20;">${esc(registro.nodeflow_number)}</td></tr>` : `<tr style="background:#fff3e0;"><td style="padding:8px 12px;color:#e65100;font-weight:700;">⚠️ Número</td><td style="padding:8px 12px;color:#e65100;">Pool vacío — asignar manualmente</td></tr>`}
        ${registro.api_key ? `<tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">API Key</td><td style="padding:8px 12px;font-family:monospace;font-size:12px;">${esc(registro.api_key)}</td></tr>` : ''}
        ${registro.stripe_customer_id ? `<tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Stripe ID</td><td style="padding:8px 12px;font-family:monospace;font-size:12px;">${esc(registro.stripe_customer_id)}</td></tr>` : ''}
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999;">ID: ${esc(registro.id)} · ${esc(registro.created_at)}</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

/**
 * Email de benvida en galego — enviado cando idioma === 'gl' ou source === 'galiza'
 */
async function sendBienvenidaGl(registro) {
  // BUG-44 FIX: Guard null contacto
  if (!registro?.email) { log.warn('sendBienvenidaGl: email nulo'); return false; }
  const plan    = registro.plan === 'pro' ? 'Pro (99€/mes)' : 'Negocio (49€/mes)';
  const nome    = (registro.contacto || 'Cliente').split(' ')[0];
  const subject = `Benvido a NodeFlow, ${nome}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#2ecc8a;font-size:28px;margin-bottom:8px;">Benvido a NodeFlow!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Ola <strong style="color:#f0f0f5;">${nome}</strong>, o teu pagamento confirmouse. O teu asistente está configurándose automaticamente — en <strong style="color:#f0f0f5;">poucos minutos</strong> recibirás o teu número NodeFlow e as instrucións de desvío.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumo da túa contratación</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${registro.negocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 Plan <strong>${plan}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🌊 Idioma: <strong>Galego</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">Que pasa agora?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>O teu asistente IA créase e configúrase automaticamente</li>
        <li>Asígnasete un número NodeFlow dedicado — recibirás as instrucións no seguinte email</li>
        <li>Activas o desvío de chamadas no teu teléfono e o asistente empeza a traballar 24/7</li>
      </ol>

      ${registro.api_key ? `
      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #1e8a5e;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">A túa API Key</p>
        <p style="font-family:monospace;font-size:13px;color:#2ecc8a;word-break:break-all;margin:0;">${esc(registro.api_key)}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Gárdaa nun lugar seguro. Necesitarala para acceder ao panel de control.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/#key=${registro.api_key}" style="background:#1e8a5e;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Acceder ao meu portal →</a>
      </div>` : ''}

      <div style="margin-top:20px;padding:16px;background:#1a1a24;border-radius:10px;text-align:center;">
        <p style="color:#666680;font-size:13px;margin-bottom:10px;">Tes algunha dúbida?</p>
        <a href="https://wa.me/34666351319" style="background:#25d366;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">💬 WhatsApp →</a>
      </div>

      <p style="margin-top:24px;font-size:12px;color:#666680;text-align:center;">
        NodeFlow · unai@nodeflow.es · <a href="https://nodeflow.es/galiza" style="color:#2ecc8a;">nodeflow.es/galiza</a>
      </p>
    </div>
  `;

  const text = `Benvido a NodeFlow, ${nome}!\n\nO teu pagamento confirmouse. En poucos minutos recibirás o teu número NodeFlow e as instrucións de desvío.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\nIdioma: Galego\n\nDúbidas? WhatsApp: +34 666 351 319`;

  return sendEmail({ to: registro.email, subject, html, text });
}

/**
 * Email de ongi etorri en euskera — enviado cuando idioma === 'eu' o source === 'hementxe'
 */
async function sendBienvenidaEu(registro) {
  // BUG-44 FIX: Guard null contacto
  if (!registro?.email) { log.warn('sendBienvenidaEu: email nulo'); return false; }
  const plan  = registro.plan === 'pro' ? 'Pro (99€/hil)' : 'Negocio (49€/hil)';
  const izena = (registro.contacto || 'Bezeroa').split(' ')[0];
  const subject = `Ongi etorri NodeFlow-era, ${izena}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#e74c3c;font-size:28px;margin-bottom:8px;">Ongi etorri NodeFlow-era!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Kaixo <strong style="color:#f0f0f5;">${izena}</strong>, zure ordainketa baieztatuta dago. Zure asistentea automatikoki konfiguratzen ari da — <strong style="color:#f0f0f5;">minutu gutxiren buruan</strong> jasoko duzu zure NodeFlow zenbakia eta desbideratzeko argibideak.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Kontratuaren laburpena</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${registro.negocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 <strong>${plan}</strong> plana</p>
        <p style="margin:6px 0;font-size:14px;">🔵 Hizkuntza: <strong>Euskera</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">Zer gertatuko da orain?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>Zure IA asistentea automatikoki sortzen eta konfiguratzen da</li>
        <li>NodeFlow zenbaki esklusibo bat esleitzen zaizu — hurrengo emailean argibideak jasoko dituzu</li>
        <li>Desbideratzea aktibatzen duzu eta asistentea 24/7 lanean hasten da</li>
      </ol>

      ${registro.api_key ? `
      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #e74c3c;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Zure API Gakoa</p>
        <p style="font-family:monospace;font-size:13px;color:#e74c3c;word-break:break-all;margin:0;">${esc(registro.api_key)}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Leku seguru batean gorde. Kontrol-panelera sartzeko beharko duzu.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/#key=${registro.api_key}" style="background:#e74c3c;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Nire atarira sartu →</a>
      </div>` : ''}

      <div style="margin-top:20px;padding:16px;background:#1a1a24;border-radius:10px;text-align:center;">
        <p style="color:#666680;font-size:13px;margin-bottom:10px;">Zalantzaren bat?</p>
        <a href="https://wa.me/34666351319" style="background:#25d366;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">💬 WhatsApp →</a>
      </div>

      <p style="margin-top:24px;font-size:12px;color:#666680;text-align:center;">
        NodeFlow · unai@nodeflow.es · <a href="https://nodeflow.es" style="color:#e74c3c;">nodeflow.es</a>
      </p>
    </div>
  `;

  const text = `Ongi etorri NodeFlow-era, ${izena}!\n\nZure ordainketa baieztatuta dago. Minutu gutxiren buruan jasoko duzu zure NodeFlow zenbakia eta desbideratzeko argibideak.\n\nNegozioa: ${registro.negocio}\nPlana: ${plan}\n\nZalantzak? WhatsApp: +34 666 351 319`;

  return sendEmail({ to: registro.email, subject, html, text });
}

/**
 * Email de bienvenida al cliente tras el pago
 * Detecta idioma: gl → galego, eu → euskera, default → español
 */
async function sendBienvenida(registro) {
  // BUG-44 FIX: Guard null registro/email
  if (!registro?.email) { log.warn('sendBienvenida: registro o email nulo'); return false; }

  // Route to Galician welcome email
  if (registro.idioma === 'gl' || registro.source === 'galiza' || registro.language === 'gl') {
    return sendBienvenidaGl(registro);
  }
  // Route to Basque welcome email
  if (registro.idioma === 'eu' || registro.source === 'hementxe' || registro.language === 'eu') {
    return sendBienvenidaEu(registro);
  }

  const plan = registro.plan === 'pro' ? 'Pro (99€/mes)' : 'Negocio (49€/mes)';
  // BUG-44 FIX: Safe split — contacto may be null for programmatic calls
  const nombre = (registro.contacto || 'Cliente').split(' ')[0];

  const subject = `¡Bienvenido a NodeFlow, ${nombre}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#a29bfe;font-size:28px;margin-bottom:8px;">¡Bienvenido a NodeFlow!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Hola <strong style="color:#f0f0f5;">${esc(nombre)}</strong>, tu pago se ha confirmado. Tu asistente se está configurando automáticamente — en <strong style="color:#f0f0f5;">pocos minutos</strong> recibirás otro email con tu número NodeFlow y las instrucciones de desvío.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumen de tu contratación</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${esc(registro.negocio)}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 Plan <strong>${esc(plan)}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🌐 Idioma: <strong>${esc(registro.idioma || 'es')}</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">¿Qué pasa ahora?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>Tu asistente IA se crea y configura automáticamente</li>
        <li>Se te asigna un número NodeFlow dedicado — recibirás las instrucciones en el siguiente email</li>
        <li>Activas el desvío de llamadas en tu teléfono y el asistente empieza a trabajar 24/7</li>
      </ol>

      ${registro.api_key ? `
      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #6c5ce7;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Tu API Key</p>
        <p style="font-family:monospace;font-size:13px;color:#a29bfe;word-break:break-all;margin:0;">${esc(registro.api_key)}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Guárdala en un lugar seguro. La necesitarás para acceder al panel de control.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/#key=${registro.api_key}" style="background:#6c5ce7;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Acceder a mi portal →</a>
      </div>` : ''}

      <div style="margin-top:20px;padding:16px;background:#1a1a24;border-radius:10px;text-align:center;">
        <p style="color:#666680;font-size:13px;margin-bottom:10px;">¿Tienes alguna duda?</p>
        <a href="https://wa.me/34666351319" style="background:#25d366;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">💬 WhatsApp →</a>
      </div>

      <p style="margin-top:24px;font-size:12px;color:#666680;text-align:center;">
        NodeFlow · unai@nodeflow.es · <a href="https://nodeflow.es" style="color:#a29bfe;">nodeflow.es</a>
      </p>
    </div>
  `;

  const text = `¡Bienvenido a NodeFlow, ${nombre}!\n\nTu pago se ha confirmado. En pocos minutos recibirás tu número NodeFlow y las instrucciones de desvío.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\n\n¿Dudas? WhatsApp: +34 666 351 319`;

  return sendEmail({ to: registro.email, subject, html, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendAcknowledgement — Auto-responder al lead justo después de rellenar el form
// Se envía ANTES del pago, en el momento que llega el registro
// ─────────────────────────────────────────────────────────────────────────────
async function sendAcknowledgement(registro) {
  // BUG-44 FIX: Guard null registro/fields
  if (!registro?.email) { log.warn('sendAcknowledgement: email nulo'); return false; }
  const nombre  = (registro.contacto || 'Cliente').split(' ')[0];
  const plan    = registro.plan === 'pro' ? 'Pro — 99€/mes' : 'Negocio — 49€/mes';
  const subject = `✅ Recibido, ${nombre} — te contactamos antes de 24h`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;background:#07070e;border-radius:16px;overflow:hidden;color:#e8e8f0;">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#6c5ce7,#a29bfe);padding:32px 32px 28px;text-align:center;">
        <div style="font-size:36px;margin-bottom:8px;">✅</div>
        <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px;">¡Solicitud recibida!</h1>
        <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.8);">Te contactamos antes de 24 horas</p>
      </div>

      <!-- Body -->
      <div style="padding:28px 32px;">
        <p style="font-size:15px;color:#c8c8d8;line-height:1.7;margin:0 0 20px;">
          Hola <strong style="color:#fff;">${nombre}</strong>, hemos recibido todos tus datos correctamente. En menos de 24 horas nos ponemos en contacto contigo para activar tu recepcionista IA.
        </p>

        <!-- Data box -->
        <div style="background:#14141e;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:24px;">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#6c5ce7;font-weight:700;margin:0 0 14px;">Resumen de tu solicitud</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="color:#888;padding:5px 0;width:100px">Negocio</td><td style="color:#fff;font-weight:600;">${registro.negocio}</td></tr>
            <tr><td style="color:#888;padding:5px 0">Sector</td><td style="color:#ddd;">${registro.sector}</td></tr>
            <tr><td style="color:#888;padding:5px 0">Ciudad</td><td style="color:#ddd;">${registro.ciudad}</td></tr>
            <tr><td style="color:#888;padding:5px 0">Plan</td><td style="color:#a29bfe;font-weight:700;">${plan}</td></tr>
            <tr><td style="color:#888;padding:5px 0">14 días</td><td style="color:#00cec9;font-weight:600;">Prueba gratuita ✓</td></tr>
          </table>
        </div>

        <!-- Steps -->
        <p style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin:0 0 14px;">Qué pasa ahora</p>
        <div style="display:flex;flex-direction:column;gap:0;">
          ${[
            ['1', 'Te contactamos', 'Te llamamos o escribimos por WhatsApp en menos de 24h para confirmar los detalles de tu asistente.'],
            ['2', 'Configuramos tu IA', 'Ajustamos la voz, el saludo, tu horario de atención y las preguntas más frecuentes de tu negocio.'],
            ['3', 'Llamada de prueba', 'Hacemos una llamada de prueba juntos antes de activar el servicio en producción.'],
            ['4', '¡En marcha!', 'Tu recepcionista IA empieza a atender las llamadas de tu negocio 24h al día.'],
          ].map(([n, t, d]) => `
          <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="min-width:28px;height:28px;border-radius:50%;background:#6c5ce7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;text-align:center;line-height:28px;">${n}</div>
            <div><p style="margin:0 0 3px;font-size:14px;font-weight:600;color:#e8e8f0;">${t}</p><p style="margin:0;font-size:13px;color:#888;line-height:1.6;">${d}</p></div>
          </div>`).join('')}
        </div>

        <!-- Activación autoservicio: rescate del pago si abandonó el checkout -->
        ${registro.id ? `
        <div style="margin:28px 0 0;padding:20px;background:linear-gradient(135deg,rgba(108,92,231,.15),rgba(162,155,254,.08));border:1px solid rgba(108,92,231,0.35);border-radius:12px;text-align:center;">
          <p style="margin:0 0 12px;font-size:14px;color:#c8c8d8;"><strong style="color:#fff;">¿No quieres esperar?</strong> Actívalo tú mismo ahora — pago seguro y tu asistente se configura solo en minutos</p>
          <a href="${process.env.PUBLIC_URL || 'https://nodeflow.es'}/api/registro/${registro.id}/checkout" style="display:inline-block;background:#6c5ce7;color:#fff;padding:13px 30px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;">⚡ Activar mi asistente ahora →</a>
        </div>` : ''}

        <!-- WhatsApp CTA -->
        <div style="margin:16px 0 0;padding:20px;background:#14141e;border:1px solid rgba(37,211,102,0.2);border-radius:12px;text-align:center;">
          <p style="margin:0 0 12px;font-size:14px;color:#888;">¿Prefieres hablar antes? Escríbenos ahora mismo</p>
          <a href="https://wa.me/34666351319?text=Hola%20Unai%2C%20acabo%20de%20registrar%20${encodeURIComponent(registro.negocio)}%20en%20NodeFlow" style="display:inline-block;background:#25d366;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">💬 WhatsApp directo →</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:16px 32px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
        <p style="margin:0;font-size:12px;color:#555;">
          NodeFlow · <a href="https://nodeflow.es" style="color:#a29bfe;text-decoration:none;">nodeflow.es</a> · <a href="mailto:unai@nodeflow.es" style="color:#a29bfe;text-decoration:none;">unai@nodeflow.es</a>
        </p>
        <p style="margin:6px 0 0;font-size:11px;color:#444;">Has recibido este email porque registraste tu negocio en NodeFlow.</p>
      </div>
    </div>
  `;

  const text = [
    `¡Solicitud recibida, ${nombre}!`,
    ``,
    `Hemos recibido los datos de ${registro.negocio}. Te contactamos en menos de 24 horas.`,
    ...(registro.id ? [``, `¿No quieres esperar? Actívalo ahora: ${process.env.PUBLIC_URL || 'https://nodeflow.es'}/api/registro/${registro.id}/checkout`] : []),
    ``,
    `Plan: ${plan}`,
    `Ciudad: ${registro.ciudad}`,
    `Sector: ${registro.sector}`,
    ``,
    `¿No quieres esperar? WhatsApp: https://wa.me/34666351319`,
    ``,
    `— NodeFlow · nodeflow.es`,
  ].join('\n');

  return sendEmail({ to: registro.email, subject, html, text });
}

// ─────────────────────────────────────────────────────────────────────────────
// notifyNuevoLead — Notificación interna a Unai para CUALQUIER lead nuevo
// Incluye teléfono grande + links directos WA y llamada
// ─────────────────────────────────────────────────────────────────────────────
async function notifyNuevoLead(registro) {
  const to      = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
  const plan    = registro.plan === 'pro' ? 'Pro 99€/mes' : 'Negocio 49€/mes';
  const emoji   = registro.plan === 'pro' ? '🚀' : '📞';
  const subject = `${emoji} Nuevo lead — ${registro.negocio} · ${registro.ciudad} [${plan}]`;
  const telLimpio = (registro.telefono || '').replace(/\D/g, '');
  const waLink  = `https://wa.me/34${telLimpio}?text=${encodeURIComponent(`Hola ${(registro.contacto||'').split(' ')[0]}, soy Unai de NodeFlow. Vi que registraste ${registro.negocio} y quería presentarme y confirmar los detalles de tu asistente IA. ¿Tienes 5 minutos?`)}`;
  const callLink = `tel:${(registro.telefono || '').replace(/\s/g,'')}`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:540px;margin:0 auto;background:#07070e;border-radius:16px;overflow:hidden;color:#e8e8f0;">
      <!-- Header -->
      <div style="background:${registro.plan === 'pro' ? 'linear-gradient(135deg,#f9ca24,#f0932b)' : 'linear-gradient(135deg,#6c5ce7,#a29bfe)'};padding:20px 24px;">
        <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.7);font-weight:600;">NUEVO LEAD NODEFLOW</p>
        <h1 style="margin:4px 0 0;font-size:20px;font-weight:800;color:#fff;">${registro.negocio}</h1>
        <p style="margin:2px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">${registro.sector} · ${registro.ciudad}</p>
      </div>

      <!-- Teléfono grande — lo primero que ves -->
      <div style="padding:20px 24px 0;text-align:center;background:#0d0d18;">
        <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;">TELÉFONO DE CONTACTO</p>
        <p style="margin:0;font-size:32px;font-weight:900;color:#fff;letter-spacing:2px;">${registro.telefono}</p>
        <div style="display:flex;gap:10px;justify-content:center;margin:14px 0 20px;">
          <a href="${callLink}" style="background:#6c5ce7;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">📞 Llamar ahora</a>
          <a href="${waLink}" style="background:#25d366;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">💬 WhatsApp</a>
        </div>
      </div>

      <!-- Data table -->
      <div style="padding:0 24px 24px;background:#0d0d18;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;">
          <tr style="background:#14141e;"><td style="padding:9px 14px;color:#666;width:110px;">Contacto</td><td style="padding:9px 14px;font-weight:600;">${registro.contacto}</td></tr>
          <tr style="background:#0d0d18;"><td style="padding:9px 14px;color:#666;">Email</td><td style="padding:9px 14px;"><a href="mailto:${registro.email}" style="color:#a29bfe;">${registro.email}</a></td></tr>
          <tr style="background:#14141e;"><td style="padding:9px 14px;color:#666;">Plan</td><td style="padding:9px 14px;font-weight:700;color:${registro.plan === 'pro' ? '#f9ca24' : '#a29bfe'};">${plan}</td></tr>
          <tr style="background:#0d0d18;"><td style="padding:9px 14px;color:#666;">Voz</td><td style="padding:9px 14px;">${registro.voz || '—'}</td></tr>
          <tr style="background:#14141e;"><td style="padding:9px 14px;color:#666;">Idioma</td><td style="padding:9px 14px;">${registro.idioma || 'es'}</td></tr>
          <tr style="background:#0d0d18;"><td style="padding:9px 14px;color:#666;">Saludo</td><td style="padding:9px 14px;font-style:italic;color:#aaa;">"${registro.saludo || '—'}"</td></tr>
          ${registro.coupon_code ? `<tr style="background:#14141e;"><td style="padding:9px 14px;color:#666;">Cupón</td><td style="padding:9px 14px;color:#00cec9;font-weight:700;">${registro.coupon_code} (−${registro.discount_percent}%)</td></tr>` : ''}
          <tr style="background:#0d0d18;"><td style="padding:9px 14px;color:#444;font-size:11px;">ID</td><td style="padding:9px 14px;font-family:monospace;font-size:11px;color:#444;">${registro.id}</td></tr>
        </table>
        <p style="margin:12px 0 0;font-size:12px;color:#444;text-align:center;">⏱️ Registrado: ${new Date().toLocaleString('es-ES', {timeZone:'Europe/Madrid'})}</p>
      </div>
    </div>
  `;

  const text = [
    `NUEVO LEAD NODEFLOW`,
    ``,
    `${registro.negocio} · ${registro.ciudad}`,
    `Plan: ${plan}`,
    ``,
    `📞 ${registro.telefono}`,
    `Contacto: ${registro.contacto}`,
    `Email: ${registro.email}`,
    ``,
    `WhatsApp directo: ${waLink}`,
    ``,
    `ID: ${registro.id}`,
  ].join('\n');

  return sendEmail({ to, subject, html, text });
}

async function sendWelcomePortalEmail(registro, magicToken) {
  if (!registro?.email) { log.warn('sendWelcomePortalEmail: email nulo'); return false; }
  const publicUrl  = process.env.PUBLIC_URL || 'https://nodeflow.es';
  const portalLink = `${publicUrl}/portal?token=${encodeURIComponent(magicToken)}`;
  const nombre     = esc((registro.contacto || registro.email).split(' ')[0]);
  const eNegocio   = esc(registro.negocio || '');
  const plan       = registro.plan === 'pro' ? 'Pro — 99€/mes' : 'Negocio — 49€/mes';
  const subject    = `¡Bienvenido a NodeFlow, ${nombre}! Tu asistente está casi listo 🎉`;

  const html = `
    <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#070712;border-radius:16px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:28px;">
        <span style="font-size:22px;font-weight:900;color:#f0f0ff;">node<span style="color:#a855f7;">flow</span></span>
      </div>
      <h1 style="font-size:24px;font-weight:800;margin-bottom:8px;color:#f0f0ff;">¡Hola, ${nombre}! 🎉</h1>
      <p style="color:#9090b0;margin-bottom:24px;">Tu pago se ha confirmado. Tu asistente IA está siendo configurado y en <strong style="color:#f0f0ff;">pocos minutos</strong> recibirás otro email con tu número NodeFlow y las instrucciones de desvío.</p>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#6060a0;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumen</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong style="color:#f0f0ff;">${eNegocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 <strong style="color:#a855f7;">${plan}</strong></p>
        <p style="margin:6px 0;font-size:14px;">⚡ Configuración automática en minutos</p>
      </div>

      <div style="text-align:center;margin:28px 0;">
        <a href="${esc(portalLink)}" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;box-shadow:0 4px 20px rgba(124,58,237,0.4);">⚡ Acceder a mi portal →</a>
      </div>
      <p style="color:#6060a0;font-size:12px;text-align:center;margin-top:4px;">Este enlace es válido durante 7 días</p>

      <div style="text-align:center;margin:22px 0 4px;">
        <a href="${publicUrl}/guia.html" style="display:inline-block;background:rgba(255,255,255,0.06);border:1px solid rgba(168,85,247,0.45);color:#c9a8ff;padding:12px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">📖 Ver tu guía de bienvenida</a>
      </div>
      <p style="color:#6060a0;font-size:12px;text-align:center;margin-top:2px;">Todo lo que hace tu asistente y cómo usar el portal, explicado fácil. La tienes también <strong style="color:#c9a8ff;">adjunta en PDF</strong> en este correo.</p>

      <div style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.03);border-radius:10px;text-align:center;">
        <p style="color:#6060a0;font-size:13px;margin-bottom:10px;">¿Tienes alguna duda?</p>
        <a href="https://wa.me/34666351319?text=Hola%2C%20acabo%20de%20activar%20NodeFlow%20para%20${encodeURIComponent(registro.negocio||'mi negocio')}" style="background:#25d366;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">💬 WhatsApp →</a>
      </div>

      <p style="margin-top:24px;font-size:11px;color:#404060;text-align:center;">
        NodeFlow IA · <a href="https://nodeflow.es" style="color:#a855f7;">nodeflow.es</a> · unai@nodeflow.es
      </p>
    </div>
  `;

  const text = `¡Bienvenido a NodeFlow, ${nombre}!\n\nTu pago está confirmado. En pocos minutos recibirás tu número NodeFlow y las instrucciones de desvío.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\n\nAccede a tu portal:\n${portalLink}\n(Este enlace es válido 7 días.)\n\nTu guía de bienvenida va adjunta en PDF, y también la tienes online:\n${publicUrl}/guia.html\n\n¿Dudas? WhatsApp: +34 666 351 319`;

  // Adjuntamos la guía en PDF además de mantener el enlace web (si el PDF existe).
  const guiaPdf = getGuiaPdfAttachment();
  const attachments = guiaPdf ? [guiaPdf] : undefined;

  return sendEmail({ to: registro.email, subject, html, text, attachments });
}

// ─────────────────────────────────────────────────────────────────────────────
// sendActivacion — Email enviado por Unai cuando el asistente está listo
// Incluye el número asignado + guía de desvío por operador
// ─────────────────────────────────────────────────────────────────────────────
async function sendActivacion(registro, numeroNodeflow) {
  if (!registro?.email) { log.warn('sendActivacion: email nulo'); return false; }
  const nombre   = (registro.contacto || 'Cliente').split(' ')[0];
  const numLimpio = numeroNodeflow.replace(/\s/g, '');
  const numMostrar = numeroNodeflow;
  const subject  = `✅ Tu asistente NodeFlow está listo — activa el desvío ahora`;

  const html = `
<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

  <!-- HEADER -->
  <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:24px 32px;border-bottom:3px solid #7c3aed;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="font-size:20px;font-weight:900;letter-spacing:-.04em;color:#0f0f23;">node<span style="color:#7c3aed;">flow</span></div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Tu asistente está listo</div>
      </td>
      <td align="right" style="font-size:28px;">✅</td>
    </tr></table>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:32px 32px 24px;">

    <p style="font-size:16px;font-weight:700;color:#0f0f23;margin:0 0 8px;">Hola ${esc(nombre)},</p>
    <p style="font-size:15px;color:#334155;margin:0 0 24px;line-height:1.7;">
      Tu asistente de voz para <strong>${esc(registro.negocio)}</strong> ya está configurado y listo.
      Solo falta un paso: activar el desvío de llamadas.
    </p>

    <!-- Número asignado -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf5ff;border-radius:12px;margin:0 0 28px;">
      <tr><td style="padding:20px 24px;text-align:center;">
        <div style="font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Tu número NodeFlow</div>
        <div style="font-size:32px;font-weight:900;color:#0f0f23;letter-spacing:2px;">${esc(numMostrar)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:6px;">Las llamadas de tus clientes llegarán a este número</div>
      </td></tr>
    </table>

    <!-- Cómo activar el desvío — TAP TO DIAL -->
    <p style="font-size:15px;font-weight:700;color:#0f0f23;margin:0 0 6px;">📲 Actívalo con un toque</p>
    <p style="font-size:14px;color:#475569;margin:0 0 16px;line-height:1.6;">
      Abre este email <strong>desde el móvil de tu negocio</strong> y pulsa un botón. Se abrirá tu marcador con el código ya puesto: solo dale a llamar y oirás un tono de confirmación.
    </p>

    <!-- Opción RECOMENDADA: condicional (**004*) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
      <tr><td style="background:#faf5ff;border:1.5px solid #7c3aed;border-radius:12px;padding:16px 18px;">
        <div style="font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Recomendado</div>
        <div style="font-size:15px;font-weight:700;color:#0f0f23;margin-bottom:2px;">Cuando no llegues a cogerlo</div>
        <div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:12px;">Tu teléfono suena primero; el asistente coge solo las que no puedas atender (comunicando, sin contestar o sin cobertura). No pierdes ninguna llamada.</div>
        <a href="tel:**004*${numLimpio}%23" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:13px;border-radius:10px;">Activar el desvío →</a>
      </td></tr>
    </table>

    <!-- Opción: todas (**21*) -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="background:#ffffff;border:1.5px solid #e8e8f0;border-radius:12px;padding:16px 18px;">
        <div style="font-size:15px;font-weight:700;color:#0f0f23;margin-bottom:2px;">Todas las llamadas al asistente</div>
        <div style="font-size:13px;color:#64748b;line-height:1.5;margin-bottom:12px;">El asistente atiende TODO desde el primer tono. Ideal si no quieres que suene tu teléfono.</div>
        <a href="tel:**21*${numLimpio}%23" style="display:block;background:#ffffff;color:#7c3aed;border:1.5px solid #7c3aed;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:12px;border-radius:10px;">Activar el desvío de todas →</a>
      </td></tr>
    </table>

    <!-- Fallback manual -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;margin:0 0 8px;border:1px solid #e8e8f0;">
      <tr style="background:#f8f8fb;"><td colspan="2" style="padding:9px 14px;font-size:12px;font-weight:700;color:#64748b;">¿El botón no abre el marcador? Márcalo a mano desde tu teléfono de empresa:</td></tr>
      <tr><td style="padding:9px 14px;font-size:13px;color:#334155;">Cuando no llegues</td><td style="padding:9px 14px;font-family:monospace;font-size:14px;font-weight:700;color:#7c3aed;">**004*${numLimpio}#</td></tr>
      <tr style="background:#f8f8fb;"><td style="padding:9px 14px;font-size:13px;color:#334155;">Todas las llamadas</td><td style="padding:9px 14px;font-family:monospace;font-size:14px;font-weight:700;color:#7c3aed;">**21*${numLimpio}#</td></tr>
    </table>
    <p style="font-size:12px;color:#94a3b8;margin:0 0 22px;">Funciona en Movistar, Vodafone, Orange, Yoigo, MásMóvil, Euskaltel, R y demás operadores.</p>

    <!-- Desactivar -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-left:4px solid #059669;border-radius:0 10px 10px 0;margin:0 0 20px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#14532d;">Para desactivarlo cuando quieras</p>
        <p style="margin:0 0 10px;font-size:12px;color:#15803d;">Vuelves a recibir tú las llamadas al instante. Pulsa el botón o marca <span style="font-family:monospace;font-weight:700;">##002#</span> (borra cualquier desvío).</p>
        <a href="tel:%23%23002%23" style="display:inline-block;background:#ffffff;color:#059669;border:1px solid #059669;text-decoration:none;font-size:13px;font-weight:700;padding:7px 14px;border-radius:8px;">Desactivar el desvío</a>
      </td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;margin:0 0 28px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#78350f;">⚠️ Si tienes fijo de empresa (DECT / centralita)</p>
        <p style="margin:0;font-size:13px;color:#92400e;line-height:1.6;">El desvío se configura desde el menú de la centralita, no desde el teléfono. Escríbenos por WhatsApp y lo dejamos listo en 5 minutos.</p>
      </td></tr>
    </table>

    <!-- Pasos siguientes -->
    <p style="font-size:14px;font-weight:700;color:#0f0f23;margin:0 0 12px;">Una vez activo el desvío:</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${[
        ['1', 'Llama a tu propio número', 'Comprueba que el asistente coge la llamada y suena como esperabas.'],
        ['2', 'Dinos que funciona', 'Mándanos un WhatsApp confirmando que todo va bien.'],
        ['3', 'Listo', 'Tu asistente ya está atendiendo llamadas de clientes reales.'],
      ].map(([n, t, d]) => `
      <tr>
        <td style="vertical-align:top;padding:0 12px 14px 0;width:32px;">
          <div style="width:28px;height:28px;border-radius:50%;background:#7c3aed;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:28px;">${n}</div>
        </td>
        <td style="vertical-align:top;padding-bottom:14px;">
          <div style="font-size:14px;font-weight:600;color:#0f0f23;margin-bottom:2px;">${t}</div>
          <div style="font-size:13px;color:#64748b;line-height:1.5;">${d}</div>
        </td>
      </tr>`).join('')}
    </table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:20px 32px;border-top:1px solid #e8e8f0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;padding-right:14px;">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);text-align:center;line-height:40px;font-size:18px;">U</div>
      </td>
      <td style="vertical-align:middle;">
        <div style="font-size:14px;font-weight:700;color:#0f0f23;">Unai Sánchez</div>
        <div style="font-size:12px;color:#64748b;">Fundador · NodeFlow IA</div>
        <div style="font-size:12px;color:#7c3aed;">
          <a href="https://wa.me/34666351319" style="color:#7c3aed;text-decoration:none;">WhatsApp directo</a>
          &nbsp;·&nbsp;
          <a href="https://nodeflow.es" style="color:#7c3aed;text-decoration:none;">nodeflow.es</a>
        </div>
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `✅ Tu asistente NodeFlow está listo, ${nombre}.`,
    ``,
    `Tu número NodeFlow: ${numMostrar}`,
    ``,
    `CÓMO ACTIVAR EL DESVÍO (desde el móvil de tu negocio):`,
    `  · Recomendado — cuando no llegues a cogerlo:  **004*${numLimpio}#`,
    `    (tu teléfono suena primero; el asistente coge lo que no atiendas)`,
    `  · Todas las llamadas al asistente:            **21*${numLimpio}#`,
    `Funciona en Movistar, Vodafone, Orange, Yoigo, MásMóvil, Euskaltel, R…`,
    `Para desactivarlo: ##002#`,
    ``,
    `Para desactivar: ##21#`,
    ``,
    `Una vez activo, llama a tu propio número para comprobar que funciona.`,
    `Cualquier duda: WhatsApp +34 666 351 319`,
  ].join('\n');

  return sendEmail({ to: registro.email, subject, html, text });
}

async function sendMagicLinkEmail(email, magicToken) {
  const publicUrl  = process.env.PUBLIC_URL || 'https://nodeflow.es';
  const portalLink = `${publicUrl}/portal?token=${encodeURIComponent(magicToken)}`;

  const html = `
    <div style="font-family:'Inter',sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#070712;border-radius:16px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:28px;">
        <span style="font-size:22px;font-weight:900;color:#f0f0ff;">node<span style="color:#a855f7;">flow</span></span>
      </div>
      <h1 style="font-size:22px;font-weight:800;margin-bottom:12px;color:#f0f0ff;">Tu enlace de acceso</h1>
      <p style="color:#9090b0;margin-bottom:28px;">Haz clic en el botón para acceder a tu portal. El enlace expira en 7 días.</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${esc(portalLink)}" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">⚡ Acceder al portal →</a>
      </div>
      <p style="color:#6060a0;font-size:12px;text-align:center;">Si no solicitaste este enlace, ignora este email.</p>
    </div>
  `;

  const text = `Accede a tu portal NodeFlow:\n\n${portalLink}\n\nEste enlace expira en 7 días.\n\nSi no lo solicitaste, ignora este email.`;

  // Asunto ÚNICO por envío. Con un asunto idéntico, Gmail agrupa todos los
  // enlaces en el MISMO hilo (el usuario no ve los nuevos) y manda los
  // repetidos a Spam/Promociones. La marca de hora, además, deja claro cuál es
  // el más reciente — que es el único válido (los enlaces son de un solo uso).
  let sello;
  try {
    sello = new Date().toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    sello = new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
  const subject = `Tu enlace de acceso a NodeFlow · ${sello}`;

  return sendEmail({ to: email, subject, html, text });
}

// ── Recompensa de referido: un negocio que refirió consiguió una conversión ──
async function sendReferralReward(referrerEmail, refereeName) {
  const html = `
    <div style="font-family:'Inter',sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#070712;border-radius:16px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:28px;">
        <span style="font-size:22px;font-weight:900;color:#f0f0ff;">node<span style="color:#a855f7;">flow</span></span>
      </div>
      <div style="text-align:center;font-size:40px;margin-bottom:8px;">🎉</div>
      <h1 style="font-size:22px;font-weight:800;margin-bottom:12px;color:#f0f0ff;text-align:center;">¡Tu recomendación ha funcionado!</h1>
      <p style="color:#9090b0;margin-bottom:20px;line-height:1.7;text-align:center;">
        <strong style="color:#e0e0f0;">${esc(refereeName || 'Un negocio')}</strong> se ha dado de alta en NodeFlow gracias a tu recomendación.
        Como agradecimiento, <strong style="color:#a855f7;">tu próxima factura llevará un mes a mitad de precio</strong>.
      </p>
      <p style="color:#9090b0;margin-bottom:28px;line-height:1.7;text-align:center;">
        Nos pondremos en contacto para aplicar tu recompensa. ¡Gracias por confiar en nosotros y correr la voz! 🙌
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="https://nodeflow.es/portal/" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">Ver mi portal →</a>
      </div>
    </div>
  `;
  const text = `¡Tu recomendación ha funcionado! ${refereeName || 'Un negocio'} se dio de alta en NodeFlow gracias a ti. Tu próxima factura llevará un mes a mitad de precio. Nos pondremos en contacto para aplicarlo.`;

  // Avisar también a Unai para que aplique el crédito manualmente
  const notifyEmail = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
  sendEmail({
    to: notifyEmail,
    subject: `💸 Recompensa de referido pendiente — ${referrerEmail}`,
    html: `<div style="font-family:sans-serif;padding:20px;"><h3>Recompensa de referido a aplicar</h3><p><strong>${esc(referrerEmail)}</strong> refirió a <strong>${esc(refereeName || '?')}</strong> y este pagó.</p><p>Aplica 1 mes a mitad de precio en su próxima factura (Stripe → Customer → Coupon).</p></div>`,
    text: `Aplicar recompensa: ${referrerEmail} refirió a ${refereeName}. 1 mes a mitad de precio.`,
  }).catch(() => {});

  return sendEmail({ to: referrerEmail, subject: '🎉 Tu recomendación de NodeFlow ha funcionado', html, text });
}

// ── Aviso de suscripción cancelada ────────────────────────────────────────
// Auditoría 2026-07: al cancelar la suscripción se desactiva la org y se
// LIBERA su número al pool (reasignable = pérdida irreversible), pero no se
// avisaba al dueño (a diferencia de payment_failed). Un negocio perdía su
// número en silencio. Este aviso cierra ese agujero.

/** Contenido del email de cancelación. PURO (testeable). */
function cancelledEmailContent(name, number) {
  const first = String(name || '').split(' ')[0] || '';
  const num = number ? esc(number) : 'tu número';
  const subject = '⚠️ Tu suscripción a NodeFlow se ha cancelado';
  const html =
    '<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">' +
      '<h2 style="color:#e17055;">Tu suscripción se ha cancelado</h2>' +
      '<p>Hola ' + (esc(first) || 'cliente') + ',</p>' +
      '<p>Tu suscripción a NodeFlow se ha cancelado, así que tu asistente ha dejado de atender llamadas y <strong>tu número ' + num + ' ha quedado libre</strong>.</p>' +
      '<p>Si ha sido un error o quieres volver, escríbenos cuanto antes y lo reactivamos. Date prisa: pasado un tiempo el número puede reasignarse y ya no podríamos recuperarlo.</p>' +
      '<a href="https://wa.me/34666351319" style="background:#6c5ce7;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px;">Reactivar por WhatsApp →</a>' +
      '<p style="margin-top:24px;font-size:12px;color:#999;">NodeFlow · unai@nodeflow.es</p>' +
    '</div>';
  const text = 'Hola ' + first + ', tu suscripción a NodeFlow se ha cancelado y tu número ' + (number || '') +
    ' ha quedado libre. Si quieres reactivarlo, escríbenos cuanto antes: +34 666 351 319';
  return { subject, html, text };
}

/** Envía el aviso de cancelación al dueño. Nunca lanza. sendEmail inyectable en tests. */
async function sendSubscriptionCancelled({ email, name, number }, deps = {}) {
  if (!email) return false;
  const send = deps.sendEmail || sendEmail;
  const { subject, html, text } = cancelledEmailContent(name, number);
  try { await send({ to: email, subject, html, text }); return true; }
  catch (e) { return false; }
}

module.exports = {
  sendEmail,
  notifyNuevoCliente,
  sendBienvenida, sendBienvenidaGl, sendBienvenidaEu,
  sendAcknowledgement,
  sendActivacion,
  notifyNuevoLead,
  sendWelcomePortalEmail,
  sendMagicLinkEmail,
  sendReferralReward,
  cancelledEmailContent, sendSubscriptionCancelled,
};
