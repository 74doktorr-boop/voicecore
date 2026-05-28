# Portal de Negocio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-featured business portal with sidebar navigation, 6 sections (Dashboard, Llamadas, Citas, Informes, Automatizaciones, Configuración), mobile-first, and complete management capabilities.

**Architecture:** Extend the existing portal: rewrite `public/portal/index.html` with a sidebar layout, extract all JS to a new `public/portal/portal.js`, and add a new `src/api/routes-portal.js` with 11 API endpoints all protected by session JWT. `businessId` is resolved server-side by matching `session.email` against `flowManager.list()` entries.

**Tech Stack:** Node.js/Express, Vanilla JS, CSS custom properties, existing session JWT (`verifySessionToken` from `routes-auth.js`), `flowManager` singleton, `scheduler` singleton, `VoicePipeline` instance passed as parameter.

**Spec:** `docs/superpowers/specs/2026-05-28-portal-negocio-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/api/routes-portal.js` | `portalAuth` middleware + all 11 API endpoints |
| Modify | `server.js` | Mount `setupPortalRoutes(app, pipeline)` |
| Rewrite | `public/portal/index.html` | Sidebar layout HTML + CSS (all JS removed, loads portal.js) |
| Create | `public/portal/portal.js` | Auth flow, section routing, data fetching, DOM rendering, mobile sidebar, modals, toasts |

---

## Task 1: routes-portal.js — Skeleton + portalAuth middleware + GET /api/portal/dashboard

**Files:**
- Create: `src/api/routes-portal.js`

**Context you need:**
- `verifySessionToken(token)` is in `src/api/routes-auth.js`, throws on invalid/expired
- `flowManager.list()` returns `[{ businessId, name, ownerEmail, ownerPhone, plan, sector, language, automations, registeredAt }]`
- `pipeline.getCallHistory(n)` returns last N calls; each call has `{ businessId, outcome, bookedAppointment, clientEmail, endedAt, startedAt, duration, callId }`
- `scheduler.getAppointments(businessId)` returns all appointments: `{ id, businessId, patientName, phone, email, service, date, time, duration, price, status, createdAt }`
- DB query fallback needed: if `flowManager` hasn't loaded the business yet, look up `organizations` table by `owner_email`

- [ ] **Step 1: Create the file with portalAuth middleware**

```js
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

const log = new Logger('ROUTES-PORTAL');

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
  let businessId   = null;
  let flowConfig   = null;

  const inMemory = flowManager.list().find(f => f.ownerEmail === session.email);
  if (inMemory) {
    businessId = inMemory.businessId;
    flowConfig = inMemory;
  } else {
    const db = getDatabase();
    if (db.enabled) {
      try {
        const { data } = await db.client
          .from('organizations')
          .select('id, name, owner_email, phone, plan, sector, language, automation_config, registered_at, created_at')
          .eq('owner_email', session.email.toLowerCase())
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) {
          businessId = data.id;
          flowConfig = {
            businessId:   data.id,
            name:         data.name,
            ownerEmail:   data.owner_email,
            ownerPhone:   data.phone,
            plan:         data.plan,
            sector:       data.sector,
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
function setupPortalRoutes(app, pipeline) {

  // GET /api/portal/dashboard
  // Returns KPIs for today, next 5 appointments, recent AI activity
  app.get('/api/portal/dashboard', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;

    const todayStr  = new Date().toISOString().slice(0, 10);
    const allCalls  = pipeline.getCallHistory(500);
    const bizCalls  = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);
    const todayCalls = bizCalls.filter(c => (c.endedAt || c.startedAt || '').startsWith(todayStr));

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
          : `Llamada no completada`,
      time: c.endedAt || c.startedAt || null,
    }));

    const registeredAt   = flowConfig.registeredAt || null;
    const daysActive     = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86400000)
      : 0;

    res.json({
      businessName: flowConfig.name,
      plan:         flowConfig.plan,
      daysActive,
      aiStatus: 'active',
      today: { callCount, bookedToday, convRate, emailsSent, hoursSaved },
      upcoming,
      recentActivity,
    });
  });

} // end setupPortalRoutes

module.exports = { setupPortalRoutes };
```

- [ ] **Step 2: Verify the file parses without syntax errors**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): routes-portal.js skeleton + portalAuth + dashboard endpoint"
```

---

## Task 2: GET /api/portal/calls

**Files:**
- Modify: `src/api/routes-portal.js` (add inside `setupPortalRoutes`, before closing `}`)

**Context:** Calls have `outcome: 'booked' | 'info' | 'abandoned'`. `endedAt` and `startedAt` are ISO strings. Duration is in seconds.

- [ ] **Step 1: Add the calls endpoint inside `setupPortalRoutes`, just before the closing `}` of that function**

```js
  // GET /api/portal/calls?from=YYYY-MM-DD&to=YYYY-MM-DD&outcome=booked|info|abandoned
  app.get('/api/portal/calls', portalAuth, (req, res) => {
    const { businessId } = req;
    const { from, to, outcome } = req.query;

    let calls = pipeline.getCallHistory(500)
      .filter(c => (c.businessId || c.assistantId) === businessId);

    if (from) {
      calls = calls.filter(c => (c.endedAt || c.startedAt || '') >= from);
    }
    if (to) {
      const toEnd = to + 'T23:59:59';
      calls = calls.filter(c => (c.endedAt || c.startedAt || '') <= toEnd);
    }
    if (outcome && ['booked', 'info', 'abandoned'].includes(outcome)) {
      calls = calls.filter(c => c.outcome === outcome);
    }

    const formatted = calls.map(c => ({
      callId:      c.callId,
      startedAt:   c.startedAt,
      endedAt:     c.endedAt,
      duration:    c.duration || 0,              // seconds
      outcome:     c.outcome || 'abandoned',
      clientEmail: c.clientEmail || null,
      appointment: c.bookedAppointment || null,
      turnCount:   c.turnCount || 0,
    }));

    res.json({ ok: true, count: formatted.length, calls: formatted });
  });
```

- [ ] **Step 2: Verify no syntax error**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): GET /api/portal/calls with date+outcome filters"
```

---

## Task 3: Appointments CRUD (4 endpoints)

**Files:**
- Modify: `src/api/routes-portal.js`

**Context:**
- `scheduler.getAppointments(businessId)` returns all appointments
- `scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time })` returns `{ success, appointment, error }`
- `scheduler.cancelAppointment(id, patientName, businessId)` — sets `status: 'cancelled'`
- To edit: directly mutate the appointment object in `scheduler.appointments` Map (there's no `updateAppointment` method; we patch the object in place)

- [ ] **Step 1: Add all 4 appointment endpoints inside `setupPortalRoutes`, just before the closing `}`**

```js
  // GET /api/portal/appointments
  app.get('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const appointments = scheduler.getAppointments(businessId)
      .sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
    res.json({ ok: true, count: appointments.length, appointments });
  });

  // POST /api/portal/appointments
  app.post('/api/portal/appointments', portalAuth, (req, res) => {
    const { businessId } = req;
    const { patientName, phone, email, service, date, time } = req.body;
    if (!patientName || !service || !date || !time) {
      return res.status(400).json({ error: 'patientName, service, date y time son obligatorios' });
    }
    const result = scheduler.bookAppointment(businessId, { patientName, phone, email, service, date, time });
    if (!result.success) return res.status(409).json({ error: result.error });
    log.info(`Portal: appointment created ${result.appointment.id} for ${patientName}`);
    res.json({ ok: true, appointment: result.appointment });
  });

  // PATCH /api/portal/appointments/:id
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
    res.json({ ok: true, appointment: apt });
  });

  // DELETE /api/portal/appointments/:id
  // Soft-cancel: sets status='cancelled', keeps the record
  app.delete('/api/portal/appointments/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const apt = scheduler.appointments.get(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (apt.businessId !== businessId) return res.status(403).json({ error: 'Acceso denegado' });
    if (apt.status === 'cancelled') return res.status(409).json({ error: 'La cita ya estaba cancelada' });

    apt.status     = 'cancelled';
    apt.cancelledAt = new Date().toISOString();

    // Send cancellation email if client email is present (fire-and-forget)
    if (apt.email) {
      try {
        const { sendEmail } = require('../notifications/email');
        const { flowConfig } = req;
        sendEmail({
          to:      apt.email,
          subject: `Cita cancelada — ${flowConfig.name}`,
          html:    `<p>Hola ${apt.patientName}, tu cita del ${apt.date} a las ${apt.time} ha sido cancelada.</p><p>Contacta con nosotros si quieres reagendar.</p>`,
        }).catch(() => {});
      } catch (_) {}
    }

    log.info(`Portal: appointment cancelled ${apt.id}`);
    res.json({ ok: true });
  });
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): appointments CRUD endpoints (GET/POST/PATCH/DELETE)"
```

---

## Task 4: GET /api/portal/reports

**Files:**
- Modify: `src/api/routes-portal.js`

**Context:** Reports aggregate call history. `period` query param: `week` (last 7 days), `month` (last 30 days), `quarter` (last 90 days). `avgTicket` comes from `flowConfig.automations?.config?.avgTicket || 35`.

- [ ] **Step 1: Add reports endpoint inside `setupPortalRoutes`, just before the closing `}`**

```js
  // GET /api/portal/reports?period=week|month|quarter
  app.get('/api/portal/reports', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;
    const period  = req.query.period || 'month';
    const days    = period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
    const fromTs  = Date.now() - days * 86400000;
    const fromStr = new Date(fromTs).toISOString().slice(0, 10);

    const allCalls = pipeline.getCallHistory(500);
    const bizCalls = allCalls.filter(c => (c.businessId || c.assistantId) === businessId);

    // Period calls
    const periodCalls = bizCalls.filter(c => (c.endedAt || c.startedAt || '') >= fromStr);
    const totalCalls  = periodCalls.length;
    const bookings    = periodCalls.filter(c => c.outcome === 'booked').length;
    const convRate    = totalCalls > 0 ? Math.round((bookings / totalCalls) * 100) : 0;
    const hoursSaved  = Math.round((totalCalls * 4) / 60 * 10) / 10;
    const avgTicket   = flowConfig.automations?.config?.avgTicket || 35;
    const revenueEst  = bookings * avgTicket;

    // Calls by day-of-week (0=Sun..6=Sat), label as Mon..Sun
    const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const callsByDow = Array(7).fill(0);
    for (const c of periodCalls) {
      const d = new Date(c.endedAt || c.startedAt || Date.now());
      callsByDow[d.getDay()]++;
    }
    const callsByDayOfWeek = DOW_LABELS.map((label, i) => ({ label, value: callsByDow[i] }));

    // All-time stats (everything in callHistory for this business)
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
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): GET /api/portal/reports with period aggregation"
```

---

## Task 5: Automations endpoints

**Files:**
- Modify: `src/api/routes-portal.js`

**Context:**
- `flowManager.patch(businessId, { automations: {...} })` updates in-memory
- `flowManager.saveToDB(businessId)` persists `automation_config` to Supabase `organizations` table
- Automations config: `{ reminders: { enabled, hoursBefore }, reviews: { enabled, hoursAfter }, waConfirm: { enabled }, rebooking: { enabled, daysThreshold, maxPerYear } }`
- `criticalDatesStore` from `src/scheduling/critical-dates.js` — the portal uses existing `/api/critical-dates/:businessId` routes for the critical dates sub-list

- [ ] **Step 1: Add automations endpoints inside `setupPortalRoutes`, just before the closing `}`**

```js
  // GET /api/portal/automations
  app.get('/api/portal/automations', portalAuth, (req, res) => {
    const { businessId, flowConfig } = req;
    res.json({
      ok: true,
      automations: flowConfig.automations || {},
    });
  });

  // PATCH /api/portal/automations
  // Body: any subset of { reminders, reviews, waConfirm, rebooking }
  // Each sub-object merges (not replaces) with existing config
  app.patch('/api/portal/automations', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { reminders, reviews, waConfirm, rebooking } = req.body;

    const patch = {};
    if (reminders !== undefined) patch.reminders = reminders;
    if (reviews   !== undefined) patch.reviews   = reviews;
    if (waConfirm !== undefined) patch.waConfirm = waConfirm;
    if (rebooking !== undefined) patch.rebooking = rebooking;

    const updated = flowManager.patch(businessId, { automations: patch });
    if (!updated) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });

    // Persist to DB (non-blocking if it fails — memory state is already updated)
    flowManager.saveToDB(businessId).catch(e =>
      log.warn(`Portal: automations DB save failed for ${businessId}: ${e.message}`)
    );

    log.info(`Portal: automations updated for ${businessId}`);
    res.json({ ok: true, automations: updated.automations });
  });
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): GET + PATCH /api/portal/automations"
```

---

## Task 6: Config endpoints

**Files:**
- Modify: `src/api/routes-portal.js`

**Context:**
- Editable fields: `name`, `language`, `sector`, `avgTicket`, `welcomeMessage`, `services`, `schedule`
- `name`, `language` are top-level on organizations table → update via Supabase directly
- `avgTicket`, `welcomeMessage`, `services`, `schedule`, `sector` stored in `automation_config.config` JSONB (no schema change needed)
- `phone` is read-only (provisioned)
- `flowManager.patch(businessId, {...})` keeps in-memory up to date

- [ ] **Step 1: Add config endpoints inside `setupPortalRoutes`, just before the closing `}`**

```js
  // GET /api/portal/config
  app.get('/api/portal/config', portalAuth, (req, res) => {
    const { flowConfig } = req;
    const custom = flowConfig.automations?.config || {};
    res.json({
      ok: true,
      config: {
        name:           flowConfig.name           || '',
        ownerEmail:     flowConfig.ownerEmail      || '',
        phone:          flowConfig.ownerPhone      || '',   // read-only
        language:       flowConfig.language        || 'es',
        sector:         flowConfig.sector          || custom.sector || '',
        plan:           flowConfig.plan            || '',   // read-only
        avgTicket:      custom.avgTicket           || 35,
        welcomeMessage: custom.welcomeMessage      || '',
        services:       custom.services            || '',
        schedule:       custom.schedule            || '',
      },
    });
  });

  // PATCH /api/portal/config
  app.patch('/api/portal/config', portalAuth, async (req, res) => {
    const { businessId, flowConfig } = req;
    const { name, language, sector, avgTicket, welcomeMessage, services, schedule } = req.body;

    // Validate language
    if (language && !['es', 'eu', 'gl'].includes(language)) {
      return res.status(400).json({ error: "language debe ser 'es', 'eu' o 'gl'" });
    }

    // Update in-memory (top-level fields)
    const topLevelPatch = {};
    if (name)     topLevelPatch.name     = name;
    if (language) topLevelPatch.language = language;
    if (sector)   topLevelPatch.sector   = sector;

    // Merge custom config fields into automations.config
    const existingCustom = flowConfig.automations?.config || {};
    const newCustom = {
      ...existingCustom,
      ...(sector         !== undefined && { sector }),
      ...(avgTicket      !== undefined && { avgTicket: Number(avgTicket) }),
      ...(welcomeMessage !== undefined && { welcomeMessage }),
      ...(services       !== undefined && { services }),
      ...(schedule       !== undefined && { schedule }),
    };

    const updated = flowManager.patch(businessId, {
      ...topLevelPatch,
      automations: { config: newCustom },
    });
    if (!updated) return res.status(404).json({ error: 'Negocio no encontrado en FlowManager' });

    // Persist to DB
    const db = getDatabase();
    if (db.enabled) {
      try {
        const dbUpdate = { automation_config: updated.automations };
        if (name)     dbUpdate.name     = name;
        if (language) dbUpdate.language = language;
        await db.client.from('organizations').update(dbUpdate).eq('id', businessId);
      } catch (e) {
        log.warn(`Portal: config DB save failed for ${businessId}: ${e.message}`);
      }
    }

    const custom = updated.automations?.config || {};
    log.info(`Portal: config updated for ${businessId}`);
    res.json({
      ok: true,
      config: {
        name:           updated.name           || '',
        ownerEmail:     updated.ownerEmail     || '',
        phone:          updated.ownerPhone     || '',
        language:       updated.language       || 'es',
        sector:         updated.sector         || custom.sector || '',
        plan:           updated.plan           || '',
        avgTicket:      custom.avgTicket       || 35,
        welcomeMessage: custom.welcomeMessage  || '',
        services:       custom.services        || '',
        schedule:       custom.schedule        || '',
      },
    });
  });
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/api/routes-portal.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(portal): GET + PATCH /api/portal/config"
```

---

## Task 7: Mount routes in server.js + smoke tests

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add 2 lines to server.js — mount portal routes right after `setupAuthRoutes(app)`**

Find this line in server.js (around line 356):
```js
// Setup Auth routes (magic link portal access)
setupAuthRoutes(app);
```

Add immediately after it:
```js
// Setup Portal de Negocio routes (business dashboard, calls, citas, informes, config)
const { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
```

- [ ] **Step 2: Start the server and verify it boots cleanly**

```bash
node server.js
```

Expected: Server starts with no errors. You should see the normal startup log lines, plus no crash.

Stop the server with Ctrl+C after confirming it boots.

- [ ] **Step 3: Get a valid session token for testing**

If you have a magic link token in Supabase for a test user, exchange it:
```bash
curl -s "http://localhost:3000/api/auth/verify?token=YOUR_MAGIC_TOKEN" | jq '.session_token'
```

Save the returned token as `$TOKEN` for the smoke tests below.

If no magic token is available, you can test with the dev fallback by checking if the org `dev@nodeflow.es` is in flowManager. Alternatively, skip the curl tests and proceed — the auth middleware will be tested when the frontend is connected.

- [ ] **Step 4: Smoke test — dashboard endpoint (if token available)**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/portal/dashboard | jq '.'
```

Expected: `{ "businessName": "...", "daysActive": ..., "today": {...}, "upcoming": [...], "recentActivity": [...] }`

- [ ] **Step 5: Smoke test — calls endpoint**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/portal/calls | jq '.count'
```

Expected: A number (0 or more).

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(portal): mount setupPortalRoutes in server.js"
```

---

## Task 8: Rewrite public/portal/index.html

**Files:**
- Rewrite: `public/portal/index.html`

**What this does:** Replaces the current top-nav tab layout with a fixed sidebar layout. Login screen kept identical. All dynamic JS removed from this file (moved to `portal.js`). Section containers are empty shells filled by `portal.js`. Loads `portal.js` at the bottom.

- [ ] **Step 1: Read the current file to understand what CSS to preserve**

Read `public/portal/index.html` — note all CSS variables in `:root` and the button/badge/table/toggle/toast CSS rules. These will be preserved exactly.

- [ ] **Step 2: Rewrite the file**

Replace the entire contents of `public/portal/index.html` with:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mi Portal — NodeFlow</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="robots" content="noindex, nofollow">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:#07070e; --card:#0f0f18; --card2:#14141e;
      --accent:#6c5ce7; --accent-l:#a29bfe;
      --green:#00cec9; --green2:#00b894;
      --red:#e74c3c; --yellow:#f9ca24;
      --text:#e8e8f0; --dim:#8888a8; --muted:#3a3a52;
      --border:rgba(255,255,255,0.07);
      --radius:14px;
      --sidebar-w:220px;
    }
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:14px}

    /* ── Login ── */
    #loginScreen{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .login-card{background:var(--card2);border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:400px;text-align:center}
    .login-logo{font-size:22px;font-weight:900;margin-bottom:8px}
    .login-logo em{color:var(--accent-l);font-style:normal}
    .login-sub{font-size:13px;color:var(--dim);margin-bottom:28px}
    .login-input{width:100%;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:12px 16px;color:var(--text);font-size:14px;font-family:inherit;margin-bottom:10px;outline:none;transition:border-color .2s}
    .login-input:focus{border-color:var(--accent)}
    .login-btn{width:100%;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .2s;margin-top:4px}
    .login-btn:hover{background:#5a4bd1}
    .login-help{font-size:12px;color:var(--muted);margin-top:16px}
    .login-help a{color:var(--accent-l);text-decoration:none}

    /* ── App shell ── */
    #app{display:none}

    /* ── Hamburger (mobile only) ── */
    .hamburger{display:none;position:fixed;top:12px;left:12px;z-index:200;background:var(--card);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:8px;font-size:18px;cursor:pointer;align-items:center;justify-content:center;line-height:1}

    /* ── Backdrop ── */
    .backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:150}
    .backdrop.open{display:block}

    /* ── Sidebar ── */
    .sidebar{position:fixed;top:0;left:0;width:var(--sidebar-w);height:100vh;background:var(--card);border-right:1px solid var(--border);z-index:160;display:flex;flex-direction:column;overflow-y:auto}
    .sidebar-logo{padding:18px 16px 14px;border-bottom:1px solid var(--border)}
    .sidebar-logo-title{font-size:16px;font-weight:900}
    .sidebar-logo-title em{color:var(--accent-l);font-style:normal}
    .sidebar-biz{font-size:11px;color:var(--dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sidebar-nav{flex:1;padding:10px 8px}
    .nav-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--dim);transition:all .15s;margin-bottom:2px;user-select:none}
    .nav-item:hover{background:rgba(255,255,255,.04);color:var(--text)}
    .nav-item.active{background:rgba(108,92,231,.15);color:var(--accent-l)}
    .nav-icon{font-size:15px;line-height:1}
    .sidebar-footer{padding:12px}
    .plan-badge{background:rgba(108,92,231,.1);border:1px solid rgba(108,92,231,.2);border-radius:8px;padding:10px 12px;margin-bottom:8px}
    .plan-badge-name{font-size:10px;color:var(--accent-l);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .plan-badge-sub{font-size:10px;color:var(--dim);margin-top:2px}

    /* ── Main content ── */
    .main-content{margin-left:var(--sidebar-w);min-height:100vh;padding:28px}

    /* ── Sections ── */
    .section{display:none}
    .section.active{display:block}
    .section-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px}
    .section-title{font-size:20px;font-weight:800}

    /* ── Cards ── */
    .kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
    .kpi{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px}
    .kpi-label{font-size:11px;font-weight:700;letter-spacing:.6px;color:var(--dim);text-transform:uppercase;margin-bottom:6px}
    .kpi-val{font-size:26px;font-weight:900;letter-spacing:-1px}
    .kpi-sub{font-size:11px;color:var(--dim);margin-top:4px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:20px}
    .card-title{font-size:15px;font-weight:800;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}

    /* ── Tables ── */
    .table-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--border)}
    table{width:100%;border-collapse:collapse}
    thead th{background:var(--card2);padding:10px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--dim);text-transform:uppercase;white-space:nowrap}
    tbody tr:hover{background:rgba(255,255,255,0.025)}
    tbody td{padding:11px 14px;border-top:1px solid var(--border);font-size:13px;vertical-align:middle}
    .empty-row td{text-align:center;color:var(--dim);padding:32px;font-style:italic}

    /* ── Badges ── */
    .badge{display:inline-block;padding:3px 9px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.3px}
    .bg{background:rgba(0,206,201,.12);color:var(--green);border:1px solid rgba(0,206,201,.25)}
    .br{background:rgba(231,76,60,.12);color:#e74c3c;border:1px solid rgba(231,76,60,.2)}
    .by{background:rgba(249,202,36,.12);color:var(--yellow);border:1px solid rgba(249,202,36,.2)}
    .bp{background:rgba(108,92,231,.15);color:var(--accent-l);border:1px solid rgba(108,92,231,.3)}
    .bd{background:rgba(255,255,255,.05);color:var(--dim);border:1px solid var(--border)}
    .binfo{background:rgba(59,130,246,.12);color:#60a5fa;border:1px solid rgba(59,130,246,.25)}

    /* ── Buttons ── */
    .btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .2s}
    .btn-accent{background:var(--accent);color:#fff}.btn-accent:hover{background:#5a4bd1}
    .btn-g{background:rgba(0,184,148,.12);color:var(--green2);border:1px solid rgba(0,184,148,.25)}.btn-g:hover{background:rgba(0,184,148,.2)}
    .btn-r{background:rgba(231,76,60,.1);color:#e74c3c;border:1px solid rgba(231,76,60,.2)}.btn-r:hover{background:rgba(231,76,60,.18)}
    .btn-d{background:rgba(255,255,255,.05);color:var(--dim);border:1px solid var(--border)}.btn-d:hover{color:var(--text);border-color:var(--muted)}
    .btn:disabled{opacity:.5;cursor:default}
    .btn-sm{padding:5px 12px;font-size:12px}

    /* ── Toggle switch ── */
    .toggle{position:relative;display:inline-block;width:40px;height:22px}
    .toggle input{opacity:0;width:0;height:0}
    .slider{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,.1);border-radius:22px;transition:.2s}
    .slider:before{content:'';position:absolute;height:16px;width:16px;left:3px;bottom:3px;background:var(--dim);border-radius:50%;transition:.2s}
    input:checked+.slider{background:var(--green2)}
    input:checked+.slider:before{transform:translateX(18px);background:#fff}

    /* ── Automation cards ── */
    .auto-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
    .auto-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px}
    .auto-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
    .auto-name{font-size:14px;font-weight:700;margin-bottom:4px}
    .auto-desc{font-size:12px;color:var(--dim);line-height:1.4}
    .auto-footer{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
    .auto-label{font-size:12px;color:var(--dim)}
    .auto-hours input{width:60px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:13px;font-family:inherit}
    .auto-stat{font-size:11px;color:var(--muted);margin-top:8px}

    /* ── Form ── */
    .form-group{margin-bottom:16px}
    .form-label{display:block;font-size:12px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
    .form-input{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
    .form-input:focus{border-color:var(--accent)}
    .form-input[readonly]{opacity:.55;cursor:default}
    select.form-input option{background:var(--card2)}
    .form-section-title{font-size:13px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border)}

    /* ── Bar chart ── */
    .bar-chart{display:flex;align-items:flex-end;gap:8px;height:80px;padding-top:8px}
    .bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
    .bar{width:100%;background:rgba(108,92,231,.3);border-radius:4px 4px 0 0;min-height:4px;transition:background .2s}
    .bar:hover{background:rgba(108,92,231,.7)}
    .bar-label{font-size:10px;color:var(--dim)}
    .bar-val{font-size:10px;color:var(--dim)}

    /* ── Modal ── */
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:300;display:flex;align-items:center;justify-content:center;padding:20px}
    .modal-box{background:var(--card2);border:1px solid var(--border);border-radius:16px;padding:28px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto}
    .modal-title{font-size:16px;font-weight:800;margin-bottom:20px}
    .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:24px}

    /* ── Filter bar ── */
    .filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center}
    .filter-bar select,.filter-bar input[type=date]{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:13px;font-family:inherit}

    /* ── Toast ── */
    #toast{position:fixed;bottom:24px;right:24px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 18px;font-size:13px;font-weight:600;transform:translateY(80px);opacity:0;transition:all .3s;z-index:400;pointer-events:none}
    #toast.show{transform:translateY(0);opacity:1}
    #toast.ok{border-color:rgba(0,184,148,.4);color:var(--green2)}
    #toast.err{border-color:rgba(231,76,60,.4);color:#e74c3c}

    /* ── AI status chip ── */
    .ai-status{background:rgba(0,184,148,.1);border:1px solid rgba(0,184,148,.2);border-radius:6px;padding:4px 10px;font-size:11px;color:var(--green2);font-weight:700}

    /* ── Activity feed ── */
    .activity-list{display:flex;flex-direction:column;gap:8px}
    .activity-item{display:flex;gap:10px;align-items:flex-start}
    .activity-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;margin-top:2px}
    .activity-text{font-size:13px;color:var(--text)}
    .activity-time{font-size:11px;color:var(--dim);margin-top:2px}

    /* ── Critical dates list ── */
    .crit-item{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px}
    .crit-info{}
    .crit-name{font-size:13px;font-weight:600}
    .crit-meta{font-size:11px;color:var(--dim);margin-top:2px}
    .crit-date{font-size:12px;font-weight:700;text-align:right}
    .crit-days{font-size:11px;color:var(--dim);margin-top:2px}

    /* ── Empty state ── */
    .empty-state{text-align:center;padding:48px 24px;color:var(--dim)}
    .empty-state-icon{font-size:40px;margin-bottom:12px}
    .empty-state-text{font-size:14px;line-height:1.5}

    /* ── Mobile ── */
    @media (max-width:767px) {
      .hamburger{display:flex}
      .sidebar{left:calc(-1 * var(--sidebar-w));transition:left .25s}
      .sidebar.open{left:0}
      .main-content{margin-left:0;padding:16px;padding-top:56px}
      .two-col{grid-template-columns:1fr}
      .kpi-grid{grid-template-columns:repeat(2,1fr)}
      .auto-grid{grid-template-columns:1fr}
    }
  </style>
</head>
<body>

<!-- ── Login Screen ── -->
<div id="loginScreen" style="display:flex">
  <div class="login-card">
    <div class="login-logo">node<em>flow</em></div>
    <div class="login-sub">Portal de clientes</div>
    <p style="font-size:13px;color:var(--dim);margin-bottom:20px;line-height:1.5;">
      Introduce tu email y te enviamos un enlace de acceso instantáneo.
    </p>
    <input type="email" class="login-input" id="loginEmail" placeholder="tu@email.com" autocomplete="email"
           onkeydown="if(event.key==='Enter')requestAccess()">
    <button class="login-btn" onclick="requestAccess()">Enviar enlace de acceso</button>
    <div id="loginMsg" style="margin-top:12px;font-size:13px;display:none"></div>
    <p class="login-help">¿Primera vez? <a href="/#precios">Activa tu plan aquí</a></p>
  </div>
</div>

<!-- ── App ── -->
<div id="app">

  <!-- Hamburger (mobile) -->
  <button class="hamburger" id="hamburger" onclick="toggleSidebar()" aria-label="Menú">☰</button>
  <!-- Backdrop -->
  <div class="backdrop" id="backdrop" onclick="closeSidebar()"></div>

  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">
      <div class="sidebar-logo-title">node<em>flow</em></div>
      <div class="sidebar-biz" id="sidebarBiz">—</div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-item active" id="nav-dashboard"         onclick="navigate('dashboard')">
        <span class="nav-icon">📊</span><span>Dashboard</span>
      </div>
      <div class="nav-item"        id="nav-llamadas"          onclick="navigate('llamadas')">
        <span class="nav-icon">📞</span><span>Llamadas</span>
      </div>
      <div class="nav-item"        id="nav-citas"             onclick="navigate('citas')">
        <span class="nav-icon">🗓️</span><span>Citas</span>
      </div>
      <div class="nav-item"        id="nav-informes"          onclick="navigate('informes')">
        <span class="nav-icon">📈</span><span>Informes</span>
      </div>
      <div class="nav-item"        id="nav-automatizaciones"  onclick="navigate('automatizaciones')">
        <span class="nav-icon">🤖</span><span>Automatizaciones</span>
      </div>
      <div style="border-top:1px solid var(--border);margin:8px 0"></div>
      <div class="nav-item"        id="nav-configuracion"     onclick="navigate('configuracion')">
        <span class="nav-icon">⚙️</span><span>Configuración</span>
      </div>
    </nav>
    <div class="sidebar-footer">
      <div class="plan-badge">
        <div class="plan-badge-name" id="sidebarPlan">—</div>
        <div class="plan-badge-sub"  id="sidebarPlanSub">Activo</div>
      </div>
      <button class="btn btn-d" style="width:100%;font-size:12px" onclick="logout()">Cerrar sesión</button>
    </div>
  </aside>

  <!-- Main -->
  <main class="main-content">

    <!-- Dashboard -->
    <div id="sec-dashboard" class="section active">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando dashboard…</div>
      </div>
    </div>

    <!-- Llamadas -->
    <div id="sec-llamadas" class="section">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando llamadas…</div>
      </div>
    </div>

    <!-- Citas -->
    <div id="sec-citas" class="section">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando citas…</div>
      </div>
    </div>

    <!-- Informes -->
    <div id="sec-informes" class="section">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando informes…</div>
      </div>
    </div>

    <!-- Automatizaciones -->
    <div id="sec-automatizaciones" class="section">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando automatizaciones…</div>
      </div>
    </div>

    <!-- Configuración -->
    <div id="sec-configuracion" class="section">
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Cargando configuración…</div>
      </div>
    </div>

  </main>
</div>

<!-- Modal overlay -->
<div id="modalOverlay" class="modal-overlay" style="display:none" onclick="if(event.target===this)closeModal()">
  <div class="modal-box" id="modalBox"></div>
</div>

<!-- Toast -->
<div id="toast"></div>

<script src="/portal/portal.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify the HTML loads in the browser**

Open `http://localhost:3000/portal` (server must be running). You should see:
- The login screen (email input + button)
- No JavaScript errors in browser console

- [ ] **Step 4: Commit**

```bash
git add public/portal/index.html
git commit -m "feat(portal): rewrite index.html with sidebar layout + section shells"
```

---

## Task 9: Create public/portal/portal.js — auth, routing, mobile sidebar, toast, API helper

**Files:**
- Create: `public/portal/portal.js`

**What this task builds:** The foundation layer that every section depends on. After this task: login works, you can navigate between sections (they'll show loading spinners), mobile hamburger works.

- [ ] **Step 1: Create the file**

```js
// public/portal/portal.js
// NodeFlow — Portal de Negocio client-side JS
'use strict';

const SESSION_KEY = 'nf_session';

// ── Global state ─────────────────────────────────────────────
let _token   = null;
let _orgInfo = null;  // { id, name, plan, owner_email, phone, ... }
let _currentSection = 'dashboard';

// ── API helper ────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_token}`,
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = ''; }, 3500);
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  document.getElementById('modalBox').innerHTML = '';
}

// ── Mobile sidebar ────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('backdrop').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
}

// ── Section navigation ────────────────────────────────────────
function navigate(section) {
  // Hide all sections, deactivate all nav items
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  // Show target section and activate nav item
  const secEl = document.getElementById(`sec-${section}`);
  const navEl = document.getElementById(`nav-${section}`);
  if (secEl) secEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  _currentSection = section;
  closeSidebar();

  // Load section data
  switch (section) {
    case 'dashboard':       loadDashboard();       break;
    case 'llamadas':        loadCalls();           break;
    case 'citas':           loadCitas();           break;
    case 'informes':        loadInformes();        break;
    case 'automatizaciones':loadAutomatizaciones();break;
    case 'configuracion':   loadConfig();          break;
  }
}

// ── Auth flow ─────────────────────────────────────────────────
async function initAuth() {
  // 1. Magic link token in URL query string
  const params      = new URLSearchParams(window.location.search);
  const magicToken  = params.get('token');
  if (magicToken) {
    try {
      const data = await fetch(`/api/auth/verify?token=${encodeURIComponent(magicToken)}`).then(r => r.json());
      if (!data.session_token) throw new Error(data.error || 'Enlace inválido');
      localStorage.setItem(SESSION_KEY, data.session_token);
      window.history.replaceState({}, '', '/portal');
      _token = data.session_token;
    } catch (e) {
      return showLogin(`Enlace inválido o expirado: ${e.message}`);
    }
  } else {
    _token = localStorage.getItem(SESSION_KEY);
  }

  if (!_token) return showLogin();

  // 2. Validate token & load org info
  try {
    _orgInfo = await api('/api/portal/me');
    if (!_orgInfo || !_orgInfo.id) throw new Error('Sin negocio asociado');
  } catch (e) {
    localStorage.removeItem(SESSION_KEY);
    return showLogin(`Sesión expirada. Inicia sesión de nuevo.`);
  }

  showApp();
}

function showLogin(errorMsg) {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  if (errorMsg) {
    const el = document.getElementById('loginMsg');
    el.style.color   = '#e74c3c';
    el.textContent   = errorMsg;
    el.style.display = 'block';
  }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display         = 'block';

  // Populate sidebar
  document.getElementById('sidebarBiz').textContent = _orgInfo.name || '—';
  const planMap = { starter: 'Plan Starter', negocio: 'Plan Negocio', pro: 'Plan Pro' };
  document.getElementById('sidebarPlan').textContent    = planMap[_orgInfo.plan] || 'Plan —';
  document.getElementById('sidebarPlanSub').textContent = `${_orgInfo.plan === 'negocio' ? '€49' : _orgInfo.plan === 'pro' ? '€99' : 'Gratis'}/mes · Activo`;

  // Load initial section
  navigate('dashboard');
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  _token   = null;
  _orgInfo = null;
  showLogin();
}

// ── Login screen helpers ──────────────────────────────────────
async function requestAccess() {
  const email  = document.getElementById('loginEmail').value.trim();
  const msgEl  = document.getElementById('loginMsg');
  if (!email || !email.includes('@')) {
    msgEl.style.color   = '#e74c3c';
    msgEl.textContent   = 'Introduce un email válido.';
    msgEl.style.display = 'block';
    return;
  }
  msgEl.style.color   = 'var(--dim)';
  msgEl.textContent   = 'Enviando…';
  msgEl.style.display = 'block';
  try {
    await fetch('/api/auth/request-link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    msgEl.style.color = 'var(--green2)';
    msgEl.textContent = '✓ Si tu email está registrado, recibirás un enlace en breve.';
  } catch (_) {
    msgEl.style.color = '#e74c3c';
    msgEl.textContent = 'Error al enviar. Inténtalo de nuevo.';
  }
}

// ── Relative time helper ──────────────────────────────────────
function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return 'ahora';
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h  < 24)  return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

// ── Format date as DD/MM/YYYY ─────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:3000/portal`.
- Login screen visible, no console errors
- Enter your email, click "Enviar enlace de acceso" → see success message
- Click the magic link from email → redirected to `/portal`, sidebar appears with business name
- Click each nav item → section heading changes
- On mobile viewport (DevTools → 375px): hamburger `☰` visible, click it → sidebar slides in, click backdrop → sidebar closes

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): portal.js foundation — auth, routing, mobile sidebar, toast, API helper"
```

---

## Task 10: Dashboard section

**Files:**
- Modify: `public/portal/portal.js` (add function before the `// ── Boot ──` comment)

- [ ] **Step 1: Add `loadDashboard()` to portal.js (before the `// ── Boot ──` line)**

```js
// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  const sec = document.getElementById('sec-dashboard');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-text">Cargando…</div></div>';
  let d;
  try {
    d = await api('/api/portal/dashboard');
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div class="empty-state-text">Error al cargar: ${e.message}</div></div>`;
    return;
  }

  const greet = new Date().getHours() < 14 ? 'Buenos días' : new Date().getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
  const dateStr = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });

  const upcomingRows = (d.upcoming || []).length > 0
    ? (d.upcoming || []).map(a => `
        <tr>
          <td>${fmtDate(a.date)}</td>
          <td><strong>${a.time}</strong></td>
          <td>${a.patientName}</td>
          <td>${a.service}</td>
          <td><span class="badge bg">✓ Confirmada</span></td>
        </tr>`).join('')
    : '<tr class="empty-row"><td colspan="5">No hay citas próximas</td></tr>';

  const activityRows = (d.recentActivity || []).length > 0
    ? (d.recentActivity || []).map(ev => {
        const badgeClass = ev.type === 'reserva' ? 'bg' : ev.type === 'info' ? 'binfo' : 'bd';
        return `<div class="activity-item">
          <span class="activity-badge badge ${badgeClass}">${ev.type}</span>
          <div>
            <div class="activity-text">${ev.text}</div>
            <div class="activity-time">${timeAgo(ev.time)}</div>
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--dim);font-size:13px">Sin actividad reciente</div>';

  sec.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">${greet}, ${d.businessName} 👋</div>
        <div style="font-size:13px;color:var(--dim);margin-top:4px">${dateStr} · Tu AI lleva activo ${d.daysActive} días</div>
      </div>
      <span class="ai-status">● AI ACTIVO</span>
    </div>

    <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Hoy</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Llamadas</div><div class="kpi-val" style="color:var(--accent-l)">${d.today.callCount}</div><div class="kpi-sub">hoy</div></div>
      <div class="kpi"><div class="kpi-label">Reservas</div><div class="kpi-val" style="color:var(--green2)">${d.today.bookedToday}</div><div class="kpi-sub">${d.today.convRate}% conversión</div></div>
      <div class="kpi"><div class="kpi-label">Emails enviados</div><div class="kpi-val" style="color:var(--accent-l)">${d.today.emailsSent}</div><div class="kpi-sub">confirmaciones</div></div>
      <div class="kpi"><div class="kpi-label">Horas ahorradas</div><div class="kpi-val" style="color:#60a5fa">${d.today.hoursSaved}h</div><div class="kpi-sub">vs atención manual</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">🗓️ Próximas citas</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Estado</th></tr></thead>
            <tbody>${upcomingRows}</tbody>
          </table>
        </div>
        <button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate('citas')">Ver todas →</button>
      </div>
      <div class="card">
        <div class="card-title">⚡ Actividad reciente</div>
        <div class="activity-list">${activityRows}</div>
        <button class="btn btn-d btn-sm" style="margin-top:12px" onclick="navigate('llamadas')">Ver llamadas →</button>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Dashboard in the portal. Expected:
- Greeting with business name
- 4 KPI cards showing today's numbers
- Table of upcoming appointments (or "No hay citas próximas")
- Recent activity feed

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): dashboard section with KPIs, upcoming citas, activity feed"
```

---

## Task 11: Llamadas section

**Files:**
- Modify: `public/portal/portal.js` (add before `// ── Boot ──`)

- [ ] **Step 1: Add `loadCalls()` to portal.js**

```js
// ── Llamadas ──────────────────────────────────────────────────
async function loadCalls(outcome, from, to) {
  const sec = document.getElementById('sec-llamadas');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando llamadas…</div></div>';

  const params = new URLSearchParams();
  if (outcome && outcome !== 'todas') params.set('outcome', outcome);
  if (from) params.set('from', from);
  if (to)   params.set('to', to);

  let data;
  try {
    data = await api(`/api/portal/calls?${params}`);
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div>Error: ${e.message}</div></div>`;
    return;
  }

  const OUTCOME_BADGE = {
    booked:    '<span class="badge bg">reserva</span>',
    info:      '<span class="badge binfo">info</span>',
    abandoned: '<span class="badge bd">abandonada</span>',
  };

  const rows = data.calls.length > 0
    ? data.calls.map(c => {
        const dur = c.duration >= 60
          ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s`
          : `${c.duration}s`;
        const badge = OUTCOME_BADGE[c.outcome] || OUTCOME_BADGE.abandoned;
        const apt   = c.appointment
          ? `<small style="color:var(--dim)">${c.appointment.date} ${c.appointment.time} · ${c.appointment.service}</small>`
          : '';
        return `<tr>
          <td>${timeAgo(c.startedAt)}</td>
          <td>${dur}</td>
          <td>${badge}</td>
          <td>${c.turnCount} turnos${apt ? '<br>' + apt : ''}</td>
          <td style="color:var(--dim)">${c.clientEmail || '—'}</td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="5">No hay llamadas con estos filtros</td></tr>';

  sec.innerHTML = `
    <div class="section-header">
      <div class="section-title">📞 Llamadas</div>
    </div>
    <div class="filter-bar">
      <label style="font-size:12px;color:var(--dim)">Resultado:</label>
      <select id="fOutcome" onchange="loadCalls(this.value, document.getElementById('fFrom').value, document.getElementById('fTo').value)">
        <option value="todas">Todas</option>
        <option value="booked">Reserva</option>
        <option value="info">Informativas</option>
        <option value="abandoned">Abandonadas</option>
      </select>
      <label style="font-size:12px;color:var(--dim)">Desde:</label>
      <input type="date" id="fFrom" onchange="loadCalls(document.getElementById('fOutcome').value, this.value, document.getElementById('fTo').value)">
      <label style="font-size:12px;color:var(--dim)">Hasta:</label>
      <input type="date" id="fTo"   onchange="loadCalls(document.getElementById('fOutcome').value, document.getElementById('fFrom').value, this.value)">
      <button class="btn btn-d btn-sm" onclick="loadCalls()">Limpiar</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Email cliente</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--dim);margin-top:12px">Total: ${data.count} llamadas</div>`;

  // Restore filter values if provided
  if (outcome && outcome !== 'todas') {
    const sel = document.getElementById('fOutcome');
    if (sel) sel.value = outcome;
  }
  if (from) { const el = document.getElementById('fFrom'); if (el) el.value = from; }
  if (to)   { const el = document.getElementById('fTo');   if (el) el.value = to;   }
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Llamadas. Expected:
- Filter bar with outcome selector + date inputs
- Table of calls (or empty state)
- Changing the outcome filter reloads the list

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): llamadas section with filters"
```

---

## Task 12: Citas section + create/edit/cancel modals

**Files:**
- Modify: `public/portal/portal.js` (add before `// ── Boot ──`)

- [ ] **Step 1: Add `loadCitas()` and modal functions to portal.js**

```js
// ── Citas ─────────────────────────────────────────────────────
async function loadCitas() {
  const sec = document.getElementById('sec-citas');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando citas…</div></div>';

  let data;
  try {
    data = await api('/api/portal/appointments');
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div>Error: ${e.message}</div></div>`;
    return;
  }

  const STATUS_BADGE = {
    confirmed:  '<span class="badge bg">✓ Confirmada</span>',
    cancelled:  '<span class="badge br">✕ Cancelada</span>',
    pending:    '<span class="badge by">Pendiente</span>',
  };

  const rows = data.appointments.length > 0
    ? data.appointments.map(a => {
        const badge = STATUS_BADGE[a.status] || STATUS_BADGE.pending;
        const actions = a.status !== 'cancelled' ? `
          <button class="btn btn-d btn-sm" onclick="openEditCita('${a.id}')">✏️</button>
          <button class="btn btn-r btn-sm" onclick="cancelCitaConfirm('${a.id}', '${(a.patientName || '').replace(/'/g, "\\'")}')">✕</button>
        ` : '';
        return `<tr>
          <td>${fmtDate(a.date)}</td>
          <td><strong>${a.time}</strong></td>
          <td>${a.patientName}</td>
          <td>${a.phone || '—'}</td>
          <td>${a.service}</td>
          <td>${badge}</td>
          <td style="white-space:nowrap">${actions}</td>
        </tr>`;
      }).join('')
    : '<tr class="empty-row"><td colspan="7">No hay citas registradas</td></tr>';

  sec.innerHTML = `
    <div class="section-header">
      <div class="section-title">🗓️ Citas</div>
      <button class="btn btn-accent" onclick="openNewCita()">+ Nueva cita</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Teléfono</th><th>Servicio</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function openNewCita() {
  openModal(`
    <div class="modal-title">+ Nueva cita</div>
    <div class="form-group"><label class="form-label">Nombre del cliente *</label>
      <input class="form-input" id="mPatientName" placeholder="Ana García"></div>
    <div class="form-group"><label class="form-label">Teléfono</label>
      <input class="form-input" id="mPhone" type="tel" placeholder="+34 600 000 000"></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="mEmail" type="email" placeholder="cliente@email.com"></div>
    <div class="form-group"><label class="form-label">Servicio *</label>
      <input class="form-input" id="mService" placeholder="Corte de pelo"></div>
    <div class="form-group"><label class="form-label">Fecha *</label>
      <input class="form-input" id="mDate" type="date"></div>
    <div class="form-group"><label class="form-label">Hora *</label>
      <input class="form-input" id="mTime" type="time"></div>
    <div class="modal-actions">
      <button class="btn btn-d" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="submitNewCita()">Guardar cita</button>
    </div>`);
  // Set today's date as default
  document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
}

async function submitNewCita() {
  const body = {
    patientName: document.getElementById('mPatientName').value.trim(),
    phone:       document.getElementById('mPhone').value.trim(),
    email:       document.getElementById('mEmail').value.trim(),
    service:     document.getElementById('mService').value.trim(),
    date:        document.getElementById('mDate').value,
    time:        document.getElementById('mTime').value,
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api('/api/portal/appointments', 'POST', body);
    closeModal();
    toast('Cita creada correctamente');
    loadCitas();
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

async function openEditCita(id) {
  let data;
  try {
    data = await api('/api/portal/appointments');
  } catch (e) {
    toast(`Error al cargar cita: ${e.message}`, 'err');
    return;
  }
  const apt = data.appointments.find(a => a.id === id);
  if (!apt) { toast('Cita no encontrada', 'err'); return; }

  openModal(`
    <div class="modal-title">✏️ Editar cita</div>
    <div class="form-group"><label class="form-label">Nombre del cliente *</label>
      <input class="form-input" id="ePatientName" value="${apt.patientName || ''}"></div>
    <div class="form-group"><label class="form-label">Teléfono</label>
      <input class="form-input" id="ePhone" type="tel" value="${apt.phone || ''}"></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="eEmail" type="email" value="${apt.email || ''}"></div>
    <div class="form-group"><label class="form-label">Servicio *</label>
      <input class="form-input" id="eService" value="${apt.service || ''}"></div>
    <div class="form-group"><label class="form-label">Fecha *</label>
      <input class="form-input" id="eDate" type="date" value="${apt.date || ''}"></div>
    <div class="form-group"><label class="form-label">Hora *</label>
      <input class="form-input" id="eTime" type="time" value="${apt.time || ''}"></div>
    <div class="modal-actions">
      <button class="btn btn-d" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="submitEditCita('${id}')">Guardar cambios</button>
    </div>`);
}

async function submitEditCita(id) {
  const body = {
    patientName: document.getElementById('ePatientName').value.trim(),
    phone:       document.getElementById('ePhone').value.trim(),
    email:       document.getElementById('eEmail').value.trim(),
    service:     document.getElementById('eService').value.trim(),
    date:        document.getElementById('eDate').value,
    time:        document.getElementById('eTime').value,
  };
  if (!body.patientName || !body.service || !body.date || !body.time) {
    toast('Rellena todos los campos obligatorios', 'err');
    return;
  }
  try {
    await api(`/api/portal/appointments/${id}`, 'PATCH', body);
    closeModal();
    toast('Cita actualizada');
    loadCitas();
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

function cancelCitaConfirm(id, name) {
  openModal(`
    <div class="modal-title">Cancelar cita</div>
    <p style="color:var(--dim);margin-bottom:20px">¿Seguro que quieres cancelar la cita de <strong style="color:var(--text)">${name}</strong>?
    Si tiene email registrado, se le enviará un aviso.</p>
    <div class="modal-actions">
      <button class="btn btn-d" onclick="closeModal()">No, volver</button>
      <button class="btn btn-r" onclick="submitCancelCita('${id}')">Sí, cancelar</button>
    </div>`);
}

async function submitCancelCita(id) {
  try {
    await api(`/api/portal/appointments/${id}`, 'DELETE');
    closeModal();
    toast('Cita cancelada');
    loadCitas();
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Citas:
- Table shows appointments (or empty state)
- "+ Nueva cita" opens modal → fill fields → save → appears in list
- ✏️ opens edit modal with pre-filled values → change service → save → reflected in list
- ✕ opens confirmation dialog → confirm → appointment shows as "Cancelada"

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): citas section with create/edit/cancel modals"
```

---

## Task 13: Informes section

**Files:**
- Modify: `public/portal/portal.js` (add before `// ── Boot ──`)

- [ ] **Step 1: Add `loadInformes()` to portal.js**

```js
// ── Informes ──────────────────────────────────────────────────
async function loadInformes(period) {
  period = period || 'month';
  const sec = document.getElementById('sec-informes');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando informes…</div></div>';

  let data;
  try {
    data = await api(`/api/portal/reports?period=${period}`);
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div>Error: ${e.message}</div></div>`;
    return;
  }

  const s = data.summary;
  const t = data.allTime;
  const PERIOD_LABEL = { week: 'Esta semana', month: 'Este mes', quarter: 'Últimos 3 meses' };

  // Build CSS bar chart
  const dow = data.callsByDayOfWeek || [];
  const maxVal = Math.max(...dow.map(d => d.value), 1);
  const bars = dow.map(d => {
    const pct = Math.round((d.value / maxVal) * 100);
    return `<div class="bar-wrap">
      <div class="bar-val">${d.value > 0 ? d.value : ''}</div>
      <div class="bar" style="height:${Math.max(pct, 5)}%" title="${d.label}: ${d.value}"></div>
      <div class="bar-label">${d.label}</div>
    </div>`;
  }).join('');

  const periodSelector = ['week', 'month', 'quarter'].map(p =>
    `<button class="btn ${p === period ? 'btn-accent' : 'btn-d'} btn-sm" onclick="loadInformes('${p}')">${PERIOD_LABEL[p]}</button>`
  ).join('');

  sec.innerHTML = `
    <div class="section-header">
      <div class="section-title">📈 Informes</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${periodSelector}</div>
    </div>

    <div style="font-size:12px;color:var(--dim);margin-bottom:12px">${PERIOD_LABEL[period]}</div>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Llamadas</div><div class="kpi-val" style="color:var(--accent-l)">${s.totalCalls}</div></div>
      <div class="kpi"><div class="kpi-label">Reservas</div><div class="kpi-val" style="color:var(--green2)">${s.bookings}</div></div>
      <div class="kpi"><div class="kpi-label">Conversión</div><div class="kpi-val" style="color:var(--yellow)">${s.convRate}%</div></div>
      <div class="kpi"><div class="kpi-label">Horas ahorradas</div><div class="kpi-val" style="color:#60a5fa">${s.hoursSaved}h</div></div>
      <div class="kpi"><div class="kpi-label">Ingresos estimados</div><div class="kpi-val" style="color:var(--green2)">€${s.revenueEst}</div><div class="kpi-sub">reservas × precio medio</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-title">📊 Llamadas por día de la semana</div>
        <div class="bar-chart">${bars || '<div style="color:var(--dim);font-size:12px">Sin datos</div>'}</div>
      </div>
      <div class="card">
        <div class="card-title">🏆 Desde que activaste NodeFlow</div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Total llamadas</span><strong>${t.totalCalls}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Reservas generadas</span><strong style="color:var(--green2)">${t.bookings}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Horas ahorradas</span><strong style="color:#60a5fa">${t.hoursSaved}h</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">Ingresos atribuidos</span><strong style="color:var(--green2)">€${t.revenueEst}</strong></div>
        </div>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Informes:
- 5 KPI cards showing period stats
- Bar chart with calls by day of week
- All-time block
- Period buttons (Esta semana / Este mes / Últimos 3 meses) change the displayed data when clicked

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): informes section with KPIs, bar chart, all-time stats"
```

---

## Task 14: Automatizaciones section

**Files:**
- Modify: `public/portal/portal.js` (add before `// ── Boot ──`)

- [ ] **Step 1: Add `loadAutomatizaciones()` and helpers to portal.js**

```js
// ── Automatizaciones ──────────────────────────────────────────
async function loadAutomatizaciones() {
  const sec = document.getElementById('sec-automatizaciones');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando…</div></div>';

  let autoData, critData;
  try {
    [autoData, critData] = await Promise.all([
      api('/api/portal/automations'),
      api(`/api/critical-dates/${_orgInfo.id}`),
    ]);
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div>Error: ${e.message}</div></div>`;
    return;
  }

  const auto = autoData.automations || {};
  const rem  = auto.reminders || {};
  const rev  = auto.reviews   || {};
  const reb  = auto.rebooking || {};

  // Critical dates rows
  const critRows = (critData.entries || []).length > 0
    ? (critData.entries || []).map(e => {
        const days = Math.ceil((new Date(e.dueDate) - new Date()) / 86400000);
        const urgClass = days <= 7 ? 'br' : days <= 15 ? 'by' : 'bp';
        return `<div class="crit-item">
          <div class="crit-info">
            <div class="crit-name">${e.clientName}</div>
            <div class="crit-meta"><span class="badge ${urgClass}">${e.type}</span> ${e.notes ? '· ' + e.notes : ''}</div>
          </div>
          <div>
            <div class="crit-date">${fmtDate(e.dueDate)}</div>
            <div class="crit-days">${days > 0 ? `en ${days}d` : days === 0 ? 'hoy' : `hace ${-days}d`}</div>
          </div>
          <button class="btn btn-r btn-sm" onclick="deleteCritDate('${e.id}')">✕</button>
        </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:24px"><div class="empty-state-text">No hay fechas críticas activas</div></div>';

  sec.innerHTML = `
    <div class="section-header"><div class="section-title">🤖 Automatizaciones</div></div>

    <div class="auto-grid">
      <div class="auto-card">
        <div class="auto-row">
          <div>
            <div class="auto-name">🔔 Recordatorios de cita</div>
            <div class="auto-desc">Email al cliente antes de su cita</div>
          </div>
          <label class="toggle"><input type="checkbox" id="togReminders" ${rem.enabled !== false ? 'checked' : ''}
            onchange="patchAuto('reminders', {enabled: this.checked})"><span class="slider"></span></label>
        </div>
        <div class="auto-footer">
          <span class="auto-label">Horas antes:</span>
          <div class="auto-hours">
            <input type="number" id="hoursReminders" value="${rem.hoursBefore || 24}" min="1" max="72"
              onchange="patchAuto('reminders', {hoursBefore: parseInt(this.value)})">
          </div>
        </div>
      </div>

      <div class="auto-card">
        <div class="auto-row">
          <div>
            <div class="auto-name">⭐ Solicitud de reseña</div>
            <div class="auto-desc">Email pidiendo reseña Google tras la cita</div>
          </div>
          <label class="toggle"><input type="checkbox" id="togReviews" ${rev.enabled !== false ? 'checked' : ''}
            onchange="patchAuto('reviews', {enabled: this.checked})"><span class="slider"></span></label>
        </div>
        <div class="auto-footer">
          <span class="auto-label">Horas después:</span>
          <div class="auto-hours">
            <input type="number" id="hoursReviews" value="${rev.hoursAfter || 24}" min="1" max="72"
              onchange="patchAuto('reviews', {hoursAfter: parseInt(this.value)})">
          </div>
        </div>
      </div>

      <div class="auto-card">
        <div class="auto-row">
          <div>
            <div class="auto-name">🔄 Rebooking automático</div>
            <div class="auto-desc">Recordatorio cuando un cliente lleva tiempo sin venir</div>
          </div>
          <label class="toggle"><input type="checkbox" id="togRebooking" ${reb.enabled !== false ? 'checked' : ''}
            onchange="patchAuto('rebooking', {enabled: this.checked})"><span class="slider"></span></label>
        </div>
        <div class="auto-footer">
          <span class="auto-label">Días sin venir:</span>
          <div class="auto-hours">
            <input type="number" id="daysRebooking" value="${reb.daysThreshold || 42}" min="7" max="365"
              onchange="patchAuto('rebooking', {daysThreshold: parseInt(this.value)})">
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="justify-content:space-between">
        <span>📅 Fechas críticas</span>
        <button class="btn btn-accent btn-sm" onclick="openNewCritDate()">+ Añadir</button>
      </div>
      <div id="critDatesList">${critRows}</div>
    </div>`;
}

async function patchAuto(type, patch) {
  try {
    await api('/api/portal/automations', 'PATCH', { [type]: patch });
    toast('Configuración guardada');
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

async function deleteCritDate(id) {
  try {
    await api(`/api/critical-dates/${id}`, 'DELETE');
    toast('Fecha crítica eliminada');
    loadAutomatizaciones();
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}

function openNewCritDate() {
  const TYPES = ['itv_expiry','vaccine_due','tax_filing','quarterly_vat','insurance_renewal',
    'license_renewal','contract_renewal','pregnancy_due','treatment_cycle','follow_up',
    'birthday','annual_review','mortgage_payment','warranty_expiry','subscription_renewal','other'];
  const typeOpts = TYPES.map(t => `<option value="${t}">${t.replace(/_/g,' ')}</option>`).join('');

  openModal(`
    <div class="modal-title">📅 Nueva fecha crítica</div>
    <div class="form-group"><label class="form-label">Nombre del cliente *</label>
      <input class="form-input" id="cdName" placeholder="Ana García"></div>
    <div class="form-group"><label class="form-label">Tipo *</label>
      <select class="form-input" id="cdType">${typeOpts}</select></div>
    <div class="form-group"><label class="form-label">Fecha crítica *</label>
      <input class="form-input" id="cdDate" type="date"></div>
    <div class="form-group"><label class="form-label">Email</label>
      <input class="form-input" id="cdEmail" type="email" placeholder="cliente@email.com"></div>
    <div class="form-group"><label class="form-label">Teléfono</label>
      <input class="form-input" id="cdPhone" type="tel"></div>
    <div class="form-group"><label class="form-label">Notas</label>
      <input class="form-input" id="cdNotes" placeholder="Vacuna rabia, perro Max…"></div>
    <div class="modal-actions">
      <button class="btn btn-d" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="submitCritDate()">Guardar</button>
    </div>`);
}

async function submitCritDate() {
  const body = {
    businessId:  _orgInfo.id,
    clientName:  document.getElementById('cdName').value.trim(),
    type:        document.getElementById('cdType').value,
    dueDate:     document.getElementById('cdDate').value,
    clientEmail: document.getElementById('cdEmail').value.trim() || null,
    clientPhone: document.getElementById('cdPhone').value.trim() || null,
    notes:       document.getElementById('cdNotes').value.trim() || null,
  };
  if (!body.clientName || !body.dueDate) {
    toast('Rellena nombre y fecha', 'err');
    return;
  }
  try {
    await api('/api/critical-dates', 'POST', body);
    closeModal();
    toast('Fecha crítica añadida');
    loadAutomatizaciones();
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Automatizaciones:
- 3 automation cards with toggles
- Toggle on/off → toast "Configuración guardada"
- Change hours input → toast shows
- Critical dates list (or empty state)
- "+ Añadir" opens modal → fill fields → save → appears in list
- ✕ on a critical date → removed from list

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): automatizaciones section with toggles + critical dates CRUD"
```

---

## Task 15: Configuración section + final smoke test

**Files:**
- Modify: `public/portal/portal.js` (add before `// ── Boot ──`)

- [ ] **Step 1: Add `loadConfig()` and `saveConfig()` to portal.js**

```js
// ── Configuración ─────────────────────────────────────────────
async function loadConfig() {
  const sec = document.getElementById('sec-configuracion');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando…</div></div>';

  let data;
  try {
    data = await api('/api/portal/config');
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div>Error: ${e.message}</div></div>`;
    return;
  }

  const c = data.config;
  sec.innerHTML = `
    <div class="section-header">
      <div class="section-title">⚙️ Configuración</div>
    </div>

    <div class="card" style="max-width:640px">
      <div class="form-section-title">Información general</div>

      <div class="form-group"><label class="form-label">Nombre del negocio</label>
        <input class="form-input" id="cfgName" value="${c.name || ''}"></div>

      <div class="form-group"><label class="form-label">Email del propietario</label>
        <input class="form-input" readonly value="${c.ownerEmail || ''}" style="opacity:.55">
        <small style="color:var(--dim);font-size:11px">Para cambiar el email, contacta con soporte</small></div>

      <div class="form-group"><label class="form-label">Teléfono del negocio</label>
        <input class="form-input" readonly value="${c.phone || '—'}">
        <small style="color:var(--dim);font-size:11px">Número provisionado — no editable</small></div>

      <div class="form-group"><label class="form-label">Idioma del AI</label>
        <select class="form-input" id="cfgLang">
          <option value="es" ${c.language === 'es' ? 'selected' : ''}>Español</option>
          <option value="eu" ${c.language === 'eu' ? 'selected' : ''}>Euskera</option>
          <option value="gl" ${c.language === 'gl' ? 'selected' : ''}>Gallego</option>
        </select></div>

      <div class="form-group"><label class="form-label">Sector</label>
        <select class="form-input" id="cfgSector">
          ${['peluqueria','barberia','estetica','clinica','dental','veterinaria','restaurante','taller',
             'gimnasio','academia','farmacia','asesoria','hotel','inmobiliaria','otro']
            .map(s => `<option value="${s}" ${c.sector === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
            .join('')}
        </select></div>

      <div class="form-section-title">Servicios y horarios</div>

      <div class="form-group"><label class="form-label">Servicios (uno por línea o separados por comas)</label>
        <textarea class="form-input" id="cfgServices" rows="4" placeholder="Corte de pelo, Tinte, Mechas…">${c.services || ''}</textarea></div>

      <div class="form-group"><label class="form-label">Horarios</label>
        <textarea class="form-input" id="cfgSchedule" rows="3" placeholder="L-V 9:00-20:00, Sáb 9:00-14:00">${c.schedule || ''}</textarea></div>

      <div class="form-section-title">Configuración del AI</div>

      <div class="form-group"><label class="form-label">Mensaje de bienvenida</label>
        <textarea class="form-input" id="cfgWelcome" rows="3" placeholder="Hola, has llamado a…">${c.welcomeMessage || ''}</textarea></div>

      <div class="form-group"><label class="form-label">Precio medio por servicio (€)</label>
        <input class="form-input" id="cfgAvgTicket" type="number" min="1" max="9999" value="${c.avgTicket || 35}"></div>

      <div style="display:flex;gap:12px;margin-top:24px">
        <button class="btn btn-accent" onclick="saveConfig()">Guardar cambios</button>
        <a href="https://wa.me/34666351319?text=Necesito%20ayuda%20con%20mi%20portal" target="_blank"
           class="btn btn-d" style="text-decoration:none">Contactar soporte</a>
      </div>
    </div>`;
}

async function saveConfig() {
  const body = {
    name:           document.getElementById('cfgName').value.trim(),
    language:       document.getElementById('cfgLang').value,
    sector:         document.getElementById('cfgSector').value,
    services:       document.getElementById('cfgServices').value.trim(),
    schedule:       document.getElementById('cfgSchedule').value.trim(),
    welcomeMessage: document.getElementById('cfgWelcome').value.trim(),
    avgTicket:      parseFloat(document.getElementById('cfgAvgTicket').value) || 35,
  };
  if (!body.name) { toast('El nombre no puede estar vacío', 'err'); return; }
  try {
    await api('/api/portal/config', 'PATCH', body);
    // Update sidebar business name live
    document.getElementById('sidebarBiz').textContent = body.name;
    toast('Configuración guardada');
  } catch (e) {
    toast(`Error: ${e.message}`, 'err');
  }
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Configuración:
- All fields pre-filled from the API
- Edit business name → click "Guardar cambios" → toast "Configuración guardada"
- Reload the page → edited name is still there (persisted to DB)
- Sidebar business name updates immediately after save

- [ ] **Step 3: Full end-to-end smoke test**

Run through this checklist manually:
- [ ] Login with magic link → redirects to portal, sidebar shows business name
- [ ] Dashboard: KPIs for today, upcoming citas, activity feed
- [ ] Llamadas: list loads, outcome filter works
- [ ] Citas: create a test cita → appears → edit it → cancel it → shows "Cancelada"
- [ ] Informes: period buttons work, bar chart renders, all-time stats show
- [ ] Automatizaciones: toggle reminder off → toast → toggle back on → toast; add critical date → appears in list → delete it
- [ ] Configuración: change language to Euskera → save → reload → Euskera is still selected
- [ ] Mobile (375px viewport): hamburger shows, sidebar slides in, backdrop closes it
- [ ] Logout: click "Cerrar sesión" → back to login screen

- [ ] **Step 4: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(portal): configuracion section + all 6 sections complete"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task covering it |
|-----------------|-----------------|
| Sidebar fija, collapses on mobile with hamburger | Task 8 (HTML), Task 9 (JS) |
| 6 sections: Dashboard, Llamadas, Citas, Informes, Automatizaciones, Configuración | Tasks 10–15 |
| Dashboard: KPIs today, upcoming citas, recent activity | Task 10 |
| Llamadas: call log with filters (date, outcome), duration, outcome badge | Task 11 |
| Citas: list, create, edit, cancel (with confirmation + email) | Task 12 |
| Informes: period selector, 5 KPIs, calls-by-DoW chart, all-time block | Task 13 |
| Automatizaciones: 3 toggle cards + critical dates CRUD | Task 14 |
| Configuración: all editable fields, save persists to DB and FlowManager | Task 15 |
| portalAuth middleware with in-memory + DB fallback | Task 1 |
| All 11 API endpoints | Tasks 1–6 |
| Mount in server.js | Task 7 |
| Appointment cancellation: status=cancelled, email if client email present | Task 3 |
| Error states: empty states per section, toast on API errors, session expiry → login | Tasks 9–15 |
| avgTicket in reports × bookings = revenueEst | Task 4 |
| Config fields stored in automation_config.config JSONB | Task 6 |
