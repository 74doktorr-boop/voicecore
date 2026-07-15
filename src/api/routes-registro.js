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
const rateStore = require('../utils/rate-store');

// ─── Rate limiter — 10 submissions per IP per 15 minutes ──────────────────────
// Vía rate-store compartido (Redis si REDIS_URL → multi-réplica; si no, memoria).
async function registroRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  let count;
  try {
    ({ count } = await rateStore.hit(`registro:${ip}`, 15 * 60 * 1000));
  } catch (e) {
    return next(); // fail-open
  }
  if (count > 10) {
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

/**
 * Reclama atómicamente un registro para aprovisionarlo (idempotencia del
 * webhook de Stripe). Transición CAS a 'provisioning' SOLO si no está ya
 * 'active' ni 'provisioning'. Es seguro entre entregas duplicadas y entre
 * réplicas (la condición se evalúa en Postgres, no en memoria por-instancia).
 * @returns {Promise<boolean>} true si este proceso ganó el claim.
 */
async function claimRegistroForProvisioning(id) {
  const db = getDatabase();
  if (db.enabled) {
    const { data, error } = await db.client.from('registros')
      .update({ status: 'provisioning' })
      .eq('id', id)
      .not('status', 'in', '("active","provisioning")')
      .select('id');
    if (error) throw new Error(`claimRegistroForProvisioning: ${error.message}`);

    if (Array.isArray(data) && data.length > 0) {
      if (_memStore.has(id)) _memStore.set(id, { ..._memStore.get(id), status: 'provisioning' });
      // Marca de tiempo para la reconciliación de atascos (auditoría 2026-07-16).
      // BEST-EFFORT y separada: si la columna aún no existe (pre-migración), falla
      // en silencio sin afectar al claim, que es lo crítico. Nunca lanza.
      try {
        Promise.resolve(
          db.client.from('registros').update({ provisioning_at: new Date().toISOString() }).eq('id', id)
        ).catch(() => {});
      } catch (_) {}
      return true;
    }

    // 0 filas: o ya está active/provisioning (duplicado real), o el registro
    // no llegó a la BD (insert cayó al registrar → solo en memoria).
    const { data: existing } = await db.client.from('registros').select('status').eq('id', id).maybeSingle();
    if (existing) return false; // existe pero ya reclamado/activo → duplicado
    // No está en BD: best-effort sobre memStore (despliegue de instancia única).
  }

  const r = _memStore.get(id);
  if (r && (r.status === 'active' || r.status === 'provisioning')) return false;
  if (r) { _memStore.set(id, { ...r, status: 'provisioning' }); return true; }
  return false;
}

/**
 * Libera un claim de aprovisionamiento devolviéndolo a estado reintentable,
 * solo si sigue en 'provisioning' (no pisa un 'active' marcado por otra
 * entrega). Se usa si el aprovisionamiento falla, para que el reintento de
 * Stripe pueda volver a procesarlo.
 */
async function releaseRegistroProvisioning(id) {
  const db = getDatabase();
  if (db.enabled) {
    try {
      await db.client.from('registros')
        .update({ status: 'pending_payment' })
        .eq('id', id)
        .eq('status', 'provisioning');
    } catch (_) { /* best-effort */ }
  }
  if (_memStore.has(id)) {
    const r = _memStore.get(id);
    if (r.status === 'provisioning') _memStore.set(id, { ...r, status: 'pending_payment' });
  }
}

/**
 * Reconciliación de altas atascadas (auditoría 2026-07-16). Si el proceso muere
 * ENTRE claim y 'active' (OOM, redeploy de EasyPanel), el registro se queda en
 * 'provisioning' para siempre: Stripe reintenta, el claim falla y el fundador
 * pagó pero se quedó a medias, en silencio. Este barrido (leader-gated, en el
 * cron) rescata esos casos de forma SEGURA — sin arriesgar doble org/número:
 *   · Atascado + YA existe org (owner_email) → se marca 'active' (el proceso
 *     creó la org pero no finalizó; la cabina de admin cubre número/emails).
 *   · Atascado + NO existe org → murió antes de crearla, así que NO se compró
 *     número: se reabre a 'pending_payment' para que el reintento de Stripe lo
 *     complete limpio. Se avisa fuerte por log en ambos casos.
 * Solo actúa sobre registros con provisioning_at ANTIGUO (thresholdMinutes) para
 * no tocar altas en vuelo (que tardan segundos). provisioning_at null → se salta
 * (conservador; pre-migración o timestamp best-effort que no cuajó).
 */
async function reconcileStuckProvisioning({ db, now = Date.now(), thresholdMinutes = 15 } = {}) {
  db = db || getDatabase();
  const out = { checked: 0, completed: 0, reopened: 0, skipped: 0 };
  if (!db.enabled) return out;
  const cutoff = new Date(now - thresholdMinutes * 60000).toISOString();

  let stuck = [];
  try {
    const { data, error } = await db.client.from('registros')
      .select('id, email, negocio, provisioning_at, status')
      .eq('status', 'provisioning');
    if (error) return out;               // columna ausente / error → no-op seguro
    stuck = data || [];
  } catch (_) { return out; }

  for (const r of stuck) {
    out.checked++;
    // Sin marca de tiempo o aún dentro de la ventana normal → no tocar (en vuelo).
    if (!r.provisioning_at || r.provisioning_at > cutoff) { out.skipped++; continue; }
    try {
      const { data: org } = await db.client.from('organizations')
        .select('id').eq('owner_email', r.email).limit(1).maybeSingle();
      if (org && org.id) {
        // La org existe: finalizar el alta (Stripe deja de reintentar).
        const { data: upd } = await db.client.from('registros')
          .update({ status: 'active' }).eq('id', r.id).eq('status', 'provisioning').select('id');
        if (Array.isArray(upd) && upd.length) {
          out.completed++;
          log.warn(`Reconcile: registro ${r.id} (${r.email}) tenía org ${org.id} pero seguía 'provisioning' → 'active'. REVISA que tenga número y que salieran los emails.`);
        }
      } else {
        // No hay org: murió antes de crearla (no se compró número) → reabrir.
        const { data: upd } = await db.client.from('registros')
          .update({ status: 'pending_payment' }).eq('id', r.id).eq('status', 'provisioning').select('id');
        if (Array.isArray(upd) && upd.length) {
          out.reopened++;
          log.error(`Reconcile: registro ${r.id} (${r.email} · ${r.negocio}) PAGÓ pero se quedó a medias SIN org → reabierto a 'pending_payment'. Si Stripe no reintenta, complétalo a mano.`);
        }
      }
    } catch (e) { log.warn(`reconcile registro ${r.id}: ${e.message}`); }
  }
  if (out.completed || out.reopened) log.info(`Reconcile altas: ${out.completed} completadas, ${out.reopened} reabiertas de ${out.checked} en provisioning.`);
  return out;
}

function setupRegistroRoutes(app) {
  // POST /api/registro — guarda los datos del formulario antes de ir a Stripe
  app.post('/api/registro', registroRateLimit, async (req, res) => {
    try {
      const { sector, negocio, contacto, ciudad, telefono, email, voz, idioma, saludo, horario, coupon, source: formSource, language: formLanguage, servicios } = req.body;

      // Servicios que ofrece (chips del onboarding): personalizan reglas de
      // seguimiento y precios desde el DÍA 0. Saneado: máx 20, strings cortos.
      const serviciosClean = Array.isArray(servicios)
        ? servicios.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 60)).slice(0, 20)
        : [];
      // Único plan comercial: Negocio €49. Se ignora cualquier `plan` del form
      // (incluido el legacy 'pro' de enlaces antiguos).
      const plan = 'negocio';
      // Cupón estático primero; si no, comprobar si es un código de referido (DB)
      let couponData = validateCoupon(coupon);
      let referralData = null;
      if (!couponData && coupon) {
        try {
          referralData = await require('../referrals/referrals').lookupReferral(coupon);
          if (referralData) {
            couponData = {
              code:       referralData.code,
              discount:   referralData.discount,
              source:     'referral',
              stripeCode: referralData.stripeCode,
            };
          }
        } catch (_) {}
      }

      // Validación básica — core required fields only
      const required = { sector, negocio, contacto, telefono, email, plan };
      for (const [key, val] of Object.entries(required)) {
        if (!val?.toString().trim()) {
          return res.status(400).json({ error: `Campo requerido: ${key}` });
        }
      }

      // Validación de formato
      const emailClean = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailClean)) {
        return res.status(400).json({ error: 'Formato de email inválido' });
      }
      const phoneClean = telefono.replace(/[\s\-\(\)\+\.]/g, '');
      if (!/^\d{7,15}$/.test(phoneClean)) {
        return res.status(400).json({ error: 'Formato de teléfono inválido' });
      }

      // Longitud máxima para evitar payloads abusivos
      if (negocio.length > 120 || contacto.length > 80 || (saludo && saludo.length > 400)) {
        return res.status(400).json({ error: 'Campos demasiado largos' });
      }


      // Optional fields with sensible defaults
      const efectivoVoz    = voz    || 'nova';
      const efectivoIdioma = idioma || 'es';
      const efectivoCiudad = ciudad || 'España';
      const efectivoSaludo = saludo || `Hola, gracias por llamar a ${negocio}. ¿En qué puedo ayudarte?`;

      // Derive source and language — Galician landing sends source:'galiza', idioma:'gl'
      // Saneamos formSource (atribución de landing): cap 60 chars, sin caracteres raros.
      const cleanFormSource = formSource
        ? String(formSource).toLowerCase().replace(/[^a-z0-9/:_-]/g, '').slice(0, 60)
        : null;
      const effectiveSource   = couponData?.source || cleanFormSource || null;
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
        ...(serviciosClean.length ? { servicios: serviciosClean } : {}),
        language: effectiveLanguage,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        ...(couponData ? {
          coupon_code:      couponData.code,
          discount_percent: couponData.discount,
        } : {}),
      });

      log.info(`Nuevo registro: ${row.id} — ${negocio} (${plan}) [${effectiveLanguage}${effectiveSource ? ` · src:${effectiveSource}` : ''}]${couponData ? ` [cupón: ${couponData.code}]` : ''}`);

      // Si entró por un referido, registrar el signup (la conversión se marca al pagar)
      if (referralData) {
        require('../referrals/referrals')
          .recordSignup(referralData.code, row.id, row.email)
          .catch(e => log.warn(`recordSignup fallido: ${e.message}`));
      }

      // ── Notificaciones — fire & forget (no bloquean la respuesta) ───────────
      // 1. Auto-responder al lead: "Recibido, te contactamos en <24h"
      sendAcknowledgement(row).catch(e => log.warn(`Acknowledgement email fallido: ${e.message}`));

      // 2. Email interno a Unai con teléfono + links directos WA/llamada
      notifyNuevoLead(row).catch(e => log.warn(`Lead notification fallida: ${e.message}`));

      // 3. WhatsApp a Unai vía Callmebot (requiere CALLMEBOT_PHONE + CALLMEBOT_API_KEY)
      notifyLeadWhatsApp(row).catch(e => log.warn(`WhatsApp notification fallida: ${e.message}`));

      res.json({
        id:     row.id,
        idioma: effectiveLanguage,  // needed by /gracias for i18n personalisation
        ...(couponData ? { stripeCode: couponData.stripeCode, discount: couponData.discount } : {}),
      });

    } catch (e) {
      log.error('Error en /api/registro', { error: e.message });
      res.status(500).json({ error: 'Error interno. Inténtalo de nuevo.' });
    }
  });

  // GET /api/registro/:id/checkout — RESCATE del pago abandonado.
  // El funnel normal (onboarding.html) ya redirige a Stripe; pero quien
  // abandona ahí se quedaba en tierra de nadie hasta que alguien le llamara.
  // Este enlace (va como botón en el email de acuse) crea una Checkout
  // Session fresca con su registroId → al pagar, la provisión automática
  // completa de siempre. GET con redirect para poder ser un enlace de email.
  app.get('/api/registro/:id/checkout', registroRateLimit, async (req, res) => {
    const base = process.env.PUBLIC_URL || 'https://nodeflow.es';
    try {
      const registro = await getRegistro(req.params.id);
      if (!registro) return res.redirect(302, `${base}/onboarding.html`);
      if (registro.status === 'active' || registro.status === 'provisioning') {
        // Ya pagó (quizá clicó el email dos veces) → a su página de progreso.
        return res.redirect(302, `${base}/gracias/?id=${encodeURIComponent(registro.id)}`);
      }

      // Si el registro trajo cupón válido, se aplica solo en el checkout.
      let stripeCode = null;
      if (registro.coupon_code) {
        const c = validateCoupon(registro.coupon_code);
        if (c?.stripeCode) stripeCode = c.stripeCode;
        else {
          try {
            const ref = await require('../referrals/referrals').lookupReferral(registro.coupon_code);
            if (ref?.stripeCode) stripeCode = ref.stripeCode;
          } catch (_) {}
        }
      }

      const { getBilling } = require('../billing/stripe');
      const out = await getBilling().createRegistroCheckout({
        registroId: registro.id,
        email: registro.email,
        couponStripeCode: stripeCode,
      });
      res.redirect(302, out.url);
    } catch (e) {
      log.error(`checkout de registro falló: ${e.message}`);
      res.redirect(302, `${base}/onboarding.html`);
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

module.exports = { setupRegistroRoutes, getRegistro, updateRegistro, claimRegistroForProvisioning, releaseRegistroProvisioning, reconcileStuckProvisioning };
