// ============================================================
// NodeFlow — Lifecycle Scheduler (System D)
// Cron: every 30 min → claim pending reminders → dispatch
// Channel priority: WhatsApp → SMS → Email
// ============================================================

const { getDatabase }           = require('../db/database');
const { getContactMemory, incrementFailedAttempts } = require('./call-memory');
const { getCapDays, holdUntil } = require('./frequency-cap');
const { sendTemplate, isConfigured: waConfigured } = require('../notifications/client-whatsapp');
const { sendSMS, isConfigured: smsConfigured } = require('../notifications/sms');
const { sendEmail }             = require('../notifications/email');
const { Logger }                = require('../utils/logger');

const log = new Logger('LIFECYCLE-SCHEDULER');

// ── Message builder ──────────────────────────────────────────────────────────

const SERVICE_LABELS = {
  corte_pelo:         'tu corte de pelo',
  color_tinte:        'el tinte',
  tratamiento:        'tu tratamiento capilar',
  permanente:         'la permanente',
  cambio_aceite:      'el cambio de aceite de tu vehículo',
  itv:                'la ITV de tu vehículo',
  revision:           'la revisión del vehículo',
  revision_anual:     'tu revisión anual',
  limpieza:           'tu limpieza dental',
  ortodoncia:         'tu seguimiento de ortodoncia',
  post_tratamiento:   'tu revisión post-tratamiento',
  facial:             'tu tratamiento facial',
  depilacion_laser:   'tu sesión de depilación láser',
  depilacion_cera:    'tu depilación',
  tratamiento_corporal: 'tu tratamiento corporal',
  vacuna_anual:       'la vacuna anual',
  desparasitacion:    'la desparasitación',
  post_cirugia:       'la revisión post-cirugía',
  renovacion_cuota:   'la renovación de tu cuota',
  reactivacion:       'tu próxima visita',
  seguimiento_post:   'tu seguimiento',
  mantenimiento:      'tu sesión de mantenimiento',
  sesion_habitual:    'tu próxima sesión',
  revision_mensual:   'tu revisión mensual',
  revision_vista:     'tu revisión de vista',
  reposicion_lentillas: 'la reposición de tus lentillas',
  aniversario:        'tu próximo aniversario',
  cumpleanos:         'tu cumpleaños',
  recuperacion:       'una nueva visita',
  renovacion_matricula: 'la renovación de matrícula',
  renovacion_psicotecnico: 'renovar tu psicotécnico',
};

/**
 * Build a personalized reminder message.
 * Returns { text, waTemplateName, waComponents, language }
 */
// Meta rechaza parámetros de plantilla con saltos de línea o tabs: TODO lo
// que viaje como {{n}} pasa por aquí (nombres importados de CSV incluidos).
function waParam(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// Texto de FALLBACK (SMS/email) por idioma — coherente con la plantilla de
// WhatsApp localizada (2026-07-07). Solo el marco cambia; los datos van igual.
function fallbackText(kind, lang, { firstName, orgName, label }) {
  const L = (lang === 'eu' || lang === 'gl') ? lang : 'es';
  const T = {
    servicio: {
      es: `Hola ${firstName} 👋 Te escribimos desde ${orgName}. Ha llegado el momento de ${label}. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.`,
      eu: `Kaixo ${firstName} 👋 ${orgName} gara. ${label} egiteko garaia iritsi da. Hitzordua hartu nahi duzu? Erantzun mezu honi edo deitu iezaguzu.`,
      gl: `Ola ${firstName} 👋 Escribímosche desde ${orgName}. Chegou o momento de ${label}. Axudámoste a reservar cita? Podes responder a esta mensaxe ou chamarnos directamente.`,
    },
    aviso: {
      es: `Hola ${firstName}, un mensaje de ${orgName}: ${label} Puedes respondernos por aquí o llamarnos cuando quieras.`,
      eu: `Kaixo ${firstName}, ${orgName}(r)en mezua: ${label} Erantzun hemen edo deitu nahi duzunean.`,
      gl: `Ola ${firstName}, unha mensaxe de ${orgName}: ${label} Podes respondernos por aquí ou chamarnos cando queiras.`,
    },
    como_fue: {
      es: `Hola ${firstName}, somos ${orgName}. ¿Qué tal fue ${label}? Si necesitas cualquier ajuste o tienes alguna duda, respóndenos por aquí y te ayudamos encantados.`,
      eu: `Kaixo ${firstName}, ${orgName} gara. Zer moduz joan zen ${label}? Zerbait doitu behar baduzu edo zalantzarik baduzu, erantzun hemen eta pozik lagunduko dizugu.`,
      gl: `Ola ${firstName}, somos ${orgName}. Que tal foi ${label}? Se precisas calquera axuste ou tes algunha dúbida, respóndenos por aquí e axudámoste encantados.`,
    },
  };
  return (T[kind] && T[kind][L]) || T[kind].es;
}

function buildMessage(reminder, contact, memory) {
  const name      = waParam(contact?.name) || 'cliente';
  const firstName = name.split(' ')[0];
  const orgName   = waParam(contact?._orgName) || 'el negocio';
  const lang      = memory?.preferences?.idioma || 'es';

  // Prioridad: etiqueta guardada al programar (soporta seguimientos personalizados)
  // → mapa estático por serviceKey → genérico.
  const serviceLabel = waParam(reminder.message_preview) || SERVICE_LABELS[reminder.service_key] || 'tu próxima cita';

  // Idioma de PLANTILLA acotado a los aprobados en Meta: pedir una combinación
  // plantilla+idioma inexistente (cliente con preferencia 'eu'/'gl') rompe el envío.
  const { templateLanguage } = require('../whatsapp/templates');

  // MENSAJE 100% DEL DUEÑO (marcador TXT: puesto por el motor): su frase
  // íntegra viaja en la plantilla-portadora nodeflow_aviso.
  if (typeof reminder.message_preview === 'string' && reminder.message_preview.startsWith('TXT:')) {
    const ownText = waParam(reminder.message_preview.slice(4));
    return {
      text: fallbackText('aviso', lang, { firstName, orgName, label: ownText }),
      language: templateLanguage('nodeflow_aviso', lang),
      waTemplateName: 'nodeflow_aviso',
      waComponents: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: orgName },
          { type: 'text', text: ownText },
        ],
      }],
    };
  }

  // POST-SERVICIO ("¿qué tal fue?"): plantilla y tono propios — es cuidado,
  // no venta. Caza al insatisfecho antes de la mala reseña.
  if (reminder.service_key === 'como_fue') {
    const careLabel = waParam(reminder.message_preview) || 'tu última visita';
    // v2 con botones 👍/👎 (responder cuesta un tap → dispara la tasa de
    // respuesta; 👍 pide reseña, 👎 alerta al dueño). GATEADO por env hasta
    // que Meta apruebe la plantilla nodeflow_como_fue_v2.
    const tplName = process.env.WA_COMO_FUE_BUTTONS === '1' ? 'nodeflow_como_fue_v2' : 'nodeflow_como_fue';
    return {
      text: fallbackText('como_fue', lang, { firstName, orgName, label: careLabel }),
      language: templateLanguage(tplName, lang),
      waTemplateName: tplName,
      waComponents: [{
        type: 'body',
        parameters: [
          { type: 'text', text: firstName },
          { type: 'text', text: orgName },
          { type: 'text', text: careLabel },
        ],
      }],
    };
  }

  const text = fallbackText('servicio', lang, { firstName, orgName, label: serviceLabel });

  return {
    text,
    language: templateLanguage('nodeflow_recordatorio_servicio', lang),
    // WA template: must be pre-approved in Meta Business Manager as 'nodeflow_recordatorio_servicio'
    // Body params: {{1}} = nombre, {{2}} = negocio, {{3}} = servicio
    waTemplateName: 'nodeflow_recordatorio_servicio',
    waComponents: [{
      type:       'body',
      parameters: [
        { type: 'text', text: firstName },
        { type: 'text', text: orgName },
        { type: 'text', text: serviceLabel },
      ],
    }],
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Dispatch a reminder via WA → SMS → Email fallback chain.
 * Returns { ok, channel } where channel is the one that actually sent.
 */
async function dispatch(reminder, contact, memory) {
  const phone = contact?.phone;
  const email = contact?.email;
  const { text, waTemplateName, waComponents, language } = buildMessage(reminder, contact, memory);

  // 1. WhatsApp (primary) — skip if contact has opted out
  if (phone && waConfigured() && !memory?.no_whatsapp) {
    // Multi-tenant: si el negocio tiene su PROPIO WhatsApp conectado, el
    // seguimiento sale desde SU número (el cliente reconoce al remitente).
    // Sin credenciales propias → null → número global de NodeFlow (igual que
    // antes). Bug de auditoría: este motor no resolvía credenciales, así que
    // TODOS los seguimientos salían del número global aunque el negocio tuviera
    // el suyo — el cliente no reconocía el remitente y degradaba el número
    // compartido para todas las orgs. reminders.js (el gemelo) ya lo hacía bien.
    let credentials = null;
    if (reminder.org_id) {
      try { credentials = await require('../whatsapp/accounts').getWaCredentials(reminder.org_id); }
      catch (_) { credentials = null; }
    }
    const result = await sendTemplate(phone, waTemplateName, language, waComponents, credentials);
    if (result.ok) {
      // Transcript de WhatsApp: el `text` es la versión legible del aviso.
      try { require('../whatsapp/wa-log').logWaMessage({ orgId: reminder.org_id, contactId: reminder.contact_id, phone, direction: 'out', body: text, kind: reminder.service_key || 'aviso' }); } catch (_) {}
      return { ok: true, channel: 'whatsapp' };
    }
    log.warn(`WA failed for reminder ${reminder.id}: ${result.error} — trying SMS`);
  }

  // 2. SMS (fallback) — skip if contact has opted out
  if (phone && smsConfigured() && !memory?.no_sms) {
    // Remitente = la marca del negocio (alpha sender dinámico), no NodeFlow.
    const { senderIdFromName } = require('../notifications/sms');
    const from = senderIdFromName(contact?._orgName) || undefined;
    const result = await sendSMS(phone, text, { from });
    if (result.ok) return { ok: true, channel: 'sms' };
    log.warn(`SMS failed for reminder ${reminder.id}: ${result.error} — trying email`);
  }

  // 3. Email (last resort) — skip if contact has opted out
  if (email && !memory?.no_email) {
    const publicUrl = process.env.PUBLIC_URL || 'https://nodeflow.es';
    const ok = await sendEmail({
      to:      email,
      subject: `Recordatorio: ${(SERVICE_LABELS[reminder.service_key] || reminder.service_key).replace(/_/g, ' ')}`,
      text,
      html: `<p>${text}</p><hr><p style="font-size:11px;color:#999;">Para no recibir más recordatorios por email: <a href="${publicUrl}/api/portal/unsubscribe?c=${reminder.contact_id}&o=${reminder.org_id}&ch=email">clic aquí</a></p>`,
    });
    if (ok) return { ok: true, channel: 'email' };
  }

  return { ok: false, channel: null };
}

// ── Scaling knobs (env-configurable, defaults safe para miles de clientes) ────
// CLAIM_LIMIT  : recordatorios reclamados por lote (claim atómico).
// CONCURRENCY  : envíos en paralelo dentro de un lote (acotado por rate-limits
//                de WhatsApp/SMS/Email).
// MAX_BATCHES  : lotes máximos por tick — drena el backlog sin esperar 30 min,
//                con tope para no monopolizar el proceso.
const CLAIM_LIMIT = Math.max(1, Number(process.env.LIFECYCLE_CLAIM_LIMIT) || 100);
const CONCURRENCY = Math.max(1, Number(process.env.LIFECYCLE_CONCURRENCY) || 5);
const MAX_BATCHES = Math.max(1, Number(process.env.LIFECYCLE_MAX_BATCHES) || 20);

/** Ejecuta `fn` sobre `items` con un máximo de `limit` en vuelo a la vez. */
async function mapWithConcurrency(items, limit, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Aviso INTERNO al dueño (Fase 2B): recordatorios cuyo service_key acaba en
 * ':biz' no van al cliente sino al WhatsApp del dueño (org.phone). No aplica
 * el do_not_contact del cliente, ni "cita futura", ni el tope de frecuencia —
 * es un aviso de gestión que el negocio pidió recibir. Reutiliza dispatch()
 * poniendo al DUEÑO como destinatario. Nunca lanza.
 */
async function _dispatchBusinessReminder(reminder, db) {
  try {
    const { data: org } = await db.client.from('organizations')
      .select('name, phone').eq('id', reminder.org_id).maybeSingle();
    const ownerPhone = org && org.phone;
    if (!ownerPhone) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'no_owner_phone', updated_at: new Date().toISOString() })
        .eq('id', reminder.id).then(undefined, () => {});
      log.warn(`Aviso al negocio ${reminder.id}: la org ${reminder.org_id} no tiene teléfono del dueño`);
      return;
    }
    // El "contacto" del envío es el DUEÑO. memory {} → sin opt-out (es él mismo).
    const ownerContact = { name: org.name || '', phone: ownerPhone, email: null, _orgName: org.name || '' };
    const result = await dispatch(reminder, ownerContact, {});
    const patch = result.ok
      ? { status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'failed', failed_reason: 'dispatch_business', updated_at: new Date().toISOString() };
    await db.client.from('scheduled_reminders').update(patch).eq('id', reminder.id).then(undefined, () => {});
  } catch (e) {
    log.warn(`_dispatchBusinessReminder(${reminder.id}): ${e.message}`);
  }
}

/** Procesa un único recordatorio (claim ya hecho). Nunca lanza. */
async function processOneReminder(reminder, db) {
  try {
    // Fase 2B — aviso interno al dueño (:biz): rama propia, va a su WhatsApp y
    // se salta las reglas pensadas para el cliente (opt-out, cita futura, tope).
    if (String(reminder.service_key || '').endsWith(':biz')) {
      return await _dispatchBusinessReminder(reminder, db);
    }
    // Re-check do_not_contact (may have changed since scheduling)
    const memory = await getContactMemory(reminder.contact_id, reminder.org_id);
    const ch = reminder.channel;
    const allBlocked = memory?.no_whatsapp && memory?.no_sms && memory?.no_email;
    const channelBlocked = (ch === 'whatsapp' && memory?.no_whatsapp)
                        || (ch === 'sms'      && memory?.no_sms)
                        || (ch === 'email'    && memory?.no_email);

    if (allBlocked || channelBlocked) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'do_not_contact', updated_at: new Date().toISOString() })
        .eq('id', reminder.id);
      return;
    }

    // Fetch contact + org name for message building
    const [{ data: contact }, { data: org }] = await Promise.all([
      db.client.from('contacts').select('name, phone, email').eq('id', reminder.contact_id).maybeSingle(),
      db.client.from('organizations').select('name').eq('id', reminder.org_id).maybeSingle(),
    ]);
    const contactWithOrg = { ...contact, _orgName: org?.name || '' };

    // Skip if a future appointment exists (client already has something booked)
    // Join via phone since nf_appointments has no contact_id
    // EXCEPTO cumpleaños y avisos DIRECTOS del dueño (aviso_*): el cumpleaños
    // es cuidado (no captación) y el aviso manual es voluntad explícita del
    // negocio — ninguno se cancela por cita futura ni se pospone por tope de
    // frecuencia (el dueño lo envió AHORA a propósito).
    const isGreeting = reminder.service_key === 'cumpleanos'
      || String(reminder.service_key || '').startsWith('aviso_');
    let newerApt = null;
    if (!isGreeting && contact?.phone) {
      const { data: newerAptData } = await db.client.from('nf_appointments')
        .select('id')
        .eq('organization_id', reminder.org_id)
        .eq('phone', contact.phone)
        .gte('date', new Date().toISOString().split('T')[0])
        .in('status', ['confirmed', 'pending'])
        .limit(1)
        .maybeSingle();
      newerApt = newerAptData;
    }

    if (newerApt) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'appointment_booked', updated_at: new Date().toISOString() })
        .eq('id', reminder.id);
      return;
    }

    // Tope de frecuencia: si ya recibió un aviso hace poco, POSPONER (no spamear).
    const capDays = isGreeting ? 0 : await getCapDays(reminder.org_id, { db });
    const holdDate = capDays ? await holdUntil(db, reminder, capDays, new Date()) : null;
    if (holdDate) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'pending', scheduled_for: holdDate.toISOString(), failed_reason: 'frequency_cap', updated_at: new Date().toISOString() })
        .eq('id', reminder.id);
      log.info(`Reminder ${reminder.id} pospuesto por tope de frecuencia → ${holdDate.toISOString().slice(0, 10)}`);
      return;
    }

    // Dispatch
    const result = await dispatch(reminder, contactWithOrg, memory);

    if (result.ok) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', reminder.id);
      // Cumpleaños es recurrente: al enviarse queda programado el del año
      // que viene (los contactos sin actividad no pasan por recalculate).
      // SOLO cumpleanos — un aviso_* manual jamás se repite solo.
      if (reminder.service_key === 'cumpleanos') {
        try {
          const next = new Date(reminder.scheduled_for);
          next.setFullYear(next.getFullYear() + 1);
          const { scheduleReminder } = require('./reminder-engine');
          await scheduleReminder({
            orgId: reminder.org_id, contactId: reminder.contact_id,
            serviceKey: reminder.service_key, scheduledFor: next,
            channel: reminder.channel || 'whatsapp', messagePreview: reminder.message_preview,
          });
        } catch (e) { log.warn(`cumpleaños: no se pudo programar el del año que viene: ${e.message}`); }
      }
    } else {
      await db.client.from('scheduled_reminders')
        .update({ status: 'failed', failed_reason: 'all_channels_failed', updated_at: new Date().toISOString() })
        .eq('id', reminder.id);
      await incrementFailedAttempts(reminder.contact_id, reminder.org_id);
      log.error(`Reminder ${reminder.id} failed all channels`);
    }
  } catch (err) {
    await db.client.from('scheduled_reminders')
      .update({ status: 'failed', failed_reason: err.message.slice(0, 200), updated_at: new Date().toISOString() })
      .eq('id', reminder.id)
      .then(undefined, () => {});
    log.error(`Reminder ${reminder.id} threw: ${err.message}`);
  }
}

// ── Main cron logic ───────────────────────────────────────────────────────────

async function processReminders() {
  const db = getDatabase();
  if (!db.enabled) return;

  // Recover stalled 'sending' reminders from a previous crashed run
  await db.client.rpc('recover_stalled_reminders').catch(() => {});

  let totalProcessed = 0;

  // Drena el backlog en varios lotes dentro del mismo tick. Cada lote se
  // reclama atómicamente (seguro entre instancias) y se despacha con
  // concurrencia acotada. Paramos cuando un lote no llega al límite (no queda
  // backlog) o al alcanzar MAX_BATCHES.
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const windowEnd = new Date(Date.now() + 31 * 60 * 1000).toISOString();
    const { data: reminders, error } = await db.client.rpc('claim_pending_reminders', {
      p_window_end: windowEnd,
      p_limit:      CLAIM_LIMIT,
    });

    if (error) { log.error('claim_pending_reminders failed', { err: error.message }); return; }
    if (!reminders?.length) break;

    // Anti-carrera del tope de frecuencia: dos recordatorios del MISMO contacto
    // en el mismo lote pasarían ambos el check (ninguno está 'sent' aún). Solo
    // procesamos el primero; el resto vuelve a 'pending' y el próximo tick los
    // pospone correctamente al ver el primero ya enviado.
    const seenContacts = new Set();
    const toProcess = [], toRequeue = [];
    for (const r of reminders) {
      const key = `${r.org_id}:${r.contact_id}`;
      if (r.contact_id && seenContacts.has(key)) toRequeue.push(r);
      else { seenContacts.add(key); toProcess.push(r); }
    }
    if (toRequeue.length) {
      await db.client.from('scheduled_reminders')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', toRequeue.map(r => r.id))
        .then(undefined, e => log.warn('requeue duplicados falló', { err: e.message }));
      log.info(`${toRequeue.length} recordatorios del mismo contacto reencolados (tope de frecuencia)`);
    }

    log.info(`Processing ${toProcess.length} reminders (batch ${batch + 1}, concurrency ${CONCURRENCY})`);
    await mapWithConcurrency(toProcess, CONCURRENCY, (r) => processOneReminder(r, db));
    totalProcessed += toProcess.length;

    if (reminders.length < CLAIM_LIMIT) break; // No queda backlog
  }

  if (totalProcessed > 0) log.info(`Lifecycle tick done — ${totalProcessed} reminders dispatched`);
}

/**
 * Process seasonal campaigns (runs once per day).
 * Creates individual pending reminders for all contacts in the org.
 */
async function processCampaigns() {
  const db = getDatabase();
  if (!db.enabled) return;

  // Fecha de HOY en MADRID (no en el huso del servidor): las campañas por día del
  // mes (fire_month/fire_day) deben dispararse en el día civil del negocio; con la
  // hora del servidor (UTC) el cron cerca de medianoche las lanzaría el día erróneo.
  const [year, month, day] = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).split('-').map(Number);

  const { data: campaigns } = await db.client
    .from('org_campaigns')
    .select('*')
    .eq('fire_month', month)
    .eq('fire_day',   day)
    .eq('enabled',    true)
    .or(`last_fired_year.is.null,last_fired_year.lt.${year}`);

  if (!campaigns?.length) return;

  const { scheduleReminder } = require('./reminder-engine');

  for (const campaign of campaigns) {
    log.info(`Processing campaign ${campaign.campaign_name} for org ${campaign.org_id}`);

    const { data: contacts } = await db.client
      .from('contacts')
      .select('id')
      .eq('org_id', campaign.org_id)
      .is('deleted_at', null); // nunca a fichas borradas (hallazgo auditoría 2026-07-07)

    if (!contacts?.length) continue;

    // El TEXTO de la campaña sale del catálogo estacional y viaja como
    // mensaje 100% (plantilla-portadora nodeflow_aviso). Sin catálogo,
    // fallback al comportamiento anterior (etiqueta de servicio).
    const { findSeasonal } = require('./seasonal-catalog');
    const seasonal = findSeasonal(campaign.service_key);
    const messagePreview = seasonal ? 'TXT:' + seasonal.text : undefined;

    // Concurrencia acotada: una org con miles de contactos no debe generar
    // una tormenta de inserts secuenciales.
    await mapWithConcurrency(contacts, CONCURRENCY, (contact) =>
      scheduleReminder({
        orgId:        campaign.org_id,
        contactId:    contact.id,
        serviceKey:   campaign.service_key,
        scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 min from now
        channel:      campaign.channel,
        messagePreview,
      }).catch(() => {})
    );

    await db.client.from('org_campaigns')
      .update({ last_fired_year: year })
      .eq('id', campaign.id);
  }
}

// ── Cron startup ─────────────────────────────────────────────────────────────

let _cronInterval    = null;
let _campaignLastRun = null;

// Ventana de cortesía: solo se despachan seguimientos entre las 9:00 y las
// 21:00 (hora de Madrid). Un WhatsApp a las 3 de la madrugada = queja
// instantánea + reporte de spam a Meta que degrada el número. El cron sigue
// corriendo cada 30 min; de noche simplemente NO despacha — los avisos esperan
// al primer tick diurno. La materialización nocturna (crear los recordatorios)
// es aparte y no manda nada. PURA, testeable.
function _isQuietHours(now) {
  try {
    let h = parseInt(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
    }).format(now || new Date()), 10);
    if (!isFinite(h)) return false;
    h = h % 24;
    return h < 9 || h >= 21;
  } catch (_) { return false; }   // ante cualquier problema, no bloquear (fail-open)
}

function startLifecycleCron() {
  if (_cronInterval) return; // Already started — idempotent
  log.info('Lifecycle cron started (30 min interval)');

  _cronInterval = setInterval(async () => {
    // Solo el líder despacha (multi-réplica: evita campañas/recordatorios
    // duplicados — los demás crons ya lo hacen, este y rebooking se olvidaron).
    if (!require('../utils/leader').isLeader()) return;
    // No molestar de madrugada. Se sale ANTES de tocar _campaignLastRun para
    // que una campaña pendiente de noche se dispare en el primer tick de día.
    if (_isQuietHours()) return;

    await processReminders().catch(e => log.error('processReminders error', { err: e.message }));

    // Campaigns run once per day (check >23h since last run)
    const now = Date.now();
    if (!_campaignLastRun || now - _campaignLastRun > 23 * 60 * 60 * 1000) {
      _campaignLastRun = now;
      await processCampaigns().catch(e => log.error('processCampaigns error', { err: e.message }));
    }
  }, 30 * 60 * 1000);

  // Run once immediately after 5 s (allow server to fully initialize)
  // Set _campaignLastRun before startup so campaigns don't re-fire if process restarts mid-day
  _campaignLastRun = Date.now();
  setTimeout(() => {
    if (!require('../utils/leader').isLeader() || _isQuietHours()) return;
    processReminders().catch(() => {});
    processCampaigns().catch(() => {});
  }, 5000);
}

module.exports = { startLifecycleCron, processReminders, processCampaigns, mapWithConcurrency, _isQuietHours };
