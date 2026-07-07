'use strict';
// ============================================================
// NodeFlow — WhatsApp Reply Handler
// Procesa respuestas de botón del cliente: CONFIRMAR / CANCELAR
//
// Flujo CONFIRMAR:
//   1. Busca la próxima cita del cliente por teléfono
//   2. Marca apt.wa_confirmed = true
//   3. Envía WA de agradecimiento al cliente
//   4. Alerta al negocio
//
// Flujo CANCELAR:
//   1. Busca la próxima cita del cliente por teléfono
//   2. Cancela la cita (status = 'cancelled')
//   3. Envía WA de confirmación de cancelación al cliente
//   4. Alerta urgente al negocio con WhatsApp
// ============================================================

const { Logger }              = require('../utils/logger');
const { scheduler }           = require('../scheduling/scheduler');
const { sendText }            = require('../notifications/client-whatsapp');
const { sendWhatsApp }        = require('../notifications/whatsapp'); // owner Callmebot fallback
const { getWaCredentials }    = require('./accounts');
const { appointmentsStore }   = require('../db/appointments-store');

const log = new Logger('WA-REPLY');

// Normalización de teléfono: util canónica de la app (nacional 9 dígitos), para
// que "34612345678", "612345678" y "+34 612 345 678" matcheen entre sí.
const { normalizePhone, phoneVariants } = require('../utils/phone');

// ── Encuentra la cita más próxima de un cliente por teléfono ─────────────────
function findNextAppointment(rawPhone) {
  const phone9 = normalizePhone(rawPhone);
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

  let best = null;
  for (const [, apt] of scheduler.appointments) {
    if (apt.status === 'cancelled') continue;
    if (normalizePhone(apt.phone) !== phone9) continue;
    if (apt.date < todayStr) continue; // pasadas, no cuentan

    if (!best || apt.date < best.date || (apt.date === best.date && apt.time < best.time)) {
      best = apt;
    }
  }
  return best;
}

// ── Obtiene config del negocio para el mensaje ───────────────────────────────
function getBusinessName(businessId) {
  const cfg = scheduler.getBusinessConfig(businessId);
  return cfg?.name || 'el negocio';
}

// ── Formatea fecha humana ─────────────────────────────────────────────────────
function humanDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${days[date.getDay()]} ${d} de ${months[m - 1]}`;
}

// ── Alerta al dueño del negocio ───────────────────────────────────────────────
async function alertOwner(apt, action, credentials = null) {
  const bizName    = getBusinessName(apt.businessId);
  const cfg        = scheduler.getBusinessConfig(apt.businessId);
  // alertPhone: teléfono personal del dueño configurado en portal
  // ownerPhone: número provisionado del negocio (fallback)
  const ownerPhone = cfg?.automations?.config?.alertPhone || cfg?.ownerPhone || process.env.OWNER_PHONE;

  const icon = action === 'confirmed' ? '✅' : '❌';
  const verb = action === 'confirmed' ? 'CONFIRMADA' : 'CANCELADA';

  // Si se canceló, mirar si hay gente en lista de espera para rellenar el hueco
  let waitlistNote = '';
  if (action === 'cancelled' && apt.businessId) {
    try {
      const { getDatabase } = require('../db/database');
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client
          .from('nf_waitlist')
          .select('name, phone')
          .eq('organization_id', apt.businessId)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true })
          .limit(3);
        if (data && data.length) {
          waitlistNote = `\n💡 *Tienes ${data.length} en lista de espera* para rellenar este hueco:\n` +
            data.map(w => `• ${w.name || 'Cliente'} (${w.phone})`).join('\n') + '\n';
        }
      }
    } catch (_) {}
  }

  const msg =
    `${icon} *Cita ${verb} por el cliente*\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 ${apt.patientName}\n` +
    `📅 ${humanDate(apt.date)} · ${apt.time}h\n` +
    `🗓️ ${apt.service}\n` +
    `📞 ${apt.phone}\n` +
    waitlistNote +
    `━━━━━━━━━━━━━━\n` +
    `🤖 NodeFlow IA — ${bizName}`;

  // Intentar enviar por Meta WA al dueño (con credenciales del negocio si existen)
  if (ownerPhone) {
    try {
      const result = await sendText(ownerPhone, msg, credentials);
      if (result.ok) return;
    } catch (_) {}
  }
  // Fallback: Callmebot (no necesita credenciales WA)
  await sendWhatsApp(msg).catch(e => log.warn(`Owner alert fallback error: ${e.message}`));
}

// ── Handler principal ─────────────────────────────────────────────────────────
async function handleReply({ from, type, payload }) {
  const apt = findNextAppointment(from);

  if (!apt) {
    log.warn(`Reply from ${from} but no upcoming appointment found`);
    await sendText(from,
      '¡Gracias por tu mensaje! No hemos encontrado ninguna cita próxima asociada a tu número. Si necesitas ayuda, llámanos directamente. 😊'
    ).catch(() => {});
    return;
  }

  // Credenciales del negocio para que la respuesta salga desde el número del negocio
  const credentials = apt.businessId ? await getWaCredentials(apt.businessId).catch(() => null) : null;

  const bizName = getBusinessName(apt.businessId);
  const name    = apt.patientName?.split(' ')[0] || 'cliente';

  // ── CONFIRMAR ──────────────────────────────────────────────────────────────
  if (payload.toUpperCase().includes('CONFIRMAR') || payload.toUpperCase() === 'SI' || payload.toUpperCase() === 'SÍ' || payload.toUpperCase() === 'OK') {
    if (apt.wa_confirmed) {
      await sendText(from,
        `${name}, tu cita ya estaba confirmada 👍 Te esperamos el *${humanDate(apt.date)}* a las *${apt.time}h*. ¡Hasta pronto!`,
        credentials
      ).catch(() => {});
      return;
    }

    apt.wa_confirmed = true;
    // Persist flag so it survives server restarts
    appointmentsStore.patch(apt.id, { wa_confirmed: true, updatedAt: new Date().toISOString() });
    log.info(`Appointment ${apt.id} confirmed by client via WA`);

    await sendText(from,
      `¡Perfecto, ${name}! ✅ Tu cita en *${bizName}* está confirmada.\n\n` +
      `📅 *${humanDate(apt.date)}* · *${apt.time}h*\n` +
      `🗓️ ${apt.service}\n\n` +
      `Te esperamos. Si surge algo y necesitas cancelar, escríbenos aquí mismo. ¡Hasta pronto! 👋`,
      credentials
    ).catch(e => log.warn(`WA confirm reply error: ${e.message}`));

    await alertOwner(apt, 'confirmed', credentials);
    return;
  }

  // ── CANCELAR ───────────────────────────────────────────────────────────────
  if (payload.toUpperCase().includes('CANCELAR') || payload.toUpperCase().includes('ANULAR') || payload.toUpperCase().includes('NO PUEDO')) {
    if (apt.status === 'cancelled') {
      await sendText(from,
        `${name}, tu cita ya estaba cancelada. Si quieres reservar otra, llámanos o escríbenos. 😊`,
        credentials
      ).catch(() => {});
      return;
    }

    const cancelledAt = new Date().toISOString();
    apt.status = 'cancelled';
    apt.cancelledAt = cancelledAt;
    apt.cancelledBy = 'client_whatsapp';
    // Persist cancellation so it survives server restarts
    appointmentsStore.patch(apt.id, { status: 'cancelled', cancelledAt, cancelledBy: 'client_whatsapp', updatedAt: cancelledAt });
    log.info(`Appointment ${apt.id} cancelled by client via WA`);

    await sendText(from,
      `Entendido, ${name}. ❌ Tu cita del *${humanDate(apt.date)}* a las *${apt.time}h* en *${bizName}* ha sido cancelada.\n\n` +
      `Cuando quieras volver a reservar, llámanos o escríbenos aquí. ¡Hasta pronto! 👋`,
      credentials
    ).catch(e => log.warn(`WA cancel reply error: ${e.message}`));

    await alertOwner(apt, 'cancelled', credentials);
    return;
  }

  // ── Payload desconocido ────────────────────────────────────────────────────
  log.warn(`Unknown payload from ${from}: "${payload}"`);
}

// ── Opt-out (cumplimiento WhatsApp: honrar bajas evita reportes y bans) ───────
const OPTOUT_RE = /\b(baja|stop|darme de baja|dar de baja|no\s*molestar|no\s*quiero(?:\s*m[aá]s)?|unsubscribe|dejar de (?:recibir|escribir)|suscripci[oó]n)\b/i;

function isOptOut(text = '') {
  return OPTOUT_RE.test(String(text));
}

/**
 * Honra una baja recibida por WhatsApp: marca no_whatsapp en el contacto
 * (one-way, vía call-memory → el scheduler ya lo respeta) y confirma al cliente.
 * @param {{from:string, businessId?:string}} params
 * @returns {Promise<boolean>} true si se persistió la baja.
 */
async function handleOptOut({ from, businessId }) {
  const credentials = businessId ? await getWaCredentials(businessId).catch(() => null) : null;
  let persisted = false;

  try {
    const { getDatabase } = require('../db/database');
    const db = getDatabase();
    if (db.enabled && businessId) {
      const variants = phoneVariants(from);
      const { data } = await db.client
        .from('contacts')
        .select('id, phone')
        .eq('org_id', businessId)
        .in('phone', variants)
        .limit(1);
      const contact = data?.[0];
      if (contact) {
        const { upsertContactMemory } = require('../lifecycle/call-memory');
        await upsertContactMemory(contact.id, businessId, { no_whatsapp: true });
        persisted = true;
      }
    }
  } catch (e) {
    log.warn(`opt-out persist failed for ${from}: ${e.message}`);
  }

  await sendText(from,
    'Hecho ✅ No volverás a recibir mensajes nuestros por WhatsApp. ' +
    'Si en el futuro cambias de idea, escríbenos cuando quieras. ¡Un saludo! 👋',
    credentials
  ).catch(() => {});

  log.info(`Opt-out WhatsApp de ${from} (org ${businessId || '?'}) — persistido=${persisted}`);
  return persisted;
}

// ── Texto libre (ni confirmar/cancelar/baja): mensajes de puro agradecimiento
//    que NO merecen molestar al dueño ("gracias", "vale", "ok gracias"…) ──────
const COURTESY_RE = /^\s*(muchas\s+|mil\s+)?(gracias|vale|ok(ey)?|genial|perfecto|estupendo|de\s*acuerdo|guay|👍|🙏|👌|❤️|😊)+[\s!.,👍🙏👌❤️😊]*$/i;
function isCourtesy(text = '') { return COURTESY_RE.test(String(text || '')); }

/**
 * El cliente ha escrito algo por WhatsApp que NodeFlow aún no gestiona solo
 * (ni confirmar/cancelar/baja). En vez de tirarlo en silencio: avisa al dueño con
 * el mensaje (para que responda él) y acusa recibo HONESTO al cliente — solo le
 * dice "te contactarán" si de verdad hemos podido avisar al negocio.
 * @returns {Promise<boolean>} true si se avisó al dueño.
 */
async function notifyOwnerFreeText({ from, businessId, text }) {
  const credentials = businessId ? await getWaCredentials(businessId).catch(() => null) : null;
  const bizName = getBusinessName(businessId);
  const cfg = businessId ? scheduler.getBusinessConfig(businessId) : null;
  const ownerPhone = cfg?.automations?.config?.alertPhone || cfg?.ownerPhone || process.env.OWNER_PHONE;

  // Contexto para el dueño: ¿este cliente tiene una cita próxima?
  const apt = findNextAppointment(from);
  const who = apt?.patientName ? `${apt.patientName} (${from})` : from;
  const aptLine = apt ? `\n📅 Su cita: ${humanDate(apt.date)} · ${apt.time}h — ${apt.service}` : '';

  const ownerMsg =
    `💬 *Un cliente te ha escrito por WhatsApp*\n━━━━━━━━━━━━━━\n` +
    `👤 ${who}${aptLine}\n\n` +
    `«${String(text).slice(0, 500)}»\n\n` +
    `━━━━━━━━━━━━━━\nNodeFlow aún no responde mensajes libres — contáctale tú. 🤖 ${bizName}`;

  let notified = false;
  if (ownerPhone) {
    try { const r = await sendText(ownerPhone, ownerMsg, credentials); if (r?.ok) notified = true; } catch (_) {}
  }
  if (!notified) {
    // Fallback: Callmebot (no necesita credenciales del negocio)
    try { await sendWhatsApp(ownerMsg); notified = true; } catch (e) { log.warn(`freeText owner alert fallback: ${e.message}`); }
  }

  // Acuse HONESTO al cliente: solo prometemos contacto si avisamos al negocio.
  const ack = notified
    ? `¡Gracias por tu mensaje! 🙌 Se lo hemos hecho llegar a ${bizName} y te contactarán. Si es urgente, llámanos.`
    : `¡Gracias por tu mensaje! Para gestionarlo cuanto antes, por favor llámanos directamente. 😊`;
  await sendText(from, ack, credentials).catch(() => {});

  log.info(`Texto libre de ${from} (org ${businessId || '?'}) → dueño avisado=${notified}`);
  return notified;
}

// ── Fase B: respuesta NEGATIVA al check-in "¿qué tal fue?" ────────────────────
// El como_fue existe para cazar al insatisfecho ANTES de la mala reseña.
// Si el cliente contesta mal pocos días después del check-in, el dueño
// recibe una alerta urgente (no el aviso genérico de "un cliente escribió").
// \p{L} con flag u: los acentos/ñ cuentan como letra (bug cazado 2 veces).
const NEGATIVE_RE = /(fatal|horrible|p[eé]simo|desastre|peor|muy mal|bastante mal|regular tirando|sigo (?:igual|mal|fastidiad)|no (?:me\s+)?(?:ha\s+|han\s+)?(?:gustado|mejorado|funcionado|ayudado|servido|convencido)|me (?:duele|molesta|sigue doliendo|ha sentado mal)|dolor|molestias|empeorad|quej|reclamaci[oó]n|decepcionad|insatisfech|mal servicio|no (?:pienso\s+)?volver[ée]?|no os recomiendo)/iu;
// Frases con palabras "negativas" que en realidad son positivas.
const NEGATIVE_GUARD_RE = /(no est[aá] (?:nada\s+)?mal|nada mal|menos mal|sin dolor|ya no me duele|no me duele|\bmejor\b|muy bien|genial|perfecto|encantad|content[oa])/iu;

function isNegativeFeedback(text = '') {
  const s = String(text || '');
  return NEGATIVE_RE.test(s) && !NEGATIVE_GUARD_RE.test(s);
}

/**
 * Si el texto suena negativo Y este contacto recibió un check-in como_fue
 * en los últimos 7 días → alerta urgente al dueño + acuse empático al cliente.
 * @returns {Promise<boolean>} true si se gestionó aquí (no seguir con el flujo genérico).
 */
async function handleCheckinFeedback({ from, businessId, text }, deps = {}) {
  if (!businessId || !isNegativeFeedback(text)) return false;

  // ¿Hubo un como_fue enviado hace poco a este contacto?
  let contact = null;
  try {
    const db = deps.db || require('../db/database').getDatabase();
    if (!db.enabled) return false;
    const variants = phoneVariants(from);
    const { data } = await db.client.from('contacts')
      .select('id, name').eq('org_id', businessId).in('phone', variants).limit(1);
    contact = data && data[0];
    if (!contact) return false;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: checkin } = await db.client.from('scheduled_reminders')
      .select('id').eq('org_id', businessId).eq('contact_id', contact.id)
      .eq('service_key', 'como_fue').eq('status', 'sent')
      .gte('sent_at', cutoff).limit(1);
    if (!checkin || !checkin.length) return false;
  } catch (e) {
    log.warn(`checkin feedback lookup (${from}): ${e.message}`);
    return false;
  }

  const send = deps.sendText || sendText;
  const sendOwnerFallback = deps.sendWhatsApp || sendWhatsApp;
  const credentials = businessId ? await getWaCredentials(businessId).catch(() => null) : null;
  const bizName = getBusinessName(businessId);
  const cfg = scheduler.getBusinessConfig(businessId);
  const ownerPhone = deps.ownerPhone !== undefined ? deps.ownerPhone
    : (cfg?.automations?.config?.alertPhone || cfg?.ownerPhone || process.env.OWNER_PHONE);
  const who = contact.name ? `${contact.name} (${from})` : from;

  const ownerMsg =
    `🚨 *Respuesta NEGATIVA a tu seguimiento*\n━━━━━━━━━━━━━━\n` +
    `👤 ${who}\n\n«${String(text).slice(0, 500)}»\n\n━━━━━━━━━━━━━━\n` +
    `Le preguntamos qué tal fue y no ha ido bien. *Llámale hoy*: ` +
    `un cliente atendido a tiempo no se convierte en mala reseña. 🤖 ${bizName}`;

  let notified = false;
  if (ownerPhone) {
    try { const r = await send(ownerPhone, ownerMsg, credentials); if (r?.ok) notified = true; } catch (_) {}
  }
  if (!notified) {
    try { await sendOwnerFallback(ownerMsg); notified = true; } catch (e) { log.warn(`checkin alert fallback: ${e.message}`); }
  }

  const ack = notified
    ? `Vaya, sentimos mucho que no haya ido como esperabas 😔 Se lo hemos pasado a ${bizName} para que te contacten hoy mismo y lo solucionen. Gracias por decírnoslo.`
    : `Vaya, sentimos mucho que no haya ido como esperabas 😔 Por favor, llámanos directamente y lo solucionamos cuanto antes. Gracias por decírnoslo.`;
  await send(from, ack, credentials).catch(() => {});

  log.info(`Check-in negativo de ${from} (org ${businessId}) → dueño avisado=${notified}`);
  return true;
}

module.exports = { handleReply, normalizePhone, isOptOut, handleOptOut, isCourtesy, notifyOwnerFreeText, isNegativeFeedback, handleCheckinFeedback };
