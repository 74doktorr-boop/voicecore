# CRM Ligero + Transcripciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir sección "Clientes" al portal (historial por teléfono + notas editables) y visor de transcripciones en Llamadas, con persistencia automática via post-call handler.

**Architecture:** El post-call handler (ya existente) persiste cada llamada en la tabla `calls` de Supabase y hace upsert de contacto en tabla nueva `contacts`. El portal expone 5 nuevos endpoints bajo `portalAuth`. Frontend: nueva sección Clientes en sidebar + botón transcript en Llamadas.

**Tech Stack:** Node.js, Express, Supabase (PostgreSQL upsert + RPC), vanilla JS, patrón existente del portal.

---

## Mapa de archivos

| Archivo | Acción | Qué hace |
|---------|--------|----------|
| `src/automations/post-call-handler.js` | Modificar | +import getDatabase; +paso 5 persist call; +paso 6 upsert contact |
| `src/api/routes-portal.js` | Modificar | Fix callId/startedAt/endedAt en GET /calls; +5 endpoints CRM |
| `public/portal/index.html` | Modificar | +CSS transcript+profile; +nav-clientes; +sec-clientes shell |
| `public/portal/portal.js` | Modificar | +case clientes en navigate(); +loadClientes; +openContactProfile; +saveContactNotes; +deleteContact; +openTranscriptModal; +transcript btn en loadCalls |

**SQL a ejecutar en Supabase (una sola vez, Task 1):**
- `CREATE TABLE contacts (...)`
- `ALTER TABLE calls ADD COLUMN IF NOT EXISTS ...`
- `CREATE OR REPLACE FUNCTION upsert_contact(...)`

---

## Task 1: Supabase migrations

**Files:**
- No code files — SQL ejecutado en el Supabase Dashboard SQL editor

### Contexto
La tabla `calls` ya existe con columnas básicas. Necesitamos añadir columnas de outcome/transcript y crear la tabla `contacts`. Verificar que el SQL es idempotente (usa `IF NOT EXISTS` y `OR REPLACE`).

- [ ] **Step 1: Abrir Supabase Dashboard → SQL Editor y ejecutar**

```sql
-- ── 1. Extend calls table ──────────────────────────────────────
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outcome          TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_number    TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS client_email     TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS booked_appointment JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_at         TIMESTAMPTZ;

-- ── 2. Create contacts table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  name         TEXT,
  email        TEXT,
  notes        TEXT,
  call_count   INTEGER NOT NULL DEFAULT 0,
  last_call_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE (org_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_org_id ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone  ON contacts(org_id, phone);

-- ── 3. Upsert function (COALESCE preserves existing name/email) ─
CREATE OR REPLACE FUNCTION upsert_contact(
  p_org_id      UUID,
  p_phone       TEXT,
  p_name        TEXT,
  p_email       TEXT,
  p_last_call_at TIMESTAMPTZ
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO contacts (org_id, phone, name, email, last_call_at, call_count)
  VALUES (p_org_id, p_phone, p_name, p_email, p_last_call_at, 1)
  ON CONFLICT (org_id, phone) DO UPDATE SET
    last_call_at = EXCLUDED.last_call_at,
    call_count   = contacts.call_count + 1,
    name         = COALESCE(contacts.name,  EXCLUDED.name),
    email        = COALESCE(contacts.email, EXCLUDED.email);
END;
$$;
```

- [ ] **Step 2: Verificar que no hay errores**

Expected: cada statement devuelve "Success. No rows returned."

- [ ] **Step 3: Confirmar que las tablas existen**

En el Supabase Dashboard → Table Editor, verificar que aparecen `contacts` y que `calls` tiene las columnas nuevas.

---

## Task 2: Fix campos callId/startedAt/endedAt en GET /api/portal/calls

**Files:**
- Modify: `src/api/routes-portal.js:136-166`

### Contexto
`callData` (de `session.toJSON()`) tiene campos `id`, `startTime`, `endTime`. El handler actual usa `c.callId`, `c.startedAt`, `c.endedAt` — todos `undefined`. Fix antes de añadir el botón de transcript.

- [ ] **Step 1: Editar `src/api/routes-portal.js` — arreglar GET /api/portal/calls**

Localizar el bloque (aprox. líneas 136–166):

```js
  // ── GET /api/portal/calls ──────────────────────────────────
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
      duration:    c.duration || 0,
      outcome:     c.outcome || 'abandoned',
      clientEmail: c.clientEmail || null,
      appointment: c.bookedAppointment || null,
      turnCount:   c.turnCount || 0,
    }));

    res.json({ ok: true, count: formatted.length, calls: formatted });
  });
```

Reemplazar por:

```js
  // ── GET /api/portal/calls ──────────────────────────────────
  app.get('/api/portal/calls', portalAuth, (req, res) => {
    const { businessId } = req;
    const { from, to, outcome } = req.query;

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
      callId:      c.id,
      startedAt:   c.startTime,
      endedAt:     c.endTime,
      duration:    c.duration || 0,
      outcome:     c.outcome || 'abandoned',
      clientEmail: c.clientEmail || null,
      appointment: c.bookedAppointment || null,
      turnCount:   c.turnCount || 0,
    }));

    res.json({ ok: true, count: formatted.length, calls: formatted });
  });
```

- [ ] **Step 2: Verificar que el servidor arranca sin errores**

```bash
node -e "
const app = { get:()=>{}, post:()=>{}, patch:()=>{}, delete:()=>{} };
const pipeline = { getCallHistory: () => [] };
const { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
console.log('OK');
" 2>&1 | grep -E "OK|Error|error"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "fix(portal): use c.id/startTime/endTime in GET /api/portal/calls"
```

---

## Task 3: Extender post-call-handler — persistir llamada + upsert contacto

**Files:**
- Modify: `src/automations/post-call-handler.js`

### Contexto
El handler existente tiene 4 pasos (email resumen, WhatsApp, email confirmación, follow-up). Añadimos pasos 5 y 6 al final de `handle()`. Ambos son fire-and-forget con `.catch()`.

`callData` tiene: `id` (callSid), `businessId`, `callerNumber`, `outcome`, `transcript`, `duration`, `turnCount`, `startTime`, `endTime`, `bookedAppointment` (con `patientName`, `email`), `clientEmail`.

- [ ] **Step 1: Editar `src/automations/post-call-handler.js` — añadir import y pasos 5+6**

Reemplazar el archivo completo:

```js
// ============================================
// NodeFlow — Post-Call Handler (System A)
// Fire-and-forget after endCall()
// ============================================

const { flowManager }    = require('./flow-manager');
const { scheduler }      = require('../scheduling/scheduler');
const { sendWhatsApp }   = require('../notifications/whatsapp');
const {
  sendBookingConfirmationEmail,
  sendCallSummaryToOwner,
  sendCallFollowUpEmail,
} = require('../notifications/call-notifications');
const { getDatabase }    = require('../db/database');
const { Logger } = require('../utils/logger');

const log = new Logger('POST-CALL');

const FOLLOWUP_DELAY_MS = 30 * 60 * 1000; // 30 min

/**
 * Handle post-call automations.
 * MUST be called fire-and-forget: postCallHandler.handle(callData).catch(() => {})
 *
 * @param {object} callData  - session.toJSON() result (includes outcome, bookedAppointment, etc.)
 */
async function handle(callData) {
  const businessId = callData.businessId || callData.assistantId;
  if (!businessId) {
    log.warn('post-call: no businessId in callData — skipping');
    return;
  }

  const schedulerConfig = scheduler.getBusinessConfig(businessId) || {};
  const config = flowManager.mergeConfig(businessId, schedulerConfig);

  log.info(`Post-call [${callData.id}] — outcome:${callData.outcome} biz:${businessId}`);

  // ── 1. Email summary to owner (always) ──────────────────────────────────────
  if (config.ownerEmail) {
    await sendCallSummaryToOwner(callData, config).catch(e => log.warn('owner summary email failed', { err: e.message }));
  }

  // ── 2. WhatsApp alert to owner for bookings ──────────────────────────────────
  if (callData.outcome === 'booked' && callData.bookedAppointment) {
    const apt = callData.bookedAppointment;
    const msg = `📞 *Nueva reserva — ${config.name}*\n` +
                `━━━━━━━━━━━━\n` +
                `👤 ${apt.patientName}\n` +
                `📋 ${apt.service}\n` +
                `📅 ${apt.date} · ${apt.time}h\n` +
                (apt.phone ? `📞 ${apt.phone}` : '') +
                `\n━━━━━━━━━━━━\nGestionado por NodeFlow IA`;
    sendWhatsApp(msg).catch(() => {});
  }

  // ── 3. Booking confirmation to client ───────────────────────────────────────
  if (callData.outcome === 'booked' && callData.bookedAppointment?.email) {
    await sendBookingConfirmationEmail(callData.bookedAppointment, config)
      .catch(e => log.warn('booking confirmation email failed', { err: e.message }));
  }

  // ── 4. Follow-up to client for info calls (30 min delay) ────────────────────
  if (callData.outcome === 'info' && callData.clientEmail) {
    setTimeout(() => {
      sendCallFollowUpEmail(callData, config)
        .catch(e => log.warn('followup email failed', { err: e.message }));
    }, FOLLOWUP_DELAY_MS);
  }

  // ── 5. Persist call to Supabase (transcript + outcome) ──────────────────────
  const db = getDatabase();
  if (db.enabled && callData.id) {
    db.client.from('calls').upsert({
      call_sid:           callData.id,
      org_id:             businessId,
      outcome:            callData.outcome            || null,
      caller_number:      callData.callerNumber       || null,
      client_email:       callData.clientEmail        || null,
      booked_appointment: callData.bookedAppointment  || null,
      transcript:         callData.transcript         || [],
      duration_ms:        callData.duration           || 0,
      turn_count:         callData.turnCount          || 0,
      started_at:         callData.startTime          || null,
      ended_at:           callData.endTime            || null,
      status:             'ended',
    }, { onConflict: 'call_sid' })
      .catch(e => log.warn('call DB persist failed', { err: e.message }));
  }

  // ── 6. Upsert contact (phone → contacts table) ───────────────────────────────
  if (db.enabled && callData.callerNumber) {
    const apt   = callData.bookedAppointment;
    const pName = apt?.patientName || null;
    const pEmail = apt?.email || callData.clientEmail || null;
    db.client.rpc('upsert_contact', {
      p_org_id:       businessId,
      p_phone:        callData.callerNumber,
      p_name:         pName,
      p_email:        pEmail,
      p_last_call_at: callData.endTime || new Date().toISOString(),
    }).catch(e => log.warn('contact upsert failed', { err: e.message }));
  }
}

module.exports = { postCallHandler: { handle } };
```

- [ ] **Step 2: Verificar que el módulo carga sin errores**

```bash
node -e "
const { postCallHandler } = require('./src/automations/post-call-handler');
console.log(typeof postCallHandler.handle === 'function' ? 'OK' : 'ERROR');
" 2>&1 | grep -E "^OK|^ERROR"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/automations/post-call-handler.js
git commit -m "feat(crm): post-call handler persists call transcript + upserts contact in Supabase"
```

---

## Task 4: Añadir endpoints de contactos a routes-portal.js

**Files:**
- Modify: `src/api/routes-portal.js:403-404` (insertar antes de `} // end setupPortalRoutes`)

### Contexto
Añadir 4 endpoints al final de `setupPortalRoutes`, justo antes de la línea `} // end setupPortalRoutes`. Todos usan `portalAuth` y `getDatabase()`. Si la DB no está disponible, devuelven datos vacíos o 503.

- [ ] **Step 1: Añadir GET /api/portal/contacts y GET /api/portal/contacts/:id**

Localizar en `src/api/routes-portal.js` la línea:
```
} // end setupPortalRoutes
```

Insertar inmediatamente antes de ella:

```js
  // ── GET /api/portal/contacts ───────────────────────────────
  app.get('/api/portal/contacts', portalAuth, async (req, res) => {
    const { businessId } = req;
    const q  = (req.query.q || '').trim();
    const db = getDatabase();
    if (!db.enabled) return res.json({ contacts: [] });

    let query = db.client
      .from('contacts')
      .select('id,phone,name,email,call_count,last_call_at,created_at')
      .eq('org_id', businessId)
      .is('deleted_at', null)
      .order('last_call_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (q) {
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
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
      displayName: c.name || (aptByPhone[c.phone] && aptByPhone[c.phone].patientName) || c.phone,
    }));

    res.json({ ok: true, count: contacts.length, contacts });
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

    // 2. Fetch linked calls by phone
    const { data: calls } = await db.client
      .from('calls')
      .select('call_sid,outcome,started_at,ended_at,duration_ms,turn_count')
      .eq('org_id', businessId)
      .eq('caller_number', contact.phone)
      .order('started_at', { ascending: false })
      .limit(50);

    // 3. Fetch linked appointments by phone (in-memory)
    const apts = scheduler.getAppointments(businessId)
      .filter(a => a.phone === contact.phone)
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
        callSid:    c.call_sid,
        outcome:    c.outcome    || 'abandoned',
        startedAt:  c.started_at || null,
        endedAt:    c.ended_at   || null,
        durationMs: c.duration_ms || 0,
        turnCount:  c.turn_count  || 0,
      })),
      appointments: apts,
    });
  });
```

- [ ] **Step 2: Añadir PATCH /api/portal/contacts/:id y DELETE /api/portal/contacts/:id**

Justo debajo del endpoint anterior, todavía antes de `} // end setupPortalRoutes`:

```js
  // ── PATCH /api/portal/contacts/:id ────────────────────────
  app.patch('/api/portal/contacts/:id', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { id } = req.params;
    const { name, email, notes } = req.body;
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

    const patch = {};
    if (name  !== undefined) patch.name  = name  || null;
    if (email !== undefined) patch.email = email || null;
    if (notes !== undefined) patch.notes = notes || null;

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
```

- [ ] **Step 3: Verificar que el módulo carga**

```bash
node -e "
const app = { get:()=>{}, post:()=>{}, patch:()=>{}, delete:()=>{} };
const pipeline = { getCallHistory: () => [] };
const { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
console.log('OK');
" 2>&1 | grep -E "^OK|Error"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(crm): add GET/PATCH/DELETE /api/portal/contacts endpoints"
```

---

## Task 5: Añadir endpoint de transcript a routes-portal.js

**Files:**
- Modify: `src/api/routes-portal.js` (antes de `} // end setupPortalRoutes`)

- [ ] **Step 1: Añadir GET /api/portal/calls/:callSid/transcript**

Insertar antes de `} // end setupPortalRoutes`:

```js
  // ── GET /api/portal/calls/:callSid/transcript ──────────────
  app.get('/api/portal/calls/:callSid/transcript', portalAuth, async (req, res) => {
    const { businessId } = req;
    const { callSid } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.json({ transcript: [], available: false });

    const { data, error } = await db.client
      .from('calls')
      .select('transcript,outcome,started_at,ended_at,duration_ms,caller_number')
      .eq('call_sid', callSid)
      .eq('org_id', businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Transcripción no disponible para esta llamada' });
    }

    res.json({
      ok:           true,
      transcript:   data.transcript   || [],
      outcome:      data.outcome      || null,
      startedAt:    data.started_at   || null,
      endedAt:      data.ended_at     || null,
      durationMs:   data.duration_ms  || 0,
      callerNumber: data.caller_number || null,
      available:    (data.transcript || []).length > 0,
    });
  });
```

- [ ] **Step 2: Verificar routing completo**

```bash
node -e "
const routes = [];
const app = {
  get:    (p) => routes.push('GET '    + p),
  post:   (p) => routes.push('POST '   + p),
  patch:  (p) => routes.push('PATCH '  + p),
  delete: (p) => routes.push('DELETE ' + p),
};
const pipeline = { getCallHistory: () => [] };
const { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
const expected = [
  'GET /api/portal/contacts',
  'GET /api/portal/contacts/:id',
  'PATCH /api/portal/contacts/:id',
  'DELETE /api/portal/contacts/:id',
  'GET /api/portal/calls/:callSid/transcript',
];
expected.forEach(r => {
  console.log(routes.includes(r) ? 'OK ' + r : 'MISSING ' + r);
});
" 2>&1 | grep -v "INFO\|WARN\|Appointment\|Seeded\|Lumina\|booked"
```

Expected: cada línea empieza con `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(crm): add GET /api/portal/calls/:callSid/transcript endpoint"
```

---

## Task 6: Añadir CSS + shell de sección Clientes a index.html

**Files:**
- Modify: `public/portal/index.html`

### Contexto
`index.html` tiene un bloque `<style>` con CSS del portal. El sidebar tiene nav-items en orden: dashboard, llamadas, citas, informes, automatizaciones, (divider), configuracion. Clientes va entre citas e informes. Los section shells van en el `<main>` en el mismo orden.

- [ ] **Step 1: Añadir CSS de transcript y perfil de contacto**

Localizar en `index.html` el bloque CSS (dentro de `<style>`). Encontrar la línea:
```css
    /* ── Empty state ── */
```

Insertar justo ANTES de ella:

```css
    /* ── Transcript viewer ── */
    .transcript-list{max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0}
    .transcript-row{display:flex;flex-direction:column;gap:3px;padding:9px 12px;border-radius:8px}
    .transcript-row.ai{background:rgba(108,92,231,.12);border-left:3px solid var(--accent)}
    .transcript-row.user{background:var(--card);border-left:3px solid var(--border)}
    .transcript-role{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
    .transcript-text{font-size:13px;line-height:1.5;color:var(--text)}

    /* ── Contact profile ── */
    .profile-header{display:flex;align-items:flex-start;gap:16px;margin-bottom:20px}
    .profile-avatar{width:48px;height:48px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
    .profile-name{font-size:18px;font-weight:700;margin-bottom:2px}
    .profile-meta{font-size:13px;color:var(--dim)}
    .profile-section-title{font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)}

    /* ── Clientes search bar ── */
    .search-bar{display:flex;gap:8px;margin-bottom:20px}
    .search-input{flex:1;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:9px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
    .search-input:focus{border-color:var(--accent)}

```

- [ ] **Step 2: Añadir nav-clientes al sidebar**

Localizar en `index.html`:
```html
      <div class="nav-item"       id="nav-informes"          onclick="navigate('informes')">
```

Insertar ANTES de esa línea:

```html
      <div class="nav-item"       id="nav-clientes"          onclick="navigate('clientes')">
        <span class="nav-icon">👥</span><span>Clientes</span>
      </div>
```

- [ ] **Step 3: Añadir shell de sección #sec-clientes**

Localizar en `index.html`:
```html
    <div id="sec-informes" class="section">
```

Insertar ANTES de esa línea:

```html
    <div id="sec-clientes" class="section">
      <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-text">Cargando clientes…</div></div>
    </div>

```

- [ ] **Step 4: Verificar que HTML tiene los nuevos elementos**

```bash
grep -c "nav-clientes\|sec-clientes\|transcript-list\|search-input" public/portal/index.html
```

Expected: `4` (una coincidencia por cada término)

- [ ] **Step 5: Commit**

```bash
git add public/portal/index.html
git commit -m "feat(crm): add Clientes section shell + transcript/profile CSS to portal"
```

---

## Task 7: Añadir loadClientes + openContactProfile a portal.js

**Files:**
- Modify: `public/portal/portal.js`

### Contexto
`portal.js` tiene un bloque `navigate(section)` que llama funciones de carga por sección. Hay que añadir el case `clientes` y las funciones de carga. El archivo usa vanilla JS (sin frameworks). Las funciones de los otros secciones siguen el patrón: `async function loadXxx() { var sec = document.getElementById('sec-xxx'); sec.innerHTML = '...'; var data = await api(...); sec.innerHTML = '...'; }`. El modal se abre con `openModal(html)` / `closeModal()`.

- [ ] **Step 1: Añadir case 'clientes' en navigate()**

Localizar en `portal.js`:
```js
  else if (section === 'configuracion')    loadConfig();
```

Cambiar a:
```js
  else if (section === 'configuracion')    loadConfig();
  else if (section === 'clientes')         loadClientes();
```

- [ ] **Step 2: Añadir variable de debounce + función loadClientes() al final de portal.js (antes del comentario Boot)**

Localizar:
```js
// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', initAuth);
```

Insertar ANTES de ese bloque:

```js
// ── Clientes ──────────────────────────────────────────────────
var _clientesSearchTimer = null;

function onClientesSearch() {
  clearTimeout(_clientesSearchTimer);
  _clientesSearchTimer = setTimeout(function() {
    var q = document.getElementById('clientesSearch');
    loadClientes(q ? q.value.trim() : '');
  }, 300);
}

async function loadClientes(q) {
  q = q || '';
  var sec = document.getElementById('sec-clientes');
  sec.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div>Cargando clientes…</div></div>';

  var data;
  try {
    var qs = q ? '?q=' + encodeURIComponent(q) : '';
    data = await api('/api/portal/contacts' + qs);
  } catch (e) {
    sec.innerHTML = '<div class="empty-state"><div>Error: ' + esc(e.message) + '</div></div>';
    return;
  }

  var rows = '';
  if (data.contacts && data.contacts.length > 0) {
    for (var i = 0; i < data.contacts.length; i++) {
      var c = data.contacts[i];
      rows += '<tr onclick="openContactProfile(\'' + esc(c.id) + '\')" style="cursor:pointer">' +
        '<td><strong>' + esc(c.displayName) + '</strong>' +
          (c.name ? '<div style="font-size:11px;color:var(--dim)">' + esc(c.phone) + '</div>' : '') + '</td>' +
        '<td>' + esc(c.email || '—') + '</td>' +
        '<td style="text-align:center"><span class="badge bp">' + (c.callCount || 0) + '</span></td>' +
        '<td style="color:var(--dim);font-size:12px">' + (c.lastCallAt ? timeAgo(c.lastCallAt) : '—') + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="event.stopPropagation();openContactProfile(\'' + esc(c.id) + '\')">Ver →</button></td>' +
        '</tr>';
    }
  } else {
    rows = '<tr class="empty-row"><td colspan="5">' +
      (q ? 'Sin resultados para "' + esc(q) + '"' : 'Aún no hay clientes registrados. Aparecerán tras las primeras llamadas.') +
      '</td></tr>';
  }

  sec.innerHTML =
    '<div class="section-header">' +
      '<div class="section-title">👥 Clientes</div>' +
      '<div style="font-size:13px;color:var(--dim)">' + (data.count || 0) + ' contactos</div>' +
    '</div>' +
    '<div class="search-bar">' +
      '<input class="search-input" id="clientesSearch" placeholder="Buscar por nombre, teléfono o email…"' +
        ' value="' + esc(q) + '" oninput="onClientesSearch()">' +
    '</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Cliente</th><th>Email</th><th>Llamadas</th><th>Última llamada</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
}
```

- [ ] **Step 3: Añadir openContactProfile() justo debajo de loadClientes()**

```js
async function openContactProfile(id) {
  openModal('<div class="modal-title">👤 Perfil de cliente</div>' +
    '<div style="color:var(--dim);font-size:13px">Cargando…</div>');

  var data;
  try {
    data = await api('/api/portal/contacts/' + id);
  } catch (e) {
    openModal('<div class="modal-title">👤 Perfil de cliente</div>' +
      '<p style="color:var(--dim)">Error: ' + esc(e.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }

  var c = data.contact;
  var initial = (c.displayName || c.phone).charAt(0).toUpperCase();

  // Calls table rows
  var callRows = '';
  var OUTCOME_BADGE = {
    booked: '<span class="badge bg">reserva</span>',
    info:   '<span class="badge binfo">info</span>',
    abandoned: '<span class="badge bd">abandonada</span>',
  };
  if (data.calls && data.calls.length > 0) {
    for (var i = 0; i < data.calls.length; i++) {
      var cl = data.calls[i];
      var dur = cl.durationMs ? Math.round(cl.durationMs / 1000) + 's' : '—';
      callRows += '<tr>' +
        '<td>' + (cl.startedAt ? new Date(cl.startedAt).toLocaleDateString('es-ES') : '—') + '</td>' +
        '<td>' + dur + '</td>' +
        '<td>' + (OUTCOME_BADGE[cl.outcome] || '<span class="badge bd">' + esc(cl.outcome) + '</span>') + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(cl.callSid) + '\')">💬</button></td>' +
        '</tr>';
    }
  } else {
    callRows = '<tr class="empty-row"><td colspan="4">Sin llamadas registradas</td></tr>';
  }

  // Appointments table rows
  var aptRows = '';
  if (data.appointments && data.appointments.length > 0) {
    for (var j = 0; j < data.appointments.length; j++) {
      var a = data.appointments[j];
      var statusBadge = a.status === 'cancelled'
        ? '<span class="badge br">Cancelada</span>'
        : '<span class="badge bg">✓ Confirmada</span>';
      aptRows += '<tr>' +
        '<td>' + fmtDate(a.date) + '</td>' +
        '<td>' + esc(a.time || '—') + '</td>' +
        '<td>' + esc(a.service || '—') + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '</tr>';
    }
  } else {
    aptRows = '<tr class="empty-row"><td colspan="4">Sin citas registradas</td></tr>';
  }

  openModal(
    '<div class="profile-header">' +
      '<div class="profile-avatar">' + initial + '</div>' +
      '<div>' +
        '<div class="profile-name">' + esc(c.displayName) + '</div>' +
        '<div class="profile-meta">' + esc(c.phone) +
          (c.email ? ' · ' + esc(c.email) : '') + '</div>' +
        '<div style="font-size:12px;color:var(--dim);margin-top:4px">' +
          (c.callCount || 0) + ' llamadas · Cliente desde ' + fmtDate((c.createdAt || '').slice(0,10)) +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="profile-section-title">Nombre y notas</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Nombre</label>' +
      '<input class="form-input" id="cpName" value="' + esc(c.name || '') + '" placeholder="' + esc(c.phone) + '">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Email</label>' +
      '<input class="form-input" id="cpEmail" type="email" value="' + esc(c.email || '') + '">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Notas</label>' +
      '<textarea class="form-input" id="cpNotes" rows="3" onblur="saveContactNotes(\'' + esc(id) + '\')">' + esc(c.notes || '') + '</textarea>' +
      '<small style="color:var(--dim);font-size:11px">Se guarda automáticamente al salir del campo</small>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<button class="btn btn-accent btn-sm" onclick="saveContactNotes(\'' + esc(id) + '\', true)">Guardar datos</button>' +
      '<button class="btn btn-r btn-sm" onclick="deleteContact(\'' + esc(id) + '\')">Eliminar contacto</button>' +
    '</div>' +

    '<div class="profile-section-title">Historial de llamadas</div>' +
    '<div class="table-wrap" style="margin-bottom:16px"><table>' +
      '<thead><tr><th>Fecha</th><th>Duración</th><th>Resultado</th><th>Transcript</th></tr></thead>' +
      '<tbody>' + callRows + '</tbody></table></div>' +

    '<div class="profile-section-title">Historial de citas</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>Fecha</th><th>Hora</th><th>Servicio</th><th>Estado</th></tr></thead>' +
      '<tbody>' + aptRows + '</tbody></table></div>' +

    '<div class="modal-actions" style="margin-top:20px">' +
      '<button class="btn btn-d" onclick="closeModal()">Cerrar</button>' +
    '</div>'
  );
}
```

- [ ] **Step 4: Verificar que las funciones existen en portal.js**

```bash
node -e "
var fs = require('fs');
var src = fs.readFileSync('./public/portal/portal.js', 'utf8');
['loadClientes', 'onClientesSearch', 'openContactProfile'].forEach(function(fn) {
  console.log(src.includes('function ' + fn) ? 'OK ' + fn : 'MISSING ' + fn);
});
"
```

Expected: tres líneas `OK`

- [ ] **Step 5: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(crm): add loadClientes + openContactProfile to portal.js"
```

---

## Task 8: Añadir saveContactNotes + deleteContact a portal.js

**Files:**
- Modify: `public/portal/portal.js`

- [ ] **Step 1: Añadir saveContactNotes() y deleteContact() después de openContactProfile()**

Localizar en `portal.js` la función `openContactProfile`. Justo DESPUÉS de su cierre `}`, insertar:

```js
async function saveContactNotes(id, withNameEmail) {
  var patch = {
    notes: (document.getElementById('cpNotes') || {}).value || '',
  };
  if (withNameEmail) {
    var nameEl  = document.getElementById('cpName');
    var emailEl = document.getElementById('cpEmail');
    if (nameEl)  patch.name  = nameEl.value.trim()  || null;
    if (emailEl) patch.email = emailEl.value.trim()  || null;
  }
  try {
    await api('/api/portal/contacts/' + id, 'PATCH', patch);
    toast(withNameEmail ? 'Contacto actualizado' : 'Notas guardadas');
    // Refresh clientes list if visible
    if (_currentSection === 'clientes') loadClientes();
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'err');
  }
}

function deleteContact(id) {
  openModal(
    '<div class="modal-title">Eliminar contacto</div>' +
    '<p style="color:var(--dim);margin-bottom:20px">¿Seguro que quieres eliminar este contacto? Se eliminarán sus notas y datos editados, pero el historial de llamadas permanece en el sistema.</p>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-d" onclick="closeModal()">Cancelar</button>' +
      '<button class="btn btn-r" onclick="confirmDeleteContact(\'' + esc(id) + '\')">Sí, eliminar</button>' +
    '</div>'
  );
}

async function confirmDeleteContact(id) {
  try {
    await api('/api/portal/contacts/' + id, 'DELETE');
    closeModal();
    toast('Contacto eliminado');
    if (_currentSection === 'clientes') loadClientes();
  } catch (e) {
    toast('Error: ' + e.message, 'err');
  }
}
```

- [ ] **Step 2: Verificar funciones**

```bash
node -e "
var fs = require('fs');
var src = fs.readFileSync('./public/portal/portal.js', 'utf8');
['saveContactNotes','deleteContact','confirmDeleteContact'].forEach(function(fn) {
  console.log(src.includes('function ' + fn) ? 'OK ' + fn : 'MISSING ' + fn);
});
"
```

Expected: tres líneas `OK`

- [ ] **Step 3: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(crm): add saveContactNotes + deleteContact to portal.js"
```

---

## Task 9: Añadir openTranscriptModal + botón transcript en loadCalls

**Files:**
- Modify: `public/portal/portal.js`

### Contexto
`loadCalls()` genera una tabla HTML. Hay que añadir una columna `Transcript` con botón `💬` en cada fila. También añadir la función `openTranscriptModal(callSid)` que llama al endpoint de transcript.

- [ ] **Step 1: Añadir openTranscriptModal() antes del bloque Boot**

Localizar en `portal.js`:
```js
// ── Boot ──────────────────────────────────────────────────────
```

Insertar ANTES de ese bloque:

```js
// ── Transcript modal ──────────────────────────────────────────
async function openTranscriptModal(callSid) {
  if (!callSid) {
    openModal('<div class="modal-title">💬 Transcripción</div>' +
      '<p style="color:var(--dim)">ID de llamada no disponible. Actualiza la sección Llamadas.</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }
  openModal('<div class="modal-title">💬 Transcripción</div>' +
    '<div style="color:var(--dim);font-size:13px;padding:12px 0">Cargando…</div>');
  var data;
  try {
    data = await api('/api/portal/calls/' + callSid + '/transcript');
  } catch (e) {
    openModal('<div class="modal-title">💬 Transcripción</div>' +
      '<p style="color:var(--dim)">No disponible: ' + esc(e.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
    return;
  }

  var dateStr = data.startedAt ? new Date(data.startedAt).toLocaleDateString('es-ES', {day:'numeric',month:'long'}) : '';
  var durStr  = data.durationMs ? Math.round(data.durationMs / 1000) + 's' : '';

  var rows = '';
  if (data.transcript && data.transcript.length > 0) {
    for (var i = 0; i < data.transcript.length; i++) {
      var t = data.transcript[i];
      var isAI = t.role === 'assistant';
      rows += '<div class="transcript-row ' + (isAI ? 'ai' : 'user') + '">' +
        '<span class="transcript-role">' + (isAI ? '🤖 AI' : '👤 Cliente') + '</span>' +
        '<span class="transcript-text">' + esc(t.content || '') + '</span>' +
        '</div>';
    }
  } else {
    rows = '<div style="color:var(--dim);font-size:13px;padding:12px 0">Sin transcripción disponible para esta llamada.</div>';
  }

  openModal(
    '<div class="modal-title">💬 Transcripción' + (dateStr ? ' · ' + dateStr : '') + '</div>' +
    (durStr ? '<div style="font-size:12px;color:var(--dim);margin-bottom:12px">' + durStr + ' · ' + data.transcript.length + ' turnos</div>' : '') +
    '<div class="transcript-list">' + rows + '</div>' +
    '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>'
  );
}
```

- [ ] **Step 2: Añadir columna Transcript en loadCalls()**

Hay tres cambios en `loadCalls()` en `public/portal/portal.js`:

**Cambio 2a — línea de cabecera** (aprox. línea 333):

Reemplazar:
```js
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Email cliente</th></tr></thead>' +
```
Por:
```js
      '<thead><tr><th>Cuándo</th><th>Duración</th><th>Resultado</th><th>Detalles</th><th>Email cliente</th><th>💬</th></tr></thead>' +
```

**Cambio 2b — fila de datos** (aprox. línea 308):

Reemplazar:
```js
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + c.turnCount + ' turnos' + apt + '</td>' +
        '<td style="color:var(--dim)">' + esc(c.clientEmail || '—') + '</td></tr>';
```
Por:
```js
      rows += '<tr><td>' + timeAgo(c.startedAt) + '</td><td>' + dur + '</td><td>' + badge + '</td>' +
        '<td>' + c.turnCount + ' turnos' + apt + '</td>' +
        '<td style="color:var(--dim)">' + esc(c.clientEmail || '—') + '</td>' +
        '<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(c.callId || '') + '\')">💬</button></td></tr>';
```

**Cambio 2c — fila vacía** (aprox. línea 313):

Reemplazar:
```js
    rows = '<tr class="empty-row"><td colspan="5">No hay llamadas con estos filtros</td></tr>';
```
Por:
```js
    rows = '<tr class="empty-row"><td colspan="6">No hay llamadas con estos filtros</td></tr>';
```

- [ ] **Step 3: Verificar funciones en portal.js**

```bash
node -e "
var fs = require('fs');
var src = fs.readFileSync('./public/portal/portal.js', 'utf8');
['openTranscriptModal'].forEach(function(fn) {
  console.log(src.includes('function ' + fn) ? 'OK ' + fn : 'MISSING ' + fn);
});
console.log(src.includes('transcript-list') ? 'OK transcript-list CSS class' : 'MISSING transcript-list');
console.log(src.includes('openTranscriptModal') && src.includes('loadCalls') ? 'OK transcript btn in loadCalls' : 'CHECK transcript btn in loadCalls');
"
```

Expected: todas las líneas con `OK`

- [ ] **Step 4: Commit**

```bash
git add public/portal/portal.js
git commit -m "feat(crm): add openTranscriptModal + transcript button in Llamadas"
```

---

## Task 10: Smoke tests finales

**Files:** Ninguno — solo verificaciones

- [ ] **Step 1: Verificar que todos los endpoints existen (sin errores de routing)**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
node -e "
var routes = [];
var app = {
  get:    function(p) { routes.push('GET '    + p); },
  post:   function(p) { routes.push('POST '   + p); },
  patch:  function(p) { routes.push('PATCH '  + p); },
  delete: function(p) { routes.push('DELETE ' + p); },
};
var pipeline = { getCallHistory: function() { return []; } };
var { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
var expected = [
  'GET /api/portal/dashboard',
  'GET /api/portal/calls',
  'GET /api/portal/appointments',
  'POST /api/portal/appointments',
  'PATCH /api/portal/appointments/:id',
  'DELETE /api/portal/appointments/:id',
  'GET /api/portal/reports',
  'GET /api/portal/automations',
  'PATCH /api/portal/automations',
  'GET /api/portal/config',
  'PATCH /api/portal/config',
  'GET /api/portal/contacts',
  'GET /api/portal/contacts/:id',
  'PATCH /api/portal/contacts/:id',
  'DELETE /api/portal/contacts/:id',
  'GET /api/portal/calls/:callSid/transcript',
];
var ok = true;
expected.forEach(function(r) {
  if (!routes.includes(r)) { console.log('MISSING: ' + r); ok = false; }
});
if (ok) console.log('ALL ' + expected.length + ' ROUTES OK');
" 2>&1 | grep -v "INFO\|WARN\|booked\|Seeded\|Lumina\|Appointment"
```

Expected: `ALL 16 ROUTES OK`

- [ ] **Step 2: Verificar que post-call-handler importa getDatabase**

```bash
grep "getDatabase" C:/Users/unais/.gemini/antigravity/scratch/voicecore/src/automations/post-call-handler.js
```

Expected: `const { getDatabase }    = require('../db/database');`

- [ ] **Step 3: Verificar que index.html tiene los 7 elementos nuevos**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
node -e "
var fs = require('fs');
var html = fs.readFileSync('./public/portal/index.html', 'utf8');
var checks = [
  'nav-clientes',
  'sec-clientes',
  'transcript-list',
  'transcript-row',
  'profile-header',
  'search-input',
  'search-bar',
];
checks.forEach(function(c) {
  console.log(html.includes(c) ? 'OK ' + c : 'MISSING ' + c);
});
"
```

Expected: 7 líneas `OK`

- [ ] **Step 4: Verificar que portal.js tiene todas las funciones nuevas**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
node -e "
var fs = require('fs');
var src = fs.readFileSync('./public/portal/portal.js', 'utf8');
var fns = ['loadClientes','onClientesSearch','openContactProfile',
           'saveContactNotes','deleteContact','confirmDeleteContact',
           'openTranscriptModal'];
fns.forEach(function(fn) {
  console.log(src.includes('function ' + fn) ? 'OK ' + fn : 'MISSING ' + fn);
});
"
```

Expected: 7 líneas `OK`

- [ ] **Step 5: Verificar que el servidor arranca**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
node -e "
var app = { get:function(){}, post:function(){}, patch:function(){}, delete:function(){}, use:function(){} };
var pipeline = { getCallHistory: function() { return []; }, startCall: function(){} };
var { setupPortalRoutes } = require('./src/api/routes-portal');
setupPortalRoutes(app, pipeline);
var { postCallHandler } = require('./src/automations/post-call-handler');
console.log(typeof postCallHandler.handle === 'function' ? 'SERVER MODULES OK' : 'ERROR');
" 2>&1 | grep -E "SERVER MODULES OK|ERROR"
```

Expected: `SERVER MODULES OK`

- [ ] **Step 6: Commit final si hay cambios sin commitear**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
git status --short
```

Si hay archivos modificados sin commitear, añadirlos y commitear:

```bash
git add -A
git commit -m "feat(crm): CRM ligero + transcripciones — smoke tests pass"
```

---

## Resumen de commits esperados

1. `fix(portal): use c.id/startTime/endTime in GET /api/portal/calls`
2. `feat(crm): post-call handler persists call transcript + upserts contact in Supabase`
3. `feat(crm): add GET/PATCH/DELETE /api/portal/contacts endpoints`
4. `feat(crm): add GET /api/portal/calls/:callSid/transcript endpoint`
5. `feat(crm): add Clientes section shell + transcript/profile CSS to portal`
6. `feat(crm): add loadClientes + openContactProfile to portal.js`
7. `feat(crm): add saveContactNotes + deleteContact to portal.js`
8. `feat(crm): add openTranscriptModal + transcript button in Llamadas`
