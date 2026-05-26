// ============================================
// NodeFlow — Email notifications via Resend
// https://resend.com  —  RESEND_API_KEY en .env
// ============================================

const { Logger } = require('../utils/logger');
const log = new Logger('EMAIL');

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
  const to      = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
  const plan    = registro.plan === 'negocio' ? 'Negocio — 49€/mes' : 'Pro — 99€/mes';
  const horario = formatHorario(registro.horario);

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
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;width:120px;">Negocio</td><td style="padding:8px 12px;font-weight:600;">${registro.negocio}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Sector</td><td style="padding:8px 12px;">${registro.sector}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Contacto</td><td style="padding:8px 12px;">${registro.contacto}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Teléfono</td><td style="padding:8px 12px;">${registro.telefono}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Email</td><td style="padding:8px 12px;">${registro.email}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Ciudad</td><td style="padding:8px 12px;">${registro.ciudad}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;font-weight:600;color:#6c5ce7;">Plan</td><td style="padding:8px 12px;font-weight:700;color:#6c5ce7;">${plan}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Voz</td><td style="padding:8px 12px;">${registro.voz}</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Idioma</td><td style="padding:8px 12px;">${registro.idioma}</td></tr>
        <tr style="background:#f4f4f4;"><td style="padding:8px 12px;color:#999;">Saludo</td><td style="padding:8px 12px;font-style:italic;">"${registro.saludo}"</td></tr>
        <tr style="background:#fff;"><td style="padding:8px 12px;color:#999;">Horario</td><td style="padding:8px 12px;font-size:13px;">${horario}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999;">ID: ${registro.id} · ${registro.created_at}</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

/**
 * Email de benvida en galego — enviado cando idioma === 'gl' ou source === 'galiza'
 */
async function sendBienvenidaGl(registro) {
  const plan    = registro.plan === 'negocio' ? 'Negocio (49€/mes)' : 'Pro (99€/mes)';
  const nome    = registro.contacto.split(' ')[0];
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
        <p style="font-family:monospace;font-size:13px;color:#2ecc8a;word-break:break-all;margin:0;">${registro.api_key}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Gárdaa nun lugar seguro. Necesitarala para acceder ao panel de control.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/?key=${registro.api_key}" style="background:#1e8a5e;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Acceder ao meu portal →</a>
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
  const plan  = registro.plan === 'negocio' ? 'Negocio (49€/hil)' : 'Pro (99€/hil)';
  const izena = registro.contacto.split(' ')[0];
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
        <p style="font-family:monospace;font-size:13px;color:#e74c3c;word-break:break-all;margin:0;">${registro.api_key}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Leku seguru batean gorde. Kontrol-panelera sartzeko beharko duzu.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/?key=${registro.api_key}" style="background:#e74c3c;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Nire atarira sartu →</a>
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
  // Route to Galician welcome email
  if (registro.idioma === 'gl' || registro.source === 'galiza' || registro.language === 'gl') {
    return sendBienvenidaGl(registro);
  }
  // Route to Basque welcome email
  if (registro.idioma === 'eu' || registro.source === 'hementxe' || registro.language === 'eu') {
    return sendBienvenidaEu(registro);
  }

  const plan = registro.plan === 'negocio' ? 'Negocio (49€/mes)' : 'Pro (99€/mes)';

  const subject = `¡Bienvenido a NodeFlow, ${registro.contacto.split(' ')[0]}! 🎉`;

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d0d12;border-radius:16px;color:#f0f0f5;">
      <h1 style="color:#a29bfe;font-size:28px;margin-bottom:8px;">¡Bienvenido a NodeFlow!</h1>
      <p style="color:#a0a0b8;margin-bottom:24px;">Hola <strong style="color:#f0f0f5;">${registro.contacto.split(' ')[0]}</strong>, tu pago se ha confirmado. En menos de 24 horas tu asistente estará listo.</p>

      <div style="background:#1a1a24;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#666680;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Resumen de tu contratación</p>
        <p style="margin:6px 0;font-size:14px;">🏪 <strong>${registro.negocio}</strong></p>
        <p style="margin:6px 0;font-size:14px;">💳 Plan <strong>${plan}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🎙 Voz: <strong>${registro.voz}</strong></p>
        <p style="margin:6px 0;font-size:14px;">🌐 Idioma: <strong>${registro.idioma}</strong></p>
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
        <p style="font-family:monospace;font-size:13px;color:#a29bfe;word-break:break-all;margin:0;">${registro.api_key}</p>
        <p style="color:#666680;font-size:11px;margin-top:8px;margin-bottom:0;">Guárdala en un lugar seguro. La necesitarás para acceder al panel de control.</p>
      </div>` : ''}

      ${registro.api_key ? `
      <div style="text-align:center;margin-top:24px;">
        <a href="https://nodeflow.es/portal/?key=${registro.api_key}" style="background:#6c5ce7;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">⚡ Acceder a mi portal →</a>
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

  const text = `¡Bienvenido a NodeFlow, ${registro.contacto.split(' ')[0]}!\n\nTu pago se ha confirmado. En menos de 24h tu asistente estará listo.\n\nNegocio: ${registro.negocio}\nPlan: ${plan}\nVoz: ${registro.voz}\n\n¿Dudas? WhatsApp: +34 666 351 319`;

  return sendEmail({ to: registro.email, subject, html, text });
}

module.exports = { sendEmail, notifyNuevoCliente, sendBienvenida, sendBienvenidaGl, sendBienvenidaEu };
