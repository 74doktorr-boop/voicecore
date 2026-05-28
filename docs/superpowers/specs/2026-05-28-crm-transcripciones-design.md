# CRM Ligero + Transcripciones — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Añadir una sección "Clientes" al portal de negocio con historial por teléfono, notas editables y visor de transcripciones de llamadas.

**Architecture:** Persistencia real desde el primer día. El post-call handler existente se extiende con dos pasos fire-and-forget: guardar el transcript en la tabla `calls` de Supabase y hacer upsert del contacto en una nueva tabla `contacts`. El portal lee siempre de Supabase: sección Clientes muestra contactos con perfil completo; sección Llamadas añade botón de transcript.

**Tech Stack:** Node.js, Express, Supabase (PostgreSQL), vanilla JS (sin framework), patrón existente del portal.

---

## Contexto del sistema

### Auth del portal
- JWT de sesión (HMAC SHA-256) en `localStorage` key `nf_session`, enviado como `Authorization: Bearer`
- `portalAuth` middleware en `routes-portal.js` verifica JWT → resuelve `businessId` desde `flowManager.list()` o DB fallback
- `businessId` = `org_id` en Supabase

### Datos disponibles en `callData` (post-call)
Cada llamada finalizada tiene: `id` (callId), `businessId`, `callerNumber`, `outcome` (`booked`|`info`|`abandoned`), `transcript` (array de `{role, content, timestamp}`), `duration`, `turnCount`, `startTime`, `endTime`, `bookedAppointment` (con `patientName`, `phone`, `email`, `service`, `date`, `time` si aplica), `clientEmail`.

### Tablas Supabase existentes relevantes
- `organizations` — `id`, `owner_email`, `name`, `plan`, etc.
- `calls` — `id`, `org_id`, `call_sid`, `caller_number`, `status`, `duration_ms`, `turn_count`, `transcript` (JSONB), `outcome`, `caller_number`, etc. ← **la ampliamos**
- `appointments` (via scheduler en memoria) — datos de citas

---

## Modelo de datos

### Tabla nueva: `contacts`

```sql
CREATE TABLE contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  name        TEXT,
  email       TEXT,
  notes       TEXT,
  call_count  INTEGER NOT NULL DEFAULT 0,
  last_call_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ,
  UNIQUE (org_id, phone)
);

CREATE INDEX idx_contacts_org_id ON contacts(org_id);
CREATE INDEX idx_contacts_phone  ON contacts(org_id, phone);
```

### Ampliación tabla `calls` (columnas añadidas)

```sql
ALTER TABLE calls ADD COLUMN IF NOT EXISTS outcome      TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_number TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS client_email  TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS booked_appointment JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS started_at   TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_at     TIMESTAMPTZ;
```

> Nota: algunas de estas columnas pueden ya existir. El `IF NOT EXISTS` las hace idempotentes.

---

## Cambios en el post-call handler

Archivo: `src/automations/post-call-handler.js`

Se añaden **2 pasos nuevos** al final de `handle()`, ambos fire-and-forget:

### Paso 5: Persistir llamada en DB

```js
// ── 5. Persist call to DB (transcript + outcome) ────────────────────────────
const db = getDatabase();
if (db.enabled) {
  db.client.from('calls').upsert({
    call_sid:            callData.id,
    org_id:              businessId,
    outcome:             callData.outcome,
    caller_number:       callData.callerNumber || null,
    client_email:        callData.clientEmail  || null,
    booked_appointment:  callData.bookedAppointment || null,
    transcript:          callData.transcript   || [],
    duration_ms:         callData.duration     || 0,
    turn_count:          callData.turnCount    || 0,
    started_at:          callData.startTime,
    ended_at:            callData.endTime,
    status:              'ended',
  }, { onConflict: 'call_sid' }).catch(e => log.warn('call DB persist failed', { err: e.message }));
}
```

### Paso 6: Upsert contacto

```js
// ── 6. Upsert contact ────────────────────────────────────────────────────────
if (db.enabled && callData.callerNumber) {
  const apt = callData.bookedAppointment;
  const patch = {
    org_id:       businessId,
    phone:        callData.callerNumber,
    last_call_at: callData.endTime || new Date().toISOString(),
  };
  // Only fill name/email if contact doesn't already have them
  // We do this with a conditional upsert: insert with name/email,
  // on conflict update only last_call_at and increment call_count
  db.client.rpc('upsert_contact', {
    p_org_id:      businessId,
    p_phone:       callData.callerNumber,
    p_name:        apt?.patientName || null,
    p_email:       apt?.email || callData.clientEmail || null,
    p_last_call_at: callData.endTime || new Date().toISOString(),
  }).catch(e => log.warn('contact upsert failed', { err: e.message }));
}
```

La lógica de upsert se implementa como función SQL `upsert_contact` (ver sección DB):

```sql
CREATE OR REPLACE FUNCTION upsert_contact(
  p_org_id UUID, p_phone TEXT, p_name TEXT,
  p_email TEXT, p_last_call_at TIMESTAMPTZ
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO contacts (org_id, phone, name, email, last_call_at, call_count)
  VALUES (p_org_id, p_phone, p_name, p_email, p_last_call_at, 1)
  ON CONFLICT (org_id, phone) DO UPDATE SET
    last_call_at = EXCLUDED.last_call_at,
    call_count   = contacts.call_count + 1,
    -- Only overwrite name/email if currently NULL
    name  = COALESCE(contacts.name,  EXCLUDED.name),
    email = COALESCE(contacts.email, EXCLUDED.email);
END;
$$;
```

---

## API endpoints (routes-portal.js)

Todos protegidos por `portalAuth`. Se añaden a `setupPortalRoutes`.

### GET /api/portal/contacts

Lista todos los contactos del negocio (no eliminados), ordenados por `last_call_at DESC`.

```js
app.get('/api/portal/contacts', portalAuth, async (req, res) => {
  const { businessId } = req;
  const q = req.query.q?.trim() || '';
  const db = getDatabase();
  if (!db.enabled) return res.json({ contacts: [] });

  let query = db.client
    .from('contacts')
    .select('id,phone,name,email,call_count,last_call_at,created_at')
    .eq('org_id', businessId)
    .is('deleted_at', null)
    .order('last_call_at', { ascending: false })
    .limit(200);

  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with latest appointment name if contact has no name
  const scheduler = require('../scheduling/scheduler').scheduler;
  const apts = scheduler.getAppointments(businessId);
  const aptByPhone = {};
  apts.forEach(a => { if (a.phone && !aptByPhone[a.phone]) aptByPhone[a.phone] = a; });

  const contacts = (data || []).map(c => ({
    ...c,
    displayName: c.name || aptByPhone[c.phone]?.patientName || c.phone,
  }));

  res.json({ contacts });
});
```

### GET /api/portal/contacts/:id

Perfil completo: datos del contacto + historial de llamadas (con transcript disponible) + citas asociadas.

```js
app.get('/api/portal/contacts/:id', portalAuth, async (req, res) => {
  const { businessId } = req;
  const { id } = req.params;
  const db = getDatabase();
  if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });

  // Fetch contact first (need phone to query linked calls)
  const { data: contact } = await db.client
    .from('contacts').select('*').eq('id', id).eq('org_id', businessId).single();

  if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

  // Fetch calls by this contact's phone
  const { data: callsByPhone } = await db.client
    .from('calls')
    .select('id,call_sid,outcome,started_at,ended_at,duration_ms,turn_count')
    .eq('org_id', businessId)
    .eq('caller_number', contact.phone)
    .order('started_at', { ascending: false })
    .limit(50);

  // Fetch appointments linked by phone
  const scheduler = require('../scheduling/scheduler').scheduler;
  const apts = scheduler.getAppointments(businessId)
    .filter(a => a.phone === contact.phone)
    .sort((a, b) => new Date(b.date + 'T' + b.time) - new Date(a.date + 'T' + a.time));

  res.json({
    contact: {
      ...contact,
      displayName: contact.name || contact.phone,
    },
    calls: (callsByPhone || []).map(c => ({
      callSid:    c.call_sid,
      outcome:    c.outcome,
      startedAt:  c.started_at,
      endedAt:    c.ended_at,
      durationMs: c.duration_ms,
      turnCount:  c.turn_count,
      hasTranscript: true, // always true if saved from post-call
    })),
    appointments: apts,
  });
});
```

### PATCH /api/portal/contacts/:id

Edita `name`, `email`, `notes`.

```js
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

  const { data, error } = await db.client
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .eq('org_id', businessId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Contacto no encontrado' });
  res.json({ ok: true, contact: data });
});
```

### DELETE /api/portal/contacts/:id

Soft-delete: pone `deleted_at = NOW()`.

```js
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

### GET /api/portal/calls/:callSid/transcript

Devuelve el transcript de una llamada específica desde Supabase.

```js
app.get('/api/portal/calls/:callSid/transcript', portalAuth, async (req, res) => {
  const { businessId } = req;
  const { callSid } = req.params;
  const db = getDatabase();
  if (!db.enabled) return res.json({ transcript: [] });

  const { data, error } = await db.client
    .from('calls')
    .select('transcript,outcome,started_at,duration_ms,caller_number')
    .eq('call_sid', callSid)
    .eq('org_id', businessId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Llamada no encontrada' });
  res.json({
    transcript:   data.transcript || [],
    outcome:      data.outcome,
    startedAt:    data.started_at,
    durationMs:   data.duration_ms,
    callerNumber: data.caller_number,
  });
});
```

---

## Frontend

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `public/portal/index.html` | +`#sec-clientes` shell en sidebar y sección body |
| `public/portal/portal.js` | +`loadClientes()`, `loadContactProfile()`, `saveContact()`, `deleteContact()`, `openTranscriptModal()`, +botón transcript en `loadCalls()` |

### Sidebar (index.html)

Añadir entre `#nav-citas` e `#nav-informes`:

```html
<div class="nav-item" id="nav-clientes" onclick="navigate('clientes')">
  <span class="nav-icon">👥</span>
  <span class="nav-label">Clientes</span>
</div>
```

Y el shell de sección:

```html
<div class="section" id="sec-clientes">
  <div class="empty-state">
    <div class="empty-state-icon">⏳</div>
    <div class="empty-state-text">Cargando clientes…</div>
  </div>
</div>
```

### navigate() — añadir case

```js
else if (section === 'clientes') loadClientes();
```

### loadClientes(q)

- Búsqueda con debounce 300ms
- Tabla: nombre/teléfono, email, nº llamadas, última llamada, botón "Ver perfil"
- Al hacer click en fila → `openContactProfile(id)`

### openContactProfile(id)

Abre modal grande (o panel) con:
- Header: nombre editable (click para editar), teléfono, email, badge
- Textarea notas con botón "Guardar notas" (autoguardado on-blur)
- Tabla "Llamadas" con columnas: fecha, duración, resultado, botón 💬 transcript
- Tabla "Citas" con columnas: fecha, hora, servicio, estado

### openTranscriptModal(callSid)

```js
async function openTranscriptModal(callSid) {
  openModal('<div class="modal-title">💬 Transcripción</div>' +
    '<div style="color:var(--dim);font-size:13px">Cargando…</div>');
  try {
    var data = await api('/api/portal/calls/' + callSid + '/transcript');
    var rows = '';
    for (var i = 0; i < data.transcript.length; i++) {
      var t = data.transcript[i];
      var isAI = t.role === 'assistant';
      rows += '<div class="transcript-row ' + (isAI ? 'ai' : 'user') + '">' +
        '<span class="transcript-role">' + (isAI ? '🤖 AI' : '👤 Cliente') + '</span>' +
        '<span class="transcript-text">' + esc(t.content) + '</span></div>';
    }
    openModal(
      '<div class="modal-title">💬 Transcripción · ' + esc(new Date(data.startedAt).toLocaleDateString('es-ES')) + '</div>' +
      '<div class="transcript-list">' + (rows || '<div style="color:var(--dim)">Sin transcripción disponible</div>') + '</div>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>'
    );
  } catch (e) {
    openModal('<div class="modal-title">💬 Transcripción</div>' +
      '<p style="color:var(--dim)">No disponible: ' + esc(e.message) + '</p>' +
      '<div class="modal-actions"><button class="btn btn-d" onclick="closeModal()">Cerrar</button></div>');
  }
}
```

### CSS nuevo (index.html `<style>`)

```css
.transcript-list { max-height:420px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:4px 0; }
.transcript-row  { display:flex; flex-direction:column; gap:2px; padding:8px 12px; border-radius:8px; }
.transcript-row.ai   { background:rgba(108,92,231,.12); border-left:3px solid var(--accent); }
.transcript-row.user { background:var(--card); border-left:3px solid var(--border); }
.transcript-role { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); }
.transcript-text { font-size:13px; line-height:1.5; color:var(--text); }
.contact-notes   { width:100%; min-height:80px; resize:vertical; }
.profile-header  { display:flex; align-items:flex-start; gap:16px; margin-bottom:20px; }
.profile-avatar  { width:48px; height:48px; border-radius:50%; background:var(--accent); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
.profile-name    { font-size:18px; font-weight:700; }
.profile-meta    { font-size:13px; color:var(--dim); margin-top:2px; }
```

### Botón transcript en loadCalls() (existente)

Añadir una columna extra en la tabla de llamadas:

```js
// En la fila de cada llamada, añadir al final:
'<td><button class="btn btn-d btn-sm" onclick="openTranscriptModal(\'' + esc(c.callId) + '\')">💬</button></td>'
```

Y añadir `<th>Transcript</th>` al header.

---

## Nota de implementación: callId vs call_sid

`callData.id` (campo del objeto que devuelve `session.toJSON()`) es el identificador interno de la llamada (UUID generado por `CallSession`, que puede ser el SID de Twilio si se pasa como `callId` al arrancar la sesión). En el post-call handler, se almacena como `call_sid: callData.id`.

El endpoint `GET /api/portal/calls` actual devuelve `callId: c.callId` — esto puede devolver `undefined` porque el objeto tiene `c.id`, no `c.callId`. **En la tarea de frontend, el plan writer debe verificar y corregir a `callId: c.id`** para que el botón de transcript funcione.

El endpoint de transcript usa `call_sid` como clave de lookup en Supabase. El frontend envía el `callId` recibido de la lista de llamadas → que tras la corrección será `c.id` → que coincide con lo almacenado como `call_sid`.

---

## Flujo de error / estados vacíos

| Situación | Comportamiento |
|-----------|---------------|
| DB no disponible | Sección Clientes muestra "CRM no disponible (modo offline)" |
| Contacto sin nombre | Se muestra el número de teléfono formateado |
| Transcript no guardado (llamadas anteriores al deploy) | Modal muestra "Transcripción no disponible para esta llamada" |
| Sin llamadas | Tabla vacía con mensaje "Aún no hay llamadas registradas" |
| Error de red en autoguardado de notas | Toast error, notas no se pierden del textarea |

---

## Fuera de alcance

- Fusión manual de dos contactos con el mismo número pero registrado diferente
- Exportar clientes a CSV
- Etiquetas/tags por cliente
- Historial de ediciones de notas
- Búsqueda full-text avanzada (solo `ilike` por ahora)
- Notificaciones push cuando llama un cliente conocido

---

## Ficheros a crear/modificar

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/automations/post-call-handler.js` | Modificar | +Persistir call en DB + upsert contacto |
| `src/api/routes-portal.js` | Modificar | +5 endpoints nuevos |
| `public/portal/index.html` | Modificar | +sidebar nav-clientes + sec-clientes shell + CSS transcript/profile |
| `public/portal/portal.js` | Modificar | +loadClientes, openContactProfile, saveContact, deleteContact, openTranscriptModal, +transcript btn en loadCalls |

**SQL a ejecutar en Supabase (una vez):**
- `CREATE TABLE contacts (...)` con índices
- `ALTER TABLE calls ADD COLUMN IF NOT EXISTS ...` (outcome, caller_number, etc.)
- `CREATE OR REPLACE FUNCTION upsert_contact(...)` 
