// src/api/routes-portal.js
// ─────────────────────────────────────────────────────────────
// NodeFlow — Portal de Negocio API
// All routes require a valid session JWT (Authorization: Bearer)
// businessId resolved from session.email → flowManager or DB
// ─────────────────────────────────────────────────────────────
'use strict';

const { Logger }             = require('../utils/logger');
const { verifySessionToken } = require('./routes-auth');
const { flowManager }        = require('../automations/flow-manager');
const { scheduler }          = require('../scheduling/scheduler');
const { getDatabase }        = require('../db/database');
const { getOrgReminderConfig, scheduleReminder, recalculate } = require('../lifecycle/reminder-engine');
const { SECTOR_REQUIRED_FIELDS, getCompletionStatus } = require('../lifecycle/sector-fields');
const { onboardingSummary } = require('../lifecycle/onboarding-steps');
const { getKnowledgeBase } = require('../knowledge/base');
const { normalizePhone } = require('../utils/phone');

const log = new Logger('ROUTES-PORTAL');

// Marca el onboarding como COMPLETO de forma permanente en
// automation_config.config.onboardingComplete. Read-merge-write sobre la fila
// FRESCA de BD (mismo patrón anti-clobber que /config y /password/clear): lee,
// funde SOLO esta clave y reescribe — NUNCA vía flowManager.patch (que no pasa
// las claves custom de automations). Idempotente: si ya estaba, no reescribe.
async function persistOnboardingComplete(businessId) {
  const db = getDatabase();
  if (!db.enabled) return false;
  const { data: cur, error: readErr } = await db.client
    .from('organizations').select('automation_config').eq('id', businessId).maybeSingle();
  if (readErr) throw new Error('lectura: ' + readErr.message);
  const baseAuto = (cur && cur.automation_config) || {};
  if (baseAuto.config && baseAuto.config.onboardingComplete) return true; // ya persistido
  const merged = { ...baseAuto, config: { ...(baseAuto.config || {}), onboardingComplete: true } };
  const { error: upErr } = await db.client.from('organizations')
    .update({ automation_config: merged }).eq('id', businessId);
  if (upErr) throw new Error('escritura: ' + upErr.message);
  // Espejo en memoria por consistencia (el flow guarda una copia).
  try {
    const flowRef = flowManager.get(businessId);
    if (flowRef) {
      if (!flowRef.automations) flowRef.automations = {};
      if (!flowRef.automations.config) flowRef.automations.config = {};
      flowRef.automations.config.onboardingComplete = true;
    }
  } catch (_) {}
  log.info(`Portal: onboarding marcado como completo para ${businessId}`);
  return true;
}

// Teléfonos que NO son oportunidad de recuperación: ya reservaron (llamada
// 'booked' en la ventana) o tienen una cita próxima. Compartido por el GET de
// oportunidades y el POST de recuperación para NO llamar "te recuperamos" a quien
// ya tiene cita (antes solo se excluía la llamada con outcome='booked', así que
// quien reservaba en una llamada POSTERIOR seguía apareciendo).
async function _excludedRecoveryPhones(db, businessId, sinceISO) {
  const excluded = new Set();
  try {
    const { data } = await db.client.from('nf_calls')
      .select('caller_number').eq('org_id', businessId)
      .gte('started_at', sinceISO).eq('outcome', 'booked').limit(500);
    for (const c of (data || [])) { const n = normalizePhone(c.caller_number); if (n) excluded.add(n); }
  } catch (_) { /* fail-open: sin exclusión extra */ }
  try {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    for (const a of scheduler.getAppointments(businessId)) {
      if (a && a.status !== 'cancelled' && a.date >= todayStr) { const n = normalizePhone(a.phone); if (n) excluded.add(n); }
    }
  } catch (_) {}
  return excluded;
}

// Oportunidades sin responder: llamadas recientes que NO acabaron en cita,
// agrupadas por teléfono y sin quien ya reservó / tiene cita próxima.
// Compartida por el GET de oportunidades y el briefing matinal (misma cifra
// en la tarjeta que en la sección — si divergieran, el dueño perdería la fe).
async function _missedOpportunitiesList(db, businessId, sinceDays) {
  if (!db.enabled) return [];
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data } = await db.client
    .from('nf_calls')
    .select('id, caller_number, outcome, started_at, duration_ms')
    .eq('org_id', businessId)
    .gte('started_at', since)
    .neq('outcome', 'booked')
    .order('started_at', { ascending: false })
    .limit(300);

  // Excluir a quien YA reservó (en una llamada posterior) o tiene cita próxima.
  const excluded = await _excludedRecoveryPhones(db, businessId, since);
  // Agrupar por número: nos quedamos con la llamada más reciente de cada uno
  const byPhone = {};
  for (const c of (data || [])) {
    if (!c.caller_number) continue;
    if (excluded.has(normalizePhone(c.caller_number))) continue;
    // lastCallId → el portal abre la TRANSCRIPCIÓN al clicar el número
    if (!byPhone[c.caller_number]) byPhone[c.caller_number] = { phone: c.caller_number, lastCall: c.started_at, lastCallId: c.id, count: 0, lastOutcome: c.outcome };
    byPhone[c.caller_number].count++;
  }
  return Object.values(byPhone)
    .sort((a, b) => new Date(b.lastCall) - new Date(a.lastCall))
    .slice(0, 100);
}

// Citas de MAÑANA cuyo cliente tiene riesgo ALTO de plantón. Compartida por
// GET /at-risk-tomorrow y el briefing matinal (todo en memoria: barata).
function _atRiskTomorrow(businessId) {
  const { computeNoShowRisk } = require('../lifecycle/no-show-risk');
  const all = scheduler.getAppointments(businessId) || [];
  const tomorrowStr = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const tomorrow = all.filter(a => a.date === tomorrowStr && a.status !== 'cancelled' && a.phone);
  const atRisk = [];
  for (const apt of tomorrow) {
    const p9 = normalizePhone(apt.phone);
    const history = all.filter(h => normalizePhone(h.phone) === p9 && h !== apt);
    const risk = computeNoShowRisk(history);
    if (risk.level === 'high') {
      atRisk.push({ id: apt.id, patientName: apt.patientName, phone: apt.phone, time: apt.time, service: apt.service, noShows: risk.noShows, note: risk.note });
    }
  }
  atRisk.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return { date: tomorrowStr, atRisk };
}

// Clientes inactivos recuperables — la MISMA señal "⚠ Reactivar" de Clientes y
// del briefing (umbral por sector de REBOOKING_DEFAULTS, 60 días por defecto).
// Devuelve { count, euros } con € honesto: solo si el negocio configuró ticket
// medio; sin él, euros=0 y la línea sale sin cifra. Compartida por briefing y
// task-inbox → una sola fuente de verdad.
async function _inactiveClientsSignal(db, businessId, avgTicket) {
  if (!db.enabled) return { count: 0, euros: 0 };
  const { reactivationThresholdDays } = require('../lifecycle/morning-briefing');
  let sector = 'generico';
  try {
    const { data } = await db.client.from('organizations')
      .select('assistant_config').eq('id', businessId).maybeSingle();
    const raw = (data && data.assistant_config && data.assistant_config.sector) || '';
    try { sector = require('../sectors/sector-registry').resolveSector(raw).slug; }
    catch (_) { sector = raw || 'generico'; }
  } catch (_) {}
  const thr = reactivationThresholdDays(sector);
  if (thr === null) return { count: 0, euros: 0 }; // sector con reactivación off
  const cutoff = new Date(Date.now() - thr * 86400000).toISOString();
  const { count } = await db.client.from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', businessId).is('deleted_at', null)
    .not('last_call_at', 'is', null).lt('last_call_at', cutoff)
    .gte('call_count', 1);
  const n = count || 0;
  return { count: n, euros: n * (Math.max(0, Number(avgTicket) || 0)) };
}

// Fichas en borrador (attrs.is_draft) + bonos a punto de agotarse/caducar, para
// el task-inbox. Best-effort y GATED (feature+tablas): sin entidades devuelve
// listas vacías y nada rompe. Un solo SELECT sobre nf_entities por org (no N+1).
async function _entityTaskSignals(db, businessId) {
  const empty = { draftEntities: [], expiringBonos: [] };
  try {
    const { entitiesFeatureEnabled, entityTablesExist, getOrgEntityTypes } = require('../entities/entity-types');
    if (!entitiesFeatureEnabled() || !(await entityTablesExist(db))) return empty;
    const eTypes = await getOrgEntityTypes(businessId, { db });
    if (!eTypes.length) return empty;
    const typeById = new Map(eTypes.map(t => [t.id, t]));
    const { data } = await db.client.from('nf_entities')
      .select('id, entity_type_id, display_name, contact_id, attrs')
      .eq('organization_id', businessId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(500);

    // Nombre del dueño (contact_id → nombre) en UN batch para los bonos.
    const rows = data || [];
    const contactIds = [...new Set(rows.map(r => r.contact_id).filter(Boolean))];
    const nameById = new Map();
    if (contactIds.length) {
      const { data: cs } = await db.client.from('contacts')
        .select('id, name').eq('org_id', businessId).in('id', contactIds.slice(0, 200));
      for (const c of (cs || [])) nameById.set(c.id, c.name);
    }

    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const BONO_SOON_DAYS = 21; // caduca dentro de 3 semanas → avisar
    const BONO_LOW_LEFT  = 2;  // le quedan ≤2 sesiones → avisar
    const draftEntities = [];
    const expiringBonos = [];
    for (const e of rows) {
      const attrs = e.attrs || {};
      const t = typeById.get(e.entity_type_id);
      if (attrs.is_draft) {
        draftEntities.push({ id: e.id, display_name: e.display_name, type_label: t && t.label_singular });
      }
      // Bono: tiene sesiones_restantes o caducidad. Actionable si quedan pocas
      // sesiones O caduca pronto. (No excluye borradores; un bono a medias
      // también merece que lo completen/avisen.)
      const rem = attrs.sesiones_restantes;
      const cad = attrs.caducidad;
      const hasRem = rem !== undefined && rem !== null && rem !== '' && Number.isFinite(Number(rem));
      const lowLeft = hasRem && Number(rem) > 0 && Number(rem) <= BONO_LOW_LEFT;
      let soonExpiry = false, daysToExpiry = null;
      if (typeof cad === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cad)) {
        daysToExpiry = Math.round((new Date(cad.slice(0, 10) + 'T12:00:00') - new Date(todayStr + 'T12:00:00')) / 86400000);
        soonExpiry = daysToExpiry >= 0 && daysToExpiry <= BONO_SOON_DAYS;
      }
      if ((hasRem || cad) && (lowLeft || soonExpiry)) {
        expiringBonos.push({
          id: e.id, display_name: e.display_name,
          remaining: hasRem ? Number(rem) : null,
          daysToExpiry, ownerName: nameById.get(e.contact_id) || null,
        });
      }
    }
    return { draftEntities, expiringBonos };
  } catch (_) { return empty; }
}

// Agrega TODAS las señales del task-inbox en paralelo y tolerante a fallos
// (allSettled): si una fuente cae, sale vacía y el resto se sirve. Reúsa las
// MISMAS listas que la sección Oportunidades, at-risk-tomorrow y el briefing —
// una sola fuente de verdad para la cifra que ve el dueño en todas partes.
async function _aggregateTaskSignals(db, businessId, avgTicket) {
  const r = await Promise.allSettled([
    _missedOpportunitiesList(db, businessId, 14),
    Promise.resolve().then(() => _atRiskTomorrow(businessId)),
    _inactiveClientsSignal(db, businessId, avgTicket),
    _entityTaskSignals(db, businessId),
  ]);
  const val = (i, f) => r[i].status === 'fulfilled' ? r[i].value : f;
  const opps    = val(0, []);
  const risk    = val(1, { date: null, atRisk: [] });
  const inactive = val(2, { count: 0, euros: 0 });
  const ents    = val(3, { draftEntities: [], expiringBonos: [] });

  // Nombre del que llamó (para "Llama a Raúl") en UN batch por teléfono.
  const oppNameByPhone = new Map();
  try {
    const phones = [...new Set((opps || []).map(o => o.phone).filter(Boolean))].slice(0, 200);
    if (db.enabled && phones.length) {
      const { data: cts } = await db.client.from('contacts')
        .select('name, phone').eq('org_id', businessId).in('phone', phones);
      for (const c of (cts || [])) if (c.name) oppNameByPhone.set(c.phone, c.name);
    }
  } catch (_) {}

  return {
    missedOpportunities: (opps || []).map(o => ({ phone: o.phone, name: oppNameByPhone.get(o.phone) || null, lastCallId: o.lastCallId })),
    atRiskTomorrow: { date: risk.date, list: (risk.atRisk || []).map(a => ({ id: a.id, patientName: a.patientName, time: a.time })) },
    inactiveClients: inactive,
    draftEntities: ents.draftEntities,
    expiringBonos: ents.expiringBonos,
  };
}

// ── Auth middleware ──────────────────────────────────────────
async function portalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  let session;
  try {
    session = verifySessionToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
  }

  // Resolve businessId: in-memory first, then DB fallback
  let businessId = null;
  let flowConfig = null;

  const inMemory = flowManager.list().find(f => f.ownerEmail === session.email);
  if (inMemory) {
    businessId = inMemory.businessId;
    flowConfig  = inMemory;
  } else {
    const db = getDatabase();
    if (db.enabled) {
      try {
        const { data } = await db.client
          .from('organizations')
          .select('id, name, owner_email, phone, plan, language, automation_config, assistant_config, registered_at, created_at')
          .eq('owner_email', session.email.toLowerCase())
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) {
          businessId = data.id;
          flowConfig  = {
            businessId:   data.id,
            name:         data.name,
            ownerEmail:   data.owner_email,
            ownerPhone:   data.phone,
            plan:         data.plan,
            sector:       (data.assistant_config && data.assistant_config.sector) || null,
            language:     data.language || 'es',
            automations:  data.automation_config || {},
            registeredAt: data.registered_at || data.created_at,
          };
        }
      } catch (e) {
        log.warn(`DB lookup failed for ${session.email}: ${e.message}`);
      }
    }
  }

  if (!businessId) {
    return res.status(404).json({ error: 'No se encontró ningún negocio para esta cuenta.' });
  }

  req.session    = session;
  req.businessId = businessId;
  req.flowConfig = flowConfig;
  next();
}

// ── setupPortalRoutes ────────────────────────────────────────
function setupPortalRoutes(app, pipeline, config) {
  config = config || {};

  // ── Base de conocimiento (RAG) ─────────────────────────────
  // GET: texto guardado + nº de fragmentos. PUT: reemplaza toda la KB del negocio.
  app.get('/api/portal/knowledge', portalAuth, async (req, res) => {
    try {
      const kb = getKnowledgeBase();
      const store = await kb._load(req.businessId);
      const text  = store.map(c => c.content).join('\n\n');
      res.json({ ok: true, chunks: store.length, text });
    } catch (e) {
      log.error('GET knowledge error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/portal/knowledge', portalAuth, async (req, res) => {
    try {
      const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
      const kb = getKnowledgeBase();
      // Reemplazo total: borra lo anterior y reingesta el texto nuevo.
      await kb.clear(req.businessId);
      let chunksAdded = 0;
      if (text) {
        const r = await kb.ingestText(req.businessId, text, 'portal');
        chunksAdded = r.chunksAdded;
      }
      res.json({ ok: true, chunksAdded });
    } catch (e) {
      log.error('PUT knowledge error', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/portal/referral ───────────────────────────────
  // Devuelve el código de referido del negocio (lo crea si no existe),
  // estadísticas y un mensaje listo para compartir.
  app.get('/api/portal/referral', portalAuth, async (req, res) => {
    try {
      const referrals = require('../referrals/referrals');
      const bizName = req.flowConfig?.name || 'tu negocio';
      const email   = req.session?.email || req.flowConfig?.ownerEmail || null;

      const code  = await referrals.getOrCreateCode(req.businessId, { name: bizName, email });
      if (!code) return res.json({ available: false });

      const stats = await referrals.getStats(req.businessId);
      const link  = `https://nodeflow.es/onboarding?coupon=${encodeURIComponent(code)}`;
      const shareText =
        `He automatizado las llamadas de mi negocio con NodeFlow (recepcionista IA 24/7) y va genial. ` +
        `Si lo pruebas con mi código *${code}* tienes ${referrals.REFEREE_DISCOUNT}% de descuento: ${link}`;

      res.json({
        available: true,
        code,
        link,
        shareText,
        refereeDiscount: referrals.REFEREE_DISCOUNT,
        timesShared:    stats?.times_shared    || 0,
        timesConverted: stats?.times_converted || 0,
        rewardPending:  stats?.reward_pending  || 0,
      });
    } catch (e) {
      log.warn(`/api/portal/referral error: ${e.message}`);
      res.status(500).json({ error: 'No se pudo obtener el código de referido' });
    }
  });

  // ── GET /api/portal/widget ─────────────────────────────────
  // Devuelve el snippet del widget "¿Te llamamos?" listo para pegar
  // y las últimas solicitudes recibidas.
  app.get('/api/portal/widget', portalAuth, async (req, res) => {
    try {
      const orgId = req.businessId;
      const snippet = `<script src="https://nodeflow.es/widget/nf-widget.js" data-org="${orgId}"></script>`;

      let callbacks = [];
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client
          .from('nf_callbacks')
          .select('name, phone, message, status, created_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20);
        callbacks = data || [];
      }
      res.json({ snippet, callbacks });
    } catch (e) {
      log.warn(`/api/portal/widget error: ${e.message}`);
      res.status(500).json({ error: 'No se pudo cargar el widget' });
    }
  });

  // ── GET /api/portal/dashboard ──────────────────────────────
  app.get('/api/portal/dashboard', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;

    // "Hoy" en MADRID, no en UTC: con toISOString el dueño veía las stats de AYER
    // entre las 00:00-02:00 (y las llamadas de esa franja se atribuían al día
    // anterior). Se compara la fecha civil de Madrid de cada llamada.
    const madridDay  = (ts) => ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : '';
    const todayStr   = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const allCalls   = pipeline.getCallHistory(500);
    const bizCalls   = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);
    // BUG-30 FIX: callSession.toJSON() emits 'endTime'/'startTime', not 'endedAt'/'startedAt'.
    // Wrong field names made todayCalls always empty, so dashboard always showed zero calls.
    const todayCalls = bizCalls.filter(c => madridDay(c.endTime || c.startTime) === todayStr);

    const callCount   = todayCalls.length;
    const bookedToday = todayCalls.filter(c => c.outcome === 'booked').length;
    const convRate    = callCount > 0 ? Math.round((bookedToday / callCount) * 100) : 0;
    const emailsSent  = todayCalls.filter(c => c.outcome === 'booked' && c.clientEmail).length;
    // 4 min average per call vs manual handling
    const hoursSaved  = Math.round((callCount * 4) / 60 * 10) / 10;

    // Upcoming appointments (today onwards, not cancelled)
    const appointments = scheduler.getAppointments(businessId);
    const upcoming = appointments
      .filter(a => a.status !== 'cancelled' && a.date >= todayStr)
      .sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`))
      .slice(0, 5);

    // Recent AI activity (last 8 relevant calls)
    const recentActivity = bizCalls.slice(0, 8).map(c => ({
      type: c.outcome === 'booked' ? 'reserva'
           : c.outcome === 'info'  ? 'info'
           :                         'llamada',
      text: c.outcome === 'booked' && c.bookedAppointment
          ? `${c.bookedAppointment.patientName} · ${c.bookedAppointment.service}`
          : c.outcome === 'info'
          ? `Consulta · ${(c.callId || '---').toString().replace(/(\d{3})\d{4,}/, '$1···')}`
          : 'Llamada no completada',
      time: c.endTime || c.startTime || null,
    }));

    const registeredAt = flowConfig.registeredAt || null;
    const daysActive   = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86400000)
      : 0;

    // ── Onboarding status — muestra al cliente qué pasos están completos ──────
    const custom        = flowConfig.automations?.config || {};
    let nodeflowNum     = custom.nodeflowNumber || custom.outboundNumber || null;
    // nf_phone_pool = fuente de verdad: la config en memoria (flowManager)
    // no ve asignaciones recientes del admin → el dashboard decía
    // "Configurando" con el número ya asignado y funcionando.
    if (!nodeflowNum) {
      try {
        const db = getDatabase();
        if (db.enabled) {
          const { data: poolRow } = await db.client
            .from('nf_phone_pool').select('phone_number')
            .eq('org_id', businessId).eq('status', 'assigned')
            .limit(1).maybeSingle();
          if (poolRow) nodeflowNum = poolRow.phone_number;
        }
      } catch (_) { /* fail-open: se queda el estado de la config */ }
    }
    const onboarding    = {
      paid:            true,                    // si llegaron aquí, pagaron
      org_created:     true,                    // si llegaron aquí, la org existe
      number_assigned: !!nodeflowNum,           // auto-asignado post-pago
      // activation_sent = true si number_assigned (el email se envía junto con la asignación)
      activation_sent: !!nodeflowNum,
      nodeflowNumber:  nodeflowNum,
      complete:        !!nodeflowNum,
    };

    // ── "Primeros pasos" SMART — cada paso se marca solo con señales reales ──
    // Señales de config: fusiona la copia en memoria con la fila FRESCA de BD
    // (assistant_config = sector/voz/saludo; automation_config.config = servicios/
    // datos negocio). El asistente cacheado en memoria puede estar stale tras un
    // redeploy, así que la BD gana campo a campo (mismo criterio que /config).
    let obDbAsis = null, obDbAuto = null, obComplete = !!custom.onboardingComplete;
    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data: orgRow } = await db.client.from('organizations')
          .select('assistant_config, automation_config').eq('id', businessId).maybeSingle();
        obDbAsis = orgRow?.assistant_config  || null;
        obDbAuto = orgRow?.automation_config || null;
        if (obDbAuto?.config?.onboardingComplete) obComplete = true;
      }
    } catch (_) { /* fail-open: se calcula con lo que haya en memoria */ }
    const { effectiveConfigSource } = require('./config-merge');
    const cfgSrc      = effectiveConfigSource(custom, obDbAuto && obDbAuto.config);
    const obWelcome   = (obDbAsis && (obDbAsis.firstMessage || obDbAsis.welcomeMessage)) || custom.welcomeMessage || '';
    const obVoice     = (obDbAsis && obDbAsis.voice) || custom.voice || '';
    const obSector    = (obDbAsis && obDbAsis.sector) || flowConfig.sector || cfgSrc.sector || '';
    const inboundCnt  = bizCalls.filter(c => (c.direction || 'inbound') === 'inbound').length;
    const obSummary   = onboardingSummary({
      sector:         obSector,
      serviceList:    Array.isArray(cfgSrc.serviceList) ? cfgSrc.serviceList : [],
      welcomeMessage: obWelcome,
      voice:          obVoice,
      address:        cfgSrc.address,
      schedule:       cfgSrc.schedule,
      alertPhone:     cfgSrc.alertPhone,
      totalCalls:     bizCalls.length,
      inboundCalls:   inboundCnt,
    });
    // Persistir onboardingComplete la PRIMERA vez que todo está hecho, para que
    // el cuadro no reaparezca aunque una señal parpadee (read-merge-write sobre
    // BD FRESCA, anti-clobber — NUNCA vía flow-manager.patch).
    if (obSummary.allDone && !obComplete) {
      obComplete = true;
      persistOnboardingComplete(businessId).catch(() => { /* no crítico */ });
    }
    const onboardingSteps = {
      steps:     obSummary.steps,
      doneCount: obSummary.doneCount,
      total:     obSummary.total,
      complete:  obComplete,          // hecho por señales O ya persistido
    };

    // Valor estimado de las reservas de hoy — misma regla que /reports (reservas × ticket medio)
    const avgTicketConfigured = !!(flowConfig.automations?.config?.avgTicket);
    const avgTicket     = flowConfig.automations?.config?.avgTicket || 35;
    const valueEstToday = bookedToday * avgTicket;
    const allBookings   = bizCalls.filter(c => c.outcome === 'booked').length;

    res.json({
      businessName: flowConfig.name,
      plan:         flowConfig.plan,
      daysActive,
      // El banner de Primeros pasos lee d.nodeflowNumber (raíz) — solo
      // estaba dentro de onboarding y el número asignado jamás se pintaba
      // (caso real 2026-07-03: checklist en rama "asignado" pero sin número).
      nodeflowNumber: nodeflowNum,
      aiStatus:     nodeflowNum ? 'active' : 'pending',
      totalCalls:   bizCalls.length,
      totalBookings: allBookings,
      valueEstToday,
      avgTicketConfigured,
      today:        { callCount, bookedToday, convRate, emailsSent, hoursSaved },
      upcoming,
      recentActivity,
      onboarding,
      onboardingSteps,
    });
  });

  // ── GET /api/portal/briefing ── briefing matinal accionable ──────────────
  // La primera tarjeta del dashboard: saluda, resume AYER y propone lo
  // accionable de HOY con enlace a la sección que lo resuelve. Agrega en
  // paralelo con fallos tolerados (allSettled): si una fuente cae, su línea
  // sale a 0 y el resto del briefing se sirve igual. La redacción de líneas
  // vive en buildBriefing() (pura, src/lifecycle/morning-briefing.js).
  app.get('/api/portal/briefing', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const db = getDatabase();
    const { buildBriefing, hourInMadrid, madridMidnightUtc } = require('../lifecycle/morning-briefing');

    // Ayer en fecha civil de MADRID, no UTC — mismo criterio que /dashboard.
    const todayStr     = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const yesterdayStr = new Date(new Date(todayStr + 'T12:00:00').getTime() - 86400000).toLocaleDateString('sv-SE');

    // € honesto: nº de inactivos × ticket medio SOLO si el negocio lo configuró
    // (sin ticket no inventamos cifra: la línea sale sin €). Siempre con "~".
    const avgTicket = Number(flowConfig.automations?.config?.avgTicket) || 0;

    const results = await Promise.allSettled([
      // 1. Llamadas de AYER + cuántas acabaron en cita (nf_calls)
      (async () => {
        if (!db.enabled) return { calls: 0, booked: 0 };
        const { data } = await db.client.from('nf_calls')
          .select('outcome')
          .eq('org_id', businessId)
          .gte('started_at', madridMidnightUtc(yesterdayStr).toISOString())
          .lt('started_at', madridMidnightUtc(todayStr).toISOString())
          .limit(1000);
        const rows = data || [];
        return { calls: rows.length, booked: rows.filter(c => c.outcome === 'booked').length };
      })(),
      // 2. Señales compartidas con el task-inbox (oportunidades, riesgo mañana,
      //    inactivos) — MISMA fuente de verdad: la cifra del briefing = la del
      //    inbox = la del contador del nav.
      _aggregateTaskSignals(db, businessId, avgTicket),
      // 3. Seguimientos con mensaje ya redactado (Personalizados) — briefing-only
      (async () => {
        const { getCandidates } = require('../lifecycle/followups');
        return (await getCandidates(businessId, { db, bizName: flowConfig.name, lang: flowConfig.language || 'es' })).length;
      })(),
    ]);

    const val = (i, fallback) => results[i].status === 'fulfilled' ? results[i].value : fallback;
    const yesterday = val(0, { calls: 0, booked: 0 });
    const sig       = val(1, { missedOpportunities: [], atRiskTomorrow: { list: [] }, inactiveClients: { count: 0, euros: 0 } });
    const inactiveCount = sig.inactiveClients.count || 0;

    const briefing = buildBriefing({
      greetingName:     flowConfig.name,
      yesterdayCalls:   yesterday.calls,
      yesterdayBooked:  yesterday.booked,
      missedCount:      sig.missedOpportunities.length,
      atRiskCount:      sig.atRiskTomorrow.list.length,
      inactiveCount,
      recoverableEuros: sig.inactiveClients.euros || 0,
      followupsPending: val(2, 0),
    }, hourInMadrid());

    res.json({ ok: true, ...briefing });
  });

  // ── GET /api/portal/knowledge/unanswered ─────────────────────
  // Preguntas que el asistente no supo responder (últimos 30 días),
  // agregadas por frecuencia. DOS fuentes que se refuerzan (cero migraciones):
  //   · transcript-analyzer → call_summaries.extracted_data._unanswered
  //   · auditor            → nf_calls.metrics.audit.info_gap
  app.get('/api/portal/knowledge/unanswered', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.json({ ok: true, questions: [] });
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [sumRes, callRes] = await Promise.all([
        db.client.from('call_summaries')
          .select('extracted_data, created_at')
          .eq('org_id', businessId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(300),
        db.client.from('nf_calls')
          .select('metrics, started_at')
          .eq('org_id', businessId)
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .limit(300),
      ]);
      if (sumRes.error) throw new Error(sumRes.error.message);

      const agg = new Map();
      const addQ = (q, at) => {
        if (typeof q !== 'string' || !q.trim()) return;
        const key = q.trim().toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[¿?¡!.,]/g, '').replace(/\s+/g, ' ').trim();
        if (key.length < 6) return;
        const cur = agg.get(key) || { question: q.trim(), count: 0, lastAt: at };
        cur.count += 1;
        if (at > cur.lastAt) { cur.lastAt = at; cur.question = q.trim(); }
        agg.set(key, cur);
      };
      for (const row of (sumRes.data || [])) {
        const qs = row.extracted_data && Array.isArray(row.extracted_data._unanswered)
          ? row.extracted_data._unanswered : [];
        for (const q of qs) addQ(q, row.created_at);
      }
      // El auditor apunta el dato que faltó (info_gap) aunque el analizador no
      // lo listara como pregunta — segunda red para el mismo hueco.
      for (const row of ((callRes && callRes.data) || [])) {
        const gap = row.metrics && row.metrics.audit && row.metrics.audit.info_gap;
        if (gap) addQ(String(gap), row.started_at);
      }
      const questions = [...agg.values()]
        .sort((a, b) => b.count - a.count || String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
        .slice(0, 10);
      res.json({ ok: true, questions });
    } catch (e) {
      log.warn(`knowledge/unanswered: ${e.message}`);
      res.json({ ok: true, questions: [] });
    }
  });

  // ── POST /api/portal/assistant-command — IA contextual del portal ──
  // Mapea lenguaje natural a UNA acción de una lista blanca. El LLM solo
  // interpreta; la ejecución la hace el cliente contra las APIs normales
  // (y las acciones de escritura se confirman en la UI antes de guardar).
  const AI_SECTIONS = ['dashboard','llamadas','citas','clientes','oportunidades','espera','tareas',
    'seguimientos','informes','insights','referidos','widget','asistente','conocimiento',
    'automatizaciones','integraciones','facturacion','configuracion','ayuda'];

  function sanitizeAiAction(a) {
    if (!a || typeof a !== 'object') return null;
    const s = (v, n) => (typeof v === 'string' ? v.slice(0, n).trim() : undefined);
    switch (a.type) {
      case 'navigate': {
        const section = s(a.section, 40);
        return AI_SECTIONS.includes(section) ? { type: 'navigate', section } : null;
      }
      case 'new_cita': {
        const out = { type: 'new_cita' };
        const date = s(a.date, 10), time = s(a.time, 5);
        if (s(a.patientName, 80)) out.patientName = s(a.patientName, 80);
        if (s(a.service, 80))     out.service = s(a.service, 80);
        if (s(a.phone, 20))       out.phone = s(a.phone, 20);
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
        if (time && /^\d{1,2}:\d{2}$/.test(time))     out.time = time.padStart(5, '0');
        return out;
      }
      case 'new_task': {
        const title = s(a.title, 140);
        return title ? { type: 'new_task', title } : null;
      }
      case 'search_clients': {
        const q = s(a.q, 80);
        return q ? { type: 'search_clients', q } : null;
      }
      case 'filter_calls': {
        const out = { type: 'filter_calls' };
        if (['booked', 'info', 'abandoned'].includes(a.outcome)) out.outcome = a.outcome;
        return out;
      }
      case 'answer': {
        const text = s(a.text, 400);
        return text ? { type: 'answer', text } : null;
      }
      case 'test_call':
        return { type: 'test_call' };
      default: return null;
    }
  }

  app.post('/api/portal/assistant-command', portalAuth, async (req, res) => {
    const { flowConfig } = req;
    const query   = String((req.body && req.body.query) || '').slice(0, 300).trim();
    const context = String((req.body && req.body.context) || 'dashboard').slice(0, 40);
    if (!query) return res.status(400).json({ error: 'query requerida' });

    const router = pipeline.llmRouter;
    if (!router || !router.providers || router.providers.size === 0) {
      return res.json({ ok: false, error: 'ai_unavailable' });
    }

    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const weekday  = now.toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' });

    const system = [
      `Eres el copiloto del portal NodeFlow del negocio "${flowConfig.name}". Hoy es ${weekday}, ${todayStr}.`,
      `El usuario está viendo la sección "${context}".`,
      'Convierte su petición en UNA acción JSON. Responde SOLO el JSON, sin markdown ni explicación.',
      '',
      'Acciones posibles:',
      '{"type":"new_cita","patientName":"...","service":"...","date":"YYYY-MM-DD","time":"HH:MM","phone":"..."} — agendar una cita (omite los campos que no se mencionen; resuelve fechas relativas como "el viernes" a fecha real futura)',
      '{"type":"new_task","title":"..."} — crear una tarea o recordatorio para el dueño ("recuérdame...", "apunta...")',
      '{"type":"search_clients","q":"..."} — buscar un cliente por nombre, teléfono o email',
      '{"type":"filter_calls","outcome":"booked"} — ver llamadas; outcome opcional: booked (con cita), info (consultas), abandoned (no completadas)',
      `{"type":"navigate","section":"..."} — abrir una sección: ${AI_SECTIONS.join('|')}`,
      '{"type":"test_call"} — el usuario quiere probar/escuchar a su asistente ("llámame", "quiero probarlo", "hazme una demo")',
      '{"type":"answer","text":"..."} — solo para preguntas sobre cómo usar el portal; máximo 2 frases, en el idioma del usuario',
      '{"type":"none"} — si no puedes mapear la petición con seguridad',
    ].join('\n');

    try {
      let out = '';
      for await (const chunk of router.streamCompletion({
        callId: 'portal-cmd',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: query },
        ],
        temperature: 0,
        maxTokens: 200,
      })) {
        if (chunk.type === 'text')  out += chunk.content;
        if (chunk.type === 'error') throw new Error(chunk.message || chunk.content || 'LLM error');
      }

      const m = out.match(/\{[\s\S]*\}/);
      const action = m ? sanitizeAiAction(JSON.parse(m[0])) : null;
      if (!action) return res.json({ ok: false, error: 'no_entendido' });

      log.info(`Portal AI (${flowConfig.name}): "${query}" → ${action.type}`);
      res.json({ ok: true, action });
    } catch (e) {
      log.warn(`assistant-command falló: ${e.message}`);
      res.json({ ok: false, error: 'no_entendido' });
    }
  });

  // ── GET /api/portal/calls ──────────────────────────────────
  app.get('/api/portal/calls', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { from, to, outcome } = req.query;

    // Fuente de verdad: nf_calls (persistente — la memoria se borra en cada
    // deploy; caso real 2026-07-03: el portal enseñaba 1 llamada de las ~6
    // hechas). La memoria queda solo como fallback si la BD está caída.
    const db = getDatabase();
    if (db.enabled) {
      try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 500, 500);
        let q = db.client.from('nf_calls')
          .select('id, started_at, ended_at, duration_ms, status, outcome, caller_number, turn_count, booked_appointment, metrics')
          .eq('org_id', businessId)
          .order('started_at', { ascending: false })
          .limit(limit);
        if (from) q = q.gte('started_at', from);
        if (to) q = q.lte('started_at', to + 'T23:59:59');
        if (outcome && ['booked', 'info', 'abandoned'].includes(outcome)) q = q.eq('outcome', outcome);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        // Quién llamó: enlazar cada llamada con su ficha de cliente (1 consulta)
        const phones = [...new Set((data || []).map(c => c.caller_number).filter(Boolean))];
        const contactByPhone = {};
        if (phones.length) {
          const { data: cts } = await db.client.from('contacts')
            .select('id, name, phone').eq('org_id', businessId).in('phone', phones);
          for (const ct of (cts || [])) contactByPhone[ct.phone] = ct;
        }
        const formatted = (data || []).map(c => {
          const apts = Array.isArray(c.booked_appointment) ? c.booked_appointment
            : (c.booked_appointment ? [c.booked_appointment] : []);
          const ct = contactByPhone[c.caller_number] || null;
          return {
            contactId:    ct ? ct.id : null,
            contactName:  ct ? ct.name : null,
            callId:       c.id,
            startedAt:    c.started_at,
            endedAt:      c.ended_at,
            // SEGUNDOS (el frontend formatea segundos — devolver ms pintaba
            // "2122m 54s" para una llamada de 2 minutos, bug real 2026-07-03).
            // Huérfanas sin cierre: 0, jamás el reloj corriendo.
            duration:     c.duration_ms ? Math.round(c.duration_ms / 1000) : 0,
            outcome:      c.status === 'lost' ? 'lost' : (c.outcome || 'abandoned'),
            clientEmail:  null,
            callerNumber: c.caller_number || null,
            appointment:  apts.length ? apts[apts.length - 1] : null,
            appointments: apts,
            turnCount:    c.turn_count || 0,
            quality:      c.metrics?.quality?.score ?? null,
          };
        });
        return res.json({ ok: true, count: formatted.length, calls: formatted });
      } catch (e) {
        log.warn(`portal calls desde nf_calls falló (${e.message}) — fallback memoria`);
      }
    }

    let calls = pipeline.getCallHistory(500)
      .filter(c => (c.businessId || c.assistantId) === businessId);

    if (from) {
      calls = calls.filter(c => (c.endTime || c.startTime || '') >= from);
    }
    if (to) {
      const toEnd = to + 'T23:59:59';
      calls = calls.filter(c => (c.endTime || c.startTime || '') <= toEnd);
    }
    if (outcome && ['booked', 'info', 'abandoned'].includes(outcome)) {
      calls = calls.filter(c => c.outcome === outcome);
    }

    const formatted = calls.map(c => ({
      callId:       c.id,
      startedAt:    c.startTime,
      endedAt:      c.endTime,
      duration:     c.duration ? Math.round(c.duration / 1000) : 0, // segundos
      outcome:      c.outcome || 'abandoned',
      clientEmail:  c.clientEmail || null,
      callerNumber: c.callerNumber || null,
      appointment:  c.bookedAppointment || null,
      turnCount:    c.turnCount || 0,
    }));

    res.json({ ok: true, count: formatted.length, calls: formatted });
  });

  // ── GET /api/portal/appointments ──────────────────────────
  app.get('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const appointments = scheduler.getAppointments(businessId)
      .sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
    res.json({ ok: true, count: appointments.length, appointments });
  });

  // ── GET /api/portal/at-risk-tomorrow ──────────────────────
  // Citas de MAÑANA cuyo cliente tiene riesgo ALTO de plantón, para que el
  // dueño las confirme personalmente. Hace accionable la predicción (op.5).
  app.get('/api/portal/at-risk-tomorrow', portalAuth, (req, res) => {
    try {
      const { date, atRisk } = _atRiskTomorrow(req.businessId);
      res.json({ ok: true, date, atRisk });
    } catch (e) { log.warn(`at-risk-tomorrow: ${e.message}`); res.json({ ok: true, atRisk: [] }); }
  });

  // ── POST /api/portal/appointments ─────────────────────────
  app.post('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const { patientName, phone, email, service, date, time, notes } = req.body;
    if (!patientName || !service || !date || !time) {
      return res.status(400).json({ error: 'patientName, service, date y time son obligatorios' });
    }
    const result = scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time, notes });
    if (!result.success) return res.status(409).json({ error: result.error });
    log.info(`Portal: appointment created ${result.appointment.id} for ${patientName}`);
    // (C) Empuja la cita al Google Calendar del negocio si está conectado. No
    // bloqueante y con los mismos criterios que la reserva por voz — antes solo
    // se sincronizaban las citas que agendaba el asistente, no las manuales.
    try {
      require('../tools/executor').syncAppointmentToCalendar(businessId, result.appointment).catch(() => {});
    } catch (_) {}
    // Crear/enlazar el CONTACTO para que el cliente aparezca en Clientes con su
    // ficha editable. Antes una cita manual no creaba contacto → el cliente
    // quedaba sin ficha (no se podía gestionar). Insert directo, SIN tocar
    // call_count/last_call_at (no fue una llamada). Best-effort, no bloquea.
    // Con teléfono → dedup por teléfono. Sin teléfono → ficha igualmente,
    // deduplicando por nombre entre las fichas sin teléfono (requiere la
    // migración que hace contacts.phone NULLABLE).
    const _db = getDatabase();
    if (_db.enabled && (phone || patientName)) {
      (async () => {
        try {
          const nowIso = new Date().toISOString();
          let q = _db.client.from('contacts').select('id, name')
            .eq('org_id', businessId).is('deleted_at', null);
          q = phone ? q.eq('phone', phone) : q.eq('name', patientName).is('phone', null);
          const { data: rows } = await q.limit(1);
          const existing = (rows && rows[0]) || null;
          if (!existing) {
            await _db.client.from('contacts').insert({
              org_id: businessId, phone: phone || null, name: patientName || null,
              email: email || null, created_at: nowIso, updated_at: nowIso,
            });
          } else if (!existing.name && patientName) {
            // Ficha sin nombre y ahora tenemos uno → lo completamos (no pisamos).
            await _db.client.from('contacts').update({ name: patientName, updated_at: nowIso })
              .eq('id', existing.id);
          }
        } catch (e) { log.warn(`contacto desde cita manual: ${e.message}`); }
      })();
    }
    res.json({ ok: true, appointment: result.appointment });
  });

  // ── GET /api/portal/appointments/:id ─────────────────────
  app.get('/api/portal/appointments/:id', portalAuth, (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    res.json({ appointment: apt });
  });

  // ── PATCH /api/portal/appointments/:id ────────────────────
  app.patch('/api/portal/appointments/:id', portalAuth, (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    if (apt.status === 'cancelled') return res.status(409).json({ error: 'La cita ya está cancelada' });

    // Validación de tipos y formatos (auditoría 2026-07-07): antes un objeto
    // en 'date' o una hora basura se guardaban tal cual y rompían aguas abajo.
    const allowed = ['patientName', 'phone', 'email', 'service', 'date', 'time', 'notes'];
    const MAXLEN = { patientName: 120, phone: 24, email: 160, service: 120, date: 10, time: 5, notes: 500 };
    for (const field of allowed) {
      if (req.body[field] === undefined) continue;
      let v = req.body[field];
      if (typeof v !== 'string' && typeof v !== 'number') {
        return res.status(400).json({ error: `Campo ${field} no válido` });
      }
      v = field === 'notes' ? String(v).trim() : String(v).replace(/\s+/g, ' ').trim();
      if (field === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ error: 'Fecha no válida (AAAA-MM-DD)' });
      if (field === 'time' && !/^\d{1,2}:\d{2}$/.test(v)) return res.status(400).json({ error: 'Hora no válida (HH:MM)' });
      apt[field] = v.slice(0, MAXLEN[field] || 200);
    }
    apt.updatedAt = new Date().toISOString();
    log.info(`Portal: appointment updated ${apt.id}`);

    // Persistir en Supabase
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.upsert(apt);
    } catch (_) {}

    res.json({ ok: true, appointment: apt });
  });

  // ── DELETE /api/portal/appointments/:id ───────────────────
  // Soft-cancel: sets status='cancelled', keeps the record
  app.delete('/api/portal/appointments/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    if (apt.status === 'cancelled') return res.status(409).json({ error: 'La cita ya estaba cancelada' });

    apt.status      = 'cancelled';
    apt.cancelledAt = new Date().toISOString();

    // Send cancellation email if client email is present (fire-and-forget)
    if (apt.email) {
      try {
        const { sendMagicLinkEmail } = require('../notifications/email');
        // sendMagicLinkEmail is the generic transporter; use it for the cancellation
        // (If a dedicated sendCancellationEmail is added later, swap it here)
        const { flowConfig } = req;
        const { sendEmail } = require('../notifications/email');
        if (typeof sendEmail === 'function') {
          sendEmail({
            to:      apt.email,
            subject: `Cita cancelada — ${flowConfig.name}`,
            html: `<p style="font-family:Inter,sans-serif">Hola ${apt.patientName},</p>
<p>Tu cita del <strong>${apt.date}</strong> a las <strong>${apt.time}h</strong> en ${flowConfig.name} ha sido cancelada.</p>
<p>Contacta con nosotros si quieres reagendar.</p>`,
          }).catch(() => {});
        }
      } catch (_) {
        // email module may not export sendEmail — silently skip
      }
    }

    log.info(`Portal: appointment cancelled ${apt.id}`);

    // Persistir cancelación en Supabase
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.patch(apt.id, {
        status:      'cancelled',
        cancelledAt: apt.cancelledAt,
        cancelledBy: 'portal',
        updatedAt:   new Date().toISOString(),
      });
    } catch (_) {}

    // Hueco liberado desde el portal → oferta automática a la lista de espera
    // (mismo motor que la cancelación por WhatsApp; gateado por env + plantilla).
    try {
      const { offerFreedSlot } = require('../lifecycle/waitlist-offer');
      const { getWaCredentials } = require('../whatsapp/accounts');
      const { sendText } = require('../notifications/client-whatsapp');
      const { sendWhatsApp } = require('../notifications/whatsapp');
      const creds = await getWaCredentials(businessId).catch(() => null);
      const auto = req.flowConfig?.automations?.config || {};
      const ownerPhone = auto.alertPhone || req.flowConfig?.ownerPhone || process.env.OWNER_PHONE;
      const [y, m, d] = String(apt.date).split('-').map(Number);
      const humanDate = (y && m && d) ? new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : apt.date;
      offerFreedSlot({
        businessId, date: apt.date, time: apt.time, service: apt.service,
        humanDate, bizName: req.flowConfig?.name || 'el negocio',
      }, {
        credentials: creds,
        notifyOwner: async (msg) => {
          if (ownerPhone) { try { const r = await sendText(ownerPhone, msg, creds); if (r?.ok) return; } catch (_) {} }
          await sendWhatsApp(msg).catch(() => {});
        },
      }).catch(() => {});
    } catch (_) {}

    res.json({ ok: true });
  });

  // ── POST /api/portal/appointments/:id/no-show ──────────────
  // Marca (o desmarca) una cita como plantón. Alimenta el riesgo de
  // no-show del cliente (regla determinista). Solo citas pasadas.
  app.post('/api/portal/appointments/:id/no-show', portalAuth, async (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    const mark = req.body?.noShow !== false; // por defecto marca; {noShow:false} desmarca
    // Solo tiene sentido en citas ya pasadas (o de hoy); una futura no puede faltar.
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    if (mark && apt.date > todayStr) return res.status(409).json({ error: 'La cita aún no ha pasado' });

    const newStatus = mark ? 'no_show' : 'completed';
    apt.status = newStatus;
    apt.updatedAt = new Date().toISOString();
    try {
      const { appointmentsStore } = require('../db/appointments-store');
      appointmentsStore.patch(apt.id, { status: newStatus, no_show_notified: mark, updatedAt: apt.updatedAt });
    } catch (_) {}
    log.info(`Portal: cita ${apt.id} marcada ${newStatus}`);
    res.json({ ok: true, status: newStatus });
  });

  // ── GET /api/portal/reports ───────────────────────────────
  // Panel analítico "cerebro del negocio". UNA llamada eficiente:
  // llamadas del periodo + del periodo anterior (para deltas) + citas +
  // atribución del motor, en paralelo y tolerante a fallos parciales.
  // La agregación/insights viven en src/reports/analytics.js (puras).
  app.get('/api/portal/reports', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const analytics = require('../reports/analytics');
    const { getAttribution } = require('../lifecycle/followup-attribution');

    const range   = analytics.RANGE_DAYS[req.query.period] ? req.query.period
                  : analytics.RANGE_DAYS[req.query.range] ? req.query.range : 'month';
    const days    = analytics.rangeDays(range);
    const now     = Date.now();
    const curFrom = new Date(now - days * 864e5).toISOString();
    // Periodo anterior: la misma ventana justo antes.
    const prevFrom = new Date(now - 2 * days * 864e5).toISOString();
    const prevTo   = curFrom;
    const avgTicket = flowConfig.automations?.config?.avgTicket || 35;
    const db = getDatabase();

    // Mapea filas de nf_calls al shape que esperan las funciones puras.
    const mapCall = c => ({
      outcome: c.outcome, status: c.status,
      startTime: c.started_at, endTime: c.ended_at,
    });

    let curCalls = null, prevCalls = null, appts = [], allCalls = null, attribution = null;

    if (db.enabled) {
      const results = await Promise.allSettled([
        // Llamadas del periodo actual
        db.client.from('nf_calls')
          .select('outcome, status, started_at, ended_at')
          .eq('org_id', businessId).gte('started_at', curFrom)
          .order('started_at', { ascending: false }).limit(4000),
        // Llamadas del periodo anterior (solo para deltas)
        db.client.from('nf_calls')
          .select('outcome, status, started_at')
          .eq('org_id', businessId).gte('started_at', prevFrom).lt('started_at', prevTo)
          .limit(4000),
        // Citas del periodo (embudo + servicios)
        db.client.from('nf_appointments')
          .select('service, price, status, date, created_at')
          .eq('organization_id', businessId).gte('created_at', curFrom).limit(4000),
        // Totales "desde que activaste" (ligero: solo outcome)
        db.client.from('nf_calls')
          .select('outcome').eq('org_id', businessId).limit(20000),
        // Atribución del motor (ROI por fuente) — su propio módulo tolerante
        getAttribution(businessId, { db, sinceDays: days, avgTicket }),
      ]);

      const [rCur, rPrev, rApt, rAll, rAttr] = results;
      if (rCur.status === 'fulfilled' && !rCur.value.error) curCalls = (rCur.value.data || []).map(mapCall);
      if (rPrev.status === 'fulfilled' && !rPrev.value.error) prevCalls = (rPrev.value.data || []).map(mapCall);
      if (rApt.status === 'fulfilled' && !rApt.value.error) appts = rApt.value.data || [];
      if (rAll.status === 'fulfilled' && !rAll.value.error) allCalls = rAll.value.data || [];
      if (rAttr.status === 'fulfilled') attribution = rAttr.value;
      if (rCur.status === 'rejected') log.warn(`reports: nf_calls periodo falló — ${rCur.reason?.message || rCur.reason}`);
    }

    // Fallback a memoria solo si la BD está caída (histórico se pierde en deploy,
    // pero al menos el panel no muere).
    if (curCalls === null) {
      const mem = pipeline.getCallHistory(2000)
        .filter(c => (c.businessId || c.assistantId) === businessId);
      const fromStr = curFrom;
      curCalls = mem.filter(c => (c.startTime || c.endTime || '') >= fromStr);
      allCalls = allCalls || mem.map(c => ({ outcome: c.outcome }));
    }
    if (prevCalls === null) prevCalls = [];

    // Totales all-time
    const allTotal    = (allCalls || []).length;
    const allBookings = (allCalls || []).filter(c => c.outcome === 'booked').length;
    const allTime = {
      totalCalls: allTotal,
      bookings: allBookings,
      hoursSaved: Math.round((allTotal * 4) / 60 * 10) / 10,
      revenueEst: allBookings * avgTicket,
    };

    const report = analytics.buildReport({
      range, now, avgTicket,
      calls: curCalls, prevCalls, appointments: appts,
      attribution, allTime,
    });

    res.json(report);
  });

  // ── GET /api/portal/automations ───────────────────────────
  app.get('/api/portal/automations', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const automations = { ...(flowConfig.automations || {}) };
    // 📞 LA ENTIDAD LLAMA — opt-in fuera del whitelist del flow-manager:
    // vive en automation_config.config.entityCalls y se lee FRESCO de BD
    // (la copia en memoria pierde .config al reiniciar).
    let entityCallsOn   = flowConfig.automations?.config?.entityCalls === true;
    // 📤 LA FICHA COMUNICA — auto-envío del resumen al crear ficha (defecto OFF)
    let summaryOnCreate = flowConfig.automations?.config?.entitySummaryOnCreate === true;
    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client.from('organizations')
          .select('automation_config').eq('id', businessId).maybeSingle();
        if (data) {
          entityCallsOn   = data.automation_config?.config?.entityCalls === true;
          summaryOnCreate = data.automation_config?.config?.entitySummaryOnCreate === true;
        }
      }
    } catch (_) { /* fail-open: se enseña la copia en memoria */ }
    res.json({ ok: true, automations: { ...automations, entityCalls: { enabled: entityCallsOn }, entitySummaryOnCreate: { enabled: summaryOnCreate } } });
  });

  // ── PATCH /api/portal/automations ────────────────────────
  app.patch('/api/portal/automations', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { reminders, reviews, waConfirm, rebooking, noshow, entityCalls, entitySummaryOnCreate } = req.body;

    // 📞 LA ENTIDAD LLAMA / 📤 LA FICHA COMUNICA — opt-ins FUERA del whitelist
    // del flow-manager (patch() los tiraría). Read-merge-write AUTORITATIVO
    // sobre automation_config.config de BD, como PATCH /api/portal/config: la
    // fuente de verdad que leen el enqueuer / el POST de entidades es ese
    // config. Se pueden mandar juntos o por separado.
    const cfgFlags = {};
    if (entityCalls           !== undefined) cfgFlags.entityCalls           = entityCalls === true || !!(entityCalls && entityCalls.enabled);
    if (entitySummaryOnCreate !== undefined) cfgFlags.entitySummaryOnCreate = entitySummaryOnCreate === true || !!(entitySummaryOnCreate && entitySummaryOnCreate.enabled);

    if (Object.keys(cfgFlags).length) {
      const db = getDatabase();
      if (db.enabled) {
        try {
          const { data: cur, error: readErr } = await db.client
            .from('organizations').select('automation_config').eq('id', businessId).maybeSingle();
          if (readErr) throw new Error('lectura: ' + readErr.message);
          const baseAuto   = (cur && cur.automation_config) || {};
          const mergedAuto = { ...baseAuto, config: { ...(baseAuto.config || {}), ...cfgFlags } };
          const { error: upErr } = await db.client.from('organizations')
            .update({ automation_config: mergedAuto }).eq('id', businessId);
          if (upErr) throw new Error('escritura: ' + upErr.message);
        } catch (e) {
          log.error(`Portal: entity flags save FAILED for ${businessId}: ${e.message}`);
          return res.status(500).json({ error: 'No se pudo guardar en la base de datos: ' + e.message });
        }
      }
      // Espejo en memoria (mutación directa del ref, como PATCH /config)
      const flowRef = flowManager.get(businessId);
      if (flowRef) {
        if (!flowRef.automations) flowRef.automations = {};
        flowRef.automations.config = { ...(flowRef.automations.config || {}), ...cfgFlags };
      }
      // Solo flags de entidad en el body → no pasar por flowManager.patch+saveToDB
      // (saveToDB volcaría la copia en memoria encima del config recién escrito).
      if (reminders === undefined && reviews === undefined && waConfirm === undefined
          && rebooking === undefined && noshow === undefined) {
        log.info(`Portal: entity flags ${JSON.stringify(cfgFlags)} for ${businessId}`);
        const cfg = (flowRef && flowRef.automations && flowRef.automations.config) || {};
        return res.json({ ok: true, automations: {
          ...((flowRef && flowRef.automations) || {}),
          entityCalls:           { enabled: cfg.entityCalls === true },
          entitySummaryOnCreate: { enabled: cfg.entitySummaryOnCreate === true },
        } });
      }
    }

    const patch = {};
    if (reminders !== undefined) patch.reminders = reminders;
    if (reviews   !== undefined) patch.reviews   = reviews;
    if (waConfirm !== undefined) patch.waConfirm = waConfirm;
    if (rebooking !== undefined) patch.rebooking = rebooking;
    if (noshow    !== undefined) patch.noshow    = noshow;

    const updated = flowManager.patch(businessId, { automations: patch });
    if (!updated) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });

    flowManager.saveToDB(businessId).catch(e =>
      log.warn(`Portal: automations DB save failed for ${businessId}: ${e.message}`)
    );

    log.info(`Portal: automations updated for ${businessId}`);
    res.json({ ok: true, automations: updated.automations });
  });

  // ── GET /api/portal/config ────────────────────────────────
  app.get('/api/portal/config', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const custom = flowConfig.automations?.config || {};
    let outboundNumber = custom.outboundNumber || custom.nodeflowNumber || '';
    // Fila FRESCA de BD: assistant_config es el almacén canónico del saludo
    // y el idioma (los edita Asistente) — sin leerlo, Configuración enseñaba
    // una copia muerta y los dos formularios divergían (bug real 2026-07-08).
    let dbAuto = null, dbAsis = null;
    try {
      const db = getDatabase();
      if (db.enabled) {
        const { data: orgRow } = await db.client.from('organizations')
          .select('automation_config, assistant_config').eq('id', businessId).maybeSingle();
        dbAuto = orgRow?.automation_config || null;
        dbAsis = orgRow?.assistant_config  || null;
        // Número asignado: nf_phone_pool/BD = fuente de verdad (la config en
        // memoria no ve asignaciones recientes — caso real 2026-07-03).
        if (!outboundNumber) {
          const dbCustom = dbAuto?.config || {};
          outboundNumber = dbCustom.outboundNumber || dbCustom.nodeflowNumber || '';
          if (!outboundNumber) {
            const { data: poolRow } = await db.client
              .from('nf_phone_pool').select('phone_number')
              .eq('org_id', businessId).eq('status', 'assigned')
              .limit(1).maybeSingle();
            if (poolRow) outboundNumber = poolRow.phone_number;
          }
        }
      }
    } catch (_) { /* fail-open */ }
    const { effectiveFirstMessage } = require('../assistants/org-assistant');
    // FUENTE DE VERDAD = BD fresca por encima de la copia en memoria. Tras
    // redeploys + escrituras de automation_config, la config en memoria (custom)
    // puede haber PERDIDO serviceList/avgTicket/… mientras la BD los conserva
    // (bug real 2026-07-08: al dueño le "desaparecieron" los servicios, que en
    // realidad seguían salvos en BD). Merge: BD gana campo a campo.
    const { effectiveConfigSource } = require('./config-merge');
    const src = effectiveConfigSource(custom, dbAuto && dbAuto.config);
    // ¿Ya hay contraseña de acceso? La verdad vive en automation_config.auth.hash
    // de la fila FRESCA de BD (NO en .config). Sin este dato, Configuración
    // enseñaba el campo "crear contraseña" en blanco aunque la org tuviera hash
    // desde hacía días (bug real 2026-07-08).
    const hasPassword = !!(dbAuto && dbAuto.auth && dbAuto.auth.hash);
    res.json({
      ok: true,
      hasPassword,
      config: {
        name:           flowConfig.name        || '',
        ownerEmail:     flowConfig.ownerEmail  || '',
        phone:          flowConfig.ownerPhone  || '',
        language:       (dbAsis && dbAsis.language) || flowConfig.language || 'es',
        sector:         (dbAsis && dbAsis.sector) || flowConfig.sector || src.sector || '',
        plan:           flowConfig.plan        || '',
        avgTicket:      src.avgTicket          || 35,
        // Saludo: el MISMO que Asistente → Básico (assistant_config.firstMessage),
        // honrando el welcomeMessage legado aún no convergido. Sin BD (dev), cae
        // a la copia en memoria.
        welcomeMessage: (dbAsis || dbAuto)
          ? effectiveFirstMessage(dbAsis, dbAuto)
          : (custom.welcomeMessage || ''),
        services:       src.services           || '',
        schedule:       src.schedule           || '',
        reviewUrl:      src.reviewUrl          || '',
        outboundNumber: outboundNumber,                 // assigned by admin — read-only for portal users
        alertPhone:     src.alertPhone         || '',   // teléfono personal dueño para alertas WA
        notifyEmail:    src.notifyEmail        || flowConfig.ownerEmail || '',
        address:        src.address            || '',
        serviceList:    Array.isArray(src.serviceList) ? src.serviceList : [],
      },
    });
  });

  // ── POST /api/portal/password/clear ── quitar la contraseña de acceso ──────
  // Read-merge-write sobre la fila FRESCA de BD: borra SOLO automation_config.auth
  // y conserva el resto (mismo patrón anti-clobber que el PATCH de config). Tras
  // esto la org vuelve a entrar únicamente por enlace mágico.
  app.post('/api/portal/password/clear', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
    try {
      const { data: cur, error: readErr } = await db.client
        .from('organizations').select('automation_config').eq('id', businessId).maybeSingle();
      if (readErr) throw new Error('lectura: ' + readErr.message);
      const merged = { ...((cur && cur.automation_config) || {}) };
      delete merged.auth;
      const { error: upErr } = await db.client.from('organizations')
        .update({ automation_config: merged }).eq('id', businessId);
      if (upErr) throw new Error('escritura: ' + upErr.message);
      // Espejo en memoria por consistencia (el flow guarda una copia).
      try {
        const flowRef = flowManager.get(businessId);
        if (flowRef && flowRef.automations && flowRef.automations.auth) delete flowRef.automations.auth;
      } catch (_) {}
      log.info(`Portal: contraseña eliminada para ${businessId}`);
      res.json({ ok: true });
    } catch (e) {
      log.error(`Portal: clear password FAILED for ${businessId}: ${e.message}`);
      res.status(500).json({ error: 'No se pudo quitar la contraseña: ' + e.message });
    }
  });

  // ── Add-ons de suscripción (voz Premium +10€, Crecimiento +39€) ──
  app.get('/api/portal/addons', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    try {
      let org = null;
      if (db.enabled) {
        const { data } = await db.client
          .from('organizations').select('automation_config').eq('id', businessId).single();
        org = data;
      }
      const { listAddons } = require('../billing/addons');
      res.json({ ok: true, addons: listAddons(org) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/portal/addons/:key/activate', portalAuth, async (req, res) => {
    const { activateAddon } = require('../billing/addons');
    const out = await activateAddon(req.businessId, req.params.key);
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.post('/api/portal/addons/:key/cancel', portalAuth, async (req, res) => {
    const { cancelAddon } = require('../billing/addons');
    const out = await cancelAddon(req.businessId, req.params.key);
    res.status(out.ok ? 200 : 400).json(out);
  });

  // ── POST /api/portal/voice-pack/:kind/checkout ────────────
  // Compra puntual de un pack de minutos de voz (premium/ultra). Devuelve la
  // URL de Stripe Checkout; al pagar, el webhook suma los minutos al cupo.
  app.post('/api/portal/voice-pack/:kind/checkout', portalAuth, async (req, res) => {
    try {
      const { PACKS } = require('../billing/voice-packs');
      const pack = PACKS[req.params.kind];
      if (!pack) return res.status(400).json({ error: 'Pack desconocido' });
      const priceId = process.env[pack.envPriceVar];
      if (!priceId) return res.status(400).json({ error: 'Ese pack aún no está disponible online — escríbenos y te lo activamos.' });
      const billing = require('../billing/stripe').getBilling();
      if (!billing.enabled) return res.status(400).json({ error: 'Facturación no disponible ahora mismo.' });
      const baseUrl = process.env.PUBLIC_URL || 'https://nodeflow.es';
      const session = await billing.stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/portal?pack=ok`,
        cancel_url:  `${baseUrl}/portal?pack=cancel`,
        metadata: { orgId: req.businessId, voicePackMinutes: String(pack.minutes), voicePackKind: pack.key },
      });
      res.json({ url: session.url });
    } catch (e) {
      log.error(`voice-pack checkout: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/portal/voice-quota ───────────────────────────
  // "Te quedan X min de voz premium este mes". Deriva del MISMO estado que la
  // degradación real (org-assistant): la cifra que ve el cliente coincide con
  // lo que suena. Fail-open: si no hay BD, no bloquea el dashboard.
  app.get('/api/portal/voice-quota', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.json({ ok: false });
      const { data: org } = await db.client
        .from('organizations')
        .select('monthly_minutes_used, automation_config, assistant_config')
        .eq('id', req.businessId).maybeSingle();
      if (!org) return res.json({ ok: false });

      const { hasAddon } = require('../billing/addons');
      const { resolveVoiceEntry } = require('../tts/voice-catalog');
      const { voiceQuotaSummary } = require('../tts/voice-quota');

      const entry = resolveVoiceEntry(org.assistant_config?.voice);
      const summary = voiceQuotaSummary({
        voiceTier:     entry?.tier || 'estandar',
        minutesUsed:   Number(org.monthly_minutes_used) || 0,
        hasVoiceAddon: hasAddon(org, 'voice_premium'),
        extraMinutes:  Number(org.automation_config?.config?.premiumExtraMinutes) || 0,
      });
      res.json({ ok: true, ...summary });
    } catch (e) {
      log.warn(`/api/portal/voice-quota error: ${e.message}`);
      res.json({ ok: false });
    }
  });

  // ── WhatsApp número propio (Fase 2, Meta directo) ──────────
  // GET status: número compartido activo + número propio conectado (si hay).
  app.get('/api/portal/whatsapp/status', portalAuth, async (req, res) => {
    const { isConfigured: waSharedConfigured } = require('../notifications/client-whatsapp');
    try {
      const { getWaCredentials } = require('../whatsapp/accounts');
      const creds = await getWaCredentials(req.businessId);
      const { hasAddon } = require('../billing/addons');
      let org = null;
      const db = getDatabase();
      if (db.enabled) {
        const { data } = await db.client.from('organizations')
          .select('automation_config').eq('id', req.businessId).maybeSingle();
        org = data;
      }
      res.json({
        connected:    !!creds,
        sharedActive: waSharedConfigured(),
        hasAddon:     hasAddon(org, 'wa_own_number'),
        phoneNumber:  creds?.phoneNumber || null,
        wabaId:       creds?.wabaId || null,   // sin exponer token ni phoneNumberId
      });
    } catch (e) {
      log.warn(`wa status: ${e.message}`);
      res.status(500).json({ error: 'Error al obtener estado' });
    }
  });

  // GET es-config: datos públicos para lanzar el Embedded Signup desde el portal.
  // appId es público por diseño de Meta; configId sale de "Facebook Login for
  // Business → Configuraciones". Sin WA_ES_CONFIG_ID el portal cae al flujo manual.
  app.get('/api/portal/whatsapp/es-config', portalAuth, (req, res) => {
    const appId = process.env.WA_APP_ID || '1004065339078581';
    const configId = process.env.WA_ES_CONFIG_ID || null;
    res.json({ appId, configId, available: !!(configId && process.env.WA_APP_SECRET) });
  });

  // POST connect-meta: self-service Embedded Signup. Requiere el add-on de pago.
  // Body: { code, phoneNumberId, wabaId, phoneNumber, displayName? } del popup de Meta.
  app.post('/api/portal/whatsapp/connect-meta', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      let org = null;
      if (db.enabled) {
        const { data } = await db.client.from('organizations')
          .select('automation_config').eq('id', req.businessId).maybeSingle();
        org = data;
      }
      const { hasAddon } = require('../billing/addons');
      if (!hasAddon(org, 'wa_own_number')) {
        return res.status(402).json({ error: 'Conectar tu propio número requiere el complemento "WhatsApp con tu número" (+15€/mes). Actívalo en Facturación.', addonRequired: 'wa_own_number' });
      }
      const { connectMetaNumber } = require('../whatsapp/meta-connect');
      const out = await connectMetaNumber(req.businessId, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      log.error(`wa connect-meta: ${e.message}`);
      res.status(500).json({ error: 'Error al conectar WhatsApp' });
    }
  });

  // DELETE connect: revoca el número propio (cae al compartido).
  app.delete('/api/portal/whatsapp/connect', portalAuth, async (req, res) => {
    try {
      const { revokeWaCredentials } = require('../whatsapp/accounts');
      await revokeWaCredentials(req.businessId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Error al desconectar' });
    }
  });

  // ── POST /api/portal/copilot/parse ────────────────────────
  // Copiloto de configuración (#8): texto libre del dueño → propuesta
  // estructurada (servicios u horario). Solo PROPONE: el portal la enseña,
  // el dueño la aplica al formulario y su Guardar normal persiste.
  app.post('/api/portal/copilot/parse', portalAuth, async (req, res) => {
    try {
      const { parseConfigText } = require('../assistants/config-copilot');
      const { kind, text } = req.body || {};
      const out = await parseConfigText(kind, text);
      res.json(out);
    } catch (e) {
      log.warn(`copilot parse: ${e.message}`);
      res.status(500).json({ ok: false, error: 'No he podido procesarlo ahora mismo.' });
    }
  });

  // ── GET /api/portal/config/gaps ───────────────────────────
  // Carril de datos del bucle de mejora (#5): qué pidió un cliente que el
  // asistente no supo responder (info_gap del auditor, últimos 14 días).
  // El portal lo pinta encima de la tabla de servicios — el aviso vive
  // exactamente donde se arregla. Fail-open: sin datos, lista vacía.
  app.get('/api/portal/config/gaps', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.json({ ok: true, gaps: [] });
    try {
      const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data } = await db.client
        .from('nf_calls')
        .select('org_id, metrics')
        .eq('org_id', businessId)
        .gte('started_at', since)
        .not('metrics', 'is', null)
        .limit(500);
      const { aggregateFindings } = require('../lifecycle/improvement-aggregator');
      const agg = aggregateFindings(data || []);
      res.json({ ok: true, gaps: (agg.byOrg[businessId] && agg.byOrg[businessId].infoGaps) || [] });
    } catch (e) {
      log.warn(`Portal gaps: ${e.message}`);
      res.json({ ok: true, gaps: [] });
    }
  });

  // ── PATCH /api/portal/config ──────────────────────────────
  app.patch('/api/portal/config', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const { name, language, sector, avgTicket, welcomeMessage, services, schedule, reviewUrl, alertPhone, notifyEmail, address, serviceList } = req.body;

    if (language && !['es', 'eu', 'gl', 'es+eu', 'es+gl'].includes(language)) {
      return res.status(400).json({ error: "language debe ser 'es', 'eu', 'gl', 'es+eu' o 'es+gl'" });
    }

    // Update top-level fields via patch
    const topLevelPatch = {};
    if (name)     topLevelPatch.name     = name;
    if (language) topLevelPatch.language = language;
    if (sector)   topLevelPatch.sector   = sector;

    if (Object.keys(topLevelPatch).length > 0) {
      flowManager.patch(businessId, topLevelPatch);
    }

    // flowManager.patch() doesn't pass through custom automations keys,
    // so directly update the config sub-object on the live flow reference
    const flow = flowManager.get(businessId);
    if (!flow) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });
    if (!flow.automations) flow.automations = {};
    const existingCustom = flow.automations.config || {};

    // PARCHE explícito: SOLO los campos que ESTE request trae. Nunca arrastra
    // el resto de la config en memoria (que puede estar obsoleta tras un
    // redeploy) — así, al persistir, se mergea sobre la BD FRESCA sin pisar
    // campos ausentes en el body (bug real 2026-07-08: guardar el horario
    // clonaba un serviceList vacío en memoria y borraba los servicios de BD).
    const configPatch = {
      ...(sector         !== undefined && { sector }),
      ...(avgTicket      !== undefined && { avgTicket: Number(avgTicket) }),
      ...(welcomeMessage !== undefined && { welcomeMessage }),
      ...(services       !== undefined && { services }),
      ...(schedule       !== undefined && { schedule }),
      ...(reviewUrl      !== undefined && { reviewUrl }),
      ...(alertPhone     !== undefined && { alertPhone }),
      ...(notifyEmail    !== undefined && { notifyEmail }),
      ...(address        !== undefined && { address }),
      // Lista estructurada de servicios+precios (la IA la usa para ser experta en el negocio)
      ...(Array.isArray(serviceList) && { serviceList: serviceList
        .filter(s => s && s.name)
        .slice(0, 60)
        .map(s => ({
          name:     String(s.name).slice(0, 80),
          price:    s.price    ? String(s.price).slice(0, 30)    : '',
          duration: s.duration ? String(s.duration).slice(0, 30) : '',
          notes:    s.notes    ? String(s.notes).slice(0, 160)   : '',
        })) }),
    };
    flow.automations.config = { ...existingCustom, ...configPatch };
    flow.updatedAt = new Date().toISOString();

    // Persist to DB
    const db = getDatabase();
    if (db.enabled) {
      try {
        // Read-merge-write AUTORITATIVO sobre el automation_config de BD: no depender
        // del flow en memoria (puede estar parcial/obsoleto tras un reinicio).
        const { data: cur, error: readErr } = await db.client
          .from('organizations').select('automation_config, assistant_config').eq('id', businessId).maybeSingle();
        if (readErr) throw new Error('lectura: ' + readErr.message);
        const baseAuto   = (cur && cur.automation_config) || {};
        // Mergea SOLO el parche de este request sobre la config FRESCA de BD.
        // Nunca el flow en memoria completo: un campo ausente en el body (p.ej.
        // serviceList al guardar solo el horario) DEBE conservar su valor de BD.
        const { mergeConfigForWrite } = require('./config-merge');
        const mergedAuto = { ...baseAuto, config: mergeConfigForWrite(baseAuto.config, configPatch) };
        // El saludo YA NO vive aquí: converge a assistant_config.firstMessage
        // (ver asisPatch abajo). Si quedara la copia legada, seguiría tapando
        // al canónico en la migración suave de lectura (effectiveFirstMessage).
        if (welcomeMessage !== undefined) delete mergedAuto.config.welcomeMessage;
        const dbUpdate = { automation_config: mergedAuto };
        if (name)     dbUpdate.name     = name;
        if (language) dbUpdate.language = language;
        // Campos COMPARTIDOS con la pantalla Asistente → van a su almacén
        // canónico (assistant_config), que es lo que leen el asistente en
        // llamada, el AUDITOR y los recordatorios:
        // - sector: este form lo escribía SOLO en automation_config.config.sector
        //   → nunca llegaba al auditor y todo salía 'genérico' (6 bugs).
        // - firstMessage (mensaje de bienvenida): se escribía en
        //   automation_config.config.welcomeMessage, que NADA leía — el dueño
        //   guardaba su saludo y las llamadas seguían con el viejo (bug real
        //   2026-07-08). Vacío NO borra: quitar el saludo se hace en Asistente
        //   (aquí un '' solo significa "sin opinión" y protege el canónico).
        const asisPatch = {};
        if (sector) asisPatch.sector = sector;
        if (typeof welcomeMessage === 'string' && welcomeMessage.trim()) {
          asisPatch.firstMessage = welcomeMessage.trim();
        }
        if (Object.keys(asisPatch).length) {
          dbUpdate.assistant_config = { ...((cur && cur.assistant_config) || {}), ...asisPatch };
        }
        const { error: upErr } = await db.client.from('organizations').update(dbUpdate).eq('id', businessId);
        if (upErr) throw new Error('escritura: ' + upErr.message);
        flow.automations = mergedAuto; // mantener la memoria en sync con BD
      } catch (e) {
        // Surfacear el fallo: antes se tragaba y el cliente creía que guardaba.
        log.error(`Portal: config DB save FAILED for ${businessId}: ${e.message}`);
        return res.status(500).json({ error: 'No se pudo guardar en la base de datos: ' + e.message });
      }
    }

    // La tabla de servicios/horario editada aquí debe llegar YA al scheduler
    // (duraciones → huecos) y al prompt (asistente cacheado 60s). Antes esta
    // ruta no sincronizaba nada y los cambios no regían hasta el reinicio.
    try {
      const { syncOrgRuntime } = require('../scheduling/org-config');
      await syncOrgRuntime(businessId);
    } catch (_) { /* no crítico */ }

    const custom = flow.automations.config || {};
    log.info(`Portal: config updated for ${businessId}`);
    res.json({
      ok: true,
      config: {
        name:           flow.name        || '',
        ownerEmail:     flow.ownerEmail  || '',
        phone:          flow.ownerPhone  || '',
        language:       flow.language    || 'es',
        sector:         flow.sector      || custom.sector || '',
        plan:           flow.plan        || '',
        avgTicket:      custom.avgTicket       || 35,
        // Eco del saludo convergido (ya vive en assistant_config.firstMessage)
        welcomeMessage: (typeof welcomeMessage === 'string' && welcomeMessage.trim())
          ? welcomeMessage.trim() : (custom.welcomeMessage || ''),
        services:       custom.services        || '',
        schedule:       custom.schedule        || '',
        reviewUrl:      custom.reviewUrl       || '',
        outboundNumber: custom.outboundNumber  || '',
        alertPhone:     custom.alertPhone      || '',
        notifyEmail:    custom.notifyEmail     || flow.ownerEmail || '',
        address:        custom.address         || '',
      },
    });
  });

  // ── GET /api/portal/contacts ───────────────────────────────
  app.get('/api/portal/contacts', portalAuth, async (req, res) => {
    const { businessId } = req;
    const q  = (req.query.q || '').trim();
    const db = getDatabase();
    if (!db.enabled) return res.json({ contacts: [] });

    const tag = (req.query.tag || '').trim().slice(0, 24);

    let query = db.client
      .from('contacts')
      .select('id,phone,name,email,call_count,last_call_at,created_at,tags')
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (tag) query = query.contains('tags', [tag]);

    if (q) {
      // BUG-48 FIX: Sanitize search query before interpolating into PostgREST .or() filter
      // string.  Raw user input can inject additional filter conditions (e.g. commas and
      // parentheses are special in PostgREST filter syntax).  Strip everything except
      // characters that legitimately appear in names, phone numbers and email addresses.
      const safeQ = q.replace(/[^a-zA-Z0-9 .@+\-_áéíóúàèìòùäëïöüñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÑÇ]/g, '').slice(0, 100);
      if (safeQ) {
        query = query.or(`name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,email.ilike.%${safeQ}%`);
      }
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Enrich: if contact has no name, try appointments for display name
    const apts = scheduler.getAppointments(businessId);
    const aptByPhone = {};
    apts.forEach(a => { if (a.phone && !aptByPhone[a.phone]) aptByPhone[a.phone] = a; });

    const contacts = (data || []).map(c => ({
      id:          c.id,
      phone:       c.phone,
      name:        c.name || null,
      email:       c.email || null,
      callCount:   c.call_count || 0,
      lastCallAt:  c.last_call_at || null,
      createdAt:   c.created_at,
      tags:        Array.isArray(c.tags) ? c.tags : [],
      displayName: c.name || (aptByPhone[c.phone] && aptByPhone[c.phone].patientName) || c.phone,
    }));

    // Recopilar todas las etiquetas en uso (para los chips de filtro)
    const allTags = [...new Set(contacts.flatMap(c => c.tags))].sort();

    res.json({ ok: true, count: contacts.length, contacts, allTags });
  });

  // ── GET /api/portal/contacts/export ── CSV de todos los contactos ──────────
  app.get('/api/portal/contacts/export', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const { data, error } = await db.client
      .from('contacts')
      .select('name,phone,email,call_count,last_call_at,tags,notes,created_at')
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .limit(5000);
    if (error) return res.status(500).json({ error: error.message });

    // Escape CSV: comillas dobles + envolver si hay coma/comilla/salto
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = ['Nombre', 'Teléfono', 'Email', 'Llamadas', 'Última llamada', 'Etiquetas', 'Notas', 'Cliente desde'];
    const rows = (data || []).map(c => [
      esc(c.name), esc(c.phone), esc(c.email), esc(c.call_count || 0),
      esc(c.last_call_at ? new Date(c.last_call_at).toLocaleDateString('es-ES') : ''),
      esc(Array.isArray(c.tags) ? c.tags.join(' · ') : ''),
      esc(c.notes),
      esc(c.created_at ? new Date(c.created_at).toLocaleDateString('es-ES') : ''),
    ].join(','));
    // BOM para que Excel reconozca UTF-8 (acentos correctos)
    const csv = '﻿' + header.join(',') + '\n' + rows.join('\n');

    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="clientes-nodeflow-${stamp}.csv"`);
    res.send(csv);
  });

  // ── POST /api/portal/contacts/import ──────────────────────────
  // Importación masiva del export de la clínica (Nombre, Teléfono, Caduca_el, Tipo).
  // { csv, preview? }. Con preview:true solo analiza (no escribe) para revisar antes.
  app.post('/api/portal/contacts/import', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
      const csv = String((req.body && req.body.csv) || '');
      if (csv.length > 2_000_000) return res.status(413).json({ error: 'Fichero demasiado grande (máx ~2MB)' });

      const { parseImportCsv, countScheduled, importContacts } = require('../lifecycle/contact-import');
      const parsed = parseImportCsv(csv);
      if (!parsed.total && parsed.errors.length && parsed.errors[0].line === 1) {
        return res.status(400).json({ error: parsed.errors[0].reason });
      }
      const willSchedule = countScheduled(parsed.rows);

      // Preview: no toca la BD. Devuelve conteos + primeras filas + errores.
      if (req.body && req.body.preview) {
        return res.json({
          ok: true, preview: true,
          total: parsed.total, willSchedule,
          errors: parsed.errors.slice(0, 20), errorCount: parsed.errors.length,
          sample: parsed.rows.slice(0, 5),
        });
      }

      if (parsed.total > 5000) return res.status(413).json({ error: 'Máximo 5000 filas por importación' });
      const result = await importContacts(req.businessId, parsed.rows, { db });
      log.info(`Import (${req.flowConfig.name}): ${result.imported} contactos, ${result.scheduled} renovaciones programadas, ${result.skipped} saltados`);
      res.json({ ok: true, ...result, parseErrors: parsed.errors.slice(0, 20), parseErrorCount: parsed.errors.length });
    } catch (e) { log.warn(`contacts import: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ════════ Tareas del dueño (mini-agenda CRM) ════════════════════════════════

  // GET /api/portal/tasks — MIS TAREAS CON VIDA: la IA llena el inbox sola.
  // Devuelve { suggested:[...], manual:[...], tasks:[...] }:
  //   · suggested = tareas que propone el asistente desde las MISMAS señales
  //     del briefing (oportunidades, riesgo mañana, borradores, inactivos,
  //     bonos), ordenadas por urgencia, sin las que el dueño descartó (con TTL).
  //   · manual    = las tareas que el dueño escribió (nf_tasks), como siempre.
  //   · tasks     = alias de manual (compat: el dashboard ya lo lee).
  // Tolerante: si las sugerencias fallan, se sirven solo las manuales.
  app.get('/api/portal/tasks', portalAuth, async (req, res) => {
    const db = getDatabase();
    const { businessId, flowConfig } = req;
    const { buildSuggestedTasks, filterDismissed } = require('../lifecycle/task-inbox');

    let manual = [];
    let suggested = [];
    if (db.enabled) {
      const [manRes, sug] = await Promise.allSettled([
        db.client.from('nf_tasks')
          .select('id, contact_id, contact_name, title, due_date, done, created_at')
          .eq('organization_id', businessId)
          .order('done', { ascending: true })
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(200),
        (async () => {
          const avgTicket = Number(flowConfig?.automations?.config?.avgTicket) || 0;
          const signals = await _aggregateTaskSignals(db, businessId, avgTicket);
          const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
          const all = buildSuggestedTasks(signals, { today: todayStr });
          // Filtrar las descartadas (mapa fresco de BD; TTL las deja resurgir).
          let dismissed = {};
          try {
            const { data } = await db.client.from('organizations')
              .select('automation_config').eq('id', businessId).maybeSingle();
            dismissed = (data && data.automation_config && data.automation_config.config
              && data.automation_config.config._dismissedTasks) || {};
          } catch (_) {}
          return filterDismissed(all, dismissed, new Date());
        })(),
      ]);
      if (manRes.status === 'fulfilled' && !manRes.value.error) manual = manRes.value.data || [];
      if (sug.status === 'fulfilled') suggested = sug.value || [];
    }
    res.json({ ok: true, suggested, manual, tasks: manual });
  });

  // POST /api/portal/tasks/dismiss — descartar una sugerencia (persistente, TTL).
  // Read-merge-write AUTORITATIVO sobre automation_config.config._dismissedTasks
  // de BD (mismo patrón anti-clobber que las flags de entidad): se lee FRESCO,
  // se añade el descarte con caducidad y se escribe solo esa clave. dismissKey lo
  // calcula el cliente con dismissKeyFor (incluye la fecha en señales efímeras).
  app.post('/api/portal/tasks/dismiss', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const dismissKey = String(req.body?.dismissKey || '').trim().slice(0, 200);
    if (!dismissKey) return res.status(400).json({ error: 'Falta dismissKey' });
    const { addDismissal, pruneDismissed } = require('../lifecycle/task-inbox');
    try {
      const { data: cur, error: readErr } = await db.client
        .from('organizations').select('automation_config').eq('id', req.businessId).maybeSingle();
      if (readErr) throw new Error('lectura: ' + readErr.message);
      const baseAuto = (cur && cur.automation_config) || {};
      const baseCfg  = baseAuto.config || {};
      // Podar caducadas antes de añadir → el mapa no crece sin fin.
      const now = new Date();
      const pruned = pruneDismissed(baseCfg._dismissedTasks || {}, now);
      const nextDismissed = addDismissal(pruned, dismissKey, now);
      const mergedAuto = { ...baseAuto, config: { ...baseCfg, _dismissedTasks: nextDismissed } };
      const { error: upErr } = await db.client.from('organizations')
        .update({ automation_config: mergedAuto }).eq('id', req.businessId);
      if (upErr) throw new Error('escritura: ' + upErr.message);
      // Espejo en memoria (como las flags de entidad) para no servir stale.
      const flowRef = flowManager.get(req.businessId);
      if (flowRef) {
        if (!flowRef.automations) flowRef.automations = {};
        flowRef.automations.config = { ...(flowRef.automations.config || {}), _dismissedTasks: nextDismissed };
      }
      res.json({ ok: true });
    } catch (e) {
      log.error(`Portal: dismiss task FAILED for ${req.businessId}: ${e.message}`);
      res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
    }
  });

  // POST /api/portal/tasks — crear { title, dueDate?, contactId?, contactName? }
  app.post('/api/portal/tasks', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: 'El título es obligatorio' });
    const dueDate = req.body?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate) ? req.body.dueDate : null;

    const { data, error } = await db.client.from('nf_tasks').insert({
      organization_id: req.businessId,
      contact_id:   req.body?.contactId   || null,
      contact_name: req.body?.contactName ? String(req.body.contactName).slice(0, 80) : null,
      title, due_date: dueDate,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, task: data });
  });

  // PATCH /api/portal/tasks/:id — marcar hecha/pendiente o editar título/fecha
  app.patch('/api/portal/tasks/:id', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const patch = {};
    if (req.body?.done !== undefined) {
      patch.done = !!req.body.done;
      patch.completed_at = patch.done ? new Date().toISOString() : null;
    }
    if (req.body?.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.dueDate !== undefined) {
      patch.due_date = req.body.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dueDate) ? req.body.dueDate : null;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

    const { data, error } = await db.client.from('nf_tasks')
      .update(patch).eq('id', req.params.id).eq('organization_id', req.businessId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ ok: true, task: data });
  });

  // DELETE /api/portal/tasks/:id
  app.delete('/api/portal/tasks/:id', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const { error } = await db.client.from('nf_tasks')
      .delete().eq('id', req.params.id).eq('organization_id', req.businessId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ════════ Lista de espera ═══════════════════════════════════════════════════
  app.get('/api/portal/waitlist', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ waitlist: [] });
    const { data, error } = await db.client
      .from('nf_waitlist')
      .select('id, name, phone, service, preferred, notes, status, created_at')
      .eq('organization_id', req.businessId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, waitlist: data || [] });
  });

  app.post('/api/portal/waitlist', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const phone = String(req.body?.phone || '').replace(/[\s\-().+]/g, '');
    if (!/^\d{7,15}$/.test(phone)) return res.status(400).json({ error: 'Teléfono inválido' });
    const { data, error } = await db.client.from('nf_waitlist').insert({
      organization_id: req.businessId,
      name:    req.body?.name    ? String(req.body.name).slice(0, 80)    : null,
      phone,
      service: req.body?.service ? String(req.body.service).slice(0, 80) : null,
      preferred: req.body?.preferred ? String(req.body.preferred).slice(0, 80) : null,
      notes:   req.body?.notes   ? String(req.body.notes).slice(0, 300)  : null,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, entry: data });
  });

  app.patch('/api/portal/waitlist/:id', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const status = ['waiting', 'contacted', 'booked', 'cancelled'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'Estado inválido' });
    const { data, error } = await db.client.from('nf_waitlist')
      .update({ status }).eq('id', req.params.id).eq('organization_id', req.businessId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, entry: data });
  });

  app.delete('/api/portal/waitlist/:id', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    const { error } = await db.client.from('nf_waitlist')
      .delete().eq('id', req.params.id).eq('organization_id', req.businessId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── GET /api/portal/missed-opportunities ── llamadas sin cita (recuperar) ───
  app.get('/api/portal/missed-opportunities', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ opportunities: [] });
    const sinceDays = Math.min(parseInt(req.query.days) || 14, 60);
    try {
      const opportunities = await _missedOpportunitiesList(db, req.businessId, sinceDays);
      res.json({ ok: true, sinceDays, opportunities });
    } catch (e) {
      log.warn(`missed-opportunities: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/campaigns/recovery ── recuperación en LOTE ─────────────
  // El asistente llama, uno a uno y en horario civilizado, a los clientes que
  // llamaron y no reservaron. Los teléfonos se validan SERVER-SIDE contra las
  // oportunidades reales de la org (el navegador no decide a quién se llama).
  app.post('/api/portal/campaigns/recovery', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
    try {
      // Recalcular oportunidades reales (misma lógica que el GET)
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data } = await db.client
        .from('nf_calls')
        .select('caller_number, outcome, started_at')
        .eq('org_id', req.businessId)
        .gte('started_at', since)
        .neq('outcome', 'booked')
        .order('started_at', { ascending: false })
        .limit(300);
      // Misma exclusión que el GET: no llamar a quien ya reservó / tiene cita.
      const excluded = await _excludedRecoveryPhones(db, req.businessId, since);
      const validPhones = new Set((data || []).map(c => c.caller_number)
        .filter(p => p && !excluded.has(normalizePhone(p))));

      // Si el body trae phones, intersectar; si no, todas las oportunidades.
      const requested = Array.isArray(req.body?.phones) && req.body.phones.length
        ? req.body.phones.filter(p => validPhones.has(p))
        : [...validPhones];
      if (!requested.length) return res.json({ ok: true, queued: 0, skipped: 0 });

      const { enqueueRecoveryBatch } = require('../campaigns/enqueuers');
      const result = await enqueueRecoveryBatch(req.businessId, req.flowConfig.name, requested.slice(0, 50));
      log.info(`Campaña de recuperación (${req.flowConfig.name}): ${result.queued} en cola, ${result.skipped} saltados`);
      res.json({ ok: true, ...result });
    } catch (e) {
      log.warn(`campaigns/recovery: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/portal/insights ── horas/días punta + conversión ───────────────
  app.get('/api/portal/insights', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ available: false });
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    try {
      const { data } = await db.client
        .from('nf_calls')
        .select('outcome, started_at')
        .eq('org_id', req.businessId)
        .gte('started_at', since)
        .limit(5000);

      const calls = data || [];
      const byHour = Array(24).fill(0);
      const byDay  = Array(7).fill(0); // 0=domingo
      let booked = 0;
      for (const c of calls) {
        if (!c.started_at) continue;
        // Convertir a hora de Madrid
        const d = new Date(c.started_at);
        const madrid = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
        byHour[madrid.getHours()]++;
        byDay[madrid.getDay()]++;
        if (c.outcome === 'booked') booked++;
      }
      const total = calls.length;
      const peakHour = byHour.indexOf(Math.max(...byHour));
      const dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const peakDay = byDay.indexOf(Math.max(...byDay));

      res.json({
        available: total > 0,
        total,
        booked,
        convRate: total > 0 ? Math.round((booked / total) * 100) : 0,
        byHour,
        byDay,
        peakHour: total > 0 ? peakHour : null,
        peakDayName: total > 0 ? dayNames[peakDay] : null,
        periodDays: 30,
      });
    } catch (e) {
      log.warn(`insights: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/portal/contacts/:id ──────────────────────────
  app.get('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    // 1. Fetch contact
    const { data: contact, error: cErr } = await db.client
      .from('contacts')
      .select('*')
      .eq('id', id)
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .single();

    if (cErr || !contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    // Emparejado por teléfono TOLERANTE al formato: el contacto puede estar
    // guardado en un formato (portal/import) y las llamadas/citas en otro (E.164 de
    // la telefonía) → antes casaba exacto y la ficha salía con 0 llamadas/citas.
    const { phoneVariants, normalizePhone } = require('../utils/phone');
    const cPhone9 = normalizePhone(contact.phone);

    // 2. Fetch linked calls by phone
    const { data: calls } = await db.client
      .from('nf_calls')
      .select('id,outcome,started_at,ended_at,duration_ms,turn_count')
      .eq('org_id', businessId)
      .in('caller_number', phoneVariants(contact.phone))
      .order('started_at', { ascending: false })
      .limit(50);

    // 3. Fetch linked appointments by phone (in-memory)
    const apts = scheduler.getAppointments(businessId)
      .filter(a => normalizePhone(a.phone) === cPhone9 && cPhone9)
      .sort((a, b) => new Date(b.date + 'T' + (b.time || '00:00')) - new Date(a.date + 'T' + (a.time || '00:00')));

    // 3b. Riesgo de plantón (determinista, del historial de faltas de ESTE cliente).
    let noShowRisk = null;
    try {
      const { computeNoShowRisk } = require('../lifecycle/no-show-risk');
      noShowRisk = computeNoShowRisk(apts);
    } catch (_) {}

    // 4. FICHA 360: los seguimientos DE ESTE cliente (próximos + últimos
    //    enviados), sus fechas clave del sector y si está en pausa.
    let reminders = [];
    try {
      const { data: rem } = await db.client.from('scheduled_reminders')
        .select('id, service_key, message_preview, channel, scheduled_for, status, sent_at')
        .eq('org_id', businessId).eq('contact_id', id)
        .in('status', ['pending', 'postponed', 'sent'])
        .order('scheduled_for', { ascending: false })
        .limit(30);
      reminders = rem || [];
    } catch (_) {}

    let sectorFields = [], sectorSlug = null;
    try {
      sectorSlug = await _resolveOrgSector(businessId);
      const { SECTOR_REQUIRED_FIELDS } = require('../lifecycle/sector-fields');
      sectorFields = [...(SECTOR_REQUIRED_FIELDS[sectorSlug] || [])];

      // Fechas INVENTADAS por el negocio (personalizados before_sector_field):
      // aparecen en la ficha de cada cliente con el nombre de su regla.
      const { loadOrgConfig } = require('../lifecycle/followup-rules');
      const orgCfg = await loadOrgConfig(db, businessId);
      for (const c of (Array.isArray(orgCfg._custom) ? orgCfg._custom : [])) {
        if (c && c.trigger === 'before_sector_field' && c.field && c.enabled !== false) {
          sectorFields.push({ key: c.field, label: c.label || c.field, type: 'date', custom: true });
        }
      }

      // Cumpleaños UNIVERSAL (Fase B): con fecha en la ficha, el motor
      // felicita cada año. Algunos sectores ya traen el campo — no duplicar.
      if (!sectorFields.some(f => f.key === 'fecha_cumpleanos')) {
        sectorFields.push({ key: 'fecha_cumpleanos', label: 'Cumpleaños', type: 'date' });
      }
    } catch (_) {}

    let paused = false;
    try {
      const { data: mem } = await db.client.from('contact_memory')
        .select('no_whatsapp, no_sms, no_email')
        .eq('org_id', businessId).eq('contact_id', id).maybeSingle();
      paused = !!(mem && mem.no_whatsapp && mem.no_sms && mem.no_email);
    } catch (_) {}

    // 5. FICHA 360 ↔ ENTIDADES (v1): "sus cosas" — el Golf, el bono, la
    //    póliza de ESTE cliente como chips que llevan a la ficha viva.
    //    Best effort: sin tablas/feature, el array queda vacío y la ficha
    //    360 sigue exactamente igual que antes.
    let contactEntities = [];
    let hasEntityTypes  = false;
    try {
      const { entitiesFeatureEnabled, entityTablesExist, getOrgEntityTypes } = require('../entities/entity-types');
      if (entitiesFeatureEnabled() && (await entityTablesExist(db))) {
        const eTypes = await getOrgEntityTypes(businessId, { db });
        hasEntityTypes = eTypes.length > 0;
        if (hasEntityTypes) {
          const { data: ents } = await db.client.from('nf_entities')
            .select('id, entity_type_id, display_name, attrs')
            .eq('organization_id', businessId)
            .eq('contact_id', id)
            .eq('is_archived', false)
            .order('updated_at', { ascending: false })
            .limit(20);
          const typeById = new Map(eTypes.map(t => [t.id, t]));
          contactEntities = (ents || []).map(e => {
            const t = typeById.get(e.entity_type_id);
            return {
              id:           e.id,
              display_name: e.display_name,
              icon:         (t && t.icon) || '🗂️',
              type_key:     t ? t.key : null,
              is_draft:     !!(e.attrs && e.attrs.is_draft),
            };
          });
        }
      }
    } catch (_) {}

    res.json({
      ok: true,
      contact: {
        id:          contact.id,
        phone:       contact.phone,
        name:        contact.name  || null,
        email:       contact.email || null,
        notes:       contact.notes || '',
        callCount:   contact.call_count || 0,
        lastCallAt:  contact.last_call_at || null,
        createdAt:   contact.created_at,
        displayName: contact.name || contact.phone,
        sectorData:  contact.sector_data || {},
      },
      reminders,
      sectorFields,
      paused,
      noShowRisk,
      entities:       contactEntities,
      hasEntityTypes,
      calls: (calls || []).map(c => ({
        callSid:    c.id,
        outcome:    c.outcome    || 'abandoned',
        startedAt:  c.started_at || null,
        endedAt:    c.ended_at   || null,
        durationMs: c.duration_ms || 0,
        turnCount:  c.turn_count  || 0,
      })),
      appointments: apts,
    });
  });

  // ── PATCH /api/portal/contacts/:id ────────────────────────
  app.patch('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const { name, email, notes, tags } = req.body;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const patch = {};
    if (name  !== undefined) patch.name  = name  || null;
    if (email !== undefined) patch.email = email || null;
    if (notes !== undefined) patch.notes = notes || null;
    if (tags  !== undefined) {
      // Saneamos: máx 10 etiquetas, cada una corta y sin caracteres raros
      patch.tags = Array.isArray(tags)
        ? tags.map(t => String(t).trim().slice(0, 24).replace(/[^a-zA-Z0-9 áéíóúñü\-_]/gi, '')).filter(Boolean).slice(0, 10)
        : [];
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    const { data, error } = await db.client
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Contacto no encontrado' });
    res.json({ ok: true, contact: data });
  });

  // ── POST /api/portal/contacts — crear ficha de cliente a mano ─────────────
  // Usado desde el formulario de fichas (dueño/titular) para dar de alta un
  // cliente que no existía, sin salir del modal. También vale como alta directa.
  // Sin call_count/last_call_at (no es una llamada). Dedup por teléfono.
  app.post('/api/portal/contacts', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    let { name, phone, email } = req.body || {};
    name  = (name  || '').toString().trim().slice(0, 120) || null;
    phone = (phone || '').toString().trim().slice(0, 24)  || null;
    email = (email || '').toString().trim().slice(0, 160) || null;
    if (!name && !phone) return res.status(400).json({ error: 'Indica al menos un nombre o un teléfono' });

    const shape = c => ({ id: c.id, name: c.name, phone: c.phone, email: c.email,
                          displayName: c.name || c.phone || 'Cliente' });
    try {
      // Dedup por teléfono: si ya existe, completa huecos y lo devuelve.
      if (phone) {
        const { data: ex } = await db.client.from('contacts')
          .select('id, name, phone, email').eq('org_id', businessId)
          .eq('phone', phone).is('deleted_at', null).limit(1);
        if (ex && ex[0]) {
          const patch = {};
          if (!ex[0].name  && name)  patch.name  = name;
          if (!ex[0].email && email) patch.email = email;
          if (Object.keys(patch).length) {
            patch.updated_at = new Date().toISOString();
            await db.client.from('contacts').update(patch).eq('id', ex[0].id);
          }
          return res.json({ ok: true, existed: true, contact: shape({ ...ex[0], ...patch }) });
        }
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await db.client.from('contacts')
        .insert({ org_id: businessId, name, phone, email, created_at: nowIso, updated_at: nowIso })
        .select('id, name, phone, email').single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, contact: shape(data) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/portal/contacts/:id ───────────────────────
  app.delete('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const { error } = await db.client
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', businessId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // ── GET /api/portal/calls/:callSid/transcript ──────────────
  app.get('/api/portal/calls/:callSid/transcript', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { callSid } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.json({ transcript: [], available: false });

    // nf_calls (el id del pipeline ES la clave — la tabla legacy "calls"
    // estaba vacía y este endpoint devolvía 404 para TODA llamada)
    const { data, error } = await db.client
      .from('nf_calls')
      .select('transcript,outcome,started_at,ended_at,duration_ms,caller_number,metrics')
      .eq('id', callSid)
      .eq('org_id', businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Transcripción no disponible para esta llamada' });
    }

    // Análisis de calidad para el dueño: score determinista + auditoría IA
    // (problemas y mejoras en su idioma) — ya se calculan solos por llamada.
    const q = data.metrics?.quality || null;
    const a = data.metrics?.audit || null;
    res.json({
      ok:           true,
      transcript:   data.transcript   || [],
      outcome:      data.outcome      || null,
      startedAt:    data.started_at   || null,
      endedAt:      data.ended_at     || null,
      durationMs:   data.duration_ms  || 0,
      callerNumber: data.caller_number || null,
      available:    (data.transcript || []).length > 0,
      analysis: (q || a) ? {
        score:        a ? a.score : (q ? q.score : null),
        satisfied:    a ? a.customer_satisfied : null,
        hallucinated: a ? a.hallucinated : null,
        verbosity:    a ? a.verbosity : null,
        problems:     a ? a.problems : [],
        improvements: a ? a.improvements : [],
        avgConfidence: q ? q.avgConfidence : null,
        avgLatency:    q ? q.avgLatency : null,
      } : null,
    });
  });

  // ── GET /api/portal/assistant ─────────────────────────────────
  app.get('/api/portal/assistant', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.json({ config: {} });
    try {
      const { data } = await db.client
        .from('organizations')
        .select('name, assistant_config, automation_config')
        .eq('id', businessId)
        .single();
      // Saludo efectivo: si queda un welcomeMessage legado guardado desde
      // Configuración (cuando escribía en un campo que nada leía), se enseña
      // aquí — es lo último que el dueño guardó. Al guardar cualquiera de las
      // dos pantallas, converge en assistant_config.firstMessage.
      const cfg = { ...(data?.assistant_config || {}) };
      const { effectiveFirstMessage } = require('../assistants/org-assistant');
      const eff = effectiveFirstMessage(data?.assistant_config, data?.automation_config);
      if (eff) cfg.firstMessage = eff;
      res.json({ config: cfg, orgName: data?.name || '' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/voice/clone ──────────────────────────────
  // Clona la voz del dueño (Instant Voice Cloning de ElevenLabs) desde una
  // muestra de audio (cuerpo CRUDO, via express.raw). Gate: add-on voice_premium
  // + consentimiento explícito (?consent=1). Guarda el voice_id y lo fija como
  // voz del asistente. Una voz clonada por negocio (borra la anterior).
  app.post('/api/portal/voice/clone', portalAuth, async (req, res) => {
    const { businessId } = req;
    const audio = req.body; // Buffer (express.raw registrado en server.js)
    if (!Buffer.isBuffer(audio) || audio.length < 20000) {
      return res.status(400).json({ error: 'Graba al menos ~30 segundos de tu voz, claros y sin ruido.' });
    }
    if (req.query.consent !== '1') {
      return res.status(400).json({ error: 'Debes confirmar que es tu voz y que autorizas clonarla.' });
    }
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'Base de datos no disponible.' });
    try {
      const { data: org } = await db.client.from('organizations')
        .select('name, automation_config, assistant_config').eq('id', businessId).maybeSingle();
      const { hasAddon } = require('../billing/addons');
      if (!hasAddon(org, 'voice_premium')) {
        return res.status(402).json({ error: 'La voz personalizada es Premium (+10€/mes). Actívala en Facturación → Complementos.', addonRequired: 'voice_premium' });
      }
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) return res.status(503).json({ error: 'Clonado de voz no disponible ahora mismo.' });

      const { ElevenLabsTTS } = require('../tts/elevenlabs');
      const eleven = new ElevenLabsTTS(apiKey);
      const prev = org?.assistant_config?.clonedVoiceId || null;

      const result = await eleven.cloneVoice({
        name: `NF · ${(org?.name || 'Negocio').slice(0, 40)}`,
        audioBuffer: audio,
        mimeType: req.headers['content-type'] || 'audio/webm',
      });
      if (!result.ok) return res.status(502).json({ error: 'No se pudo clonar la voz: ' + result.error });

      // Persistir: clonedVoiceId + fijarla como voz del asistente (voice_id real
      // de ElevenLabs → resolveElevenVoice lo respeta tal cual).
      const mergedAC = { ...(org?.assistant_config || {}), clonedVoiceId: result.voiceId, voice: result.voiceId };
      const { error: upErr } = await db.client.from('organizations')
        .update({ assistant_config: mergedAC }).eq('id', businessId);
      if (upErr) return res.status(500).json({ error: 'Voz clonada pero no se pudo guardar: ' + upErr.message });

      if (prev && prev !== result.voiceId) eleven.deleteVoice(prev).catch(() => {}); // limpia el slot anterior
      try { require('../assistants/org-assistant').invalidateOrgAssistant(businessId); } catch (_) {}

      log.info(`Voz clonada para ${businessId}: ${result.voiceId}`);

      // Aviso al FUNDADOR (opción A: automático pero en el loop). Best-effort,
      // no bloquea la respuesta al cliente.
      try {
        const bizName = org?.name || 'Un negocio';
        require('../notifications/founder').notifyFounder({
          subject: `🎙️ ${bizName} ha clonado su voz`,
          text: `🎙️ *Voz clonada — NodeFlow*\n━━━━━━━━━━━━\n${bizName} acaba de clonar su voz.\nvoice_id: ${result.voiceId}\n\nRevisa la calidad: llama a su asistente de prueba o escúchala desde su portal. Si no convence, puede volver a grabar.`,
        }).catch(() => {});
      } catch (_) {}

      res.json({ ok: true, voiceId: result.voiceId });
    } catch (e) {
      log.warn(`/api/portal/voice/clone error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── PUT /api/portal/assistant ─────────────────────────────────
  // Portal users can edit their config but CANNOT set customPromptOverride or model.
  app.put('/api/portal/assistant', portalAuth, async (req, res) => {
    const { businessId } = req;
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'body debe ser el objeto config' });
    }

    // Strip fields portal users must not control
    const safe = { ...incoming };
    delete safe.customPromptOverride;
    delete safe.model;

    const db = getDatabase();
    try {
      // Merge with existing config (don't overwrite fields not sent)
      const { data: existing } = await db.client
        .from('organizations').select('name, assistant_config, automation_config').eq('id', businessId).single();

      // Candado de voz Premium (add-on +10€): server-side y determinista.
      // Sin castigo retroactivo — solo bloquea CAMBIAR a una voz premium.
      if (safe.voice) {
        const { voiceChangeAllowed } = require('../billing/addons');
        const check = voiceChangeAllowed(existing, safe.voice);
        if (!check.allowed) {
          return res.status(402).json({ error: check.reason, addonRequired: 'voice_premium' });
        }
      }

      const merged = { ...(existing?.assistant_config || {}), ...safe };

      const { generatePrompt } = require('../assistants/prompt-generator');
      const prompt = generatePrompt(merged, existing?.name || '');

      await db.client
        .from('organizations')
        .update({ assistant_config: merged })
        .eq('id', businessId);

      // Convergencia del saludo: guardado aquí firstMessage (canónico), el
      // welcomeMessage legado de automation_config.config se borra — si
      // quedara, seguiría tapando al canónico en la migración suave de
      // lectura (effectiveFirstMessage) y las dos pantallas divergirían.
      if (safe.firstMessage !== undefined) {
        try {
          const autoCur = existing?.automation_config;
          if (autoCur?.config && typeof autoCur.config.welcomeMessage === 'string') {
            const { welcomeMessage: _legado, ...cfgSinLegado } = autoCur.config;
            await db.client.from('organizations')
              .update({ automation_config: { ...autoCur, config: cfgSinLegado } })
              .eq('id', businessId);
          }
          // También en el flow EN MEMORIA: si quedara ahí, el próximo PATCH
          // /config lo re-mergearía a BD y resucitaría el legado.
          const flowRef = flowManager.get(businessId);
          if (flowRef?.automations?.config) delete flowRef.automations.config.welcomeMessage;
        } catch (e) {
          log.warn(`Portal: limpieza de welcomeMessage legado falló: ${e.message}`);
        }
      }

      // UNA sola verdad de servicios (#8): la tabla estructurada
      // (automation_config.serviceList) manda. El texto libre legacy solo
      // SIEMBRA la tabla si aún no existe; jamás la pisa (antes, guardar la
      // pestaña Asistente regeneraba la lista desde el textarea y machacaba
      // los servicios editados en la tabla de Configuración).
      if (safe.services !== undefined) {
        try {
          const { seedServiceListFromText } = require('../scheduling/org-config');
          const { data: orgAuto } = await db.client
            .from('organizations').select('automation_config').eq('id', businessId).single();
          const auto = orgAuto?.automation_config || {};
          const seeded = seedServiceListFromText(auto.config?.serviceList, safe.services);
          if (seeded) {
            auto.config = { ...(auto.config || {}), serviceList: seeded };
            await db.client.from('organizations')
              .update({ automation_config: auto }).eq('id', businessId);
            log.info(`Portal: serviceList SEMBRADO desde texto legacy (${seeded.length} servicios) para ${businessId}`);
          }
        } catch (e) {
          log.error(`Portal: siembra de serviceList falló: ${e.message}`);
        }
      }

      // Scheduler + asistente cacheado en sync — vía helper canónico
      // (traduce SIEMPRE con toSchedulerConfig: copiar merged.schedule tal
      // cual metía claves {mon,tue...} donde el scheduler indexa 0-6 y todos
      // los días parecían cerrados — bug HHR 2026-07-03).
      try {
        const { syncOrgRuntime } = require('../scheduling/org-config');
        await syncOrgRuntime(businessId);
      } catch (_) { /* runtime sync no es crítico para responder */ }

      log.info(`Portal: assistant config updated for ${businessId}`);
      res.json({ ok: true, prompt });
    } catch (e) {
      log.error(`Portal PUT assistant error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/whatsapp/request ─────────────────────────
  // Solicitud del número de WhatsApp propio (nivel premium). Antes era un
  // mailto: que en equipos sin cliente de correo abría el selector de
  // archivos (bug real 2026-07-03). Ahora viaja por el servidor.
  app.post('/api/portal/whatsapp/request', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    // Fallback al email del fundador: sin NOTIFY_EMAIL en el host, el botón
    // devolvía "No se pudo enviar" (caso real 2026-07-03).
    const to = process.env.NOTIFY_EMAIL || 'unai@nodeflow.es';
    try {
      const { sendEmail } = require('../notifications/email');
      await sendEmail({
        to,
        subject: `Solicitud número WhatsApp propio — ${flowConfig?.name || businessId}`,
        html: `<h3>Solicitud de número de WhatsApp propio</h3>
          <p><b>Negocio:</b> ${flowConfig?.name || '—'} (${businessId})<br>
          <b>Email dueño:</b> ${flowConfig?.ownerEmail || '—'}<br>
          <b>Teléfono dueño:</b> ${flowConfig?.ownerPhone || '—'}<br>
          <b>Plan:</b> ${flowConfig?.plan || '—'}</p>
          <p>Solicitado desde Integraciones del portal.</p>`,
      });
      log.info(`WhatsApp propio solicitado por ${businessId}`);
      res.json({ ok: true });
    } catch (e) {
      log.error(`whatsapp/request: ${e.message}`);
      res.status(500).json({ error: 'No se pudo enviar la solicitud' });
    }
  });

  // ── POST /api/portal/calls/outbound ──────────────────────────
  // Inicia una llamada saliente desde el portal del cliente.
  // Plan gate: requiere una org activa con plan válido (Negocio/enterprise).
  // body: { to: string, assistantId?: string, provider?: 'auto'|'vonage'|'twilio' }
  app.post('/api/portal/calls/outbound', portalAuth, async (req, res) => {
    const { flowConfig, businessId } = req;

    // Plan gate
    const plan = (flowConfig.plan || 'negocio').toLowerCase();
    if (!['negocio', 'enterprise'].includes(plan)) {
      return res.status(403).json({
        error: 'Las llamadas salientes requieren una suscripción activa.',
        upgrade: true,
      });
    }

    const { to, assistantId, provider = 'auto' } = req.body;
    if (!to) return res.status(400).json({ error: 'El campo "to" (número destino) es obligatorio' });

    // Sanitise: only digits, +, spaces, hyphens — no other chars
    const safeTo = String(to).replace(/[^\d+\s\-]/g, '').slice(0, 20);
    if (safeTo.replace(/[+\s\-]/g, '').length < 7) {
      return res.status(400).json({ error: 'Número de teléfono no válido' });
    }

    // Resolve assistant: prefer explicit id, then fall back to businessId (org's own assistant)
    const effAssistantId = assistantId || businessId;

    const publicUrl = config.publicUrl || process.env.PUBLIC_URL || '';

    try {
      // ── Telnyx (proveedor actual) — TeXML outbound ─────────────────
      // POST /v2/texml/calls/{app_id}: al descolgar, Telnyx pide el TeXML
      // a Url (= nuestro webhook inbound) y conecta el media stream del
      // asistente. Mismo flujo que una llamada entrante.
      const telnyxApiKey = config.telnyxApiKey || process.env.TELNYX_API_KEY;
      const telnyxAppId  = config.telnyxAppId  || process.env.TELNYX_APP_ID;
      const useTelnyx = (provider === 'telnyx') || (provider === 'auto' && telnyxApiKey);

      if (useTelnyx) {
        // Motor compartido (portal + campañas): resolución de número
        // org→pool→env y registro del PROPÓSITO de la llamada — el
        // asistente sabrá por qué llama (prueba, recuperación…).
        const { startOutboundCall, PURPOSE_BLOCKS } = require('../telephony/outbound');
        const purpose = ['test_call', 'recovery'].includes(req.body.purpose) ? req.body.purpose : 'test_call';
        const promptBlock = PURPOSE_BLOCKS[purpose]
          ? PURPOSE_BLOCKS[purpose](flowConfig.name, String(req.body.client_name || '').slice(0, 80) || null)
          : '';
        try {
          const result = await startOutboundCall({
            businessId: effAssistantId,
            to:         safeTo,
            from:       (flowConfig.automations && flowConfig.automations.config && flowConfig.automations.config.outboundNumber) || null,
            publicUrl,
            context:    { purpose, promptBlock },
          });
          log.info(`Portal: Telnyx outbound call → ${safeTo} for ${businessId} (${purpose})`);
          return res.json(result);
        } catch (e) {
          return res.status(503).json({ error: e.message + (e.message.includes('configuradas') || e.message.includes('configurado') ? ' Contacta con soporte.' : '') });
        }
      }

      const useVonage = (provider === 'vonage') ||
        (provider === 'auto' && config.vonageApiKey && config.vonageApplicationId);

      if (useVonage) {
        const { Vonage } = require('@vonage/server-sdk');
        const vonage = new Vonage({
          apiKey:        config.vonageApiKey,
          apiSecret:     config.vonageApiSecret,
          applicationId: config.vonageApplicationId,
          privateKey:    config.vonagePrivateKeyPath || './vonage_private.key',
        });
        const result = await vonage.voice.createOutboundCall({
          to:         [{ type: 'phone', number: safeTo }],
          from:       { type: 'phone', number: (flowConfig.automations && flowConfig.automations.config && flowConfig.automations.config.outboundNumber) || config.vonagePhoneNumber },
          answer_url: [`${publicUrl}/vonage/answer/${effAssistantId}`],
          event_url:  [`${publicUrl}/vonage/event`],
        });
        log.info(`Portal: Vonage outbound call → ${safeTo} for ${businessId}`);
        res.json({ ok: true, callUUID: result.uuid, provider: 'vonage' });
      } else {
        const twilio = require('twilio')(
          config.twilioAccountSid  || process.env.TWILIO_ACCOUNT_SID,
          config.twilioAuthToken   || process.env.TWILIO_AUTH_TOKEN,
        );
        // Per-org outbound number takes priority over global config
        const fromNumber = (flowConfig.automations && flowConfig.automations.config && flowConfig.automations.config.outboundNumber)
          || config.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;
        if (!fromNumber) {
          return res.status(503).json({ error: 'No hay número de teléfono saliente configurado para este negocio. Contacta con soporte.' });
        }
        const call = await twilio.calls.create({
          to:   safeTo,
          from: fromNumber,
          url:  `${publicUrl}/voice/inbound/${effAssistantId}`,
        });
        log.info(`Portal: Twilio outbound call → ${safeTo} for ${businessId}`);
        res.json({ ok: true, callSid: call.sid, provider: 'twilio' });
      }
    } catch (e) {
      log.error(`Portal: outbound call failed for ${businessId}: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Lifecycle: Reminder Config
  // ============================================================

  app.get('/api/portal/reminder-config', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;
      const { data: org } = await db.client.from('organizations')
        .select('assistant_config').eq('id', orgId).maybeSingle();
      const config = await getOrgReminderConfig(orgId, (org?.assistant_config && org.assistant_config.sector) || '');
      res.json({ ok: true, config });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/reminder-config', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;
      const { config: cfg } = req.body;
      if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'config object required' });
      const { error } = await db.client.from('org_reminder_config')
        .upsert({ org_id: orgId, config: cfg, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Sector Completion (wizard data)
  // IMPORTANT: Must be registered BEFORE /contacts/:id/sector-data
  // to prevent Express matching 'sector-completion' as a contact :id
  // ============================================================

  app.get('/api/portal/contacts/sector-completion', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;

      // Get org sector
      const { data: org, error: orgErr } = await db.client
        .from('organizations').select('assistant_config').eq('id', orgId).maybeSingle();
      if (orgErr) return res.status(500).json({ error: orgErr.message });
      if (!org)   return res.status(404).json({ error: 'Organization not found' });

      const sectorSlug = (org.assistant_config && org.assistant_config.sector) || '';
      const fields     = SECTOR_REQUIRED_FIELDS[sectorSlug];

      // Sectors with no manual fields — wizard not needed
      if (!fields || fields.length === 0) {
        return res.json({ wizardNeeded: false, sector: sectorSlug, fields: [], contacts: [], pendingCount: 0, totalCount: 0 });
      }

      // Fetch all contacts for this org
      const { data: contacts, error: contactsErr } = await db.client
        .from('contacts')
        .select('id, name, phone, sector_data')
        .eq('org_id', orgId)
        .order('name', { ascending: true });

      if (contactsErr) return res.status(500).json({ error: contactsErr.message });

      const list = (contacts || []).map(function(c) {
        const { status, missing } = getCompletionStatus(sectorSlug, c.sector_data);
        return {
          id:         c.id,
          name:       c.name       || null,
          phone:      c.phone      || null,
          sectorData: c.sector_data || {},   // included so wizard can pre-fill existing values
          status,
          missing,
        };
      });

      const pendingCount = list.filter(function(c) { return c.status !== 'complete'; }).length;

      res.json({
        wizardNeeded: true,
        sector:       sectorSlug,
        fields,
        contacts:     list,
        pendingCount,
        totalCount:   list.length,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Contact Sector Data
  // ============================================================

  app.get('/api/portal/contacts/:id/sector-data', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data, error } = await db.client.from('contacts')
        .select('id, name, phone, sector_data')
        .eq('id', req.params.id)
        .eq('org_id', req.businessId)
        .maybeSingle();
      if (error || !data) return res.status(404).json({ error: 'Contact not found' });
      res.json({ ok: true, sectorData: data.sector_data || {} });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/contacts/:id/sector-data', portalAuth, async (req, res) => {
    try {
      const db        = getDatabase();
      const orgId     = req.businessId;
      const contactId = req.params.id;
      const { sectorData } = req.body;
      if (!sectorData || typeof sectorData !== 'object' || Array.isArray(sectorData)) {
        return res.status(400).json({ error: 'sectorData object required' });
      }
      // Topes server-side (auditoría 2026-07-07): sin esto, un script con
      // sesión podría inflar la BD ficha a ficha. Solo valores planos.
      const keys = Object.keys(sectorData);
      if (keys.length > 60) return res.status(400).json({ error: 'Demasiados campos (máx. 60)' });
      const clean = {};
      for (const k of keys) {
        const v = sectorData[k];
        const key = String(k).slice(0, 64);
        if (v === null || v === undefined || v === '') { clean[key] = v === '' ? '' : null; continue; }
        if (typeof v === 'number' || typeof v === 'boolean') { clean[key] = v; continue; }
        clean[key] = String(v).slice(0, 300);
      }
      if (JSON.stringify(clean).length > 8192) return res.status(400).json({ error: 'Ficha demasiado grande (máx. 8KB)' });

      const { error } = await db.client.from('contacts')
        .update({ sector_data: clean })
        .eq('id', contactId).eq('org_id', orgId);
      if (error) return res.status(500).json({ error: error.message });

      // Recalculate reminders in background (fire-and-forget)
      recalculate(contactId, orgId).catch(() => {});

      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Lifecycle: Reminders Dashboard
  // ============================================================

  app.get('/api/portal/reminders', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { status = 'pending' } = req.query;
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit,  10) || 50));
      const offset = Math.max(0,              parseInt(req.query.offset, 10) || 0);

      let query = db.client.from('scheduled_reminders')
        .select('*, contacts(name, phone)')
        .eq('org_id', req.businessId)
        .order('scheduled_for', { ascending: true })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (status !== 'all') query = query.eq('status', status);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, reminders: data || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/portal/reminders/upcoming', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db.client.from('scheduled_reminders')
        .select('*, contacts(name, phone)')
        .eq('org_id', req.businessId)
        .eq('status', 'pending')
        .lte('scheduled_for', until)
        .order('scheduled_for', { ascending: true })
        .limit(100);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, reminders: data || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/send-now', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { data: existing } = await db.client.from('scheduled_reminders')
        .select('*').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Reminder not found' });

      await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'manual_send_now', updated_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('org_id', req.businessId);

      const out = await scheduleReminder({
        orgId:        req.businessId,
        contactId:    existing.contact_id,
        serviceKey:   existing.service_key,
        scheduledFor: new Date(Date.now() + 5000), // 5 seconds from now
        channel:      existing.channel,
        messagePreview: existing.message_preview, // sin esto, un TXT: del dueño perdería su texto
      });

      // Acuse HONESTO (auditoría 2026-07-07): si el cliente está de baja o en
      // enfriamiento, decirlo — no un ok que no es verdad.
      if (out && out.ok === false) {
        const msgs = {
          do_not_contact: 'No enviado: este cliente pidió no recibir mensajes.',
          cooling_off: 'No enviado: este cliente está en periodo de enfriamiento tras varios avisos.',
        };
        return res.status(409).json({ error: msgs[out.skipped] || out.error || 'No se pudo programar el envío' });
      }
      res.json({ ok: true, message: 'Reminder queued for immediate dispatch' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/postpone', portalAuth, async (req, res) => {
    try {
      const db   = getDatabase();
      const days = Math.max(1, Math.min(90, Number(req.body.days) || 7));

      const { data: existing } = await db.client.from('scheduled_reminders')
        .select('*').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Reminder not found' });

      const newDate = new Date(existing.scheduled_for);
      newDate.setDate(newDate.getDate() + days);

      await db.client.from('scheduled_reminders')
        .update({ status: 'postponed', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);

      await db.client.from('scheduled_reminders').insert({
        org_id:         req.businessId,
        contact_id:     existing.contact_id,
        service_key:    existing.service_key,
        channel:        existing.channel,
        scheduled_for:  newDate.toISOString(),
        status:         'pending',
        postponed_from: req.params.id,
        postponed_days: days,
      });

      res.json({ ok: true, newDate: newDate.toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/reminders/:id/cancel', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const { error } = await db.client.from('scheduled_reminders')
        .update({ status: 'cancelled', failed_reason: 'manual_cancel', updated_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('org_id', req.businessId);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Seguimientos personalizados (2026-07-06)
  // El sistema SUGIERE quién llamó y no reservó + redacta un mensaje
  // personalizado; el dueño revisa/edita y lo envía por SU WhatsApp.
  // Dos vías operativas: enlace wa.me (lo manda él → sin límite de
  // plantilla, 100% personalizado) y API de su propio número.
  // Nada se envía solo: humano en el bucle.
  // ============================================================
  app.get('/api/portal/followups', portalAuth, async (req, res) => {
    try {
      const { getCandidates } = require('../lifecycle/followups');
      const items = await getCandidates(req.businessId, { bizName: req.flowConfig.name, lang: req.flowConfig.language });
      res.json({ ok: true, followups: items });
    } catch (e) { log.warn(`followups list: ${e.message}`); res.json({ ok: true, followups: [] }); }
  });

  // Marca un seguimiento como HECHO (tras abrir el enlace wa.me, o al descartar).
  // Body opcional: { channel: 'wa_link' | 'dismissed' }
  app.post('/api/portal/followups/:callId/done', portalAuth, async (req, res) => {
    try {
      const { markDone } = require('../lifecycle/followups');
      const channel = ['wa_link', 'dismissed'].includes(req.body && req.body.channel) ? req.body.channel : null;
      const r = await markDone(req.params.callId, req.businessId, { channel });
      if (!r.ok) return res.status(500).json({ error: r.error || 'No se pudo marcar' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Envía el seguimiento por el WhatsApp PROPIO del negocio (API de Meta).
  // Requiere número propio conectado (add-on wa_own_number). Body: { message }.
  // Ojo Meta: el texto libre solo sale dentro de la ventana de 24h; si el
  // cliente no ha escrito, Meta lo rechaza → el dueño usa el enlace wa.me.
  app.post('/api/portal/followups/:callId/send', portalAuth, async (req, res) => {
    try {
      // truncateSafe: un .slice() a lo bruto puede partir un emoji (par suplente
      // UTF-16) y el mensaje llega a WhatsApp acabado en "�".
      const { truncateSafe } = require('../lifecycle/followups');
      const message = truncateSafe(String(req.body && req.body.message || '').trim(), 1000);
      if (!message) return res.status(400).json({ error: 'Mensaje vacío' });

      const db = getDatabase();
      // Recupera la llamada (para el teléfono) y valida propiedad.
      const { data: call } = await db.client.from('nf_calls')
        .select('id, caller_number').eq('id', req.params.callId)
        .eq('org_id', req.businessId).maybeSingle();
      if (!call) return res.status(404).json({ error: 'Llamada no encontrada' });
      if (!call.caller_number || call.caller_number === 'unknown') {
        return res.status(400).json({ error: 'Sin número de teléfono para este contacto' });
      }

      const { getWaCredentials } = require('../whatsapp/accounts');
      const creds = await getWaCredentials(req.businessId);
      if (!creds) {
        return res.status(402).json({
          error: 'Para enviar desde tu propio número necesitas conectarlo (complemento "WhatsApp con tu número"). Mientras tanto, usa el botón de WhatsApp para enviarlo tú.',
          addonRequired: 'wa_own_number',
        });
      }

      const { sendText } = require('../notifications/client-whatsapp');
      const out = await sendText(call.caller_number, message, creds);
      if (!out.ok) {
        // Fuera de la ventana de 24h Meta rechaza el texto libre → guiar al enlace.
        return res.status(422).json({ error: out.error || 'WhatsApp no pudo enviarlo', useLink: true });
      }

      const { markDone } = require('../lifecycle/followups');
      await markDone(req.params.callId, req.businessId, { channel: 'api' });
      res.json({ ok: true, messageId: out.messageId });
    } catch (e) { log.warn(`followup send: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Reglas de seguimiento por sector (2026-07-06)
  // El dueño ve los seguimientos "de fábrica" de su sector, los activa/
  // desactiva, ajusta el cuándo/canal y AÑADE los suyos propios.
  // ============================================================
  async function _resolveOrgSector(orgId) {
    const db = getDatabase();
    if (!db.enabled) return 'generico';
    const { data } = await db.client.from('organizations')
      .select('assistant_config').eq('id', orgId).maybeSingle();
    const raw = (data && data.assistant_config && data.assistant_config.sector) || '';
    try { return require('../sectors/sector-registry').resolveSector(raw).slug; }
    catch (_) { return raw || 'generico'; }
  }

  app.get('/api/portal/followup-rules', portalAuth, async (req, res) => {
    try {
      const { buildRulesView, loadOrgConfig, CHANNELS } = require('../lifecycle/followup-rules');
      const { SECTOR_CATALOG, CUSTOM_TRIGGERS, TRIGGERS } = require('../lifecycle/sector-catalog');
      const db = getDatabase();
      const sector = await _resolveOrgSector(req.businessId);
      const orgConfig = await loadOrgConfig(db, req.businessId);
      const { resolveCap } = require('../lifecycle/frequency-cap');
      // Qué canales pueden ENVIAR hoy de verdad (WhatsApp aún en activación,
      // SMS opcional…) — el dueño debe saber por dónde saldrían sus avisos.
      const channelsLive = {
        whatsapp: require('../notifications/client-whatsapp').isConfigured(),
        sms: require('../notifications/sms').isConfigured(),
        email: !!process.env.RESEND_API_KEY,
      };
      // Servicios del negocio → las reglas ligadas a servicio se auto-apagan
      // si no ofrece nada que case (con aviso visible en la UI).
      let svcList = null;
      try {
        const { data: orgRow } = await getDatabase().client.from('organizations')
          .select('automation_config').eq('id', req.businessId).maybeSingle();
        svcList = orgRow?.automation_config?.config?.serviceList || null;
      } catch (_) {}
      const rules = buildRulesView(sector, orgConfig, svcList);

      // Cobertura de FECHAS por regla (auditoría 2026-07-07): una regla de
      // fecha con 0 fichas rellenadas no envía nada y el dueño no sabía por
      // qué. Ahora la UI puede avisar "ningún cliente tiene esta fecha aún".
      const fieldCoverage = {};
      const dateRules = rules.filter(r => (r.trigger === 'before_sector_field' || r.trigger === 'from_sector_field' || r.trigger === 'yearly_field') && r.field);
      for (const r of dateRules.slice(0, 25)) {
        try {
          const { count } = await db.client.from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', req.businessId).is('deleted_at', null)
            .not(`sector_data->>${r.field}`, 'is', null);
          fieldCoverage[r.key] = count || 0;
        } catch (_) {}
      }

      res.json({
        ok: true,
        sector,
        sectorLabel: (SECTOR_CATALOG[sector] && SECTOR_CATALOG[sector].label) || null,
        rules,
        fieldCoverage,
        channels: CHANNELS,
        channelsLive,
        customTriggers: CUSTOM_TRIGGERS.map(t => ({ value: t, label: TRIGGERS[t] })),
        frequencyCapDays: resolveCap(orgConfig),
      });
    } catch (e) { log.warn(`followup-rules get: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/followup-rules', portalAuth, async (req, res) => {
    try {
      const { saveRules } = require('../lifecycle/followup-rules');
      const sector = await _resolveOrgSector(req.businessId);
      const r = await saveRules(req.businessId, sector, req.body || {}, { db: getDatabase() });
      if (r.error) return res.status(400).json({ error: r.error });
      // Aplica los cambios a la cartera ACTUAL (background, no bloquea la respuesta).
      require('../lifecycle/reminder-engine').recalculateOrg(req.businessId).catch(() => {});
      res.json({ ok: true });
    } catch (e) { log.warn(`followup-rules put: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // Estimación: a cuántos clientes actuales llegaría en los próximos 90 días.
  app.get('/api/portal/followup-rules/reach', portalAuth, async (req, res) => {
    try {
      const { estimateReach } = require('../lifecycle/followup-rules');
      const sector = await _resolveOrgSector(req.businessId);
      const reach = await estimateReach(req.businessId, sector, { db: getDatabase() });
      res.json({ ok: true, ...reach });
    } catch (e) { log.warn(`followup-rules reach: ${e.message}`); res.json({ ok: true, total: 0, byRule: {}, horizon: 90 }); }
  });

  // ── 🗓️ Campañas del año (estacionales de un clic) ──────────
  // GET: sugeridas del sector con su estado. PUT {key, enabled}: activa/
  // desactiva (fila en org_campaigns; el cron diario ya las dispara).
  app.get('/api/portal/campaigns', portalAuth, async (req, res) => {
    try {
      const { getSeasonalForSector } = require('../lifecycle/seasonal-catalog');
      const sector = await _resolveOrgSector(req.businessId);
      const suggested = getSeasonalForSector(sector);
      const db = getDatabase();
      let rows = [];
      if (db.enabled) {
        const { data } = await db.client.from('org_campaigns')
          .select('service_key, enabled, last_fired_year').eq('org_id', req.businessId);
        rows = data || [];
      }
      const byKey = Object.fromEntries(rows.map(r => [r.service_key, r]));
      // Nº de destinatarios ≈ contactos con teléfono (mismo criterio que promo)
      let audience = 0;
      try {
        const { getRecipients } = require('../notifications/promo-broadcast');
        audience = (await getRecipients(req.businessId, { db })).length;
      } catch (_) {}
      res.json({
        ok: true, audience,
        campaigns: suggested.map(c => ({
          ...c,
          enabled: !!(byKey[c.key] && byKey[c.key].enabled),
          lastFiredYear: (byKey[c.key] && byKey[c.key].last_fired_year) || null,
        })),
      });
    } catch (e) { log.warn(`campaigns get: ${e.message}`); res.json({ ok: true, campaigns: [], audience: 0 }); }
  });

  app.put('/api/portal/campaigns', portalAuth, async (req, res) => {
    try {
      const key = String((req.body && req.body.key) || '');
      const enabled = req.body && req.body.enabled === true;
      const { findSeasonal } = require('../lifecycle/seasonal-catalog');
      const c = findSeasonal(key);
      if (!c) return res.status(400).json({ error: 'Campaña desconocida' });
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });

      // Update si existe; si no, insert (unique org+service_key+fecha).
      const { data: upd } = await db.client.from('org_campaigns')
        .update({ enabled }).eq('org_id', req.businessId).eq('service_key', key).select('id');
      if (!upd || !upd.length) {
        const { error } = await db.client.from('org_campaigns').insert({
          org_id: req.businessId, service_key: key, campaign_name: c.name,
          fire_month: c.month, fire_day: c.day, channel: 'whatsapp', enabled,
        });
        if (error) return res.status(500).json({ error: error.message });
      }
      log.info(`Campaña ${key} ${enabled ? 'ON' : 'OFF'} (${req.flowConfig.name})`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ✉️ Paquete de mensajes del mes (contador + excedente) ──
  app.get('/api/portal/message-usage', portalAuth, async (req, res) => {
    try {
      const { usageSummary } = require('../billing/message-usage');
      res.json({ ok: true, ...(await usageSummary(req.businessId, { db: getDatabase() })) });
    } catch (e) { res.json({ ok: true, used: 0, included: 200, overage: 0, overageEur: 0, ratePerMessage: 0.10 }); }
  });

  // ── 📣 PROMOCIÓN por WhatsApp a los clientes del negocio ──
  // preview:true → destinatarios y coste estimado, sin enviar. Sin preview →
  // envía (rate-limit: 1 difusión por org cada 10 min; opt-outs excluidos).
  const _promoLast = new Map();
  app.post('/api/portal/promo', portalAuth, async (req, res) => {
    try {
      const { getRecipients, sendPromo } = require('../notifications/promo-broadcast');
      const text = String((req.body && req.body.text) || '').trim().slice(0, 300);
      const tag = String((req.body && req.body.tag) || '').trim() || null;
      // Segmentos (2026-07-07): filtros combinables para acotar el envío.
      const b = req.body || {};
      const seg = {
        service: b.service ? String(b.service).slice(0, 60) : null,
        inactiveDays: b.inactiveDays ? Math.max(1, Math.min(3650, parseInt(b.inactiveDays, 10) || 0)) : null,
        birthdayMonth: b.birthdayMonth === true,
      };

      if (req.body && req.body.preview) {
        const recipients = await getRecipients(req.businessId, { tag, ...seg, db: getDatabase() });
        return res.json({ ok: true, preview: true, recipients: recipients.length });
      }

      if (text.length < 10) return res.status(400).json({ error: 'Escribe la promoción (mínimo 10 caracteres)' });
      const last = _promoLast.get(req.businessId) || 0;
      if (Date.now() - last < 10 * 60 * 1000) {
        return res.status(429).json({ error: 'Ya enviaste una promoción hace poco — espera 10 minutos entre difusiones.' });
      }
      _promoLast.set(req.businessId, Date.now());

      const out = await sendPromo(req.businessId, { text, tag, bizName: req.flowConfig.name, ...seg }, { db: getDatabase() });
      // Fallo sin ningún envío: cooldown corto (1 min) en vez de reset total —
      // permite reintentar pronto pero no martillear (auditoría 2026-07-07).
      if (out.aborted && out.sent === 0) {
        _promoLast.set(req.businessId, Date.now() - 9 * 60 * 1000);
        return res.status(422).json({ error: out.aborted });
      }
      log.info(`Promo (${req.flowConfig.name}): ${out.sent}/${out.recipients} enviadas`);
      res.json({ ok: true, ...out });
    } catch (e) { log.warn(`promo: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ── 📨 Aviso directo a clientes SELECCIONADOS (2026-07-07, pedido Unai) ──
  // "Contactar a X clientes por WhatsApp en nombre del negocio": el dueño
  // marca clientes concretos y escribe SU mensaje. Viaja como TXT: por la
  // plantilla-portadora nodeflow_aviso vía el dispatcher normal → respeta
  // opt-outs/pausas, entra al ledger (paquete + ficha + ROI). Tope 50/envío.
  const _notifyLast = new Map();
  app.post('/api/portal/notify-clients', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
      const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      const ids = Array.isArray(req.body && req.body.contactIds) ? req.body.contactIds.slice(0, 50) : [];
      if (text.length < 10) return res.status(400).json({ error: 'Escribe el mensaje (mínimo 10 caracteres)' });
      if (!ids.length) return res.status(400).json({ error: 'Selecciona al menos un cliente' });
      const last = _notifyLast.get(req.businessId) || 0;
      if (Date.now() - last < 60 * 1000) return res.status(429).json({ error: 'Espera un minuto entre avisos.' });
      _notifyLast.set(req.businessId, Date.now());

      // Propiedad: solo contactos de SU org.
      const { data: owned } = await db.client.from('contacts')
        .select('id').eq('org_id', req.businessId).is('deleted_at', null).in('id', ids);
      const validIds = (owned || []).map(c => c.id);

      const { scheduleReminder } = require('../lifecycle/reminder-engine');
      const crypto = require('crypto');
      let queued = 0, skipped = 0;
      for (const cid of validIds) {
        const out = await scheduleReminder({
          orgId: req.businessId, contactId: cid,
          serviceKey: 'aviso_' + crypto.randomBytes(4).toString('hex'),
          scheduledFor: new Date(Date.now() + 5000),
          channel: 'whatsapp', messagePreview: 'TXT:' + text,
        });
        if (out && out.ok) queued++; else skipped++;
      }
      log.info(`Aviso directo (${req.flowConfig.name}): ${queued} encolados, ${skipped} saltados de ${ids.length}`);
      res.json({ ok: true, queued, skipped, invalid: ids.length - validIds.length });
    } catch (e) { log.warn(`notify-clients: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ── FICHA 360: seguimiento PERSONAL para un cliente concreto ──
  // "Avísale el 15 de marzo: preguntar por el presupuesto de la moto".
  // Crea un recordatorio one-off ligado a SU ficha; el mensaje usa la
  // etiqueta como servicio ("Ha llegado el momento de {label}").
  app.post('/api/portal/contacts/:id/personal-reminder', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      // La etiqueta acaba en un parámetro de plantilla de Meta: sin saltos de línea.
      const label = String((req.body && req.body.label) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const dateStr = String((req.body && req.body.date) || '').trim();
      if (!label) return res.status(400).json({ error: 'Escribe de qué quieres avisarle' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'Fecha no válida' });
      const when = new Date(dateStr + 'T09:30:00');
      if (isNaN(when.getTime())) return res.status(400).json({ error: 'Fecha no válida' });
      if (when.getTime() < Date.now()) return res.status(400).json({ error: 'La fecha debe ser futura' });

      // Verificar propiedad del contacto
      const { data: c } = await db.client.from('contacts')
        .select('id').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!c) return res.status(404).json({ error: 'Contacto no encontrado' });

      // Tope por ficha (auditoría 2026-07-07): sin él, un script podría
      // encolar recordatorios personales sin límite.
      const { count: pendingPersonal } = await db.client.from('scheduled_reminders')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', req.businessId).eq('contact_id', req.params.id)
        .like('service_key', 'personal_%').in('status', ['pending', 'postponed']);
      if ((pendingPersonal || 0) >= 15) {
        return res.status(429).json({ error: 'Este cliente ya tiene 15 avisos personales pendientes — borra alguno primero.' });
      }

      // serviceKey único: los personales no se pisan entre sí (scheduleReminder
      // cancela pendientes del MISMO serviceKey — cada personal lleva el suyo).
      const { scheduleReminder } = require('../lifecycle/reminder-engine');
      const serviceKey = 'personal_' + require('crypto').randomBytes(4).toString('hex');
      const out = await scheduleReminder({
        orgId: req.businessId, contactId: req.params.id, serviceKey,
        scheduledFor: when, channel: 'whatsapp', messagePreview: label,
      });
      if (out && out.ok === false) {
        const msgs = {
          do_not_contact: 'No programado: este cliente pidió no recibir mensajes (está pausado o se dio de baja).',
          cooling_off: 'No programado: este cliente está en periodo de enfriamiento.',
        };
        return res.status(409).json({ error: msgs[out.skipped] || out.error || 'No se pudo programar' });
      }
      res.json({ ok: true });
    } catch (e) { log.warn(`personal-reminder: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ── FICHA 360: pausar/reanudar TODOS los avisos a un cliente ──
  // Silencio total para ese contacto (whatsapp+sms+email) sin tocar reglas.
  app.put('/api/portal/contacts/:id/pause', portalAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const paused = req.body && req.body.paused === true;
      const { data: c } = await db.client.from('contacts')
        .select('id').eq('id', req.params.id).eq('org_id', req.businessId).maybeSingle();
      if (!c) return res.status(404).json({ error: 'Contacto no encontrado' });
      const { error } = await db.client.from('contact_memory').upsert({
        org_id: req.businessId, contact_id: req.params.id,
        no_whatsapp: paused, no_sms: paused, no_email: paused,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,contact_id' });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, paused });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ROI del motor: citas atribuidas a seguimientos ──
  // "El motor te trajo N citas (~X€)" — la métrica que renueva suscripciones.
  app.get('/api/portal/followup-roi', portalAuth, async (req, res) => {
    try {
      const { getAttribution } = require('../lifecycle/followup-attribution');
      const r = await getAttribution(req.businessId, {
        db: getDatabase(),
        sinceDays: Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30)),
        avgTicket: req.flowConfig?.automations?.config?.avgTicket || 0,
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      log.warn(`followup-roi: ${e.message}`);
      res.json({ ok: true, totals: { count: 0, value: 0, auto: 0, personal: 0 }, bookings: [], sentCount: 0 });
    }
  });

  // ── Recetario: ideas curadas de seguimiento con "+ Añadir" ──
  app.get('/api/portal/followup-rules/recipes', portalAuth, async (req, res) => {
    try {
      const { getRecipes } = require('../lifecycle/followup-recipes');
      const { buildRulesView, loadOrgConfig } = require('../lifecycle/followup-rules');
      const sector = await _resolveOrgSector(req.businessId);
      const orgConfig = await loadOrgConfig(getDatabase(), req.businessId);
      const existing = buildRulesView(sector, orgConfig).map(r => r.label);
      // Servicios del negocio → cada negocio ve SU recetario (una peluquería
      // sin tintes no ve la idea de raíces). Sin lista, no se restringe.
      let svcList = null;
      try {
        const { data: orgRow } = await getDatabase().client.from('organizations')
          .select('automation_config').eq('id', req.businessId).maybeSingle();
        svcList = orgRow?.automation_config?.config?.serviceList || null;
      } catch (_) {}
      res.json({ ok: true, recipes: getRecipes(sector, existing, svcList) });
    } catch (e) { log.warn(`recipes: ${e.message}`); res.json({ ok: true, recipes: [] }); }
  });

  // ── Sugerencias de seguimiento (el sistema aprende y propone) ──
  app.get('/api/portal/followup-rules/suggestions', portalAuth, async (req, res) => {
    try {
      const { getSuggestions } = require('../lifecycle/followup-suggestions');
      const sector = await _resolveOrgSector(req.businessId);
      const suggestions = await getSuggestions(req.businessId, sector, { db: getDatabase() });
      res.json({ ok: true, suggestions });
    } catch (e) { log.warn(`suggestions get: ${e.message}`); res.json({ ok: true, suggestions: [] }); }
  });

  app.post('/api/portal/followup-rules/suggestions/apply', portalAuth, async (req, res) => {
    try {
      const id = String((req.body && req.body.id) || '');
      if (!id) return res.status(400).json({ error: 'Falta la sugerencia' });
      const { applySuggestion } = require('../lifecycle/followup-suggestions');
      const sector = await _resolveOrgSector(req.businessId);
      const r = await applySuggestion(req.businessId, sector, id, { db: getDatabase() });
      if (r.error) return res.status(400).json({ error: r.error });
      require('../lifecycle/reminder-engine').recalculateOrg(req.businessId).catch(() => {});
      res.json({ ok: true });
    } catch (e) { log.warn(`suggestions apply: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/portal/followup-rules/suggestions/dismiss', portalAuth, async (req, res) => {
    try {
      const id = String((req.body && req.body.id) || '');
      if (!id) return res.status(400).json({ error: 'Falta la sugerencia' });
      const { dismissSuggestion } = require('../lifecycle/followup-suggestions');
      const r = await dismissSuggestion(req.businessId, id, { db: getDatabase() });
      if (r.error) return res.status(400).json({ error: r.error });
      res.json({ ok: true });
    } catch (e) { log.warn(`suggestions dismiss: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  // ============================================================
  // Opt-out (PUBLIC — no auth required)
  // ============================================================

  // ── GET /api/portal/onboarding-status ── PUBLIC (no auth) ───────────────────
  // Polled by /gracias page to show real-time onboarding progress.
  // Returns steps completed for a given registroId.
  app.get('/api/portal/onboarding-status', async (req, res) => {
    const { registroId } = req.query;
    if (!registroId || typeof registroId !== 'string' || registroId.length > 80) {
      return res.status(400).json({ error: 'registroId requerido' });
    }

    const db = getDatabase();

    // Default: all pending (DB not available or registro not found)
    const result = {
      steps: {
        paid:            false,
        org_created:     false,
        number_assigned: false,
        activation_sent: false,
      },
      complete:       false,
      nodeflowNumber: null,
      portalReady:    false,
    };

    if (!db.enabled) return res.json(result);

    try {
      // 1. Check registro status
      const { data: reg } = await db.client
        .from('registros')
        .select('id, status, email, paid_at')
        .eq('id', registroId)
        .maybeSingle();

      if (!reg) return res.json(result);

      result.steps.paid = !!(reg.paid_at || reg.status === 'active');

      // 2. Check org
      const { data: org } = await db.client
        .from('organizations')
        .select('id, automation_config, is_active')
        .eq('owner_email', reg.email.trim().toLowerCase())
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (org) {
        result.steps.org_created = true;
        result.portalReady       = true;

        const cfg = org.automation_config?.config || {};
        const num = cfg.nodeflowNumber || cfg.outboundNumber || null;
        if (num) {
          result.steps.number_assigned = true;
          result.steps.activation_sent = true;
          result.nodeflowNumber        = num;
          result.complete              = true;
        }
      }

      result.steps.paid = result.steps.paid || result.steps.org_created;

      res.json(result);
    } catch (e) {
      log.warn('onboarding-status error', { err: e.message });
      res.json(result); // fail open — return default pending state
    }
  });

  app.get('/api/portal/unsubscribe', async (req, res) => {
    try {
      const { c: contactId, o: orgId, ch: channel } = req.query;
      if (!contactId || !orgId || !['whatsapp','email','sms'].includes(channel)) {
        return res.status(400).send('Enlace inválido');
      }
      const db    = getDatabase();
      const field = channel === 'whatsapp' ? 'no_whatsapp' : channel === 'sms' ? 'no_sms' : 'no_email';
      // Verify contact belongs to this org (prevents cross-tenant opt-out)
      const { data: contactExists } = await db.client.from('contacts')
        .select('id').eq('id', contactId).eq('org_id', orgId).maybeSingle();
      if (!contactExists) {
        return res.status(400).send('Enlace inválido o expirado');
      }
      await db.client.from('contact_memory')
        .upsert(
          { org_id: orgId, contact_id: contactId, [field]: true, updated_at: new Date().toISOString() },
          { onConflict: 'org_id,contact_id' }
        ).catch(() => {});
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ Preferencia guardada</h2>
        <p>No recibirás más recordatorios por ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'email'} de este negocio.</p>
      </body></html>`);
    } catch (e) { res.status(500).send('Error interno'); }
  });

  // ════════ ENTIDADES v0 — vehículos, mascotas, pólizas… ═══════════════════
  // La "cosa" del cliente como objeto de primera clase (diseño Entidades
  // 2026-07-08). Gate triple: feature flag + el sector tiene plantillas +
  // las tablas existen (migración manual pendiente → {available:false} y el
  // portal oculta la pestaña). Copy-on-create perezoso al primer GET.

  // Resuelve el gate y devuelve los tipos de la org (o null si no aplica).
  async function _entityGate(req) {
    const { sectorHasEntityTemplates, entityTablesExist, ensureOrgEntityTypes } =
      require('../entities/entity-types');
    // BUG REAL (2026-07-09, org de Unai): req.flowConfig.sector es undefined
    // cuando portalAuth resuelve desde flowManager en memoria (el flow guarda
    // el sector en automations.config.sector, no en la raíz) → la pestaña de
    // Entidades no aparecía NUNCA. Se resuelve con el helper canónico, que
    // mira todos los sitios donde puede vivir el sector.
    const sector = await _resolveOrgSector(req.businessId);
    if (!sector || !sectorHasEntityTemplates(sector)) return null;
    const db = getDatabase();
    if (!db.enabled || !(await entityTablesExist(db))) return null;
    // Siembra las plantillas del sector si faltan (idempotente, cacheado)
    const types = await ensureOrgEntityTypes(req.businessId, sector, { db });
    return types.length ? types : null;
  }

  // v1: al guardar una ficha, sus avisos se re-materializan YA en background
  // (antes solo la pasada nocturna) — el 🔔 del timeline refleja el cambio
  // al instante. Best effort: si falla, la noche lo recoge igual.
  function _syncEntityRemindersBg(orgId, entityType, entity) {
    if (!entity) return;
    setImmediate(() => {
      try {
        const { syncEntityRemindersNow } = require('../entities/entity-reminders');
        syncEntityRemindersNow({ orgId, entityType, entity }).catch(() => {});
      } catch (_) {}
    });
  }

  // 📤 LA FICHA COMUNICA (auto, opt-in): al CREAR una ficha en el portal CON
  // dueño vinculado, si la org activó entitySummaryOnCreate, le enviamos el
  // resumen solo. Lee el flag FRESCO de BD (misma fuente que el enqueuer, no
  // la copia en memoria que pierde .config al reiniciar). Best effort en
  // background: nunca bloquea ni rompe la creación.
  function _maybeAutoSendSummary(orgId, entityType, entity) {
    if (!entity || !entity.contact_id) return;
    setImmediate(async () => {
      try {
        const db = getDatabase();
        if (!db.enabled) return;
        const { data } = await db.client.from('organizations')
          .select('automation_config').eq('id', orgId).maybeSingle();
        const on = data && data.automation_config
          && data.automation_config.config
          && data.automation_config.config.entitySummaryOnCreate === true;
        if (!on) return;
        const { sendEntitySummary } = require('../entities/entity-notify');
        await sendEntitySummary({ orgId, entityType, entity, db }).catch(() => {});
      } catch (_) {}
    });
  }

  // ── GET /api/portal/entity-types ── tipos de entidad de la org ────────────
  // Incluye los PRESETS del sector (recetario de fichas, mismo patrón que el
  // recetario de Seguimientos): fichas típicas que prellenan el formulario
  // con un clic. Las fechas relativas se resuelven AQUÍ, al servir — nunca
  // viajan horneadas. Best effort: sin presets la pestaña funciona igual.
  app.get('/api/portal/entity-types', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.json({ available: false, types: [] });
      let presets = null;
      try {
        const { resolvePresetsForSector } = require('../entities/entity-presets');
        presets = resolvePresetsForSector(await _resolveOrgSector(req.businessId), new Date());
      } catch (e) { log.warn(`entity-presets: ${e.message}`); }
      res.json({ available: true, types, presets });
    } catch (e) {
      log.warn(`GET entity-types: ${e.message}`);
      res.json({ available: false, types: [] }); // fail-closed: la pestaña se oculta
    }
  });

  // ── GET /api/portal/entities?type=vehiculo&q=… ── lista org-scoped ────────
  app.get('/api/portal/entities', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.json({ available: false, entities: [] });

      const typeKey = String(req.query.type || '').slice(0, 40);
      const type    = typeKey ? types.find(t => t.key === typeKey) : types[0];
      if (!type) return res.status(400).json({ error: 'Tipo de ficha desconocido' });

      const { listEntities } = require('../entities/entities');
      const r = await listEntities({
        orgId: req.businessId, entityTypeId: type.id,
        q: req.query.q, limit: 200,
      });
      if (!r.ok) return res.status(500).json({ error: r.error || 'Error al cargar' });

      // Nombres de los dueños vinculados, en lote (chip → Ficha 360)
      const db = getDatabase();
      const contactIds = [...new Set(r.entities.map(e => e.contact_id).filter(Boolean))];
      const names = {};
      if (contactIds.length) {
        const { data: cs } = await db.client.from('contacts')
          .select('id, name, phone').in('id', contactIds).eq('org_id', req.businessId);
        for (const c of (cs || [])) names[c.id] = c.name || c.phone || null;
      }
      const entities = r.entities.map(e => ({ ...e, contact_name: e.contact_id ? (names[e.contact_id] || null) : null }));
      res.json({ available: true, type: type.key, entities });
    } catch (e) {
      log.error('GET entities', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/entities ── crear (attrs validados en código) ────────
  app.post('/api/portal/entities', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });

      const body = req.body || {};
      const type = types.find(t => t.key === String(body.type || ''));
      if (!type) return res.status(400).json({ error: 'Tipo de ficha desconocido' });

      // El dueño solo puede vincular contactos SUYOS
      let contactId = null;
      if (body.contact_id) {
        const db = getDatabase();
        const { data: c } = await db.client.from('contacts')
          .select('id').eq('id', body.contact_id).eq('org_id', req.businessId).maybeSingle();
        if (!c) return res.status(400).json({ error: 'Cliente no encontrado' });
        contactId = c.id;
      }

      // Anti-duplicados: si el tipo tiene identificador natural (matrícula,
      // nº de póliza…) y ya existe una ficha viva con ese valor → 409 con
      // mensaje claro. El duplicado se evita AQUÍ (código), no en la UI.
      const { identifierField } = require('../entities/entity-types');
      const idField = identifierField(type);
      const idValue = idField && body.attrs && typeof body.attrs === 'object' ? body.attrs[idField.key] : null;
      if (idField && String(idValue || '').trim()) {
        const { findEntityByIdentifier } = require('../entities/entities');
        const dup = await findEntityByIdentifier({
          orgId: req.businessId, entityTypeId: type.id,
          fieldKey: idField.key, value: idValue,
        });
        if (dup) {
          return res.status(409).json({
            error: `Ya tienes una ficha con ${(idField.label || idField.key).toLowerCase()} «${String(idValue).trim()}»: ${dup.display_name}. Edita esa ficha en vez de crear un duplicado.`,
            duplicate_id: dup.id,
          });
        }
      }

      const { createEntity } = require('../entities/entities');
      const r = await createEntity({ orgId: req.businessId, entityType: type, attrs: body.attrs, contactId });
      if (!r.ok) return res.status(400).json({ error: (r.errors && r.errors[0] && r.errors[0].error) || r.error || 'No se pudo guardar', errors: r.errors });
      _syncEntityRemindersBg(req.businessId, type, r.entity);
      _maybeAutoSendSummary(req.businessId, type, r.entity);
      res.json({ ok: true, entity: r.entity });
    } catch (e) {
      log.error('POST entities', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/portal/entities/:id ── editar (merge parcial de attrs) ─────
  app.patch('/api/portal/entities/:id', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });

      const { getEntity, updateEntity } = require('../entities/entities');
      const current = await getEntity({ orgId: req.businessId, entityId: req.params.id });
      if (!current) return res.status(404).json({ error: 'Ficha no encontrada' });
      const type = types.find(t => t.id === current.entity_type_id);
      if (!type) return res.status(400).json({ error: 'Tipo de ficha desconocido' });

      const body = req.body || {};
      let contactId; // undefined = no tocar
      if (body.contact_id !== undefined) {
        if (!body.contact_id) contactId = null;
        else {
          const db = getDatabase();
          const { data: c } = await db.client.from('contacts')
            .select('id').eq('id', body.contact_id).eq('org_id', req.businessId).maybeSingle();
          if (!c) return res.status(400).json({ error: 'Cliente no encontrado' });
          contactId = c.id;
        }
      }

      const r = await updateEntity({
        orgId: req.businessId, entityType: type, entityId: req.params.id,
        attrs: body.attrs, contactId,
      });
      if (!r.ok) return res.status(400).json({ error: (r.errors && r.errors[0] && r.errors[0].error) || r.error || 'No se pudo guardar', errors: r.errors });
      _syncEntityRemindersBg(req.businessId, type, r.entity);
      res.json({ ok: true, entity: r.entity });
    } catch (e) {
      log.error('PATCH entities', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/portal/entities/:id/timeline ── la FICHA VIVA (v1) ───────────
  // Un solo viaje: la entidad + su historia. El timeline es la unión de
  // (a) nf_entity_events, (b) citas con entity_id, (c) avisos enviados y
  // programados 🔔 — consultas en PARALELO + merge puro (cero N+1), títulos
  // listos-para-pintar (el cliente no hace joins).
  app.get('/api/portal/entities/:id/timeline', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });

      const { getEntity } = require('../entities/entities');
      const entity = await getEntity({ orgId: req.businessId, entityId: req.params.id });
      if (!entity) return res.status(404).json({ error: 'Ficha no encontrada' });
      const type = types.find(t => t.id === entity.entity_type_id);

      const db = getDatabase();
      const { fetchEntityTimeline } = require('../entities/entity-timeline');

      // Timeline + datos del dueño (nombre para pintar; teléfono para el botón
      // wa.me de "enviar resumen"), en paralelo.
      const [timeline, owner] = await Promise.all([
        fetchEntityTimeline({ orgId: req.businessId, entityId: entity.id, entityType: type, db }),
        (async () => {
          if (!entity.contact_id) return null;
          const { data: c } = await db.client.from('contacts')
            .select('name, phone').eq('id', entity.contact_id).eq('org_id', req.businessId).maybeSingle();
          return c || null;
        })(),
      ]);

      res.json({
        available: true,
        entity:    {
          ...entity,
          contact_name:  owner ? (owner.name || owner.phone || null) : null,
          contact_phone: owner ? (owner.phone || null) : null,
        },
        type_key:  type ? type.key : null,
        timeline,
      });
    } catch (e) {
      log.error('GET entity timeline', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/entities/:id/notes ── nota manual en el timeline ─────
  app.post('/api/portal/entities/:id/notes', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });

      const { addEntityNote } = require('../entities/entities');
      const r = await addEntityNote({ orgId: req.businessId, entityId: req.params.id, text: (req.body || {}).text });
      if (!r.ok) {
        return res.status(r.error === 'not_found' ? 404 : 400)
          .json({ error: r.error === 'not_found' ? 'Ficha no encontrada' : r.error });
      }
      res.json({ ok: true });
    } catch (e) {
      log.error('POST entity note', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/entities/:id/send-summary ── LA FICHA COMUNICA ───────
  // Envía al dueño un resumen humano de su ficha por la maquinaria de avisos
  // (WA → SMS → Email, respetando opt-out). Cuenta 1 mensaje del paquete.
  // Requiere dueño con teléfono/email → si no, 4xx claro en español (el botón
  // del portal ya sale deshabilitado, esto es el cinturón de seguridad).
  app.post('/api/portal/entities/:id/send-summary', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });

      const { getEntity } = require('../entities/entities');
      const entity = await getEntity({ orgId: req.businessId, entityId: req.params.id });
      if (!entity) return res.status(404).json({ error: 'Ficha no encontrada' });
      const type = types.find(t => t.id === entity.entity_type_id);

      const { sendEntitySummary } = require('../entities/entity-notify');
      const r = await sendEntitySummary({ orgId: req.businessId, entityType: type, entity });
      if (r.ok) return res.json({ ok: true, channel: r.channel });

      // Errores de negocio → 4xx honesto en español (nunca un 500 opaco)
      const MESSAGES = {
        no_contact:      'Esta ficha no tiene cliente vinculado. Vincula un dueño con teléfono para poder enviarle el resumen.',
        no_phone:        'El cliente vinculado no tiene teléfono ni email. Añádelos en su ficha para poder escribirle.',
        do_not_contact:  'Este cliente pidió no recibir mensajes. Respetamos su preferencia y no le escribimos.',
        send_failed:     'No se pudo enviar por ningún canal ahora mismo. Prueba de nuevo en unos minutos.',
        db_disabled:     'El envío no está disponible ahora mismo.',
      };
      const status = (r.reason === 'send_failed' || r.reason === 'db_disabled') ? 502 : 400;
      return res.status(status).json({ error: MESSAGES[r.reason] || 'No se pudo enviar el resumen.' });
    } catch (e) {
      log.error('POST entity send-summary', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/portal/entities/:id ── archivar (borrado suave) ───────────
  app.delete('/api/portal/entities/:id', portalAuth, async (req, res) => {
    try {
      const types = await _entityGate(req);
      if (!types) return res.status(404).json({ available: false, error: 'Fichas no disponibles' });
      const { archiveEntity } = require('../entities/entities');
      const r = await archiveEntity({ orgId: req.businessId, entityId: req.params.id });
      if (!r.ok) return res.status(500).json({ error: r.error || 'No se pudo eliminar' });
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE entities', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ════════ IMPORTACIÓN MÁGICA (v1) — su Excel → fichas avisando solas ══════
  // El desbloqueador de adopción: pega su listado, el sistema detecta las
  // columnas contra la plantilla de SU sector (determinista, cero LLM) y crea
  // las fichas con el dueño vinculado por teléfono. Parser/mapeo/validación
  // son PUROS en src/entities/entity-import.js; aquí solo la escritura
  // (org-scoped SIEMPRE) y el disparo de los avisos 🔔.

  // Resuelve gate + tipo + parseo + mapeo + filas. Compartido por preview y
  // commit (el commit re-parsea: sin estado en el servidor entre pasos).
  async function _entityImportPrepare(req) {
    const types = await _entityGate(req);
    if (!types) return { status: 404, error: 'Fichas no disponibles' };

    const body = req.body || {};
    const type = types.find(t => t.key === String(body.type || '')) || types[0];
    if (!type) return { status: 400, error: 'Tipo de ficha desconocido' };

    const csv = String(body.csv || '');
    if (!csv.trim()) return { status: 400, error: 'Pega tus datos o sube el archivo primero' };
    if (csv.length > 2_000_000) return { status: 413, error: 'Fichero demasiado grande (máx ~2MB)' };

    const { parseCsv, suggestMapping, sanitizeMapping, buildImportRows } =
      require('../entities/entity-import');
    const parsed = parseCsv(csv);
    if (!parsed.headers.length || !parsed.rows.length) {
      return { status: 400, error: 'No he encontrado datos: la primera línea deben ser los títulos de las columnas y debajo las filas' };
    }

    const mapping = Array.isArray(body.mapping)
      ? sanitizeMapping(body.mapping, type.fields || [])
      : suggestMapping(parsed.headers, type.fields || []);
    const built = buildImportRows({ rows: parsed.rows, mapping, fields: type.fields || [] });
    return { type, parsed, mapping, built };
  }

  // ── POST /api/portal/entities/import/preview ── analiza SIN escribir ──────
  // { type, csv, mapping? } → columnas detectadas + mapeo sugerido (o el del
  // dueño revalidado) + muestra de filas + conteos. Cambiar un select en el
  // paso 2 re-llama aquí con el mapeo nuevo: la validación siempre es del
  // servidor, la UI jamás inventa conteos.
  app.post('/api/portal/entities/import/preview', portalAuth, async (req, res) => {
    try {
      const p = await _entityImportPrepare(req);
      if (p.error) return res.status(p.status).json({ error: p.error });
      const { MAX_IMPORT_ROWS } = require('../entities/entity-import');

      res.json({
        ok: true,
        type:         p.type.key,
        headers:      p.parsed.headers,
        mapping:      p.mapping,
        totalRows:    p.parsed.rows.length,
        maxRows:      MAX_IMPORT_ROWS,
        ready:        p.built.rows.length,
        drafts:       p.built.rows.filter(r => r.isDraft).length,
        withPhone:    p.built.rows.filter(r => r.phone).length,
        skipped:      p.built.skipped.slice(0, 20),
        skippedCount: p.built.skipped.length,
        truncated:    p.built.truncated,
        sample:       p.built.rows.slice(0, 5).map(r => ({
          row: r.row, attrs: r.attrs, phone: r.phone, contactName: r.contactName, isDraft: r.isDraft,
        })),
      });
    } catch (e) {
      log.error('POST entities import preview', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/portal/entities/import/commit ── crea las fichas en bloque ──
  // { type, csv, mapping } → contactos por teléfono (vincula existentes por
  // variantes; crea los que faltan — sin dueño no hay a quién avisar), fichas
  // en chunks, eventos 'created' en bloque y avisos re-materializados en
  // background. Devuelve { created, linked, contactsCreated, drafts, skipped }.
  app.post('/api/portal/entities/import/commit', portalAuth, async (req, res) => {
    try {
      const p = await _entityImportPrepare(req);
      if (p.error) return res.status(p.status).json({ error: p.error });
      const { type, built } = p;
      if (!built.rows.length) {
        return res.status(400).json({
          error: 'Ninguna fila válida para importar — revisa el mapeo de columnas',
          skipped: built.skipped.slice(0, 20), skippedCount: built.skipped.length,
        });
      }

      const db = getDatabase();
      if (!db.enabled) return res.status(503).json({ error: 'BD no disponible' });
      const orgId = req.businessId;
      const { phoneVariants, normalizePhone } = require('../utils/phone');
      const { computeDisplayName } = require('../entities/entities');

      // 1) Vincular dueños EXISTENTES por variantes de teléfono (+34/nacional/
      //    espacios) — mismo criterio que la importación de clientes.
      const contactIdByKey = new Map();
      const withPhone = built.rows.filter(r => r.phone);
      const uniqPhones = [...new Map(withPhone.map(r => [normalizePhone(r.phone), r.phone])).entries()]
        .filter(([k]) => k);
      const PHONE_CHUNK = 40;
      for (let i = 0; i < uniqPhones.length; i += PHONE_CHUNK) {
        const chunk = uniqPhones.slice(i, i + PHONE_CHUNK);
        const variants = [...new Set(chunk.flatMap(([, phone]) => phoneVariants(phone)))];
        if (!variants.length) continue;
        try {
          const { data } = await db.client.from('contacts')
            .select('id, phone').eq('org_id', orgId).in('phone', variants);
          for (const c of (data || [])) {
            const k = normalizePhone(c.phone);
            if (k && !contactIdByKey.has(k)) contactIdByKey.set(k, c.id);
          }
        } catch (e) { log.warn(`entity import: lookup contactos falló: ${e.message}`); }
      }

      // 2) Crear los contactos que FALTAN (dedupe por teléfono normalizado):
      //    la promesa es "avisando solos" — sin contacto no hay aviso.
      let contactsCreated = 0;
      const toCreate = new Map();   // key normalizado → fila de contacts
      for (const r of withPhone) {
        const k = normalizePhone(r.phone);
        if (!k || contactIdByKey.has(k) || toCreate.has(k)) continue;
        toCreate.set(k, { org_id: orgId, phone: r.phone, name: r.contactName || null, call_count: 0 });
      }
      const newContacts = [...toCreate.values()];
      const INSERT_CHUNK = 200;
      for (let i = 0; i < newContacts.length; i += INSERT_CHUNK) {
        const chunk = newContacts.slice(i, i + INSERT_CHUNK);
        try {
          const { data, error } = await db.client.from('contacts').insert(chunk).select('id, phone');
          if (error) throw new Error(error.message);
          for (const c of (data || [])) {
            const k = normalizePhone(c.phone);
            if (k) contactIdByKey.set(k, c.id);
          }
          contactsCreated += (data || []).length;
        } catch (e) { log.warn(`entity import: alta de contactos falló: ${e.message}`); }
      }

      // 2b) UPSERT por identificador: si la plantilla tiene identificador
      //     natural (matrícula, nº de póliza…), indexamos las fichas vivas
      //     por su valor normalizado y las filas que casan ACTUALIZAN en vez
      //     de insertar — reimportar el mismo Excel ya no duplica.
      const { identifierField } = require('../entities/entity-types');
      const { resolveImportActions } = require('../entities/entity-import');
      const { normalizeIdentifier, updateEntity } = require('../entities/entities');
      const skipped = [...built.skipped];
      const idField = identifierField(type);
      let existingIndex = null;
      if (idField) {
        existingIndex = new Map();
        const PAGE = 1000, MAX_SCAN = 10000;
        for (let from = 0; from < MAX_SCAN; from += PAGE) {
          const { data, error } = await db.client.from('nf_entities')
            .select('id, contact_id, attrs')
            .eq('organization_id', orgId)
            .eq('entity_type_id', type.id)
            .eq('is_archived', false)
            .range(from, from + PAGE - 1);
          if (error) { log.warn(`entity import: índice de identificadores falló: ${error.message}`); break; }
          for (const en of (data || [])) {
            const k = normalizeIdentifier((en.attrs || {})[idField.key]);
            if (k && !existingIndex.has(k)) existingIndex.set(k, en);
          }
          if (!data || data.length < PAGE) break;
        }
      }
      const actions = resolveImportActions({ rows: built.rows, idField, existingIndex });
      skipped.push(...actions.skipped);

      // 3) Fichas NUEVAS en chunks (display_name desnormalizado al escribir,
      //    como createEntity — attrs YA validados por buildImportRows).
      const created = [];
      const ENT_CHUNK = 100;
      for (let i = 0; i < actions.inserts.length; i += ENT_CHUNK) {
        const chunk = actions.inserts.slice(i, i + ENT_CHUNK);
        const payload = chunk.map(r => ({
          organization_id: orgId,
          entity_type_id:  type.id,
          contact_id:      (r.phone && contactIdByKey.get(normalizePhone(r.phone))) || null,
          display_name:    computeDisplayName(type.label_template, r.attrs, type.label_singular),
          attrs:           r.attrs,
        }));
        try {
          const { data, error } = await db.client.from('nf_entities')
            .insert(payload).select('id, contact_id, display_name, attrs');
          if (error) throw new Error(error.message);
          created.push(...(data || []));
        } catch (e) {
          for (const r of chunk) skipped.push({ row: r.row, reason: `Error al guardar: ${e.message}` });
        }
      }

      // 3b) Fichas EXISTENTES: merge de attrs (lo importado GANA), display_name
      //     recomputado, evento 'field_change' con el diff y is_draft que se
      //     apaga solo si el merge completa los required — todo vía
      //     updateEntity (mismas reglas que un PATCH manual). El vínculo con
      //     el dueño solo se toca si el Excel trae teléfono.
      const updated = [];
      const UPD_CONC = 10;
      for (let i = 0; i < actions.updates.length; i += UPD_CONC) {
        const batch = actions.updates.slice(i, i + UPD_CONC);
        await Promise.all(batch.map(async ({ row, entity }) => {
          const attrs = { ...row.attrs };
          delete attrs.is_draft;   // en un update decide el merge, no la fila
          const contactId = (row.phone && contactIdByKey.get(normalizePhone(row.phone))) || undefined;
          try {
            const r2 = await updateEntity({
              orgId, entityType: type, entityId: entity.id, attrs, contactId, actor: 'staff',
            });
            if (r2.ok) updated.push(r2.entity);
            else skipped.push({ row: row.row, reason: `Error al actualizar: ${(r2.errors && r2.errors[0] && r2.errors[0].error) || r2.error || 'desconocido'}` });
          } catch (e) {
            skipped.push({ row: row.row, reason: `Error al actualizar: ${e.message}` });
          }
        }));
      }

      // 4) Evento 'created' en bloque (best effort: el timeline de cada ficha
      //    cuenta de dónde salió; si falla, la importación NO se cae).
      for (let i = 0; i < created.length; i += INSERT_CHUNK) {
        const chunk = created.slice(i, i + INSERT_CHUNK);
        await db.client.from('nf_entity_events').insert(chunk.map(en => ({
          organization_id: orgId,
          entity_id:       en.id,
          kind:            'created',
          title:           `${type.label_singular} importado: ${en.display_name}`,
          properties:      { imported: true },
          actor:           'staff',
        }))).then(undefined, e => log.warn(`entity import: eventos no registrados: ${e.message}`));
      }

      // 5) Avisos 🔔 en background — el "avisando solos en 5 minutos": las
      //    fichas con dueño y fecha materializan YA, no a la noche. Secuencial
      //    y best effort (la pasada nocturna recoge lo que falle). Las
      //    actualizadas también: el Excel pudo traer fechas nuevas.
      const withOwner = [...created, ...updated].filter(en => en.contact_id);
      if (withOwner.length) {
        setImmediate(async () => {
          try {
            const { syncEntityRemindersNow } = require('../entities/entity-reminders');
            for (const en of withOwner) {
              await syncEntityRemindersNow({ orgId, entityType: type, entity: en }).catch(() => {});
            }
          } catch (_) {}
        });
      }

      const linked = withOwner.length;
      log.info(`Importación de entidades (${orgId}): ${created.length} nuevas + ${updated.length} actualizadas (${linked} con dueño, ${contactsCreated} contactos nuevos), ${skipped.length} saltadas`);
      res.json({
        ok: true,
        created:         created.length,
        updated:         updated.length,   // «actualizadas»: ya existían por identificador
        linked,
        contactsCreated,
        drafts:          actions.inserts.filter(r => r.isDraft).length,
        skipped:         skipped.slice(0, 50),
        skippedCount:    skipped.length,
        truncated:       built.truncated,
      });
    } catch (e) {
      log.error('POST entities import commit', { error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

} // end setupPortalRoutes

module.exports = { setupPortalRoutes, portalAuth };
