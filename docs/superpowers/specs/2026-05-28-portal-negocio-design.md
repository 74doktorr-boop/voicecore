# Portal de Negocio — Design Spec

**Date:** 2026-05-28  
**Status:** Approved for implementation  
**Author:** Brainstorming session with user

---

## Goal

Build a full-featured business portal that each NodeFlow customer accesses after logging in. The portal gives the business owner complete visibility and control over their AI: calls handled, appointments booked, reports, automations status, and full configuration of their setup — all from a professional sidebar-based SaaS UI, mobile-first.

---

## Architecture

### Approach: Extend existing portal (rewrite HTML + extract JS)

Rather than a new route or SPA framework, we rewrite `public/portal/index.html` in-place and extract its JavaScript to a new `public/portal/portal.js`. A new API file `src/api/routes-portal.js` provides all portal data endpoints. The existing auth flow (magic link → session token cookie) is preserved without changes.

**Auth pattern:**  
Session JWT cookie `nf_session` contains `{ email, registroId, exp }`. All portal API routes verify this token. To resolve `businessId`, routes search `flowManager` for the flow where `flow.ownerEmail === session.email`. No changes to auth infrastructure needed.

**Tech stack:** Vanilla JS (no framework), CSS custom properties, Inter font, existing session/auth stack, Supabase for persistence already in place.

---

## UI Structure

### Layout: Sidebar fija

- **Desktop (≥768px):** 220px fixed left sidebar + full-width main content area
- **Mobile (<768px):** Sidebar hidden, hamburger button (☰) in top-left, sidebar slides in as an overlay with a dark backdrop

### Sidebar nav items (in order)

| Icon | Label | Section ID |
|------|-------|-----------|
| 📊 | Dashboard | `sec-dashboard` |
| 📞 | Llamadas | `sec-llamadas` |
| 🗓️ | Citas | `sec-citas` |
| 📈 | Informes | `sec-informes` |
| 🤖 | Automatizaciones | `sec-automatizaciones` |
| ⚙️ | Configuración | `sec-configuracion` |

Bottom of sidebar: plan badge (PLAN NEGOCIO · €49/mes · Activo), logout button.

### Color tokens (existing, no changes)
```css
--bg:#07070e; --card:#0f0f18; --card2:#14141e;
--accent:#6c5ce7; --accent-l:#a29bfe;
--green:#00cec9; --green2:#00b894;
--red:#e74c3c; --yellow:#f9ca24;
--text:#e8e8f0; --dim:#8888a8; --muted:#3a3a52;
--border:rgba(255,255,255,0.07);
```

---

## Sections — Content & Functionality

### 1. Dashboard (`sec-dashboard`)

**Purpose:** At-a-glance view of today's AI activity. Loads first on every login.

**Content:**
- Greeting: "Buenos días/tardes, {businessName} 👋" + date + "Tu AI lleva activo {N} días"
- AI status badge (green ● AI ACTIVO)
- KPI cards row (today): Llamadas, Reservas, Emails enviados, Horas ahorradas
- Two-column grid: Próximas citas (next 3–5) + Actividad reciente del AI (last 5–8 events with type tags: `reserva`, `email`, `info`, `llamada`)

**Data source:** `GET /api/portal/dashboard` — aggregates call history from VoicePipeline + appointments from Scheduler

---

### 2. Llamadas (`sec-llamadas`)

**Purpose:** Full call log with outcome, duration, transcript preview.

**Content:**
- Filter bar: date range (today / 7 days / 30 days / all) + outcome filter (todas / reserva / info / abandonada)
- Call log table: timestamp, phone (masked: +34 6xx ···), duration, outcome badge, "Ver" button
- Call detail modal/expand: full transcript (if available), appointment linked (if outcome=booked), outcome classification, any emails sent

**Data source:** `GET /api/portal/calls?from=&to=&outcome=`

---

### 3. Citas (`sec-citas`)

**Purpose:** Full appointment management — see, add, edit, cancel.

**Content:**
- View toggle: Lista / Semana
- List view: sorted by date, each row shows client name, service, datetime, status (confirmed/cancelled/pending)
- Action buttons per row: ✏️ Edit, ✕ Cancel
- "+ Nueva cita" button → modal form (client name, phone, email optional, service, date/time)
- Edit modal: all fields editable, save confirmation
- Cancel: confirmation dialog before sending cancellation email

**Data source:**
- `GET /api/portal/appointments` — list all
- `POST /api/portal/appointments` — create
- `PATCH /api/portal/appointments/:id` — edit
- `DELETE /api/portal/appointments/:id` — cancel (soft delete, sends email if client email present)

---

### 4. Informes (`sec-informes`)

**Purpose:** ROI summary to justify monthly subscription, reinforce retention.

**Content:**
- Period selector: Esta semana / Este mes / Últimos 3 meses
- Top metrics: Total llamadas, Reservas generadas, Tasa de conversión (%), Horas ahorradas, Ingresos estimados atribuidos al AI
- Ingresos estimados = reservas × avgTicket (configured in Configuración, default €35)
- Charts (pure CSS/HTML bar charts, no external library): llamadas por día of week, conversión over time
- "Desde que activaste NodeFlow" total stats block at the bottom

**Data source:** `GET /api/portal/reports?period=week|month|quarter`

---

### 5. Automatizaciones (`sec-automatizaciones`)

**Purpose:** Status panel for all active automations — toggle, configure.

**Content:**
- Three automation cards:
  - **Post-llamada:** summary/confirmation emails — toggle on/off, description of what it does
  - **Rebooking:** automatic rebooking reminders — toggle on/off, daysThreshold config input
  - **Fechas críticas:** reminder system — toggle on/off, list of active critical dates with add/edit/delete
- Each card shows: last triggered, count sent this month
- Critical dates sub-list: type badge, client name, due date, days until, advance_days chips

**Data source:**
- `GET /api/portal/automations` — current config
- `PATCH /api/portal/automations` — update config (toggle, threshold)
- `GET /api/critical-dates/:businessId` — critical dates list (existing route)
- `POST /api/critical-dates` + `DELETE /api/critical-dates/:id` — add/remove (existing routes)

---

### 6. Configuración (`sec-configuracion`)

**Purpose:** Full self-service configuration of the business AI setup.

**Content — editable fields:**

| Field | Type | Notes |
|-------|------|-------|
| Nombre del negocio | text | Displayed in portal header |
| Email del propietario | email | Where summaries are sent |
| Teléfono del negocio | text | Read-only (provisioned via Vonage) |
| Idioma del AI | select | es / eu / gl |
| Sector | select | peluqueria, restaurante, clinica, etc. |
| Horarios | textarea / time inputs | Opening hours per weekday |
| Servicios | textarea | Comma/newline separated list |
| Precio medio por servicio (€) | number | Used for ROI estimates in Informes |
| Mensaje de bienvenida del AI | textarea | Custom greeting |

- "Guardar cambios" button — PATCH to backend, success toast
- Danger zone: "Contactar soporte" link (no self-delete to prevent accidents)

**Data source:** `GET /api/portal/config` + `PATCH /api/portal/config`

---

## API Endpoints (all under `/api/portal/*`)

All routes require valid session token (cookie `nf_session` or `Authorization: Bearer`). businessId resolved server-side from `session.email → flowManager.ownerEmail`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/portal/dashboard` | KPIs, next appointments, recent activity |
| GET | `/api/portal/calls` | Call history (query: from, to, outcome) |
| GET | `/api/portal/appointments` | All appointments |
| POST | `/api/portal/appointments` | Create appointment |
| PATCH | `/api/portal/appointments/:id` | Edit appointment |
| DELETE | `/api/portal/appointments/:id` | Cancel appointment |
| GET | `/api/portal/reports` | Aggregated metrics (query: period) |
| GET | `/api/portal/automations` | Current automation config |
| PATCH | `/api/portal/automations` | Update automation config |
| GET | `/api/portal/config` | Business config |
| PATCH | `/api/portal/config` | Update business config |

Critical dates reuse existing `/api/critical-dates/*` routes (already implemented).

---

## Files to Touch

### New files

| File | Purpose |
|------|---------|
| `public/portal/portal.js` | All portal client-side logic (section routing, API calls, DOM rendering, mobile sidebar, toasts) |
| `src/api/routes-portal.js` | All 11 portal API endpoints |

### Rewritten files

| File | Change |
|------|--------|
| `public/portal/index.html` | Full rewrite: login screen preserved, app area replaced with sidebar layout + section containers. Loads `portal.js`. |

### Modified files

| File | Change |
|------|--------|
| `server.js` | Mount `routes-portal.js` at `/api/portal` |

---

## Mobile-First Behaviour

- Base CSS written for mobile (single column, full width)
- `@media (min-width: 768px)` for desktop: show sidebar, shrink main content
- Sidebar: `position:fixed; left:-220px; transition:left .25s` on mobile, `left:0` when `.open`
- Hamburger `☰` button: `position:fixed; top:12px; left:12px; z-index:200` — only visible on mobile
- Backdrop: `position:fixed; inset:0; background:rgba(0,0,0,.6)` — appears when sidebar is open on mobile, click closes it
- Tables (calls, citas) become scrollable on mobile (`overflow-x:auto`)

---

## Auth Details

### Login flow (unchanged)
1. User enters email → `POST /api/auth/magic-link` → email sent
2. User clicks link → `GET /api/auth/verify?token=...` → sets `nf_session` cookie → redirect to `/portal`
3. On portal load: if no valid cookie, show login screen; else fetch dashboard data

### Session verification in routes-portal.js
```js
const { verifySessionToken } = require('./routes-auth');

function portalAuth(req, res, next) {
  const token = req.cookies?.nf_session || req.headers.authorization?.replace('Bearer ', '');
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: 'Session expired' });
  
  // Resolve businessId
  const flow = flowManager.getAllFlows().find(f => f.ownerEmail === session.email);
  if (!flow) return res.status(404).json({ error: 'No business found for this account' });
  
  req.session = session;
  req.businessId = flow.id;
  req.flowConfig = flow;
  next();
}
```

---

## Error States

- **No business found:** Show empty-state with "Tu cuenta está configurada pero el AI no está activo todavía. Contacta con soporte." — don't crash
- **API errors:** Toast notification bottom-right, red, auto-dismiss 4s
- **Empty sections:** Each section has its own empty state (no calls yet, no citas, etc.) — not blank pages
- **Session expired:** Redirect to login screen, show "Tu sesión ha expirado. Inicia sesión de nuevo."

---

## Testing

- Manual test checklist per section (no E2E framework in this project)
- Each API route testable via curl with a valid session token
- Mobile: test at 375px (iPhone SE) and 414px (iPhone XR) viewport widths
- Test: login → dashboard loads → each section navigates cleanly → mobile hamburger works → config save persists → logout

---

## Out of Scope (for this spec)

- Real-time updates (WebSocket push) — polling on tab focus is sufficient for MVP
- Export to PDF/CSV — Informes section, planned for future
- Multi-user / team access — single owner per business for now
- Two-factor auth
- Dark/light theme toggle (dark only)
