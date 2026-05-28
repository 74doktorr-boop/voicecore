# NodeFlow Playground + Assistant Config Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dedicated admin playground at `/admin/playground` for managing AI voice assistants per business, plus a self-service "Asistente" tab in the client portal so each business can configure their own bot.

**Architecture:** Supabase-first — assistant config stored as JSONB in `organizations.assistant_config`. A server-side `prompt-generator.js` compiles the system prompt from structured fields + a sector template at call time. Two surfaces share the same data: admin (all orgs) and portal (own org only). Voice demo runs entirely in-browser via a STT→LLM→TTS REST pipeline — no Vonage required.

**Tech Stack:** Node.js/Express, Supabase (JSONB column), OpenAI (LLM + TTS), existing STT, Web MediaRecorder API, plain HTML/JS (no React, consistent with existing portal/admin)

---

## Decisions Made

| Decision | Choice | Reason |
|----------|--------|--------|
| Config storage | Supabase `organizations.assistant_config` JSONB | Persists across Docker redeployes; no file system dependency |
| Demo type | Voice (browser mic → STT → LLM → TTS → audio) | Full fidelity test without Vonage; works in any browser |
| Editor mode | Guided form + raw prompt tab | Businesses use form; admin/advanced users can touch raw prompt |
| Layout | Dedicated page `/admin/playground` | Cleaner UX than adding another tab to dense admin panel |
| Org creation | Manual from playground (no Stripe) | Admin needs to set up clients directly, e.g. onboarded by phone |
| Existing demo JSONs | Left untouched | `assistants/*.json` files remain for the 4 demo configs; new orgs use DB only |

---

## Data Model

### Supabase migration required

```sql
-- Add assistant_config column to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS assistant_config JSONB DEFAULT '{}';
```

### `assistant_config` JSON shape

```json
{
  "assistantName": "Laura",
  "sector": "fisioterapia",
  "language": "es+eu",
  "voice": "nova",
  "model": "gpt-4o-mini",
  "temperature": 0.5,
  "firstMessage": "Buenas, Fisio Bilbao, ¿en qué puedo ayudarle?",
  "schedule": {
    "mon": { "open": "09:00", "close": "20:00" },
    "tue": { "open": "09:00", "close": "20:00" },
    "wed": { "open": "09:00", "close": "20:00" },
    "thu": { "open": "09:00", "close": "20:00" },
    "fri": { "open": "09:00", "close": "20:00" },
    "sat": { "open": "10:00", "close": "14:00" },
    "sun": null
  },
  "services": "Fisioterapia general, deportiva, dolor lumbar...",
  "sectorData": {
    "seguros": ["Adeslas", "Sanitas", "Mutua Madrileña"],
    "especialidades": "Columna, rodilla, lesiones deportivas",
    "cartaItems": null,
    "maxGuests": null
  },
  "extraInfo": "Parking gratuito, acceso PMR",
  "customPromptOverride": null
}
```

`customPromptOverride`: if non-null, bypasses the generated prompt and uses this string directly. Only admin can set this via the "Prompt raw" tab.

### `demo_bots` table (new)

```sql
CREATE TABLE IF NOT EXISTS demo_bots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  sector      TEXT NOT NULL DEFAULT 'generico',
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Demo bots are not linked to any org — used for pure testing.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `public/admin/playground.html` | Playground page HTML (dark theme, sidebar + detail panel) |
| `public/admin/playground.js` | All JS: sidebar list, org CRUD, assistant editor tabs, demo voice call |
| `src/api/routes-assistant.js` | Admin REST API: CRUD for org assistant config + org creation/deletion + demo bot CRUD |
| `src/api/routes-demo.js` | Shared STT/chat/TTS pipeline endpoints used by both admin and portal demo |
| `src/assistants/prompt-generator.js` | `generatePrompt(config, sector)` → system prompt string. One template per sector. |

### Modified files

| File | Change |
|------|--------|
| `server.js` | Mount `routes-assistant.js` and `routes-demo.js`; add `/admin/playground` static route |
| `src/api/routes-admin.js` | Add `POST /api/admin/orgs` (create org manually) and `DELETE /api/admin/orgs/:id` |
| `public/portal/index.html` | Add "Asistente" nav item + section HTML |
| `public/portal/portal.js` | Add `loadAsistente()`, `saveAsistenteConfig()`, `startPortalVoiceDemo()` |

---

## API Endpoints

### Admin — Assistant config (routes-assistant.js)

```
GET  /api/admin/assistant/:orgId          → { config: AssistantConfig }
PUT  /api/admin/assistant/:orgId          → save config; auto-regenerate prompt; { ok, prompt }
POST /api/admin/assistant/generate-prompt → { prompt: string } (dry-run, no save)
GET  /api/admin/demo-bots                 → { bots: DemoBot[] }
POST /api/admin/demo-bots                 → create demo bot; { bot }
DELETE /api/admin/demo-bots/:id           → { ok }
```

### Admin — Org management (routes-admin.js additions)

```
POST   /api/admin/orgs    body: { name, ownerEmail, plan, sector, phone? }  → { org }
DELETE /api/admin/orgs/:id                                                  → { ok }
```

### Demo pipeline (routes-demo.js — auth: adminAuth OR portalAuth)

```
POST /api/demo/stt   multipart: audio blob  → { transcript: string }
POST /api/demo/chat  body: { orgId?, botId?, messages: [{role,content}] }  → { reply: string }
POST /api/demo/tts   body: { text, voice? }  → audio/mpeg stream
```

The `/api/demo/chat` endpoint resolves the system prompt: if `orgId` is given, loads from `organizations.assistant_config`; if `botId`, from `demo_bots`; generates prompt via `prompt-generator.js`.

### Portal — Assistant config (routes-portal.js additions)

```
GET  /api/portal/assistant       → { config: AssistantConfig }
PUT  /api/portal/assistant       body: AssistantConfig (subset — no customPromptOverride)  → { ok, prompt }
```

Portal users cannot set `customPromptOverride` — that field is stripped server-side.

---

## Prompt Generator (`src/assistants/prompt-generator.js`)

```js
generatePrompt(config, orgName) → string
```

Sector templates:

| Sector | Extra sections injected |
|--------|------------------------|
| `restaurante` | Horario comida/cena, carta (items), aforo máximo |
| `fisioterapia` | Seguros aceptados, especialidades |
| `clinica` | Especialidades médicas, seguros |
| `peluqueria` | Servicios y precios |
| `gimnasio` | Clases disponibles |
| `generico` | Solo servicios (textarea) |

Template structure (all sectors share this base):
```
Eres {assistantName}, la recepcionista de {orgName}.
Hablas por teléfono con clientes.

IDIOMA: {language instructions}
FECHA: {{DATE}}
ESTILO: [standard phone style block]
HORARIO: {schedule block}
{sector-specific block}
INFORMACIÓN ADICIONAL: {extraInfo}
PROHIBIDO: [standard prohibitions block]
```

If `customPromptOverride` is set, it replaces the entire generated prompt.

---

## Voice Demo Flow (browser-side, playground.js + portal.js)

```
1. User clicks "Iniciar demo"
2. navigator.mediaDevices.getUserMedia({ audio: true })
3. MediaRecorder captures 3-second audio chunks
4. Each chunk → POST /api/demo/stt → transcript
5. Transcript appended to messages[]
6. POST /api/demo/chat with full messages[] → reply text
7. POST /api/demo/tts with reply → audio/mpeg
8. new Audio(URL.createObjectURL(blob)).play()
9. After playback ends → resume recording → loop to step 3
10. "Colgar" button stops MediaRecorder + clears messages[]
```

VAD (voice activity detection): simple energy threshold on the audio chunk before sending to STT — skip silent chunks to avoid noise.

---

## Playground HTML Structure (`public/admin/playground.html`)

```
<body>
  <div class="playground-layout">
    <aside class="sidebar">
      <!-- Logo -->
      <!-- Orgs list (fetched from /api/admin/orgs) -->
      <!-- "+ Nueva org" button → modal -->
      <!-- Demo bots section -->
      <!-- "+ Nuevo bot" button → modal -->
    </aside>
    <main class="detail-panel">
      <!-- Top bar: org name, plan badge, action buttons -->
      <nav class="detail-tabs">
        <button data-tab="config">Config org</button>
        <button data-tab="asistente">Asistente</button>
        <button data-tab="demo">Demo voz</button>
      </nav>
      <!-- Tab panels -->
      <section id="tab-config"> ... </section>
      <section id="tab-asistente">
        <!-- Sub-tabs: Básico | Horario | Contenido | Prompt raw | Voz -->
      </section>
      <section id="tab-demo">
        <!-- Mic button, transcript log, audio visualizer -->
      </section>
    </main>
  </div>
</body>
```

Auth: password-based same as existing admin (uses existing `DASHBOARD_PASSWORD` + `/api/admin/auth`).

---

## Portal "Asistente" Section

Added as a new nav item in `/portal`. Only shows the assistant editor (no org config, no raw prompt by default). Sub-tabs: **Básico**, **Horario**, **Contenido** — same form structure as playground but without "Prompt raw" and "Config org" tabs. A collapsed "Avanzado" accordion at the bottom reveals the raw prompt with a disclaimer: *"Modificar el prompt puede cambiar el comportamiento del asistente de formas inesperadas."*

---

## Security

- All `/api/admin/assistant/*` routes protected by `adminAuth` (existing middleware).
- All `/api/portal/assistant` routes protected by `portalAuth` (existing middleware) — tenant-isolated by `org_id` from session.
- `POST /api/portal/assistant` strips `customPromptOverride` and `model` fields before saving — businesses cannot set arbitrary prompts or change model.
- `/api/demo/*` routes require either a valid admin token OR a valid portal session JWT. No public access.
- `POST /api/demo/tts` text input capped at 500 chars (cost protection, consistent with existing TTS cap).

---

## What Is NOT in Scope

- Real-time WebSocket voice (uses polling REST loop instead — simpler, sufficient for demo)
- Multi-language prompt templates beyond `es`, `eu`, `es+eu`
- Vonage integration for demo calls (blocked; REST demo pipeline is the substitute)
- Billing changes from the playground (plan changes must still go through Stripe)
- Bulk import of orgs
