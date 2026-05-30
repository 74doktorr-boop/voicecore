// ============================================
// NodeFlow — Registro de nuevos clientes
// POST /api/registro  → guarda datos, devuelve ID
// ============================================

const { Logger } = require('../utils/logger');
const { getDatabase } = require('../db/database');
const { sendEmail, sendAcknowledgement, notifyNuevoLead } = require('../notifications/email');
const { notifyLeadWhatsApp } = require('../notifications/whatsapp');
const crypto = require('crypto');

const log = new Logger('REGISTRO');

// ─── Rate limiter — 10 submissions per IP per 15 minutes ──────────────────────
const _rlStore = new Map();
function registroRateLimit(req, res, next) {
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 min
  let bucket = _rlStore.get(ip);
  if (!bucket || now - bucket.start > windowMs) { bucket = { start: now, count: 0 }; _rlStore.set(ip, bucket); }
  bucket.count++;
  if (bucket.count > 10) {
    log.warn(`Registro rate limit exceeded for IP: ${ip}`);
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.' });
  }
  next();
}

// ─── Cupones válidos ───────────────────────────────────────────────────────────
const COUPONS = {
  'HEMENTXE10': {
    discount: 10,
    source:   'hementxe',
    stripeCode: 'HEMENTXE10',
    active: true,
    description: 'Revista Hementxe – Q2 2026',
  },
  'GALIZA15': {
    discount: 15,
    source:   'galiza',
    stripeCode: 'GALIZA15',
    active: true,
    description: 'Campaña lanzamiento Galicia – 2026',
  },
  'GALIZA': {
    discount: 15,
    source:   'galiza',
    stripeCode: 'GALIZA15',
    active: true,
    description: 'Alias corto campaña Galicia – 2026',
  },
};

function validateCoupon(code) {
  if (!code) return null;
  const c = COUPONS[code.toUpperCase().trim()];
  return (c && c.active) ? { code: code.toUpperCase().trim(), ...c } : null;
}

// Fallback en memoria si Supabase no está configurado (máx 500 entradas, LRU simple)
const _memStore = new Map();
const _MEM_MAX  = 500;
function _memSet(id, row) {
  if (_memStore.size >= _MEM_MAX) {
    // Evict oldest entry
    _memStore.delete(_memStore.keys().next().value);
  }
  _memStore.set(id, row);
}

function generateId() {
  return 'reg_' + crypto.randomBytes(8).toString('hex');
}

async function saveRegistro(data) {
  const id  = generateId();
  const row = { id, status: 'pending_payment', created_at: new Date().toISOString(), ...data };

  const db = getDatabase();
  if (db.enabled) {
    try {
      await db.client.from('registros').insert(row);
      log.info(`Registro guardado en Supabase: ${id}`);
    } catch (e) {
      log.warn(`Supabase insert fallido, usando memoria: ${e.message}`);
      _memSet(id, row);
    }
  } else {
    _memSet(id, row);
    log.info(`Registro guardado en memoria: ${id}`);
  }

  return row;
}

async function getRegistro(id) {
  // Primero memoria (más rápido)
  if (_memStore.has(id)) return _memStore.get(id);

  const db = getDatabase();
  if (db.enabled) {
    const { data } = await db.client.from('registros').select('*').eq('id', id).single();
    return data || null;
  }

  return null;
}

async function updateRegistro(id, patch) {
  if (_memStore.has(id)) {
    _memStore.set(id, { ..._memStore.get(id), ...patch });
  }

  const db = getDatabase();
  if (db.enabled) {
    await db.client.from('registros').update(patch).eq('id', id);
  }
}

function setupRegistroRoutes(app) {
  // POST /api/registro — guarda los datos del formulario antes de ir a Stripe
  app.post('/api/registro', registroRateLimit, async (req, res) => {
    try {
      const { sector, negocio, contacto, ciudad, telefono, email, plan, voz, idioma, saludo, horario, coupon, source: formSource, language: formLanguage } = req.body;
      const couponData = validateCoupon(coupon);

      // Validación básica — core required fields only
      const required = { sector, negocio, contacto, telefono, email, plan };
      for (const [key, val] of Object.entries(required)) {
        if (!val?.toString().trim()) {
          return res.status(400).json({ error: `Campo requerido: ${key}` });
        }
      }

      if (!['negocio', 'pro', 'starter'].includes(plan)) {
        return res.status(400).json({ error: 'Plan inválido' });
      }

      // Optional fields with sensible defaults
      const efectivoVoz    = voz    || 'nova';
      const efectivoIdioma = idioma || 'es';
      const efectivoCiudad = ciudad || 'España';
      const efectivoSaludo = saludo || `Hola, gracias por llamar a ${negocio}. ¿En qué puedo ayudarte?`;

      // Derive source and language — Galician landing sends source:'galiza', idioma:'gl'
      const effectiveSource   = couponData?.source || formSource || null;
      const effectiveLanguage = formLanguage || efectivoIdioma;

      const row = await saveRegistro({
        sector, negocio, contacto,
        ciudad:  efectivoCiudad,
        telefono: telefono.trim(),
        email:    email.trim().toLowerCase(),
        plan,
        voz:    efectivoVoz,
        idioma: efectivoIdioma,
        saludo: efectivoSaludo,
        horario:  typeof horario === 'object' ? horario : {},
        language: effectiveLanguage,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        ...(couponData ? {
          coupon_code:      couponData.code,
          discount_percent: couponData.discount,
        } : {}),
      });

      log.info(`Nuevo registro: ${row.id} — ${negocio} (${plan}) [${effectiveLanguage}${effectiveSource ? ` · src:${effectiveSource}` : ''}]${couponData ? ` [cupón: ${couponData.code}]` : ''}`);

      // ── Notificaciones — fire & forget (no bloquean la respuesta) ───────────
      // 1. Auto-responder al lead: "Recibido, te contactamos en <24h"
      sendAcknowledgement(row).catch(e => log.warn(`Acknowledgement email fallido: ${e.message}`));

      // 2. Email interno a Unai con teléfono + links directos WA/llamada
      notifyNuevoLead(row).catch(e => log.warn(`Lead notification fallida: ${e.message}`));

      // 3. WhatsApp a Unai vía Callmebot (requiere CALLMEBOT_PHONE + CALLMEBOT_API_KEY)
      notifyLeadWhatsApp(row).catch(e => log.warn(`WhatsApp notification fallida: ${e.message}`));

      res.json({
        id: row.id,
        ...(couponData ? { stripeCode: couponData.stripeCode, discount: couponData.discount } : {}),
      });

    } catch (e) {
      log.error('Error en /api/registro', { error: e.message });
      res.status(500).json({ error: 'Error interno. Inténtalo de nuevo.' });
    }
  });

  // GET /api/registro/:id — datos públicos para la página /gracias
  app.get('/api/registro/:id', async (req, res) => {
    try {
      const registro = await getRegistro(req.params.id);
      if (!registro) return res.status(404).json({ error: 'Not found' });
      res.json({ negocio: registro.negocio, sector: registro.sector, plan: registro.plan });
    } catch (e) {
      res.status(500).json({ error: 'Error interno' });
    }
  });

  log.info('Registro routes configured');
}

module.exports = { setupRegistroRoutes, getRegistro, updateRegistro };
