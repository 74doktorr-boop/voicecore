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
const { getKnowledgeBase } = require('../knowledge/base');
const { normalizePhone } = require('../utils/phone');

const log = new Logger('ROUTES-PORTAL');

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
    });
  });

  // ── GET /api/portal/knowledge/unanswered ─────────────────────
  // Preguntas que el asistente no supo responder (últimos 30 días),
  // agregadas por frecuencia. Fuente: transcript-analyzer →
  // call_summaries.extracted_data._unanswered. Cero migraciones.
  app.get('/api/portal/knowledge/unanswered', portalAuth, async (req, res) => {
    const { businessId } = req;
    const db = getDatabase();
    if (!db.enabled) return res.json({ ok: true, questions: [] });
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await db.client
        .from('call_summaries')
        .select('extracted_data, created_at')
        .eq('org_id', businessId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw new Error(error.message);

      const agg = new Map();
      for (const row of (data || [])) {
        const qs = row.extracted_data && Array.isArray(row.extracted_data._unanswered)
          ? row.extracted_data._unanswered : [];
        for (const q of qs) {
          if (typeof q !== 'string' || !q.trim()) continue;
          const key = q.trim().toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[¿?¡!.,]/g, '').replace(/\s+/g, ' ').trim();
          if (key.length < 6) continue;
          const cur = agg.get(key) || { question: q.trim(), count: 0, lastAt: row.created_at };
          cur.count += 1;
          if (row.created_at > cur.lastAt) { cur.lastAt = row.created_at; cur.question = q.trim(); }
          agg.set(key, cur);
        }
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

    const allowed = ['patientName', 'phone', 'email', 'service', 'date', 'time', 'notes'];
    for (const field of allowed) {
      if (req.body[field] !== undefined) apt[field] = req.body[field];
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

    res.json({ ok: true });
  });

  // ── GET /api/portal/reports ───────────────────────────────
  app.get('/api/portal/reports', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const period  = req.query.period || 'month';
    const days    = period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
    const fromTs  = Date.now() - days * 86400000;
    const fromStr = new Date(fromTs).toISOString().slice(0, 10);

    // Fuente de verdad: nf_calls. Los informes salían de la memoria del
    // proceso (borrada en cada deploy) → "1 llamada" tras una noche de
    // pruebas. Fallback a memoria solo si la BD está caída.
    let bizCalls;
    const db = getDatabase();
    if (db.enabled) {
      try {
        const { data, error } = await db.client.from('nf_calls')
          .select('outcome, started_at, ended_at')
          .eq('org_id', businessId)
          .order('started_at', { ascending: false })
          .limit(2000);
        if (error) throw new Error(error.message);
        bizCalls = (data || []).map(c => ({
          outcome: c.outcome, startTime: c.started_at, endTime: c.ended_at,
        }));
      } catch (e) {
        log.warn(`portal reports desde nf_calls falló (${e.message}) — fallback memoria`);
      }
    }
    if (!bizCalls) {
      bizCalls = pipeline.getCallHistory(500)
        .filter(c => (c.businessId || c.assistantId) === businessId);
    }

    // Period calls
    // BUG-30 FIX: same field name issue — use endTime/startTime from toJSON()
    const periodCalls = bizCalls.filter(c => (c.endTime || c.startTime || '') >= fromStr);
    const totalCalls  = periodCalls.length;
    const bookings    = periodCalls.filter(c => c.outcome === 'booked').length;
    const convRate    = totalCalls > 0 ? Math.round((bookings / totalCalls) * 100) : 0;
    const hoursSaved  = Math.round((totalCalls * 4) / 60 * 10) / 10;
    const avgTicket   = flowConfig.automations?.config?.avgTicket || 35;
    const revenueEst  = bookings * avgTicket;

    // Calls by day-of-week
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const callsByDow = Array(7).fill(0);
    for (const c of periodCalls) {
      // Día de la semana en MADRID (no en el huso del servidor UTC): una llamada de
      // madrugada podía caer en el día anterior y descuadrar el gráfico del portal.
      const d = new Date(new Date(c.endTime || c.startTime || Date.now())
        .toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
      callsByDow[d.getDay()]++;
    }
    const callsByDayOfWeek = DOW_LABELS.map((label, i) => ({ label, value: callsByDow[i] }));

    // All-time stats
    const allTotal    = bizCalls.length;
    const allBookings = bizCalls.filter(c => c.outcome === 'booked').length;
    const allHours    = Math.round((allTotal * 4) / 60 * 10) / 10;
    const allRevenue  = allBookings * avgTicket;

    res.json({
      ok: true,
      period,
      summary: { totalCalls, bookings, convRate, hoursSaved, revenueEst },
      callsByDayOfWeek,
      allTime: { totalCalls: allTotal, bookings: allBookings, hoursSaved: allHours, revenueEst: allRevenue },
    });
  });

  // ── GET /api/portal/automations ───────────────────────────
  app.get('/api/portal/automations', portalAuth, (req, res) => {
    const { flowConfig } = req;
    res.json({ ok: true, automations: flowConfig.automations || {} });
  });

  // ── PATCH /api/portal/automations ────────────────────────
  app.patch('/api/portal/automations', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { reminders, reviews, waConfirm, rebooking, noshow } = req.body;

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
    // Número asignado: nf_phone_pool/BD = fuente de verdad. La config en
    // memoria (flowManager) no ve asignaciones recientes → Configuración
    // decía "pendiente de asignación" con el número asignado y operativo
    // (caso real 2026-07-03; mismo fix que ya llevaba el dashboard).
    let outboundNumber = custom.outboundNumber || custom.nodeflowNumber || '';
    if (!outboundNumber) {
      try {
        const db = getDatabase();
        if (db.enabled) {
          const { data: orgRow } = await db.client.from('organizations')
            .select('automation_config').eq('id', businessId).maybeSingle();
          const dbCustom = orgRow?.automation_config?.config || {};
          outboundNumber = dbCustom.outboundNumber || dbCustom.nodeflowNumber || '';
          if (!outboundNumber) {
            const { data: poolRow } = await db.client
              .from('nf_phone_pool').select('phone_number')
              .eq('org_id', businessId).eq('status', 'assigned')
              .limit(1).maybeSingle();
            if (poolRow) outboundNumber = poolRow.phone_number;
          }
        }
      } catch (_) { /* fail-open */ }
    }
    res.json({
      ok: true,
      config: {
        name:           flowConfig.name        || '',
        ownerEmail:     flowConfig.ownerEmail  || '',
        phone:          flowConfig.ownerPhone  || '',
        language:       flowConfig.language    || 'es',
        sector:         flowConfig.sector      || custom.sector || '',
        plan:           flowConfig.plan        || '',
        avgTicket:      custom.avgTicket       || 35,
        welcomeMessage: custom.welcomeMessage  || '',
        services:       custom.services        || '',
        schedule:       custom.schedule        || '',
        reviewUrl:      custom.reviewUrl       || '',
        outboundNumber: outboundNumber,                 // assigned by admin — read-only for portal users
        alertPhone:     custom.alertPhone      || '',   // teléfono personal dueño para alertas WA
        notifyEmail:    custom.notifyEmail     || flowConfig.ownerEmail || '',
        address:        custom.address         || '',
        serviceList:    Array.isArray(custom.serviceList) ? custom.serviceList : [],
      },
    });
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
    flow.automations.config = {
      ...existingCustom,
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
        const mergedAuto = { ...baseAuto, config: { ...(baseAuto.config || {}), ...(flow.automations.config || {}) } };
        const dbUpdate = { automation_config: mergedAuto };
        if (name)     dbUpdate.name     = name;
        if (language) dbUpdate.language = language;
        // 'sector' NO es columna de organizations. Vive en assistant_config.sector,
        // que es de donde lo leen el ASISTENTE, el AUDITOR y los recordatorios (7
        // lectores). Este form lo escribía SOLO en automation_config.config.sector
        // → nunca llegaba al auditor: todo salía 'genérico' y el aprendizaje por
        // vertical no podía agrupar. Se escribe en la ubicación canónica.
        if (sector) dbUpdate.assistant_config = { ...((cur && cur.assistant_config) || {}), sector };
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
        welcomeMessage: custom.welcomeMessage  || '',
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

  // GET /api/portal/tasks — pendientes primero (por fecha), luego completadas
  app.get('/api/portal/tasks', portalAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ tasks: [] });
    const { data, error } = await db.client
      .from('nf_tasks')
      .select('id, contact_id, contact_name, title, due_date, done, created_at')
      .eq('organization_id', req.businessId)
      .order('done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, tasks: data || [] });
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
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    try {
      const { data } = await db.client
        .from('nf_calls')
        .select('caller_number, outcome, started_at, duration_ms')
        .eq('org_id', req.businessId)
        .gte('started_at', since)
        .neq('outcome', 'booked')
        .order('started_at', { ascending: false })
        .limit(300);

      // Excluir a quien YA reservó (en una llamada posterior) o tiene cita próxima.
      const excluded = await _excludedRecoveryPhones(db, req.businessId, since);
      // Agrupar por número: nos quedamos con la llamada más reciente de cada uno
      const byPhone = {};
      for (const c of (data || [])) {
        if (!c.caller_number) continue;
        if (excluded.has(normalizePhone(c.caller_number))) continue;
        if (!byPhone[c.caller_number]) byPhone[c.caller_number] = { phone: c.caller_number, lastCall: c.started_at, count: 0, lastOutcome: c.outcome };
        byPhone[c.caller_number].count++;
      }
      const opportunities = Object.values(byPhone)
        .sort((a, b) => new Date(b.lastCall) - new Date(a.lastCall))
        .slice(0, 100);
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
      },
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
        .select('name, assistant_config')
        .eq('id', businessId)
        .single();
      res.json({ config: data?.assistant_config || {}, orgName: data?.name || '' });
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
      if (!sectorData || typeof sectorData !== 'object') return res.status(400).json({ error: 'sectorData object required' });

      const { error } = await db.client.from('contacts')
        .update({ sector_data: sectorData })
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

      await scheduleReminder({
        orgId:        req.businessId,
        contactId:    existing.contact_id,
        serviceKey:   existing.service_key,
        scheduledFor: new Date(Date.now() + 5000), // 5 seconds from now
        channel:      existing.channel,
      });

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
      const items = await getCandidates(req.businessId, { bizName: req.flowConfig.name });
      res.json({ ok: true, followups: items });
    } catch (e) { log.warn(`followups list: ${e.message}`); res.json({ ok: true, followups: [] }); }
  });

  // Marca un seguimiento como HECHO (tras abrir el enlace wa.me, o al descartar).
  // Body opcional: { channel: 'wa_link' | 'dismissed' }
  app.post('/api/portal/followups/:callId/done', portalAuth, async (req, res) => {
    try {
      const { markDone } = require('../lifecycle/followups');
      const r = await markDone(req.params.callId, req.businessId);
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
      const message = String(req.body && req.body.message || '').trim().slice(0, 1000);
      if (!message) return res.status(400).json({ error: 'Mensaje vacío' });

      const db = getDatabase();
      // Recupera la llamada (para el teléfono) y valida propiedad.
      const { data: call } = await db.client.from('nf_calls')
        .select('id, caller_number, followup_sent').eq('id', req.params.callId)
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
      await markDone(req.params.callId, req.businessId);
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
      res.json({
        ok: true,
        sector,
        sectorLabel: (SECTOR_CATALOG[sector] && SECTOR_CATALOG[sector].label) || null,
        rules: buildRulesView(sector, orgConfig),
        channels: CHANNELS,
        customTriggers: CUSTOM_TRIGGERS.map(t => ({ value: t, label: TRIGGERS[t] })),
      });
    } catch (e) { log.warn(`followup-rules get: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  app.put('/api/portal/followup-rules', portalAuth, async (req, res) => {
    try {
      const { saveRules } = require('../lifecycle/followup-rules');
      const sector = await _resolveOrgSector(req.businessId);
      const r = await saveRules(req.businessId, sector, req.body || {}, { db: getDatabase() });
      if (r.error) return res.status(400).json({ error: r.error });
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

} // end setupPortalRoutes

module.exports = { setupPortalRoutes, portalAuth };
