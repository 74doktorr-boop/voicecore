'use strict';
// ============================================================
// NodeFlow — "Llámame" público de la landing (2026-07-17, endurecido 2026-07-18)
// El prospecto deja su número y la IA le LLAMA para que la pruebe en su propio
// teléfono. Ataca la objeción nº1 del embudo simulado (74% no compra por no
// fiarse de la IA): oírla en SU móvil vale más que cualquier anuncio. Además,
// cada petición es un LEAD caliente → se registra y se avisa a Unai.
//
// ESTO GASTA DINERO REAL (telefonía) y es PÚBLICO Y SIN AUTH → protecciones
// no negociables (revisión adversaria pre-lanzamiento):
//   · INERTE sin LLAMAME_ORG_ID (la org demo que atiende) → 503.
//   · Solo números ESPAÑOLES móvil/fijo (anti toll-fraud internacional/premium).
//   · Horario 9:00-21:00 Madrid.
//   · Topes: 1/día por teléfono, 3/día por IP (en memoria, defensa rápida) +
//     TOPE GLOBAL AUTORITATIVO EN BD (cuenta los leads llamame de hoy →
//     sobrevive a reinicios y es común a todas las réplicas; el Map por sí solo
//     era evadible reiniciando o multi-replicando — lección del incidente 843).
//   · nombre/sector se SANEAN antes de entrar al prompt de la IA (eran inyección
//     de prompt: texto libre del atacante dentro del system prompt de la demo).
//   · El lead se inserta ANTES de llamar = registro de gasto autoritativo.
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
 * Sanea texto libre del formulario ANTES de meterlo en el prompt del sistema de
 * la IA. Neutraliza inyección de prompt: quita saltos, backticks, llaves y
 * comillas que romperían la plantilla, colapsa espacios y recorta. PURA.
 */
function sanitizePromptText(raw, max = 40) {
  return String(raw || '')
    .replace(/[`{}\\<>\r\n]/g, ' ')      // rompen la plantilla / markdown del prompt
    .replace(/["']/g, ' ')                // comillas que cierran cadenas
    .replace(/[#*_]/g, ' ')               // markdown que cambia el sentido
    .replace(/\s+/g, ' ')                 // colapsa
    .trim()
    .slice(0, max);
}

/** ¿Queda cupo en `key` sin consumirlo? PURA respecto a store/today. */
function peekDailySlot(store, key, max, today) {
  const rec = store.get(key);
  return !rec || rec.day !== today || rec.n < max;
}

/** Consume un uso de `key` (asume que peek ya dio OK). PURA respecto a store/today. */
function takeDailySlot(store, key, max, today) {
  const rec = store.get(key);
  if (!rec || rec.day !== today) { store.set(key, { day: today, n: 1 }); return true; }
  if (rec.n >= max) return false;
  rec.n++;
  return true;
}

const PHONE_MAX = 1, IP_MAX = 3;
const GLOBAL_MAX = () => Math.max(1, Number(process.env.LLAMAME_DAILY_CAP) || 30);

/** Cuenta los leads Llámame de HOY (Madrid) para esta org = tope de gasto real. */
async function _countTodayLeads(orgId) {
  const { getDatabase } = require('../db/database');
  const db = getDatabase();
  if (!db.enabled) return 0;
  const startMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()); // YYYY-MM-DD
  // Medianoche Madrid → instante UTC (aprox; el filtro es un piso conservador).
  const fromUtc = new Date(`${startMadrid}T00:00:00+02:00`).toISOString();
  const { count, error } = await db.client.from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('source', 'llamame_web').gte('created_at', fromUtc);
  if (error) throw new Error(error.message);
  return count || 0;
}

function setupLlamameRoutes(app, deps = {}) {
  const stores = { phone: new Map(), ip: new Map() };
  const countTodayLeads = deps.countTodayLeads || _countTodayLeads;

  app.post('/api/public/llamame', async (req, res) => {
    try {
      const orgId = deps.orgId !== undefined ? deps.orgId : process.env.LLAMAME_ORG_ID;
      if (!orgId) return res.status(503).json({ error: 'La demo por llamada no está disponible ahora mismo.' });

      const { normalizeE164, startOutboundCall, registerOutboundContext, PURPOSE_BLOCKS } =
        deps.outbound || require('../telephony/outbound');

      const to = normalizeE164(req.body?.telefono);
      if (!to || !isAllowedSpanishDest(to)) {
        return res.status(400).json({ error: 'Necesitamos un teléfono español válido (móvil o fijo).' });
      }

      const hour = deps.hour !== undefined ? deps.hour : madridHour();
      if (!inCallingHours(hour)) {
        return res.status(409).json({ error: 'Solo llamamos de 9:00 a 21:00 — déjanos tu número por la mañana y te llamamos.' });
      }

      const today = deps.today || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
      // trust proxy=1 → req.ip es la IP real del cliente; NO usar la cabecera
      // cruda como fallback (la controla el atacante y evadiría el tope por IP).
      const ip = String(req.ip || 'unknown');

      // 1) TOPE GLOBAL AUTORITATIVO (BD): sobrevive a reinicios y es común a todas
      //    las réplicas. Es el freno de gasto de verdad.
      let usedToday = 0;
      try { usedToday = await countTodayLeads(orgId); } catch (e) { log.warn(`countTodayLeads: ${e.message}`); }
      if (usedToday >= GLOBAL_MAX()) {
        log.warn(`Tope diario global de Llámame alcanzado (${usedToday}/${GLOBAL_MAX()})`);
        return res.status(429).json({ error: 'Hoy hemos llegado al tope de demos. Déjanos tu número en el formulario y te llamamos mañana.' });
      }

      // 2) Topes por teléfono e IP: PEEK ambos antes de consumir, para no quemar
      //    el cupo de un número si la IP ya estaba al límite (y viceversa).
      if (!peekDailySlot(stores.phone, to, PHONE_MAX, today)) {
        return res.status(429).json({ error: 'Ya te hemos llamado hoy — si quieres repetir, escríbenos y te llamamos encantados.' });
      }
      if (!peekDailySlot(stores.ip, ip, IP_MAX, today)) {
        return res.status(429).json({ error: 'Demasiadas peticiones desde esta conexión. Inténtalo mañana o escríbenos.' });
      }
      takeDailySlot(stores.phone, to, PHONE_MAX, today);
      takeDailySlot(stores.ip, ip, IP_MAX, today);

      // 3) Saneo anti-inyección de prompt del texto libre del formulario.
      const nombre = sanitizePromptText(req.body?.nombre, 40);
      const sector = sanitizePromptText(req.body?.sector, 40);

      // 4) LEAD primero = registro de gasto autoritativo (lo cuenta el tope global).
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
      } catch (e) { log.warn(`Llámame lead insert: ${e.message}`); }

      // 5) Lanzar la demo saliente.
      await registerOutboundContext(to, {
        businessId: orgId,
        purpose: 'llamame_demo',
        promptBlock: PURPOSE_BLOCKS.llamame_demo('NodeFlow', nombre || null, sector || null),
      });
      await startOutboundCall({ businessId: orgId, to, context: null });
      log.info(`Llámame: demo saliente a ${to.slice(0, 6)}*** (${nombre || 'sin nombre'}${sector ? ', ' + sector : ''})`);

      // 6) Aviso a Unai. Best-effort, jamás rompe la demo.
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

module.exports = { setupLlamameRoutes, isAllowedSpanishDest, inCallingHours, takeDailySlot, peekDailySlot, sanitizePromptText };
