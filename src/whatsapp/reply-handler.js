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

// ── Normaliza teléfono para comparar ─────────────────────────────────────────
// Asegura que phone="34612345678" y apt.phone="612345678" o "+34 612 345 678"
// todos matcheen entre sí.
function normalizePhone(raw = '') {
  let p = String(raw).replace(/[\s\-+()]/g, '');
  if (p.startsWith('0034')) p = p.slice(4);
  if (p.startsWith('34') && p.length === 11) p = p.slice(2);
  return p; // 9 dígitos: "612345678"
}

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
  const msg =
    `${icon} *Cita ${verb} por el cliente*\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 ${apt.patientName}\n` +
    `📅 ${humanDate(apt.date)} · ${apt.time}h\n` +
    `🗓️ ${apt.service}\n` +
    `📞 ${apt.phone}\n` +
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

module.exports = { handleReply };
