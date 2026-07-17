'use strict';
// ============================================================
// NodeFlow — "Llámame" público de la landing (2026-07-17)
// El prospecto deja su número y la IA le LLAMA para que la pruebe en su propio
// teléfono. Ataca la objeción nº1 del embudo simulado (74% no compra por no
// fiarse de la IA): oírla en SU móvil vale más que cualquier anuncio. Además,
// cada petición es un LEAD caliente → se registra y se avisa a Unai.
//
// ESTO GASTA DINERO REAL (telefonía) → protecciones no negociables:
//   · INERTE sin LLAMAME_ORG_ID (la org demo que atiende) → 503.
//   · Solo números ESPAÑOLES móvil/fijo (anti toll-fraud internacional/premium).
//   · Horario 9:00-21:00 Madrid (nadie quiere una demo a las 3am).
//   · Topes: 1/día por teléfono, 3/día por IP, LLAMAME_DAILY_CAP global (30).
// Lección del incidente 822/843: nada de gasto silencioso sin límites.
// ============================================================

const { Logger } = require('../utils/logger');
const log = new Logger('LLAMAME');

// ── Helpers puros (testeables) ───────────────────────────────────────────────

/** Solo destinos españoles no premium: +34 móvil (6/7) o fijo (8/9). PURA. */
function isAllowedSpanishDest(e164) {
  return /^\+34[6789]\d{8}$/.test(String(e164 || ''));
}

/** ¿Hora razonable para llamar? 9:00-20:59 Madrid. `hour` inyectable. PURA. */
function inCallingHours(hour) {
  return hour >= 9 && hour < 21;
}

function madridHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: 'numeric', hour12: false }).format(now));
}

/**
 * Limitador diario en memoria: clave → nº de usos del día (Madrid).
 * PURO respecto a `store` y `today` (inyectables en tests).
 */
function takeDailySlot(store, key, max, today) {
  const rec = store.get(key);
  if (!rec || rec.day !== today) { store.set(key, { day: today, n: 1 }); return true; }
  if (rec.n >= max) return false;
  rec.n++;
  return true;
}

const PHONE_MAX = 1, IP_MAX = 3;
const GLOBAL_MAX = () => Math.max(1, Number(process.env.LLAMAME_DAILY_CAP) || 30);

function setupLlamameRoutes(app, deps = {}) {
  const stores = { phone: new Map(), ip: new Map(), global: new Map() };

  app.post('/api/public/llamame', async (req, res) => {
    try {
      const orgId = deps.orgId !== undefined ? deps.orgId : process.env.LLAMAME_ORG_ID;
      if (!orgId) return res.status(503).json({ error: 'La demo por llamada no está disponible ahora mismo.' });

      const { normalizeE164, startOutboundCall, registerOutboundContext, PURPOSE_BLOCKS } =
        deps.outbound || require('../telephony/outbound');

      const nombre = String(req.body?.nombre || '').trim().slice(0, 60);
      const sector = String(req.body?.sector || '').trim().slice(0, 60);
      const to = normalizeE164(req.body?.telefono);
      if (!to || !isAllowedSpanishDest(to)) {
        return res.status(400).json({ error: 'Necesitamos un teléfono español válido (móvil o fijo).' });
      }

      const hour = deps.hour !== undefined ? deps.hour : madridHour();
      if (!inCallingHours(hour)) {
        return res.status(409).json({ error: 'Solo llamamos de 9:00 a 21:00 — déjanos tu número por la mañana y te llamamos.' });
      }

      const today = deps.today || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
      if (!takeDailySlot(stores.phone, to, PHONE_MAX, today)) {
        return res.status(429).json({ error: 'Ya te hemos llamado hoy — si quieres repetir, escríbenos y te llamamos encantados.' });
      }
      if (!takeDailySlot(stores.ip, String(ip), IP_MAX, today)) {
        return res.status(429).json({ error: 'Demasiadas peticiones desde esta conexión. Inténtalo mañana o escríbenos.' });
      }
      if (!takeDailySlot(stores.global, 'all', GLOBAL_MAX(), today)) {
        log.warn(`Tope diario global de Llámame alcanzado (${GLOBAL_MAX()})`);
        return res.status(429).json({ error: 'Hoy hemos llegado al tope de demos. Déjanos tu número en el formulario y te llamamos mañana.' });
      }

      // Contexto de la llamada: la IA sabe que llama a un PROSPECTO que la prueba.
      await registerOutboundContext(to, {
        businessId: orgId,
        purpose: 'llamame_demo',
        promptBlock: PURPOSE_BLOCKS.llamame_demo('NodeFlow', nombre || null, sector || null),
      });
      await startOutboundCall({ businessId: orgId, to, context: null });
      log.info(`Llámame: demo saliente a ${to.slice(0, 6)}*** (${nombre || 'sin nombre'}${sector ? ', ' + sector : ''})`);

      // LEAD caliente: registrar + avisar a Unai. Best-effort, jamás rompe la demo.
      try {
        const db = require('../db/database').getDatabase();
        if (db.enabled) {
          await db.client.from('leads').insert({
            org_id: orgId, name: nombre || null, phone: to,
            business_type: sector || null, urgency: 'alta',
            notes: 'Pidió la demo Llámame en la landing', source: 'llamame_web',
            created_at: new Date().toISOString(),
          });
        }
      } catch (_) {}
      try {
        const { sendWhatsApp } = require('../notifications/whatsapp');
        sendWhatsApp(`🔥 LEAD Llámame: ${nombre || 'sin nombre'}${sector ? ' (' + sector + ')' : ''} — ${to}. La IA le está llamando AHORA.`).catch(() => {});
      } catch (_) {}

      return res.json({ ok: true, message: 'Te estamos llamando. Descuelga y pruébala 😉' });
    } catch (e) {
      log.warn(`Llámame falló: ${e.message}`);
      return res.status(502).json({ error: 'No hemos podido lanzar la llamada. Inténtalo de nuevo en un minuto.' });
    }
  });

  log.info('Ruta pública Llámame montada en /api/public/llamame (INERTE sin LLAMAME_ORG_ID)');
}

module.exports = { setupLlamameRoutes, isAllowedSpanishDest, inCallingHours, takeDailySlot };
