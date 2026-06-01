// ============================================================
// NodeFlow — Leads Utilities
// Shared helpers for the lead scraping pipeline:
//   dedup, WA templates, CSV writer, pushToSheet
// ============================================================

require('dotenv').config();
const fs    = require('fs');
const https = require('https');

// ── Normalise string for comparison (strips accents, lowercase, collapse spaces) ──
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks (accents)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// ── Dedup leads by nombre+ciudad (case-insensitive) ───────────────────────────
function dedup(leads) {
  const seen = new Set();
  return leads.filter(l => {
    const key = norm(l.nombre) + '|' + norm(l.ciudad);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── WhatsApp message templates by sector keyword ──────────────────────────────
const WA_TEMPLATES = {
  'dental':        (n, c) => `Hola ${n} 👋 Trabajo con clínicas dentales en ${c} para automatizar la recepción telefónica con IA. Citas, confirmaciones y cancelaciones sin coste de personal extra. ¿Tienes 5 minutos para verlo?`,
  'veterinari':    (n, c) => `Hola ${n} 👋 Vi vuestra clínica veterinaria en ${c}. Tengo una IA que atiende llamadas 24h — citas, urgencias, consultas — sin perderse nada. ¿Te cuento?`,
  'peluquer':      (n, c) => `Hola ${n} 👋 Vi vuestra peluquería en ${c}. Tengo una solución de IA que atiende reservas telefónicas 24h sin que tengas que coger el teléfono. ¿Te cuento en 5 minutos?`,
  'estétic':       (n, c) => `Hola ${n} 👋 Vi vuestro centro en ${c}. Trabajo con centros de estética para automatizar reservas telefónicas con IA — sin perder una llamada aunque estéis atendiendo. ¿Te cuento?`,
  'estetica':      (n, c) => `Hola ${n} 👋 Vi vuestro centro en ${c}. Trabajo con centros de estética para automatizar reservas telefónicas con IA — sin perder una llamada aunque estéis atendiendo. ¿Te cuento?`,
  'gimnasio':      (n, c) => `Hola ${n} 👋 Vi vuestro gimnasio en ${c}. Ofrezco una IA que atiende llamadas 24h: altas, horarios, clases. Los clientes llaman cuando quieren, vosotros no perdéis ninguna alta. ¿Te cuento en 5 min?`,
  'restaurante':   (n, c) => `Hola ${n} 👋 Os vi en ${c} y me surgió una idea: ¿y si vuestra IA atendiera las reservas telefónicas de noche/fin de semana sin perder ninguna llamada? Sin apps, sin cambios. ¿Hablamos?`,
  'farmacia':      (n, c) => `Hola ${n} 👋 Vi vuestra farmacia en ${c}. Tengo una IA que atiende consultas y derivaciones telefónicas 24h. Los clientes obtienen respuesta siempre, vosotros sin interrupciones. ¿5 minutos?`,
  'hotel':         (n, c) => `Hola ${n} 👋 Vi vuestro hotel en ${c}. Ofrezco IA para recepción telefónica 24h: reservas, check-in info, consultas. Sin perder ninguna llamada fuera de horario. ¿Lo vemos?`,
  'academi':       (n, c) => `Hola ${n} 👋 Vi vuestra academia en ${c}. Tengo una IA que atiende consultas y matriculaciones telefónicas 24h sin que tengáis que coger el teléfono. ¿Te interesa verlo?`,
  'asesor':        (n, c) => `Hola ${n} 👋 Vi vuestra asesoría en ${c}. Ofrezco IA que atiende llamadas entrantes 24h: citas, consultas básicas, derivaciones. Vosotros solo veis lo importante. ¿Hablamos?`,
  'inmobiliaria':  (n, c) => `Hola ${n} 👋 Vi vuestra inmobiliaria en ${c}. Tengo una IA que atiende consultas de pisos 24h — características, visitas, precio — sin que tengáis que estar disponibles siempre. ¿Lo vemos?`,
  'taller':        (n, c) => `Hola ${n} 👋 Ofrezco a talleres en ${c} una IA que atiende llamadas de clientes 24h: citas, presupuestos, consultas. Tú solo ves lo que entra. ¿Te interesa probarlo gratis 7 días?`,
  'clínica':       (n, c) => `Hola ${n} 👋 Vi vuestra clínica en ${c}. Tengo una IA que atiende llamadas de pacientes 24h — citas, resultados, derivaciones — sin colapsar recepción. ¿Te cuento?`,
  'clinica':       (n, c) => `Hola ${n} 👋 Vi vuestra clínica en ${c}. Tengo una IA que atiende llamadas de pacientes 24h — citas, resultados, derivaciones — sin colapsar recepción. ¿Te cuento?`,
  'fisioterapia':  (n, c) => `Hola ${n} 👋 Vi vuestro centro de fisioterapia en ${c}. Ofrezco IA que atiende citas telefónicas 24h sin coste de personal extra. ¿5 minutos para verlo?`,
};

function buildWALink(lead) {
  if (!lead.telefono) {
    return { wa_link: '', wa_mensaje: '(sin teléfono — buscar manualmente)' };
  }

  const searchStr = norm(lead.sector) + ' ' + norm(lead.nombre);
  const key = Object.keys(WA_TEMPLATES).find(k => searchStr.includes(k)) || null;
  const fn  = key
    ? WA_TEMPLATES[key]
    : (n, c) => `Hola ${n} 👋 Os vi en ${c}. Tengo una IA que atiende vuestras llamadas 24h — reservas, consultas, citas. ¿5 minutos para verlo?`;

  const wa_mensaje = fn(lead.nombre, lead.ciudad);

  // Normalise phone: strip non-digits, add 34 prefix for Spanish numbers (9 digits)
  const digits = lead.telefono.replace(/\D/g, '');
  const phone  = digits.startsWith('34') ? digits : '34' + digits;
  const wa_link = `https://wa.me/${phone}?text=${encodeURIComponent(wa_mensaje)}`;

  return { wa_link, wa_mensaje };
}

// ── CSV ───────────────────────────────────────────────────────────────────────
const CSV_HEADERS = [
  'nombre', 'sector', 'ciudad', 'telefono', 'address', 'rating', 'reviews',
  'website', 'maps_url', 'wa_link', 'wa_mensaje',
  'estado', 'notas', 'fecha_contacto', 'fecha_añadido',
];

function escCsv(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}

function writeCSV(leads, filepath) {
  const rows = leads.map(l =>
    CSV_HEADERS.map(h => escCsv(l[h] != null ? l[h] : '')).join(',')
  );
  fs.writeFileSync(filepath, [CSV_HEADERS.join(','), ...rows].join('\n'), 'utf8');
}

// ── Push leads to Google Sheet via Apps Script ────────────────────────────────
// Uses GOOGLE_APPS_SCRIPT_URL from .env
// Apps Script handles deduplication server-side (by nombre+ciudad)
function pushToSheet(leads) {
  return new Promise((resolve) => {
    const rawUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!rawUrl) {
      return resolve({ ok: false, reason: 'GOOGLE_APPS_SCRIPT_URL no configurada en .env' });
    }

    const today   = new Date().toLocaleDateString('es-ES');
    const payload = JSON.stringify({
      leads: leads.map(l => ({ ...l, fecha_añadido: today })),
    });

    _doPost(rawUrl, payload, 0, resolve);
  });
}

function _doPost(url, payload, redirectCount, resolve) {
  if (redirectCount > 5) {
    return resolve({ ok: false, reason: 'Demasiadas redirecciones del Sheet' });
  }

  let urlObj;
  try { urlObj = new URL(url); }
  catch { return resolve({ ok: false, reason: 'URL del Sheet inválida: ' + url }); }

  const options = {
    hostname: urlObj.hostname,
    path:     urlObj.pathname + urlObj.search,
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    // Follow redirects (Apps Script typically returns 302)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return _doPost(res.headers.location, payload, redirectCount + 1, resolve);
    }

    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const json = JSON.parse(body);
        resolve({
          ok:      json.ok === true,
          added:   json.added   || 0,
          skipped: json.skipped || 0,
          error:   json.error,
        });
      } catch {
        resolve({ ok: false, reason: 'Respuesta inesperada: ' + body.substring(0, 120) });
      }
    });
  });

  req.on('error', e => resolve({ ok: false, reason: e.message }));
  req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, reason: 'Timeout (15s)' }); });
  req.write(payload);
  req.end();
}

module.exports = { dedup, buildWALink, writeCSV, pushToSheet };
