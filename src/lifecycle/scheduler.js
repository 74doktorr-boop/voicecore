// ============================================================
// NodeFlow — Lifecycle Scheduler (System D)
// Cron: every 30 min → claim pending reminders → dispatch
// Channel priority: WhatsApp → SMS → Email
// ============================================================

const { getDatabase }           = require('../db/database');
const { getContactMemory, incrementFailedAttempts } = require('./call-memory');
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
};

/**
 * Build a personalized reminder message.
 * Returns { text, waTemplateName, waComponents, language }
 */
function buildMessage(reminder, contact, memory) {
  const name      = contact?.name || 'cliente';
  const firstName = name.split(' ')[0];
  const orgName   = contact?._orgName || 'el negocio';
  const lang      = memory?.preferences?.idioma || 'es';

  const serviceLabel = SERVICE_LABELS[reminder.service_key] || 'tu próxima cita';

  const text = `Hola ${firstName} 👋 Te escribimos desde ${orgName}. Ha llegado el momento de ${serviceLabel}. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.`;

  return {
    text,
    language: lang,
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
    const result = await sendTemplate(phone, waTemplateName, language, waComponents);
    if (result.ok) return { ok: true, channel: 'whatsapp' };
    log.warn(`WA failed for reminder ${reminder.id}: ${result.error} — trying SMS`);
  }

  // 2. SMS (fallback) — skip if contact has opted out
  if (phone && smsConfigured() && !memory?.no_sms) {
    const result = await sendSMS(phone, text);
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

// ── Main cron logic ───────────────────────────────────────────────────────────

async function processReminders() {
  const db = getDatabase();
  if (!db.enabled) return;

  // Recover stalled 'sending' reminders from a previous crashed run
  await db.client.rpc('recover_stalled_reminders').catch(() => {});

  // Claim pending reminders due in the next 30 min atomically
  const windowEnd = new Date(Date.now() + 31 * 60 * 1000).toISOString();
  const { data: reminders, error } = await db.client.rpc('claim_pending_reminders', {
    p_window_end: windowEnd,
    p_limit:      50,
  });

  if (error) { log.error('claim_pending_reminders failed', { err: error.message }); return; }
  if (!reminders?.length) return;

  log.info(`Processing ${reminders.length} reminders`);

  for (const reminder of reminders) {
    try {
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
        continue;
      }

      // Fetch contact + org name for message building
      const [{ data: contact }, { data: org }] = await Promise.all([
        db.client.from('contacts').select('name, phone, email').eq('id', reminder.contact_id).maybeSingle(),
        db.client.from('organizations').select('name').eq('id', reminder.org_id).maybeSingle(),
      ]);
      const contactWithOrg = { ...contact, _orgName: org?.name || '' };

      // Skip if a future appointment exists (client already has something booked)
      // Join via phone since nf_appointments has no contact_id
      let newerApt = null;
      if (contact?.phone) {
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
        continue;
      }

      // Dispatch
      const result = await dispatch(reminder, contactWithOrg, memory);

      if (result.ok) {
        await db.client.from('scheduled_reminders')
          .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', reminder.id);
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
        .catch(() => {});
      log.error(`Reminder ${reminder.id} threw: ${err.message}`);
    }
  }
}

/**
 * Process seasonal campaigns (runs once per day).
 * Creates individual pending reminders for all contacts in the org.
 */
async function processCampaigns() {
  const db = getDatabase();
  if (!db.enabled) return;

  const now   = new Date();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const year  = now.getFullYear();

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
      .eq('org_id', campaign.org_id);

    if (!contacts?.length) continue;

    for (const contact of contacts) {
      await scheduleReminder({
        orgId:        campaign.org_id,
        contactId:    contact.id,
        serviceKey:   campaign.service_key,
        scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 min from now
        channel:      campaign.channel,
      }).catch(() => {});
    }

    await db.client.from('org_campaigns')
      .update({ last_fired_year: year })
      .eq('id', campaign.id);
  }
}

// ── Cron startup ─────────────────────────────────────────────────────────────

let _cronInterval    = null;
let _campaignLastRun = null;

function startLifecycleCron() {
  if (_cronInterval) return; // Already started — idempotent
  log.info('Lifecycle cron started (30 min interval)');

  _cronInterval = setInterval(async () => {
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
    processReminders().catch(() => {});
    processCampaigns().catch(() => {});
  }, 5000);
}

module.exports = { startLifecycleCron, processReminders, processCampaigns };
