// ============================================
// NodeFlow — Re-booking email (System B)
// Trilingüe: es / eu / gl
// ============================================

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('REBOOKING-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n = '') { return n.split(' ')[0]; }

// Sector-specific copy (title + message body)
const SECTOR_COPY = {
  restaurante:  { es: ['¿Volvemos a vernos?', 'Han pasado unas semanas desde tu última visita. Tenemos novedades que te van a encantar.'] },
  peluqueria:   { es: ['Tu melena te llama', 'Hace más de un mes que no pasas por aquí. ¿Reservamos para esta semana?'],
                  eu: ['Zure ilea dei egiten dizu', 'Hilabete baino gehiago da ikusten ez zaitudala. Aste honetarako hitzordua jartzen dugu?'] },
  estetica:     { es: ['Es hora de mimarte', 'Hace tiempo que no disfrutas de tu tratamiento favorito.'] },
  barberia:     { es: ['Ya va tocando un repaso', 'Lleva un tiempo sin pasar por la barbería. ¿Te apuntamos?'] },
  clinica:      { es: ['Recordatorio de revisión', 'Han pasado varios meses desde tu última consulta. Tu salud es lo primero.'] },
  dental:       { es: ['Tu revisión dental anual', 'Han pasado 6 meses. Te recomendamos una revisión para mantener tu sonrisa.'] },
  veterinaria:  { es: ['Tu mascota merece una revisión', 'Ha pasado un año desde la última visita. Una revisión anual es importante para su salud.'],
                  eu: ['Zure maskota azterketa bat merezi du', 'Urte bat igaro da azken bisita egin genuenetik.'] },
  taller:       { es: ['Tu coche lleva tiempo sin revisión', 'Hace un año desde la última puesta a punto. Revisemos que todo esté en orden.'] },
  gimnasio:     { es: ['¡Te echamos de menos!', 'Llevamos tiempo sin verte. Recuerda que estamos aquí para ayudarte con tus objetivos.'] },
  academia:     { es: ['No te pierdas las próximas clases', 'Hay plazas disponibles en los próximos cursos. ¿Te interesa continuar?'] },
  farmacia:     { es: ['Renovación de medicación', 'Es momento de renovar tu receta o pasar a recoger tu pedido habitual.'] },
  asesoria:     { es: ['Se acerca el próximo período fiscal', 'Llevamos unos meses sin hablar. ¿Revisamos tu situación antes del próximo vencimiento?'] },
  hotel:        { es: ['¿Vuelves a visitarnos?', 'Han pasado 3 meses desde tu estancia. Tenemos una oferta especial para clientes habituales.'] },
  default:      { es: ['Hace tiempo que no te vemos', 'Queremos recordarte que seguimos aquí para ayudarte cuando lo necesites.'] },
};

function getCopy(sector, lang) {
  const s = SECTOR_COPY[sector] || SECTOR_COPY.default;
  const l = s[lang] || s.es || SECTOR_COPY.default.es;
  return { title: l[0], body: l[1] };
}

/**
 * @param {object} client   - { name, email, phone, lastVisitDate }
 * @param {object} config   - { name, ownerPhone, language, sector }
 * @param {string} lastVisitDate  - 'YYYY-MM-DD'
 */
async function sendRebookingEmail(client, config, lastVisitDate) {
  if (!client?.email) {
    log.warn(`sendRebookingEmail: no email for client ${client?.name} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const sector  = config?.sector   || 'default';
  const copy    = getCopy(sector, lang);
  const name    = firstName(client.name);
  const bizName = esc(config?.name || 'nuestro negocio');
  const phone   = esc(config?.ownerPhone || '');

  // Format last visit date
  let lastVisitStr = lastVisitDate || '';
  if (lastVisitDate) {
    try {
      const d = new Date(lastVisitDate + 'T12:00:00');
      lastVisitStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch(_) {}
  }

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
  const lastVisitLabel = lang === 'eu' ? 'Azken bisita' : lang === 'gl' ? 'Última visita' : 'Última visita';
  const ctaLabel = lang === 'eu' ? 'Hitzordua hartu' : lang === 'gl' ? 'Reservar cita' : 'Reservar cita';
  const unsubLabel = lang === 'eu' ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.' : 'Para darte de baja de estos recordatorios, responde a este email.';

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px 28px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">NodeFlow</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px;">${esc(bizName)}</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:16px;font-weight:700;margin:0 0 8px;">${greeting} 👋</p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 20px;">${esc(copy.body)}</p>
    ${lastVisitStr ? `<p style="color:#475569;font-size:12px;margin:0 0 16px;">${lastVisitLabel}: ${lastVisitStr}</p>` : ''}
    <a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px;">📞 ${ctaLabel}</a>
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">${unsubLabel}</p>
  </div>
</div>
</body></html>`;

  log.info(`Sending rebooking email to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject: `${copy.title} — ${config?.name || ''}`, html });
}

module.exports = { sendRebookingEmail };
