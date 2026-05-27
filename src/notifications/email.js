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

async function sendEmail({ to, subject, html, text }) {
  const resend = getResend();

  if (!resend) {
    log.info(`[EMAIL NO ENVIADO] To: ${to} | Subject: ${subject}`);
    log.info(`[EMAIL CONTENT]\n${text || html}`);
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'NodeFlow <unai@nodeflow.es>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });

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
  const plan    = registro.plan === 'negocio' ? 'Negocio — 49€/mes' : 'Pro — 99€/mes';
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
  const plan    = registro.plan === 'negocio' ? 'Negocio (49€/mes)' : 'Pro (99€/mes)';
  const nome    = (registro.contacto || 'Cliente').split(' ')[0];
  const subject = `Benvido a NodeFlow, ${nome}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#2ecc8a;font-size:28px;margin-bottom:8px;">Benvido a NodeFlow!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Ola <strong style="color:#f0f0f5;">${nome}</strong>, o teu pagamento confirmouse. En menos de 24 horas o teu asistente estará listo.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumo da túa contratación</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${registro.negocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 Plan <strong>${plan}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🎙 Voz: <strong>${registro.voz}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🌊 Idioma: <strong>Galego</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">Que pasa agora?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>Poñémonos en contacto contigo nas próximas horas para rematar de configurar o teu asistente</li>
        <li>Proporcionámosche o número de teléfono que recibirá as chamadas</li>
        <li>Facemos unha chamada de proba contigo antes de activar o servizo en produción</li>
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

  const text = `Benvido a NodeFlow, ${nome}!\n\nO teu pagamento confirmouse. En menos de 24h o teu asistente estará listo.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\nIdioma: Galego\n\nDúbidas? WhatsApp: +34 666 351 319`;

  return sendEmail({ to: registro.email, subject, html, text });
}

/**
 * Email de ongi etorri en euskera — enviado cuando idioma === 'eu' o source === 'hementxe'
 */
async function sendBienvenidaEu(registro) {
  // BUG-44 FIX: Guard null contacto
  if (!registro?.email) { log.warn('sendBienvenidaEu: email nulo'); return false; }
  const plan  = registro.plan === 'negocio' ? 'Negocio (49€/hil)' : 'Pro (99€/hil)';
  const izena = (registro.contacto || 'Bezeroa').split(' ')[0];
  const subject = `Ongi etorri NodeFlow-era, ${izena}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#e74c3c;font-size:28px;margin-bottom:8px;">Ongi etorri NodeFlow-era!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Kaixo <strong style="color:#f0f0f5;">${izena}</strong>, zure ordainketa baieztatuta dago. 24 ordutan zure asistentea prest egongo da.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Kontratuaren laburpena</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${registro.negocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 <strong>${plan}</strong> plana</p>
        <p style="margin:6px 0;font-size:14px;">🎙 Ahotsa: <strong>${registro.voz}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🔵 Hizkuntza: <strong>Euskera</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">Zer gertatuko da orain?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>Hurrengo orduetan harremanetan jarriko gara zurekin asistentea konfiguratzeko</li>
        <li>Deiak jasoko dituen telefono-zenbakia emango dizugu</li>
        <li>Zerbitzua aktibatu aurretik proba-dei bat egingo dugu</li>
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

  const text = `Ongi etorri NodeFlow-era, ${izena}!\n\nZure ordainketa baieztatuta dago. 24 ordutan prest egongo da zure asistentea.\n\nNegozioa: ${registro.negocio}\nPlana: ${plan}\nAhotsa: ${registro.voz}\n\nZalantzak? WhatsApp: +34 666 351 319`;

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

  const plan = registro.plan === 'negocio' ? 'Negocio (49€/mes)' : 'Pro (99€/mes)';
  // BUG-44 FIX: Safe split — contacto may be null for programmatic calls
  const nombre = (registro.contacto || 'Cliente').split(' ')[0];

  const subject = `¡Bienvenido a NodeFlow, ${nombre}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#a29bfe;font-size:28px;margin-bottom:8px;">¡Bienvenido a NodeFlow!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Hola <strong style="color:#f0f0f5;">${esc(nombre)}</strong>, tu pago se ha confirmado. En menos de 24 horas tu asistente estará listo.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumen de tu contratación</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${esc(registro.negocio)}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 Plan <strong>${esc(plan)}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🎙 Voz: <strong>${esc(registro.voz)}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🌐 Idioma: <strong>${esc(registro.idioma)}</strong></p>
      </div>

      <p style="color:#a0a0b8;font-size:14px;margin-bottom:8px;"><strong style="color:#f0f0f5;">¿Qué pasa ahora?</strong></p>
      <ol style="color:#a0a0b8;font-size:14px;padding-left:20px;line-height:1.8;">
        <li>Te contactamos en las próximas horas para terminar de configurar tu asistente</li>
        <li>Te proporcionamos el número de teléfono que recibirá las llamadas</li>
        <li>Hacemos una llamada de prueba contigo antes de activar el servicio en producción</li>
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

  const text = `¡Bienvenido a NodeFlow, ${nombre}!\n\nTu pago se ha confirmado. En menos de 24h tu asistente estará listo.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\nVoz: ${registro.voz}\n\n¿Dudas? WhatsApp: +34 666 351 319`;

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
  const plan    = registro.plan === 'negocio' ? 'Negocio — 49€/mes' : 'Pro — 99€/mes';
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

        <!-- WhatsApp CTA -->
        <div style="margin:28px 0 0;padding:20px;background:#14141e;border:1px solid rgba(37,211,102,0.2);border-radius:12px;text-align:center;">
          <p style="margin:0 0 12px;font-size:14px;color:#888;">¿No quieres esperar? Escríbenos ahora mismo</p>
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
  const plan    = registro.plan === 'negocio' ? 'Negocio 49€/mes' : 'Pro 99€/mes';
  const emoji   = registro.plan === 'pro' ? '🚀' : '📞';
  const subject = `${emoji} Nuevo lead — ${registro.negocio} · ${registro.ciudad} [${plan}]`;
  const waLink  = `https://wa.me/34${registro.telefono.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola ${registro.contacto.split(' ')[0]}, soy Unai de NodeFlow. Vi que registraste ${registro.negocio} y quería presentarme y confirmar los detalles de tu asistente IA. ¿Tienes 5 minutos?`)}`;
  const callLink = `tel:${registro.telefono.replace(/\s/g,'')}`;

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
      <p style="color:#9090b0;margin-bottom:24px;">Tu pago se ha confirmado. En menos de <strong style="color:#f0f0ff;">24 horas</strong> tu asistente IA estará activo y atendiendo llamadas.</p>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:24px;">
        <p style="color:#6060a0;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumen</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong style="color:#f0f0ff;">${eNegocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 <strong style="color:#a855f7;">${plan}</strong></p>
        <p style="margin:6px 0;font-size:14px;">⏱ Setup en menos de 24h</p>
      </div>

      <div style="text-align:center;margin:28px 0;">
        <a href="${esc(portalLink)}" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;box-shadow:0 4px 20px rgba(124,58,237,0.4);">⚡ Acceder a mi portal →</a>
      </div>
      <p style="color:#6060a0;font-size:12px;text-align:center;margin-top:4px;">Este enlace es válido durante 7 días</p>

      <div style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.03);border-radius:10px;text-align:center;">
        <p style="color:#6060a0;font-size:13px;margin-bottom:10px;">¿Tienes alguna duda?</p>
        <a href="https://wa.me/34666351319?text=Hola%2C%20acabo%20de%20activar%20NodeFlow%20para%20${encodeURIComponent(registro.negocio||'mi negocio')}" style="background:#25d366;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">💬 WhatsApp →</a>
      </div>

      <p style="margin-top:24px;font-size:11px;color:#404060;text-align:center;">
        NodeFlow IA · <a href="https://nodeflow.es" style="color:#a855f7;">nodeflow.es</a> · unai@nodeflow.es
      </p>
    </div>
  `;

  const text = `¡Bienvenido a NodeFlow, ${nombre}!\n\nTu pago está confirmado. En menos de 24h tu asistente estará listo.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\n\nAccede a tu portal:\n${portalLink}\n\nEste enlace es válido 7 días.\n\n¿Dudas? WhatsApp: +34 666 351 319`;

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

  return sendEmail({ to: email, subject: 'Tu enlace de acceso a NodeFlow', html, text });
}

module.exports = {
  sendEmail,
  notifyNuevoCliente,
  sendBienvenida, sendBienvenidaGl, sendBienvenidaEu,
  sendAcknowledgement,
  notifyNuevoLead,
  sendWelcomePortalEmail,
  sendMagicLinkEmail,
};
