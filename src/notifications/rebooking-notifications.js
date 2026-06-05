// ============================================
// NodeFlow — Re-booking email v2
// Sector-aware, trilingual (es/eu/gl)
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('REBOOKING-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function firstName(n = '') { return n.split(' ')[0]; }

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
  hotel:        { emoji: '🏨', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
  yoga:         { emoji: '🧘', color: '#6d28d9', light: '#f5f3ff', dark: '#3b0764' },
  pilates:      { emoji: '🏃', color: '#db2777', light: '#fdf2f8', dark: '#831843' },
  nutricion:    { emoji: '🥗', color: '#059669', light: '#f0fdf4', dark: '#14532d' },
  barberia:     { emoji: '💈', color: '#1e293b', light: '#f8fafc', dark: '#0f172a' },
  autoescuela:  { emoji: '🚗', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  abogados:     { emoji: '⚖️', color: '#475569', light: '#f8fafc', dark: '#1e293b' },
  default:      { emoji: '👋', color: '#7c3aed', light: '#faf5ff', dark: '#4c1d95' },
};

// ─── Sector copy (title + body + stat) ───────────────────────────────────────

const SECTOR_COPY = {
  peluqueria: {
    es: {
      title: 'Tu melena te llama',
      body: 'Hace más de un mes que no pasas por aquí. ¿Reservamos para esta semana?',
      stat: { emoji: '✂️', value: '4-6 sem', label: 'Intervalo ideal\nentre visitas' },
    },
    eu: {
      title: 'Zure ilea dei egiten dizu',
      body: 'Hilabete baino gehiago da ikusten ez zaitudala. Aste honetarako hitzordua jartzen dugu?',
      stat: { emoji: '✂️', value: '4-6 aste', label: 'Bisita tartea\negokia' },
    },
  },
  estetica: {
    es: {
      title: 'Es hora de mimarte',
      body: 'Hace tiempo que no disfrutas de tu tratamiento favorito. Tu piel lo nota.',
      stat: { emoji: '💆', value: '3-4 sem', label: 'Frecuencia ideal\npara mejores resultados' },
    },
  },
  dental: {
    es: {
      title: 'Tu revisión dental anual',
      body: 'Han pasado 6 meses desde tu última consulta. Una revisión preventiva ahorra mucho a largo plazo.',
      stat: { emoji: '🦷', value: '6 meses', label: 'Revisión recomendada\npor los expertos' },
    },
  },
  clinica: {
    es: {
      title: 'Recordatorio de revisión',
      body: 'Han pasado varios meses desde tu última consulta. Tu salud es lo primero.',
      stat: { emoji: '🏥', value: '3-6 mes', label: 'Control médico\nrecomendado' },
    },
  },
  veterinaria: {
    es: {
      title: 'Tu mascota merece una revisión',
      body: 'Ha pasado un año desde la última visita. Una revisión anual es clave para su salud.',
      stat: { emoji: '🐾', value: '1 año', label: 'Revisión anual\nrecomendada' },
    },
    eu: {
      title: 'Zure maskota azterketa bat merezi du',
      body: 'Urte bat igaro da azken bisitaz geroztik. Urteko azterketa garrantzitsua da.',
      stat: { emoji: '🐾', value: '1 urte', label: 'Urteko azterketa\ngomendatua' },
    },
  },
  taller: {
    es: {
      title: 'Tu coche lleva tiempo sin revisión',
      body: 'Hace un año desde la última puesta a punto. Mejor revisarlo antes de que avise en marcha.',
      stat: { emoji: '🚗', value: '1 año', label: 'Revisión anual\nrecomendada' },
    },
  },
  gimnasio: {
    es: {
      title: '¡Te echamos de menos!',
      body: 'Llevamos tiempo sin verte. La constancia es lo que marca la diferencia — volvemos a estar aquí.',
      stat: { emoji: '💪', value: '3x/sem', label: 'Frecuencia ideal\npara resultados' },
    },
  },
  fisioterapia: {
    es: {
      title: 'Seguimiento de tu tratamiento',
      body: 'Los tratamientos de fisio funcionan mucho mejor cuando se mantiene la cadencia. ¿Continuamos?',
      stat: { emoji: '🏃', value: '1-2 sem', label: 'Frecuencia recomendada\nentre sesiones' },
    },
  },
  restaurante: {
    es: {
      title: '¿Volvemos a vernos?',
      body: 'Han pasado unas semanas desde tu última visita. Tenemos novedades en carta que te van a gustar.',
      stat: { emoji: '🍽️', value: 'Nuevo menú', label: 'Novedades desde\ntu última visita' },
    },
  },
  psicologia: {
    es: {
      title: '¿Cómo estás?',
      body: 'Hace unas semanas que no hablamos. Estoy aquí cuando lo necesites — sin prisas ni presión.',
      stat: { emoji: '🧠', value: 'Semanal', label: 'Cadencia recomendada\nen proceso activo' },
    },
  },
  nutricion: {
    es: {
      title: 'Tu seguimiento mensual te espera',
      body: 'Es el momento de revisar tu progreso. Un seguimiento constante marca la diferencia.',
      stat: { emoji: '🥗', value: '1 mes', label: 'Control mensual\nrecomendado' },
    },
  },
  yoga: {
    es: {
      title: 'El mat te echa de menos',
      body: 'Hace unas semanas que no practicas. La constancia en el yoga es donde están los resultados.',
      stat: { emoji: '🧘', value: '2-3x/sem', label: 'Práctica ideal\npara progresar' },
    },
  },
  pilates: {
    es: {
      title: 'Retomemos el pilates',
      body: 'Tu cuerpo mejora con la constancia. ¿Reservamos una clase para esta semana?',
      stat: { emoji: '🏃', value: '2x/sem', label: 'Frecuencia ideal\nen pilates' },
    },
  },
  barberia: {
    es: {
      title: 'Ya va tocando un repaso',
      body: 'Llevamos un tiempo sin verte por la barbería. ¿Te apuntamos para esta semana?',
      stat: { emoji: '💈', value: '3-4 sem', label: 'Frecuencia ideal\nentre cortes' },
    },
  },
  optica: {
    es: {
      title: 'Tu vista merece atención',
      body: 'Hace tiempo que no revisamos tu graduación. Una revisión periódica es clave para tu salud visual.',
      stat: { emoji: '👓', value: '1-2 años', label: 'Revisión visual\nrecomendada' },
    },
  },
  asesoria: {
    es: {
      title: 'Se acerca el próximo período fiscal',
      body: 'Llevamos unos meses sin hablar. ¿Revisamos tu situación antes del próximo vencimiento?',
      stat: { emoji: '📊', value: 'Trimestral', label: 'Revisión contable\nrecomendada' },
    },
  },
  hotel: {
    es: {
      title: '¿Vuelves a visitarnos?',
      body: 'Han pasado unos meses desde tu estancia. Tenemos una oferta especial para clientes habituales.',
      stat: { emoji: '🏨', value: 'Oferta', label: 'Descuento exclusivo\npara clientes frecuentes' },
    },
  },
  academia: {
    es: {
      title: 'No te pierdas las próximas clases',
      body: 'Hay plazas disponibles en los próximos cursos. ¿Te interesa continuar con tu formación?',
      stat: { emoji: '📚', value: 'Nuevos cursos', label: 'Disponibles\neste mes' },
    },
  },
  farmacia: {
    es: {
      title: 'Renovación de medicación',
      body: 'Es momento de renovar tu receta o pasar a recoger tu pedido habitual.',
      stat: { emoji: '💊', value: 'Mensual', label: 'Renovación\nde medicación' },
    },
  },
  abogados: {
    es: {
      title: 'Revisemos tu situación',
      body: 'Han pasado unos meses. ¿Hay algo legal que deba revisar o gestionar para ti?',
      stat: { emoji: '⚖️', value: 'Periódico', label: 'Revisión de\nasuntos legales' },
    },
  },
  default: {
    es: {
      title: 'Hace tiempo que no te vemos',
      body: 'Queremos recordarte que seguimos aquí para ayudarte cuando lo necesites.',
      stat: { emoji: '👋', value: '¡Hola!', label: 'Seguimos aquí\npara ti' },
    },
    eu: {
      title: 'Denbora da ikusi ez zaitudanik',
      body: 'Beharrezkoa duzunean hemen gaude.',
      stat: { emoji: '👋', value: 'Kaixo!', label: 'Hemen gaude\nzure zain' },
    },
  },
};

function getCopy(sector, lang) {
  const s = SECTOR_COPY[sector] || SECTOR_COPY.default;
  const l = s[lang] || s.es || SECTOR_COPY.default.es;
  return l;
}

// ─── Helper: stat box ─────────────────────────────────────────────────────────

function statBox(stat, color, light, dark) {
  if (!stat) return '';
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${light};border-radius:12px;margin:0 0 20px;">
    <tr>
      <td style="padding:16px 20px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:28px;padding-right:16px;vertical-align:middle;">${stat.emoji}</td>
            <td style="vertical-align:middle;">
              <div style="font-size:22px;font-weight:900;color:#0f0f23;letter-spacing:-.03em;">${esc(stat.value)}</div>
              <div style="font-size:11px;color:${dark};margin-top:2px;line-height:1.4;">${esc(stat.label).replace(/\n/g,'<br>')}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * @param {object} client        - { name, email, phone, lastVisitDate }
 * @param {object} config        - { name, ownerPhone, language, sector }
 * @param {string} lastVisitDate - 'YYYY-MM-DD'
 */
async function sendRebookingEmail(client, config, lastVisitDate) {
  if (!client?.email) {
    log.warn(`sendRebookingEmail: no email for client ${client?.name} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const sector  = config?.sector   || 'default';
  const sc      = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const copy    = getCopy(sector, lang);
  const name    = firstName(client.name);
  const bizName = esc(config?.name || 'nuestro negocio');
  const phone   = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');

  // Format last visit date
  let lastVisitStr = lastVisitDate || '';
  if (lastVisitDate) {
    try {
      const d = new Date(lastVisitDate + 'T12:00:00');
      lastVisitStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
    } catch(_) {}
  }

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
  const lastVisitLabel = lang === 'eu' ? 'Azken bisita' : 'Última visita';
  const ctaLabel  = lang === 'eu' ? 'Hitzordua hartu →' : lang === 'gl' ? 'Reservar cita →' : 'Reservar cita →';
  const ctaWa     = lang === 'eu' ? 'WhatsApp bidez' : 'Por WhatsApp';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : lang === 'gl'
    ? 'Para non recibir máis recordatorios, responde a este correo.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  const waText = encodeURIComponent(lang === 'eu'
    ? `Kaixo, ${name} naiz. Hitzordua hartu nahi nuke.`
    : `Hola, soy ${name}. Me gustaría reservar una cita.`);
  const waLink = phone ? `https://wa.me/34${phone.replace(/\D/g,'')}?text=${waText}` : '';

  const subject = `${copy.title} — ${config?.name || ''}`;

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
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Mensaje del negocio</div>
          </td>
          <td align="right" style="font-size:32px;">${sc.emoji}</td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:28px 28px 24px;">

      <!-- Title -->
      <p style="font-size:22px;font-weight:900;color:#0f0f23;margin:0 0 8px;letter-spacing:-.02em;">${esc(copy.title)}</p>

      <!-- Body text -->
      <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 20px;">
        ${greeting}, ${esc(copy.body)}
      </p>

      <!-- Stat box -->
      ${statBox(copy.stat, sc.color, sc.light, sc.dark)}

      <!-- Last visit (if provided) -->
      ${lastVisitStr ? `
      <div style="background:#f8f8fb;border-radius:10px;padding:12px 16px;margin:0 0 20px;font-size:13px;color:#64748b;">
        ${lastVisitLabel}: <strong style="color:#0f0f23;">${lastVisitStr}</strong>
      </div>` : ''}

      <!-- CTAs -->
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:13px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaLabel}</a>
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
    `${copy.title}`,
    ``,
    `${greeting}, ${copy.body}`,
    ``,
    lastVisitStr ? `${lastVisitLabel}: ${lastVisitStr}` : '',
    ``,
    phone ? `📞 ${ctaLabel}: ${phone}` : '',
    waLink ? `💬 ${ctaWa}: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(l => l !== undefined && l !== null).join('\n');

  log.info(`Sending rebooking email to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject, html, text });
}

// ─── Second-touch follow-up ───────────────────────────────────────────────────

/**
 * @param {object} client  - { name, email, phone }
 * @param {object} config  - { name, ownerPhone, language, sector }
 */
async function sendRebookingFollowUp(client, config) {
  if (!client?.email) {
    log.warn(`sendRebookingFollowUp: no email for ${client?.name} — skipped`);
    return false;
  }

  const lang      = config?.language || 'es';
  const sector    = config?.sector   || 'default';
  const sc        = SECTOR_CONFIG[sector] || SECTOR_CONFIG.default;
  const rawName   = firstName(client.name);
  const name      = esc(rawName);
  const bizName   = esc(config?.name || 'nuestro equipo');
  const phone     = (config?.ownerPhone || '').replace(/[^0-9+\-\s]/g, '');

  // Second touch is more personal — shorter, different angle
  const FOLLOWUP_COPY = {
    peluqueria: {
      es: { title: 'Un mensaje rápido de tu peluquería', body: 'Solo quería ver si necesitas hora esta semana. Tenemos huecos disponibles — reservar lleva 30 segundos.' },
      eu: { title: 'Mezu azkar bat zure ilargintegitik', body: 'Aste honetarako denbora duzu? Tarteak libre daude.' },
    },
    psicologia: {
      es: { title: '¿Cómo llevas la semana?', body: 'No hace falta que todo esté bien para hablar. Estoy aquí cuando quieras retomar.' },
    },
    dental: {
      es: { title: 'Solo un recordatorio amable', body: 'La revisión dental sigue pendiente. Cuanto antes, mejor para tu salud bucal. ¿Lo dejamos esta semana?' },
    },
    default: {
      es: { title: '¿Seguimos en contacto?', body: `Te escribimos hace unos días. Seguimos aquí cuando lo necesites — ${config?.name || 'estamos disponibles'} para ti.` },
      eu: { title: 'Oraindik hemen gaude', body: 'Duela egun batzuk idatzi genizun. Behar duzunean, hemen gaude.' },
    },
  };

  const fc = (FOLLOWUP_COPY[sector] || FOLLOWUP_COPY.default);
  const fl = fc[lang] || fc.es || FOLLOWUP_COPY.default.es;

  const greeting   = lang === 'eu' ? `Kaixo ${name}` : `Hola ${name}`;
  const ctaLabel   = lang === 'eu' ? 'Hitzordua hartu' : 'Reservar cita';
  const ctaWa      = lang === 'eu' ? 'WhatsApp bidez' : 'Por WhatsApp';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  const waText = encodeURIComponent(`Hola, soy ${rawName}. Me gustaría reservar una cita.`);
  const waLink = phone ? `https://wa.me/34${phone.replace(/\D/g,'')}?text=${waText}` : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f8;padding:32px 16px;">
<tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

    <!-- HEADER — more personal, no logo -->
    <tr><td style="background:#ffffff;border-radius:16px 16px 0 0;padding:22px 28px;border-bottom:2px solid ${sc.color};">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:16px;font-weight:800;color:#0f0f23;">${bizName} ${sc.emoji}</div>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- BODY -->
    <tr><td style="background:#ffffff;padding:24px 28px 20px;">
      <p style="font-size:19px;font-weight:800;color:#0f0f23;margin:0 0 8px;">${esc(fl.title)}</p>
      <p style="font-size:15px;color:#334155;line-height:1.7;margin:0 0 24px;">
        ${greeting} 👋, ${esc(fl.body)}
      </p>

      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${phone ? `<td style="padding-right:10px;">
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${sc.color};">
              <a href="tel:${phone.replace(/\s/g,'')}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">📞 ${ctaLabel}</a>
            </td></tr></table>
          </td>` : ''}
          ${waLink ? `<td>
            <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#25d366;">
              <a href="${waLink}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">💬 ${ctaWa}</a>
            </td></tr></table>
          </td>` : ''}
        </tr>
      </table>
    </td></tr>

    <!-- FOOTER -->
    <tr><td style="background:#f8f8fb;border-radius:0 0 16px 16px;padding:14px 28px;border-top:1px solid #e8e8f0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;">${unsubLabel}</p>
      <p style="font-size:10px;color:#cbd5e1;margin:6px 0 0;">
        Gestionado por <a href="https://nodeflow.es" style="color:${sc.color};text-decoration:none;">NodeFlow IA</a>
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${fl.title}`,
    ``,
    `${greeting}, ${fl.body}`,
    ``,
    phone ? `📞 ${ctaLabel}: ${phone}` : '',
    waLink ? `💬 ${ctaWa}: ${waLink}` : '',
    ``,
    unsubLabel,
  ].filter(l => l !== undefined && l !== null).join('\n');

  log.info(`Second-touch rebooking sent to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject: `${fl.title} — ${config?.name || ''}`, html, text });
}

module.exports = { sendRebookingEmail, sendRebookingFollowUp };
