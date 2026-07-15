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

  // Hueco liberado → ofrecerlo automáticamente al primer candidato de la lista
  // de espera (gateado por WA_WAITLIST_AUTOOFFER + plantilla aprobada). No
  // bloquea el aviso al dueño: corre después y a prueba de fallos.
  if (action === 'cancelled' && apt.businessId) {
    try {
      const { offerFreedSlot } = require('../lifecycle/waitlist-offer');
      await offerFreedSlot({
        businessId: apt.businessId, date: apt.date, time: apt.time,
        service: apt.service, humanDate: humanDate(apt.date), bizName,
      }, {
        credentials,
        notifyOwner: async (m) => {
          if (ownerPhone) { try { const r = await sendText(ownerPhone, m, credentials); if (r?.ok) return; } catch (_) {} }
          await sendWhatsApp(m).catch(() => {});
        },
      });
    } catch (e) { log.warn(`waitlist auto-offer: ${e.message}`); }
  }
}

// ── Sincronización con Google Calendar (Fase 3) ──────────────────────────────
// Al CONFIRMAR: si la cita aún no tiene evento en el calendario del dueño, se
// crea y se guarda el id. Deps inyectables para tests.
async function ensureCalendarEvent(apt, deps = {}) {
  if (!apt || apt.googleEventId || !apt.businessId) return null;
  const push  = deps.pushAppointmentEvent || require('../integrations/calendar-sync').pushAppointmentEvent;
  const store = deps.appointmentsStore     || appointmentsStore;
  const eventId = await push(apt.businessId, apt);
  if (eventId) {
    apt.googleEventId = eventId;
    store.patch(apt.id, { googleEventId: eventId });
  }
  return eventId;
}

// Al CANCELAR: borra el evento del calendario (si lo había) y limpia el id.
// Delega en el helper CANÓNICO de calendar-sync (compartido con las
// cancelaciones por voz y por portal). Deps inyectables para tests.
async function removeCalendarEvent(apt, deps = {}) {
  return require('../integrations/calendar-sync').syncCancelToCalendar(apt, deps);
}

// ── Handler principal ─────────────────────────────────────────────────────────
async function handleReply({ from, type, payload }) {
  // CITA EXACTA por payload (bug real 2026-07-15): el recordatorio ahora manda
  // "CONFIRMAR:APT-x" / "CANCELAR:APT-x" en el botón. Si viene el id, se actúa
  // sobre ESA cita — no sobre "la más próxima" (con dos citas, confirmaba/
  // cancelaba la equivocada). Seguridad: el id debe pertenecer al MISMO
  // teléfono que responde. Sin id (texto libre, plantillas viejas) → fallback.
  let apt = null;
  const idMatch = String(payload || '').match(/\b(APT-[A-Za-z0-9_-]+)\b/);
  if (idMatch) {
    const cand = scheduler.appointments.get(idMatch[1]);
    if (cand && normalizePhone(cand.phone) === normalizePhone(from)) apt = cand;
    else log.warn(`Reply con id ${idMatch[1]} que no casa con ${from} — fallback a cita más próxima`);
  }
  if (!apt) apt = findNextAppointment(from);

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

  // Precedencia de intención (bug del repaso 2026-07-15): "NO PUEDO confirmar"
  // entraba por CONFIRMAR (se evaluaba primero con includes). La intención de
  // cancelar SIEMPRE gana sobre la palabra "confirmar" suelta.
  const _up = String(payload || '').toUpperCase();
  const _cancelIntent = _up.includes('CANCELAR') || _up.includes('ANULAR') || _up.includes('NO PUEDO');

  // ── CONFIRMAR ──────────────────────────────────────────────────────────────
  if (!_cancelIntent && (_up.includes('CONFIRMAR') || _up === 'SI' || _up === 'SÍ' || _up === 'OK')) {
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

    // Fase 3: si la cita aún no está en Google Calendar (reservada antes de
    // conectar Google, o el sync de la reserva falló), la creamos AHORA al
    // confirmar → queda en Citas Y en el calendario del dueño. Fail-open.
    ensureCalendarEvent(apt).catch(() => {});

    await sendText(from,
      `¡Perfecto, ${name}! ✅ Tu cita en *${bizName}* está confirmada.\n\n` +
      `📅 *${humanDate(apt.date)}* · *${apt.time}h*\n` +
      `🗓️ ${apt.service}\n\n` +
      `Te esperamos. Si surge algo y necesitas cancelar, escríbenos aquí mismo. ¡Hasta pronto! 👋`,
      credentials
    ).catch(e => log.warn(`WA confirm reply error: ${e.message}`));
    try { require('./wa-log').logWaMessage({ orgId: apt.businessId, phone: from, direction: 'out', kind: 'confirmar', body: `Cita confirmada: ${apt.service || 'tu cita'} — ${humanDate(apt.date)} ${apt.time}h` }); } catch (_) {}

    await alertOwner(apt, 'confirmed', credentials);
    return;
  }

  // ── CANCELAR ───────────────────────────────────────────────────────────────
  if (_cancelIntent) {
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

    // Fase 3: borra el evento del Google Calendar del dueño (si lo había) — así
    // no queda de FANTASMA tras la cancelación. Fail-open, no bloquea la respuesta.
    removeCalendarEvent(apt).catch(() => {});

    await sendText(from,
      `Entendido, ${name}. ❌ Tu cita del *${humanDate(apt.date)}* a las *${apt.time}h* en *${bizName}* ha sido cancelada.\n\n` +
      `Cuando quieras volver a reservar, llámanos o escríbenos aquí. ¡Hasta pronto! 👋`,
      credentials
    ).catch(e => log.warn(`WA cancel reply error: ${e.message}`));
    try { require('./wa-log').logWaMessage({ orgId: apt.businessId, phone: from, direction: 'out', kind: 'cancelar', body: `Cita cancelada: ${humanDate(apt.date)} ${apt.time}h` }); } catch (_) {}

    await alertOwner(apt, 'cancelled', credentials);
    return;
  }

  // ── Payload desconocido ────────────────────────────────────────────────────
  log.warn(`Unknown payload from ${from}: "${payload}"`);
}

// ── Opt-out (cumplimiento WhatsApp: honrar bajas evita reportes y bans) ───────
const OPTOUT_RE = /\b(baja|baixa|stop|darme de baja|dar de baja|no\s*molestar|no\s*quiero(?:\s*m[aá]s)?|unsubscribe|dejar de (?:recibir|escribir)|suscripci[oó]n|ez dut nahi|kendu|baja eman)\b/i;

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

// ── Botones del check-in v2 (👍 Todo genial / 👎 Se puede mejorar) ───────────
// El payload del quick_reply llega como el TEXTO del botón.
function checkinButtonKind(payload = '') {
  const p = String(payload || '');
  if (/👍|todo genial/iu.test(p)) return 'positive';
  if (/👎|se puede mejorar/iu.test(p)) return 'negative';
  return null;
}

/**
 * 👍 → agradecer + pedir reseña de Google (la respuesta abre la ventana de
 * 24h: el enlace viaja como texto libre, sin plantilla). El momento exacto:
 * satisfacción confirmada = la reseña sale sola.
 * 👎 → alerta URGENTE al dueño (mismo circuito que el texto negativo) +
 * acuse empático. @returns true si el payload era de check-in.
 */
async function handleCheckinButton({ from, businessId, payload }, deps = {}) {
  const kind = checkinButtonKind(payload);
  if (!kind) return false;

  const send = deps.sendText || sendText;
  const sendOwnerFallback = deps.sendWhatsApp || sendWhatsApp;
  const credentials = businessId ? await getWaCredentials(businessId).catch(() => null) : null;
  const bizName = getBusinessName(businessId);
  const cfg = businessId ? scheduler.getBusinessConfig(businessId) : null;

  if (kind === 'positive') {
    // reviewUrl: misma prioridad que los emails de reseña (reminders.js) —
    // URL directa del portal > placeId de Google > nada (solo agradecer).
    const auto = cfg?.automations?.config || {};
    const reviewUrl = auto.reviewUrl
      || (cfg?.googlePlaceId ? `https://search.google.com/local/writereview?placeid=${cfg.googlePlaceId}` : null);
    const msg = reviewUrl
      ? `¡Nos alegra un montón! 🙌 Si tienes 30 segundos, una reseña en Google nos ayuda muchísimo a seguir creciendo:\n${reviewUrl}\n¡Gracias por confiar en ${bizName}!`
      : `¡Nos alegra un montón! 🙌 Gracias por confiar en ${bizName} — aquí nos tienes para lo que necesites.`;
    await send(from, msg, credentials).catch(() => {});
    log.info(`Check-in 👍 de ${from} (org ${businessId || '?'}) — reseña ${reviewUrl ? 'pedida' : 'sin enlace configurado'}`);
    return true;
  }

  // negative: alerta urgente al dueño (sin regex ni lookup — el botón ES la señal)
  const ownerPhone = deps.ownerPhone !== undefined ? deps.ownerPhone
    : (cfg?.automations?.config?.alertPhone || cfg?.ownerPhone || process.env.OWNER_PHONE);
  const ownerMsg =
    `🚨 *Un cliente ha pulsado "Se puede mejorar"*\n━━━━━━━━━━━━━━\n` +
    `👤 ${from}\n\n` +
    `Respondió al seguimiento post-servicio con el botón 👎.\n` +
    `━━━━━━━━━━━━━━\n*Llámale hoy*: un cliente atendido a tiempo no se convierte en mala reseña. 🤖 ${bizName}`;
  let notified = false;
  if (ownerPhone) {
    try { const r = await send(ownerPhone, ownerMsg, credentials); if (r?.ok) notified = true; } catch (_) {}
  }
  if (!notified) {
    try { await sendOwnerFallback(ownerMsg); notified = true; } catch (e) { log.warn(`checkin 👎 fallback: ${e.message}`); }
  }
  const ack = notified
    ? `Vaya, sentimos que no haya ido como esperabas 😔 Se lo hemos pasado a ${bizName} para que te contacten hoy mismo y lo solucionen. Si quieres contarnos más, escríbenos por aquí.`
    : `Vaya, sentimos que no haya ido como esperabas 😔 Por favor, llámanos y lo solucionamos cuanto antes. Si quieres contarnos más, escríbenos por aquí.`;
  await send(from, ack, credentials).catch(() => {});
  log.info(`Check-in 👎 de ${from} (org ${businessId || '?'}) → dueño avisado=${notified}`);
  return true;
}

// ── Respuesta a una oferta de HUECO LIBRE (lista de espera) ──────────────────
// El candidato tenía una entrada 'contacted' (se le ofreció un hueco). Si
// acepta → alerta al dueño para que lo reserve (humano en el lazo = sin riesgo
// de doble reserva); si rechaza → vuelve a 'waiting' para el siguiente.
function waitlistReplyKind(payload = '') {
  const p = String(payload || '');
  // Rechazo PRIMERO y con negación explícita: "no me interesa" / "no lo
  // quiero" contienen "me interesa"/"quiero" — si mirásemos aceptar antes,
  // un rechazo se colaría como aceptación (bug cazado 2026-07-07).
  if (/\bno\b[^.!?]*\b(quiero|interesa|puedo|viene|va)\b|ahora no|otro d[ií]a|paso\b|d[eé]jalo|no gracias/iu.test(p)) return 'decline';
  if (/lo quiero|me interesa|me viene bien|\bs[ií]\b|\bvale\b|perfecto|genial|adelante|quiero/iu.test(p)) return 'accept';
  return null;
}

async function handleWaitlistResponse({ from, businessId, payload }, deps = {}) {
  if (!businessId) return false;
  const db = deps.db || require('../db/database').getDatabase();
  if (!db.enabled) return false;

  // ¿Tiene este teléfono una oferta de hueco pendiente ('contacted')?
  let entry = null;
  try {
    const variants = phoneVariants(from);
    const { data } = await db.client.from('nf_waitlist')
      .select('id, name, phone, service, status')
      .eq('organization_id', businessId).eq('status', 'contacted')
      .in('phone', variants).order('created_at', { ascending: false }).limit(1);
    entry = data && data[0];
  } catch (e) { log.warn(`waitlist response lookup (${from}): ${e.message}`); }
  if (!entry) return false;

  const kind = waitlistReplyKind(payload);
  if (!kind) return false; // tiene oferta pero la respuesta no es clara → deja que el flujo genérico avise al dueño

  const send = deps.sendText || sendText;
  const sendOwnerFallback = deps.sendWhatsApp || sendWhatsApp;
  const credentials = businessId ? await getWaCredentials(businessId).catch(() => null) : null;
  const bizName = getBusinessName(businessId);
  const cfg = businessId ? scheduler.getBusinessConfig(businessId) : null;
  const ownerPhone = deps.ownerPhone !== undefined ? deps.ownerPhone
    : (cfg?.automations?.config?.alertPhone || cfg?.ownerPhone || process.env.OWNER_PHONE);
  const firstName = String(entry.name || 'cliente').split(' ')[0] || 'cliente';

  if (kind === 'accept') {
    // Marca 'booked' (pendiente de que el dueño confirme la cita) — solo si sigue 'contacted'.
    await db.client.from('nf_waitlist').update({ status: 'booked' })
      .eq('id', entry.id).eq('status', 'contacted').then(undefined, () => {});
    const ownerMsg =
      `✅ *¡Quieren el hueco libre!*\n━━━━━━━━━━━━━━\n👤 ${entry.name || 'Cliente'} (${from})\n` +
      `${entry.service ? `🗓️ ${entry.service}\n` : ''}━━━━━━━━━━━━━━\n*Resérvale la cita y confírmasela.* 🤖 ${bizName}`;
    let notified = false;
    if (ownerPhone) { try { const r = await send(ownerPhone, ownerMsg, credentials); if (r?.ok) notified = true; } catch (_) {} }
    if (!notified) { try { await sendOwnerFallback(ownerMsg); } catch (_) {} }
    await send(from, `¡Genial, ${firstName}! 🙌 Se lo hemos pasado a ${bizName} para que te confirme la cita enseguida. ¡Gracias!`, credentials).catch(() => {});
    log.info(`Hueco ACEPTADO por ${from} (org ${businessId})`);
    return true;
  }

  // decline → vuelve a la cola para el siguiente
  await db.client.from('nf_waitlist').update({ status: 'waiting' })
    .eq('id', entry.id).eq('status', 'contacted').then(undefined, () => {});
  await send(from, `Sin problema, ${firstName} 😊 Te mantenemos en la lista para el próximo hueco. ¡Hasta pronto!`, credentials).catch(() => {});
  log.info(`Hueco RECHAZADO por ${from} (org ${businessId}) → vuelve a lista`);
  return true;
}

module.exports = { handleReply, ensureCalendarEvent, removeCalendarEvent, normalizePhone, isOptOut, handleOptOut, isCourtesy, notifyOwnerFreeText, isNegativeFeedback, handleCheckinFeedback, checkinButtonKind, handleCheckinButton, waitlistReplyKind, handleWaitlistResponse };
