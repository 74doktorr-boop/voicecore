# NodeFlow Playground + Assistant Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/playground` to manage all AI assistant configs + voice demo, plus a self-service "Asistente" tab in the client portal, with config stored in Supabase (`organizations.assistant_config`).

**Architecture:** Supabase-first JSONB config per org. `prompt-generator.js` compiles system prompts from structured fields + sector templates. Two new route files (`routes-assistant.js`, `routes-demo.js`) handle the backend. Browser voice demo uses MediaRecorder → base64 → OpenAI Whisper → LLM → TTS REST pipeline (no Vonage).

**Tech Stack:** Node.js/Express, Supabase, OpenAI SDK (`openai` ^4 already installed), Web MediaRecorder API, plain HTML/CSS/JS (no React, matches existing portal/admin style)

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| CREATE | `src/assistants/prompt-generator.js` | `generatePrompt(config, orgName)` — sector templates → system prompt string |
| CREATE | `src/api/routes-assistant.js` | Admin CRUD for assistant config + demo bots |
| CREATE | `src/api/routes-demo.js` | STT/chat/TTS pipeline (shared admin + portal) |
| CREATE | `public/admin/playground.html` | Playground page HTML |
| CREATE | `public/admin/playground.js` | All playground JS |
| MODIFY | `src/api/routes-admin.js` | Add POST/DELETE /api/admin/orgs, export `isAdminToken` |
| MODIFY | `src/api/routes-portal.js` | Add GET/PUT /api/portal/assistant |
| MODIFY | `server.js` | Mount new routes, add /admin/playground static route |
| MODIFY | `public/portal/index.html` | Add Asistente nav item + section HTML |
| MODIFY | `public/portal/portal.js` | Add loadAsistente(), saveAsistenteConfig(), voice demo |

---

## Task 1: Supabase migration

**Files:**
- No code files — manual SQL run in Supabase dashboard

- [ ] **Step 1: Run migration SQL in Supabase**

Open Supabase → SQL Editor → New query → paste and run:

```sql
-- Add assistant_config column to existing organizations table
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS assistant_config JSONB DEFAULT '{}';

-- New table for test bots (not linked to any org)
CREATE TABLE IF NOT EXISTS demo_bots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  sector      TEXT NOT NULL DEFAULT 'generico',
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 2: Verify in Supabase Table Editor**

Open Table Editor → `organizations` → confirm `assistant_config` column exists (type jsonb, default `{}`).
Open Table Editor → verify `demo_bots` table exists with columns: `id`, `name`, `sector`, `config`, `created_at`.

- [ ] **Step 3: Commit note**

```bash
git commit --allow-empty -m "chore: Supabase migration — assistant_config + demo_bots (manual SQL applied)"
```

---

## Task 2: prompt-generator.js

**Files:**
- Create: `src/assistants/prompt-generator.js`

- [ ] **Step 1: Create the file**

```js
// src/assistants/prompt-generator.js
// Compiles a system prompt from structured assistant config + sector template.
// Called by routes-assistant.js (on save) and routes-demo.js (on each demo chat).
'use strict';

const DAY_NAMES = { mon:'lunes', tue:'martes', wed:'miércoles', thu:'jueves', fri:'viernes', sat:'sábado', sun:'domingo' };

function formatSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return 'Consultar horario';
  const lines = [];
  for (const [day, slot] of Object.entries(schedule)) {
    if (!slot) {
      lines.push(`${DAY_NAMES[day] || day}: cerrado`);
    } else {
      lines.push(`${DAY_NAMES[day] || day}: ${slot.open}–${slot.close}`);
    }
  }
  return lines.join(', ');
}

function formatLanguage(lang) {
  if (lang === 'es+eu') return 'Responde en el idioma en que te hablen: español o euskera. Si no estás segura del idioma, usa español.';
  if (lang === 'eu')    return 'Responde exclusivamente en euskera.';
  return 'Responde exclusivamente en español de España.';
}

function sectorBlock(sector, sectorData = {}) {
  switch (sector) {
    case 'restaurante': {
      const carta = Array.isArray(sectorData.cartaItems) && sectorData.cartaItems.length > 0
        ? sectorData.cartaItems.map(i => `- ${i.name}${i.price ? ` (${i.price})` : ''}`).join('\n')
        : null;
      return [
        sectorData.horarioComida  ? `COMIDAS: ${sectorData.horarioComida}` : null,
        sectorData.horarioCena    ? `CENAS: ${sectorData.horarioCena}` : null,
        sectorData.maxGuests      ? `AFORO MÁXIMO POR RESERVA: ${sectorData.maxGuests} personas` : null,
        carta                     ? `CARTA:\n${carta}` : null,
      ].filter(Boolean).join('\n');
    }
    case 'fisioterapia':
    case 'clinica': {
      const seguros = Array.isArray(sectorData.seguros) && sectorData.seguros.length > 0
        ? `SEGUROS ACEPTADOS: ${sectorData.seguros.join(', ')}`
        : null;
      const espec = sectorData.especialidades
        ? `ESPECIALIDADES: ${sectorData.especialidades}`
        : null;
      return [seguros, espec].filter(Boolean).join('\n');
    }
    case 'peluqueria': {
      return sectorData.servicios
        ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}`
        : '';
    }
    case 'gimnasio': {
      return sectorData.clases
        ? `CLASES DISPONIBLES: ${sectorData.clases}`
        : '';
    }
    default:
      return '';
  }
}

/**
 * Generate a system prompt from structured assistant config.
 * @param {object} config   - The assistant_config object from the DB
 * @param {string} orgName  - The organization name (from organizations.name)
 * @returns {string}        - The compiled system prompt
 */
function generatePrompt(config, orgName) {
  // If admin set a raw override, use it verbatim
  if (config.customPromptOverride) return config.customPromptOverride;

  const assistantName = config.assistantName || 'Laura';
  const sector        = config.sector || 'generico';
  const language      = config.language || 'es';
  const scheduleStr   = formatSchedule(config.schedule);
  const services      = config.services || '';
  const extraInfo     = config.extraInfo || '';
  const langInstr     = formatLanguage(language);
  const sectorStr     = sectorBlock(sector, config.sectorData || {});

  return `Eres ${assistantName}, la recepcionista de ${orgName}.
Hablas por teléfono con clientes.

IDIOMA: ${langInstr}
FECHA DE HOY: {{DATE}}

ESTILO:
- Habla como una persona real por teléfono. Frases cortas y naturales.
- Máximo 1-2 frases por respuesta.
- Tono amable y profesional.
- Usa usted hasta que el cliente sea informal contigo.

CÓMO GESTIONAR LA CONVERSACIÓN:
- Pregunta UNA sola cosa cada vez.
- Si el cliente te da información que no pediste, recógela. No la ignores.
- NUNCA pidas algo que ya te hayan dicho.

HORARIO: ${scheduleStr}
${services ? `SERVICIOS: ${services}` : ''}
${sectorStr}
${extraInfo ? `INFORMACIÓN ADICIONAL: ${extraInfo}` : ''}

PROHIBIDO:
- No hables en otro idioma.
- No repitas preguntas ya respondidas.
- No hagas preguntas innecesarias de clarificación.
- No uses emojis.`.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { generatePrompt };
```

- [ ] **Step 2: Quick smoke test in Node REPL**

```bash
cd /path/to/voicecore
node -e "
const { generatePrompt } = require('./src/assistants/prompt-generator');
const config = {
  assistantName: 'Laura',
  sector: 'fisioterapia',
  language: 'es+eu',
  schedule: { mon:{open:'09:00',close:'20:00'}, sat:{open:'10:00',close:'14:00'}, sun:null },
  services: 'Fisioterapia general, deportiva',
  sectorData: { seguros: ['Adeslas','Sanitas'], especialidades: 'Columna, rodilla' },
};
console.log(generatePrompt(config, 'Fisio Bilbao'));
"
```

Expected: a full system prompt with the schedule, seguros, and euskera language instruction.

- [ ] **Step 3: Commit**

```bash
git add src/assistants/prompt-generator.js
git commit -m "feat: add prompt-generator — compiles system prompt from structured config"
```

---

## Task 3: routes-assistant.js (admin assistant CRUD)

**Files:**
- Create: `src/api/routes-assistant.js`

- [ ] **Step 1: Create the file**

```js
// src/api/routes-assistant.js
// Admin endpoints for reading/writing per-org assistant config and demo bots.
// All routes protected by adminAuth.
'use strict';

const { Logger }          = require('../utils/logger');
const { getDatabase }     = require('../db/database');
const { generatePrompt }  = require('../assistants/prompt-generator');
const { adminAuth }       = require('./routes-admin');

const log = new Logger('ROUTES-ASSISTANT');

function setupAssistantRoutes(app) {

  // ── GET /api/admin/assistant/:orgId ───────────────────────────
  app.get('/api/admin/assistant/:orgId', adminAuth, async (req, res) => {
    const { orgId } = req.params;
    const db = getDatabase();
    if (!db.enabled) return res.json({ config: {} });
    try {
      const { data, error } = await db.client
        .from('organizations')
        .select('id, name, assistant_config')
        .eq('id', orgId)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Org no encontrada' });
      res.json({ config: data.assistant_config || {}, orgName: data.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PUT /api/admin/assistant/:orgId ───────────────────────────
  // Saves config and returns the regenerated system prompt.
  app.put('/api/admin/assistant/:orgId', adminAuth, async (req, res) => {
    const { orgId } = req.params;
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'body debe ser el objeto config' });
    }
    const db = getDatabase();
    try {
      // Fetch org name for prompt generation
      const { data: org } = await db.client
        .from('organizations').select('name').eq('id', orgId).single();
      if (!org) return res.status(404).json({ error: 'Org no encontrada' });

      const prompt = generatePrompt(config, org.name);

      await db.client
        .from('organizations')
        .update({ assistant_config: config })
        .eq('id', orgId);

      log.info(`Assistant config saved for org ${orgId}`);
      res.json({ ok: true, prompt });
    } catch (e) {
      log.error(`PUT assistant config error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/assistant/generate-prompt ─────────────────
  // Dry-run: returns generated prompt without saving.
  app.post('/api/admin/assistant/generate-prompt', adminAuth, async (req, res) => {
    const { config, orgName } = req.body;
    if (!config || !orgName) {
      return res.status(400).json({ error: 'config y orgName requeridos' });
    }
    try {
      const prompt = generatePrompt(config, orgName);
      res.json({ prompt });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/admin/demo-bots ──────────────────────────────────
  app.get('/api/admin/demo-bots', adminAuth, async (req, res) => {
    const db = getDatabase();
    if (!db.enabled) return res.json({ bots: [] });
    try {
      const { data } = await db.client
        .from('demo_bots').select('*').order('created_at', { ascending: false });
      res.json({ bots: data || [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/admin/demo-bots ─────────────────────────────────
  app.post('/api/admin/demo-bots', adminAuth, async (req, res) => {
    const { name, sector = 'generico', config = {} } = req.body;
    if (!name) return res.status(400).json({ error: 'name requerido' });
    const db = getDatabase();
    try {
      const { data, error } = await db.client
        .from('demo_bots').insert({ name, sector, config }).select().single();
      if (error) throw new Error(error.message);
      log.info(`Demo bot created: ${data.id} (${name})`);
      res.json({ bot: data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/admin/demo-bots/:id ──────────────────────────
  app.delete('/api/admin/demo-bots/:id', adminAuth, async (req, res) => {
    const db = getDatabase();
    try {
      await db.client.from('demo_bots').delete().eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { setupAssistantRoutes };
```

- [ ] **Step 2: Verify the file parses without errors**

```bash
node -e "require('./src/api/routes-assistant')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-assistant.js
git commit -m "feat: add routes-assistant — admin CRUD for assistant config + demo bots"
```

---

## Task 4: Extend routes-admin.js (org CRUD + export isAdminToken)

**Files:**
- Modify: `src/api/routes-admin.js`

- [ ] **Step 1: Add `isAdminToken` export**

Find line 311 in `src/api/routes-admin.js`:
```js
module.exports = { setupAdminRoutes, adminAuth };
```
Change to:
```js
function isAdminToken(token) {
  return !!(token && _validTokens.has(token));
}

module.exports = { setupAdminRoutes, adminAuth, isAdminToken };
```

- [ ] **Step 2: Add POST /api/admin/orgs inside `setupAdminRoutes`**

Find the comment `// ─── Send magic link` (around line 176) and insert BEFORE it:

```js
  // ─── Create org manually (without Stripe) ───────────────────────────────────
  app.post('/api/admin/orgs', adminAuth, async (req, res) => {
    const { name, ownerEmail, plan, sector, phone } = req.body;
    if (!name || !ownerEmail || !plan) {
      return res.status(400).json({ error: 'name, ownerEmail y plan son requeridos' });
    }
    if (!['starter', 'negocio', 'pro'].includes(plan)) {
      return res.status(400).json({ error: "plan debe ser 'starter', 'negocio' o 'pro'" });
    }
    const db = getDatabase();
    if (!db.enabled) return res.status(503).json({ error: 'DB no disponible' });
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data, error } = await db.client
        .from('organizations')
        .insert({
          name,
          slug: `${slug}-${Date.now().toString(36)}`,
          owner_email: ownerEmail.trim().toLowerCase(),
          owner_name:  name,
          phone:       phone || null,
          plan,
          sector:      sector || 'generico',
          is_active:   true,
          status:      'active',
          assistant_config: {},
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      log.info(`Org created manually: ${data.id} (${name})`);
      res.json({ org: data });
    } catch (e) {
      log.error(`POST /api/admin/orgs error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Delete org ──────────────────────────────────────────────────────────────
  app.delete('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    const db = getDatabase();
    try {
      // Soft-delete: set is_active=false, status='deleted'
      await db.client
        .from('organizations')
        .update({ is_active: false, status: 'deleted' })
        .eq('id', req.params.id);
      log.info(`Org soft-deleted: ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 3: Verify**

```bash
node -e "require('./src/api/routes-admin')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/api/routes-admin.js
git commit -m "feat: routes-admin — add POST/DELETE /api/admin/orgs + export isAdminToken"
```

---

## Task 5: routes-demo.js (STT / chat / TTS pipeline)

**Files:**
- Create: `src/api/routes-demo.js`

The demo voice pipeline:
1. Browser sends base64 audio → `/api/demo/stt` → OpenAI Whisper → transcript
2. Browser sends messages[] → `/api/demo/chat` → LLM with org's system prompt → reply
3. Browser sends reply text → `/api/demo/tts` → existing ttsRouter → audio buffer

`demoAuth` accepts either an admin Bearer token OR a portal session JWT.

- [ ] **Step 1: Create the file**

```js
// src/api/routes-demo.js
// Shared demo pipeline: STT → chat → TTS.
// Auth: admin token OR portal session JWT.
'use strict';

const { Logger }          = require('../utils/logger');
const { getDatabase }     = require('../db/database');
const { verifySessionToken } = require('./routes-auth');
const { isAdminToken }    = require('./routes-admin');
const { generatePrompt }  = require('../assistants/prompt-generator');
const { toFile }          = require('openai');
const OpenAI              = require('openai').default;

const log = new Logger('ROUTES-DEMO');

// ── Auth middleware (admin OR portal session) ───────────────────
async function demoAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  if (isAdminToken(token)) {
    req.isAdmin = true;
    return next();
  }

  try {
    const session = verifySessionToken(token);
    req.session = session;
    const db = getDatabase();
    if (db.enabled) {
      const { data } = await db.client
        .from('organizations')
        .select('id')
        .eq('owner_email', session.email.toLowerCase())
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data) req.businessId = data.id;
    }
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'No autorizado' });
  }
}

function setupDemoRoutes(app, ttsRouter) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // ── POST /api/demo/stt ────────────────────────────────────────
  // body: { audio: <base64>, mimeType?: 'audio/webm' }
  // Returns: { transcript: string }
  app.post('/api/demo/stt', demoAuth, async (req, res) => {
    const { audio, mimeType = 'audio/webm' } = req.body;
    if (!audio) return res.status(400).json({ error: 'audio (base64) requerido' });
    try {
      const buffer = Buffer.from(audio, 'base64');
      if (buffer.length < 500) return res.json({ transcript: '' }); // skip silence
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = await toFile(buffer, `audio.${ext}`, { type: mimeType });
      const result = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'es',
      });
      res.json({ transcript: result.text || '' });
    } catch (e) {
      log.error(`STT error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/demo/chat ───────────────────────────────────────
  // body: { orgId?, botId?, messages: [{role, content}] }
  // Returns: { reply: string }
  app.post('/api/demo/chat', demoAuth, async (req, res) => {
    const { orgId, botId, messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages requerido' });
    }
    // Portal users can only chat with their own org
    const effectiveOrgId = req.isAdmin ? orgId : req.businessId;

    const db = getDatabase();
    let systemPrompt = 'Eres un asistente de prueba. Responde brevemente.';
    let model = 'gpt-4o-mini';
    let temperature = 0.5;

    try {
      if (effectiveOrgId && db.enabled) {
        const { data: org } = await db.client
          .from('organizations')
          .select('name, assistant_config')
          .eq('id', effectiveOrgId)
          .single();
        if (org && org.assistant_config) {
          systemPrompt = generatePrompt(org.assistant_config, org.name);
          model        = org.assistant_config.model       || 'gpt-4o-mini';
          temperature  = org.assistant_config.temperature ?? 0.5;
        }
      } else if (botId && db.enabled) {
        const { data: bot } = await db.client
          .from('demo_bots').select('name, config').eq('id', botId).single();
        if (bot && bot.config) {
          systemPrompt = generatePrompt(bot.config, bot.name);
          model        = bot.config.model       || 'gpt-4o-mini';
          temperature  = bot.config.temperature ?? 0.5;
        }
      }

      // Inject today's date
      systemPrompt = systemPrompt.replace('{{DATE}}', new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));

      const completion = await openai.chat.completions.create({
        model,
        temperature,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
      });

      const reply = completion.choices[0]?.message?.content || '';
      res.json({ reply });
    } catch (e) {
      log.error(`Chat error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/demo/tts ────────────────────────────────────────
  // body: { text: string, voice?: string }
  // Returns: audio/mpeg stream
  app.post('/api/demo/tts', demoAuth, async (req, res) => {
    let { text, voice = 'nova' } = req.body;
    if (!text) return res.status(400).json({ error: 'text requerido' });
    text = text.slice(0, 500); // cost protection
    try {
      const audio = await ttsRouter.synthesize({
        callId: `demo-${Date.now()}`,
        text,
        voice,
        provider: 'openai',
        language: 'es',
      });
      res.set('Content-Type', 'audio/mpeg');
      res.send(audio);
    } catch (e) {
      log.error(`TTS error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { setupDemoRoutes };
```

- [ ] **Step 2: Verify the file parses**

```bash
node -e "require('./src/api/routes-demo')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-demo.js
git commit -m "feat: add routes-demo — STT/chat/TTS pipeline for browser voice demo"
```

---

## Task 6: Mount new routes in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add requires near the top of server.js**

Find the existing require block (around line 29 where `setupAdminRoutes` is required):
```js
const { setupAdminRoutes }        = require('./src/api/routes-admin');
```
Add immediately after:
```js
const { setupAssistantRoutes }    = require('./src/api/routes-assistant');
const { setupDemoRoutes }         = require('./src/api/routes-demo');
```

- [ ] **Step 2: Add /admin/playground static route**

Find the line (around line 198):
```js
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
```
Add immediately after:
```js
app.get('/admin/playground', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'playground.html'));
});
```

- [ ] **Step 3: Mount the new routes**

Find the line (around line 363):
```js
setupAdminRoutes(app, config, assistantManager);
```
Add immediately after:
```js
setupAssistantRoutes(app);
setupDemoRoutes(app, ttsRouter);
```

- [ ] **Step 4: Verify server starts**

```bash
node server.js &
sleep 3
curl -s http://localhost:3000/api/health | head -c 100
kill %1
```

Expected: JSON response from health endpoint (no crash).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: mount routes-assistant and routes-demo in server.js"
```

---

## Task 7: Portal assistant endpoints (routes-portal.js)

**Files:**
- Modify: `src/api/routes-portal.js`

- [ ] **Step 1: Add GET /api/portal/assistant**

Find the last route in the file (contacts/transcript area) and add BEFORE the closing `}` of `setupPortalRoutes`:

```js
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
        .from('organizations').select('name, assistant_config').eq('id', businessId).single();
      const merged = { ...(existing?.assistant_config || {}), ...safe };

      const { generatePrompt } = require('../assistants/prompt-generator');
      const prompt = generatePrompt(merged, existing?.name || '');

      await db.client
        .from('organizations')
        .update({ assistant_config: merged })
        .eq('id', businessId);

      log.info(`Portal: assistant config updated for ${businessId}`);
      res.json({ ok: true, prompt });
    } catch (e) {
      log.error(`Portal PUT assistant error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/api/routes-portal')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat: portal — add GET/PUT /api/portal/assistant"
```

---

## Task 8: public/admin/playground.html + playground.js

**Files:**
- Create: `public/admin/playground.html`
- Create: `public/admin/playground.js`

- [ ] **Step 1: Create playground.html**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playground — NodeFlow Admin</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="robots" content="noindex,nofollow">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#07070e;--card:#0f0f18;--card2:#14141e;--accent:#6c5ce7;--accent-l:#a29bfe;--green:#00cec9;--red:#e74c3c;--text:#e8e8f0;--dim:#8888a8;--muted:#3a3a52;--border:rgba(255,255,255,0.07)}
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);height:100vh;overflow:hidden;font-size:14px}

    /* Login */
    #loginScreen{display:flex;align-items:center;justify-content:center;height:100vh}
    .login-card{background:var(--card2);border:1px solid var(--border);border-radius:20px;padding:40px;width:380px;text-align:center}
    .login-logo{font-size:22px;font-weight:900;margin-bottom:6px}.login-logo em{color:var(--accent-l);font-style:normal}
    .login-sub{font-size:13px;color:var(--dim);margin-bottom:24px}
    .login-input{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:12px 16px;color:var(--text);font-size:14px;font-family:inherit;margin-bottom:10px;outline:none;transition:border-color .2s}
    .login-input:focus{border-color:var(--accent)}
    .login-btn{width:100%;background:var(--accent);color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .2s}
    .login-btn:hover{background:#5a4bd1}

    /* App layout */
    #app{display:none;height:100vh;flex-direction:row}

    /* Sidebar */
    .sidebar{width:220px;background:var(--card);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0}
    .sb-logo{padding:16px 14px;border-bottom:1px solid var(--border)}
    .sb-logo-title{font-size:16px;font-weight:900}.sb-logo-title em{color:var(--accent-l);font-style:normal}
    .sb-logo-sub{font-size:10px;color:var(--dim);margin-top:2px;letter-spacing:.05em;text-transform:uppercase}
    .sb-section{padding:10px 10px 0}
    .sb-section-label{font-size:9px;color:var(--dim);font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:0 6px;margin-bottom:6px}
    .org-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:2px;border-left:2px solid transparent;transition:all .15s}
    .org-item:hover{background:rgba(255,255,255,.04)}
    .org-item.active{background:rgba(108,92,231,.12);border-left-color:var(--accent)}
    .org-name{font-size:12px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .org-badges{display:flex;gap:3px;flex-shrink:0}
    .badge{font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;text-transform:uppercase;letter-spacing:.03em}
    .badge-negocio{background:rgba(0,206,201,.15);color:#00cec9}
    .badge-pro{background:rgba(162,155,254,.15);color:var(--accent-l)}
    .badge-starter{background:rgba(136,136,168,.1);color:var(--dim)}
    .badge-test{background:rgba(108,92,231,.15);color:var(--accent-l)}
    .sb-add-btn{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;color:var(--dim);border:1px dashed var(--muted);margin:6px 10px;transition:all .15s}
    .sb-add-btn:hover{color:var(--accent-l);border-color:var(--accent)}
    .sb-divider{height:1px;background:var(--border);margin:10px}

    /* Main panel */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .top-bar{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-shrink:0}
    .top-bar h2{font-size:18px;font-weight:800;flex:1}
    .btn{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .15s}
    .btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{background:#5a4bd1}
    .btn-outline{background:transparent;color:var(--dim);border:1px solid var(--muted)}.btn-outline:hover{color:var(--text);border-color:var(--dim)}
    .btn-danger{background:rgba(231,76,60,.1);color:var(--red);border:1px solid rgba(231,76,60,.2)}.btn-danger:hover{background:rgba(231,76,60,.2)}
    .btn-sm{padding:5px 10px;font-size:11px}

    /* Tabs */
    .tab-nav{padding:0 20px;border-bottom:1px solid var(--border);display:flex;gap:0;flex-shrink:0}
    .tab-btn{padding:12px 16px;font-size:13px;font-weight:600;color:var(--dim);cursor:pointer;border:none;background:none;font-family:inherit;border-bottom:2px solid transparent;transition:all .15s}
    .tab-btn:hover{color:var(--text)}
    .tab-btn.active{color:var(--accent-l);border-bottom-color:var(--accent)}

    /* Tab content */
    .tab-panel{flex:1;overflow-y:auto;padding:20px}
    .tab-panel.hidden{display:none}

    /* Form grid */
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .form-full{grid-column:1/-1}
    .form-group label{display:block;font-size:11px;font-weight:600;color:var(--dim);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
    .form-input,.form-select,.form-textarea{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
    .form-input:focus,.form-select:focus,.form-textarea:focus{border-color:var(--accent)}
    .form-select{appearance:none;cursor:pointer}
    .form-select option{background:#1a1a2e}
    .form-textarea{resize:vertical;min-height:80px}
    .form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--border)}

    /* Sub-tabs (inside Asistente tab) */
    .sub-tab-nav{display:flex;gap:4px;margin-bottom:16px;background:var(--card2);border-radius:8px;padding:4px}
    .sub-tab-btn{padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;color:var(--dim);cursor:pointer;border:none;background:none;font-family:inherit;transition:all .15s}
    .sub-tab-btn.active{background:var(--card);color:var(--text)}
    .sub-tab-panel{display:none}.sub-tab-panel.active{display:block}

    /* Schedule grid */
    .schedule-grid{display:grid;gap:8px}
    .schedule-row{display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center}
    .schedule-day{font-size:12px;font-weight:600;color:var(--dim)}
    .schedule-slots{display:flex;gap:8px;align-items:center}
    .schedule-closed{font-size:11px;color:var(--muted)}
    .day-toggle{cursor:pointer;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim);user-select:none}

    /* Sector chips */
    .chips-container{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
    .chip{display:flex;align-items:center;gap:4px;background:rgba(108,92,231,.12);border:1px solid rgba(108,92,231,.2);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:600;color:var(--accent-l)}
    .chip-remove{cursor:pointer;opacity:.6;hover:opacity:1;font-size:13px;line-height:1}
    .chip-add-input{background:transparent;border:1px dashed var(--muted);border-radius:20px;padding:4px 10px;font-size:11px;color:var(--text);font-family:inherit;outline:none;width:120px}

    /* Prompt raw */
    .prompt-raw-textarea{width:100%;background:#0d0d15;border:1px solid var(--border);border-radius:8px;padding:12px;color:#a8b4d0;font-family:'Fira Code','Courier New',monospace;font-size:11px;line-height:1.6;resize:vertical;min-height:280px;outline:none}
    .prompt-raw-textarea:focus{border-color:var(--accent)}
    .prompt-warning{background:rgba(249,202,36,.08);border:1px solid rgba(249,202,36,.2);border-radius:8px;padding:10px 14px;font-size:11px;color:#f9ca24;margin-bottom:12px}

    /* Demo tab */
    .demo-container{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:20px}
    .demo-mic-btn{width:72px;height:72px;border-radius:50%;border:none;cursor:pointer;font-size:28px;transition:all .2s;display:flex;align-items:center;justify-content:center}
    .demo-mic-btn.idle{background:rgba(108,92,231,.15);color:var(--accent-l)}
    .demo-mic-btn.idle:hover{background:rgba(108,92,231,.25)}
    .demo-mic-btn.active{background:#e74c3c;color:#fff;animation:pulse 1.5s infinite}
    .demo-mic-btn.speaking{background:rgba(0,206,201,.15);color:var(--green)}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(231,76,60,.4)}50%{box-shadow:0 0 0 12px rgba(231,76,60,0)}}
    .demo-status{font-size:12px;color:var(--dim)}
    .demo-transcript{width:100%;max-width:500px;background:var(--card2);border-radius:12px;padding:14px;min-height:120px;max-height:250px;overflow-y:auto}
    .demo-msg{margin-bottom:8px;font-size:12px;line-height:1.5}
    .demo-msg.user{color:var(--dim)}.demo-msg.user::before{content:'Tú: ';font-weight:700}
    .demo-msg.bot{color:var(--text)}.demo-msg.bot::before{content:'Bot: ';font-weight:700;color:var(--accent-l)}

    /* Toast */
    #toast{position:fixed;bottom:20px;right:20px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:13px;transform:translateY(60px);opacity:0;transition:all .3s;z-index:999;pointer-events:none}
    #toast.show{transform:translateY(0);opacity:1}
    #toast.ok{border-color:rgba(0,206,201,.3);color:var(--green)}
    #toast.err{border-color:rgba(231,76,60,.3);color:var(--red)}

    /* Modal */
    #modalOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;align-items:center;justify-content:center}
    #modalBox{background:var(--card2);border:1px solid var(--border);border-radius:16px;padding:28px;width:400px;max-width:90vw}
    .modal-title{font-size:16px;font-weight:800;margin-bottom:18px}
  </style>
</head>
<body>

<!-- Login -->
<div id="loginScreen">
  <div class="login-card">
    <div class="login-logo">Node<em>Flow</em></div>
    <div class="login-sub">Admin Playground</div>
    <input id="loginPass" class="login-input" type="password" placeholder="Contraseña de admin" onkeydown="if(event.key==='Enter')doLogin()">
    <button class="login-btn" onclick="doLogin()">Entrar</button>
  </div>
</div>

<!-- App -->
<div id="app">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sb-logo">
      <div class="sb-logo-title">Node<em>Flow</em></div>
      <div class="sb-logo-sub">Playground</div>
    </div>

    <div class="sb-section" style="padding-top:14px">
      <div class="sb-section-label">Orgs</div>
      <div id="orgList"></div>
      <div class="sb-add-btn" onclick="openCreateOrgModal()">＋ Nueva org</div>
    </div>

    <div class="sb-divider"></div>

    <div class="sb-section">
      <div class="sb-section-label">Bots de prueba</div>
      <div id="botList"></div>
      <div class="sb-add-btn" onclick="openCreateBotModal()">＋ Nuevo bot test</div>
    </div>
  </aside>

  <!-- Main -->
  <main class="main">
    <div class="top-bar" id="topBar">
      <h2 id="detailTitle">Selecciona un negocio</h2>
      <div id="topActions"></div>
    </div>

    <nav class="tab-nav" id="tabNav" style="display:none">
      <button class="tab-btn active" onclick="showTab('config')">⚙️ Config org</button>
      <button class="tab-btn" onclick="showTab('asistente')">🤖 Asistente</button>
      <button class="tab-btn" onclick="showTab('demo')">🎤 Demo voz</button>
    </nav>

    <!-- Tab: Config org -->
    <div class="tab-panel" id="tab-config">
      <div class="form-grid" id="configForm"></div>
      <div class="form-actions"><button class="btn btn-primary" onclick="saveOrgConfig()">Guardar cambios</button></div>
    </div>

    <!-- Tab: Asistente -->
    <div class="tab-panel hidden" id="tab-asistente">
      <div class="sub-tab-nav">
        <button class="sub-tab-btn active" onclick="showSubTab('basico')">📋 Básico</button>
        <button class="sub-tab-btn" onclick="showSubTab('horario')">🕐 Horario</button>
        <button class="sub-tab-btn" onclick="showSubTab('contenido')">📄 Contenido</button>
        <button class="sub-tab-btn" onclick="showSubTab('prompt')">⚙️ Prompt raw</button>
        <button class="sub-tab-btn" onclick="showSubTab('voz')">🔊 Voz</button>
      </div>
      <div id="sub-basico" class="sub-tab-panel active"></div>
      <div id="sub-horario" class="sub-tab-panel"></div>
      <div id="sub-contenido" class="sub-tab-panel"></div>
      <div id="sub-prompt" class="sub-tab-panel"></div>
      <div id="sub-voz" class="sub-tab-panel"></div>
      <div class="form-actions">
        <button class="btn btn-outline" onclick="previewPrompt()">👁 Ver prompt generado</button>
        <button class="btn btn-primary" onclick="saveAssistantConfig()">Guardar asistente</button>
      </div>
    </div>

    <!-- Tab: Demo voz -->
    <div class="tab-panel hidden" id="tab-demo">
      <div class="demo-container">
        <button class="demo-mic-btn idle" id="demoMicBtn" onclick="toggleDemo()">🎤</button>
        <div class="demo-status" id="demoStatus">Pulsa para iniciar demo de voz</div>
        <div class="demo-transcript" id="demoTranscript"></div>
      </div>
    </div>
  </main>
</div>

<!-- Toast -->
<div id="toast"></div>

<!-- Modal -->
<div id="modalOverlay" onclick="if(event.target===this)closeModal()">
  <div id="modalBox"></div>
</div>

<script src="/admin/playground.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create playground.js**

```js
// public/admin/playground.js
'use strict';

const ADMIN_TOKEN_KEY = 'nf_admin_token';
var _token = null;
var _selectedOrgId = null;
var _selectedBotId = null;
var _orgs = [];
var _bots = [];
var _assistantConfig = {};
var _currentOrgName = '';

// ── API helper ────────────────────────────────────────────────────
async function api(path, method, body) {
  method = method || 'GET';
  var opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  var res = await fetch(path, opts);
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (type || 'ok');
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.className = ''; }, 3000);
}

function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// ── Login ──────────────────────────────────────────────────────────
async function doLogin() {
  var pass = document.getElementById('loginPass').value;
  try {
    var data = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    }).then(function(r) { return r.json(); });
    if (!data.token) throw new Error(data.error || 'Login failed');
    _token = data.token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, _token);
    showApp();
  } catch (e) { toast(e.message, 'err'); }
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadSidebar();
}

// ── Sidebar ────────────────────────────────────────────────────────
async function loadSidebar() {
  try {
    var [orgData, botData] = await Promise.all([
      api('/api/admin/orgs'),
      api('/api/admin/demo-bots'),
    ]);
    _orgs = orgData.orgs || [];
    _bots = botData.bots || [];
    renderSidebar();
  } catch (e) { toast('Error cargando sidebar: ' + e.message, 'err'); }
}

function renderSidebar() {
  var orgList = document.getElementById('orgList');
  orgList.innerHTML = _orgs.map(function(o) {
    var active = o.id === _selectedOrgId ? ' active' : '';
    var badgeClass = o.plan === 'pro' ? 'badge-pro' : o.plan === 'negocio' ? 'badge-negocio' : 'badge-starter';
    return '<div class="org-item' + active + '" onclick="selectOrg(\'' + o.id + '\')">' +
      '<div class="org-name">' + esc(o.name) + '</div>' +
      '<div class="org-badges"><span class="badge ' + badgeClass + '">' + esc(o.plan) + '</span></div>' +
      '</div>';
  }).join('');
  var botList = document.getElementById('botList');
  botList.innerHTML = _bots.map(function(b) {
    var active = b.id === _selectedBotId ? ' active' : '';
    return '<div class="org-item' + active + '" onclick="selectBot(\'' + b.id + '\')">' +
      '<div class="org-name">' + esc(b.name) + '</div>' +
      '<div class="org-badges"><span class="badge badge-test">test</span></div>' +
      '</div>';
  }).join('');
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Org selection ───────────────────────────────────────────────────
async function selectOrg(orgId) {
  _selectedOrgId = orgId;
  _selectedBotId = null;
  var org = _orgs.find(function(o) { return o.id === orgId; });
  if (!org) return;
  _currentOrgName = org.name;
  renderSidebar();
  document.getElementById('detailTitle').textContent = org.name;
  var badge = org.plan === 'pro' ? 'badge-pro' : org.plan === 'negocio' ? 'badge-negocio' : 'badge-starter';
  document.getElementById('topActions').innerHTML =
    '<span class="badge ' + badge + '" style="margin-right:8px">' + esc(org.plan) + '</span>' +
    '<button class="btn btn-outline btn-sm" onclick="sendMagicLink(\'' + orgId + '\')">💌 Magic link</button> ' +
    '<button class="btn btn-danger btn-sm" onclick="deleteOrg(\'' + orgId + '\')">🗑</button>';
  document.getElementById('tabNav').style.display = 'flex';
  showTab('config');
  renderConfigForm(org);
  await loadAssistantConfig(orgId);
}

function renderConfigForm(org) {
  document.getElementById('configForm').innerHTML =
    '<div class="form-group"><label>Nombre</label><input class="form-input" id="cfg-name" value="' + esc(org.name) + '"></div>' +
    '<div class="form-group"><label>Email propietario</label><input class="form-input" id="cfg-email" value="' + esc(org.owner_email) + '"></div>' +
    '<div class="form-group"><label>Plan</label><select class="form-select" id="cfg-plan">' +
      ['starter','negocio','pro'].map(function(p){ return '<option value="' + p + '"' + (org.plan===p?' selected':'') + '>' + p + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Sector</label><input class="form-input" id="cfg-sector" value="' + esc(org.sector || '') + '"></div>' +
    '<div class="form-group"><label>Teléfono</label><input class="form-input" id="cfg-phone" value="' + esc(org.phone || '') + '"></div>' +
    '<div class="form-group"><label>Estado</label><select class="form-select" id="cfg-status">' +
      ['active','paused','deleted'].map(function(s){ return '<option value="' + s + '"' + (org.status===s?' selected':'') + '>' + s + '</option>'; }).join('') +
    '</select></div>';
}

async function saveOrgConfig() {
  var body = {
    name:       document.getElementById('cfg-name').value.trim(),
    plan:       document.getElementById('cfg-plan').value,
    sector:     document.getElementById('cfg-sector').value.trim(),
    phone:      document.getElementById('cfg-phone').value.trim(),
    status:     document.getElementById('cfg-status').value,
  };
  try {
    await api('/api/admin/orgs/' + _selectedOrgId, 'PATCH', body);
    toast('Cambios guardados');
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

async function sendMagicLink(orgId) {
  try {
    await api('/api/admin/send-magic-link', 'POST', { orgId });
    toast('Magic link enviado ✉️');
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteOrg(orgId) {
  if (!confirm('¿Eliminar esta org? (soft-delete)')) return;
  try {
    await api('/api/admin/orgs/' + orgId, 'DELETE');
    toast('Org eliminada');
    _selectedOrgId = null;
    document.getElementById('tabNav').style.display = 'none';
    document.getElementById('detailTitle').textContent = 'Selecciona un negocio';
    document.getElementById('topActions').innerHTML = '';
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Bot selection ──────────────────────────────────────────────────
async function selectBot(botId) {
  _selectedBotId = botId;
  _selectedOrgId = null;
  var bot = _bots.find(function(b) { return b.id === botId; });
  if (!bot) return;
  _currentOrgName = bot.name;
  renderSidebar();
  document.getElementById('detailTitle').textContent = bot.name;
  document.getElementById('topActions').innerHTML =
    '<span class="badge badge-test" style="margin-right:8px">test bot</span>' +
    '<button class="btn btn-danger btn-sm" onclick="deleteBot(\'' + botId + '\')">🗑</button>';
  document.getElementById('tabNav').style.display = 'flex';
  // Bot only has Asistente + Demo tabs
  showTab('asistente');
  _assistantConfig = bot.config || {};
  renderAssistantSubTabs();
}

async function deleteBot(botId) {
  if (!confirm('¿Eliminar este bot de prueba?')) return;
  try {
    await api('/api/admin/demo-bots/' + botId, 'DELETE');
    toast('Bot eliminado');
    _selectedBotId = null;
    document.getElementById('tabNav').style.display = 'none';
    document.getElementById('detailTitle').textContent = 'Selecciona un negocio';
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Tabs ────────────────────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.add('hidden'); });
  var btn = document.querySelector('.tab-btn[onclick="showTab(\'' + tab + '\')"]');
  if (btn) btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.remove('hidden');
}

function showSubTab(sub) {
  document.querySelectorAll('.sub-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.sub-tab-panel').forEach(function(p) { p.classList.remove('active'); });
  event.target.classList.add('active');
  document.getElementById('sub-' + sub).classList.add('active');
}

// ── Assistant config ────────────────────────────────────────────────
var DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
var DAY_LABELS = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

async function loadAssistantConfig(orgId) {
  try {
    var data = await api('/api/admin/assistant/' + orgId);
    _assistantConfig = data.config || {};
    renderAssistantSubTabs();
  } catch (e) { toast('Error cargando config asistente: ' + e.message, 'err'); }
}

function renderAssistantSubTabs() {
  var c = _assistantConfig;

  // Básico
  document.getElementById('sub-basico').innerHTML =
    '<div class="form-grid">' +
    '<div class="form-group"><label>Nombre del asistente</label><input class="form-input" id="a-name" value="' + esc(c.assistantName||'') + '" placeholder="Laura"></div>' +
    '<div class="form-group"><label>Idioma</label><select class="form-select" id="a-lang">' +
      [['es','Español'],['eu','Euskera'],['es+eu','Español + Euskera']].map(function(l){ return '<option value="' + l[0] + '"' + (c.language===l[0]?' selected':'') + '>' + l[1] + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Sector</label><select class="form-select" id="a-sector">' +
      ['generico','restaurante','fisioterapia','clinica','peluqueria','gimnasio','veterinaria','farmacia'].map(function(s){ return '<option value="' + s + '"' + (c.sector===s?' selected':'') + '>' + s + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Modelo LLM</label><select class="form-select" id="a-model">' +
      ['gpt-4o-mini','gpt-4o'].map(function(m){ return '<option value="' + m + '"' + (c.model===m?' selected':'') + '>' + m + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group form-full"><label>Mensaje de bienvenida</label><input class="form-input" id="a-first" value="' + esc(c.firstMessage||'') + '" placeholder="Buenas, ¿en qué puedo ayudarle?"></div>' +
    '<div class="form-group form-full"><label>Información adicional</label><textarea class="form-textarea" id="a-extra" placeholder="Parking, accesibilidad, notas...">' + esc(c.extraInfo||'') + '</textarea></div>' +
    '</div>';

  // Horario
  var sched = c.schedule || {};
  document.getElementById('sub-horario').innerHTML =
    '<div class="schedule-grid">' +
    DAYS.map(function(d) {
      var slot = sched[d];
      var open  = slot ? slot.open  : '09:00';
      var close = slot ? slot.close : '18:00';
      var checked = slot ? 'checked' : '';
      return '<div class="schedule-row">' +
        '<label class="day-toggle"><input type="checkbox" id="day-' + d + '" ' + checked + ' onchange="toggleDay(\'' + d + '\')">' +
        ' <span class="schedule-day">' + DAY_LABELS[d] + '</span></label>' +
        '<div class="schedule-slots" id="slots-' + d + '" style="display:' + (slot?'flex':'none') + '">' +
        '<input type="time" class="form-input" id="open-' + d + '" value="' + open + '" style="width:90px">' +
        '<span style="color:var(--dim);font-size:11px">–</span>' +
        '<input type="time" class="form-input" id="close-' + d + '" value="' + close + '" style="width:90px">' +
        '</div>' +
        (slot ? '' : '<span class="schedule-closed">Cerrado</span>') +
        '</div>';
    }).join('') +
    '</div>';

  // Contenido (sector-specific)
  renderContenidoTab(c.sector || 'generico', c.sectorData || {}, c.services || '');

  // Prompt raw
  var savedPrompt = c.customPromptOverride || '';
  document.getElementById('sub-prompt').innerHTML =
    '<div class="prompt-warning">⚠️ Al guardar texto aquí, se usará este prompt en lugar del generado automáticamente. Borra el campo para volver al generado.</div>' +
    '<textarea class="prompt-raw-textarea" id="a-prompt-raw" placeholder="Deja vacío para usar el prompt generado automáticamente...">' + esc(savedPrompt) + '</textarea>';

  // Voz
  document.getElementById('sub-voz').innerHTML =
    '<div class="form-grid">' +
    '<div class="form-group"><label>Voz TTS</label><select class="form-select" id="a-voice">' +
      ['nova','alloy','echo','fable','onyx','shimmer'].map(function(v){ return '<option value="' + v + '"' + (c.voice===v?' selected':'') + '>' + v + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="form-group"><label>Temperatura</label><input class="form-input" type="number" id="a-temp" min="0" max="1" step="0.1" value="' + (c.temperature ?? 0.5) + '"></div>' +
    '</div>';
}

function toggleDay(day) {
  var checked = document.getElementById('day-' + day).checked;
  document.getElementById('slots-' + day).style.display = checked ? 'flex' : 'none';
}

function renderContenidoTab(sector, sectorData, services) {
  var html = '<div class="form-grid">';
  html += '<div class="form-group form-full"><label>Servicios generales</label><textarea class="form-textarea" id="a-services" placeholder="Describe los servicios que ofrece el negocio...">' + esc(services) + '</textarea></div>';

  if (sector === 'restaurante') {
    html += '<div class="form-group"><label>Horario comidas</label><input class="form-input" id="sd-horarioComida" value="' + esc(sectorData.horarioComida||'') + '" placeholder="13:00-15:30"></div>';
    html += '<div class="form-group"><label>Horario cenas</label><input class="form-input" id="sd-horarioCena" value="' + esc(sectorData.horarioCena||'') + '" placeholder="20:30-23:00"></div>';
    html += '<div class="form-group"><label>Aforo máximo</label><input class="form-input" id="sd-maxGuests" type="number" value="' + esc(sectorData.maxGuests||'') + '" placeholder="12"></div>';
    html += '<div class="form-group form-full"><label>Carta (un plato por línea, formato: Nombre - Precio)</label><textarea class="form-textarea" id="sd-cartaRaw" placeholder="Chuletón - 28€\nMerluza a la vasca - 22€">' + esc((sectorData.cartaItems||[]).map(function(i){return i.name+(i.price?' - '+i.price:'');}).join('\n')) + '</textarea></div>';
  } else if (sector === 'fisioterapia' || sector === 'clinica') {
    var seguros = (sectorData.seguros || []);
    html += '<div class="form-group form-full"><label>Seguros aceptados</label>';
    html += '<div class="chips-container" id="seguros-chips">' + seguros.map(function(s){ return '<span class="chip">' + esc(s) + ' <span class="chip-remove" onclick="removeSeguro(this)">×</span></span>'; }).join('') + '</div>';
    html += '<input class="chip-add-input" id="seguro-input" placeholder="+ Añadir seguro" onkeydown="if(event.key===\'Enter\'||event.key===\',\'){addSeguro();event.preventDefault()}"></div>';
    html += '<div class="form-group form-full"><label>Especialidades</label><textarea class="form-textarea" id="sd-especialidades" placeholder="Columna, rodilla, lesiones deportivas...">' + esc(sectorData.especialidades||'') + '</textarea></div>';
  } else if (sector === 'peluqueria') {
    html += '<div class="form-group form-full"><label>Servicios y precios</label><textarea class="form-textarea" id="sd-servicios" placeholder="Corte mujer - 25€\nTinte - 45€">' + esc(sectorData.servicios||'') + '</textarea></div>';
  } else if (sector === 'gimnasio') {
    html += '<div class="form-group form-full"><label>Clases disponibles</label><textarea class="form-textarea" id="sd-clases" placeholder="Yoga L/X/V 9:00, Spinning M/J 19:00...">' + esc(sectorData.clases||'') + '</textarea></div>';
  }
  html += '</div>';
  document.getElementById('sub-contenido').innerHTML = html;
}

function addSeguro() {
  var input = document.getElementById('seguro-input');
  var val = input.value.trim();
  if (!val) return;
  var chip = document.createElement('span');
  chip.className = 'chip';
  chip.innerHTML = esc(val) + ' <span class="chip-remove" onclick="removeSeguro(this)">×</span>';
  document.getElementById('seguros-chips').appendChild(chip);
  input.value = '';
}
function removeSeguro(el) {
  el.parentElement.remove();
}

function collectAssistantConfig() {
  var c = {};
  var get = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };

  c.assistantName = get('a-name');
  c.language      = get('a-lang');
  c.sector        = get('a-sector');
  c.model         = get('a-model');
  c.firstMessage  = get('a-first');
  c.extraInfo     = get('a-extra');
  c.voice         = get('a-voice');
  c.temperature   = parseFloat(get('a-temp')) || 0.5;
  c.customPromptOverride = get('a-prompt-raw').trim() || null;

  // Schedule
  c.schedule = {};
  DAYS.forEach(function(d) {
    var cb = document.getElementById('day-' + d);
    if (cb && cb.checked) {
      c.schedule[d] = { open: get('open-' + d) || '09:00', close: get('close-' + d) || '18:00' };
    } else {
      c.schedule[d] = null;
    }
  });

  // Services
  c.services = get('a-services');

  // Sector-specific
  var sd = {};
  var sector = c.sector;
  if (sector === 'restaurante') {
    sd.horarioComida = get('sd-horarioComida');
    sd.horarioCena   = get('sd-horarioCena');
    sd.maxGuests     = parseInt(get('sd-maxGuests')) || null;
    var cartaRaw = get('sd-cartaRaw');
    sd.cartaItems = cartaRaw.split('\n').filter(Boolean).map(function(line) {
      var parts = line.split(' - ');
      return { name: parts[0].trim(), price: parts[1] ? parts[1].trim() : null };
    });
  } else if (sector === 'fisioterapia' || sector === 'clinica') {
    sd.seguros = Array.from(document.querySelectorAll('#seguros-chips .chip')).map(function(el) {
      return el.textContent.replace('×','').trim();
    });
    sd.especialidades = get('sd-especialidades');
  } else if (sector === 'peluqueria') {
    sd.servicios = get('sd-servicios');
  } else if (sector === 'gimnasio') {
    sd.clases = get('sd-clases');
  }
  c.sectorData = sd;

  return c;
}

async function previewPrompt() {
  var config = collectAssistantConfig();
  try {
    var data = await api('/api/admin/assistant/generate-prompt', 'POST', { config, orgName: _currentOrgName });
    openModal('<div class="modal-title">Prompt generado</div>' +
      '<pre style="white-space:pre-wrap;font-size:11px;color:#a8b4d0;font-family:monospace;max-height:400px;overflow-y:auto;background:#0d0d15;padding:12px;border-radius:8px">' + esc(data.prompt) + '</pre>' +
      '<div style="margin-top:14px;text-align:right"><button class="btn btn-outline" onclick="closeModal()">Cerrar</button></div>');
  } catch (e) { toast(e.message, 'err'); }
}

async function saveAssistantConfig() {
  var config = collectAssistantConfig();
  try {
    var endpoint = _selectedOrgId ? '/api/admin/assistant/' + _selectedOrgId : '/api/admin/demo-bots/' + _selectedBotId;
    var method   = _selectedOrgId ? 'PUT' : 'PUT'; // demo bots: we'll PATCH config via update endpoint
    if (_selectedBotId) {
      // For demo bots update the config field directly
      await api('/api/admin/demo-bots/' + _selectedBotId, 'PATCH', { config });
    } else {
      await api('/api/admin/assistant/' + _selectedOrgId, 'PUT', config);
    }
    _assistantConfig = config;
    toast('Asistente guardado ✓');
  } catch (e) { toast(e.message, 'err'); }
}

// ── Create org modal ────────────────────────────────────────────────
function openCreateOrgModal() {
  openModal('<div class="modal-title">Nueva org</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Nombre</label><input class="form-input" id="new-name" placeholder="Mi Negocio S.L."></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Email propietario</label><input class="form-input" id="new-email" type="email" placeholder="owner@example.com"></div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Plan</label><select class="form-select" id="new-plan"><option value="negocio">negocio</option><option value="pro">pro</option><option value="starter">starter</option></select></div>' +
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><input class="form-input" id="new-sector" placeholder="fisioterapia"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn btn-outline" onclick="closeModal()">Cancelar</button>' +
    '<button class="btn btn-primary" onclick="createOrg()">Crear</button></div>');
}

async function createOrg() {
  var body = {
    name:       document.getElementById('new-name').value.trim(),
    ownerEmail: document.getElementById('new-email').value.trim(),
    plan:       document.getElementById('new-plan').value,
    sector:     document.getElementById('new-sector').value.trim(),
  };
  if (!body.name || !body.ownerEmail) { toast('Nombre y email requeridos', 'err'); return; }
  try {
    await api('/api/admin/orgs', 'POST', body);
    toast('Org creada ✓');
    closeModal();
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

function openCreateBotModal() {
  openModal('<div class="modal-title">Nuevo bot de prueba</div>' +
    '<div class="form-group" style="margin-bottom:10px"><label>Nombre</label><input class="form-input" id="bot-name" placeholder="bot-restaurante-test"></div>' +
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><select class="form-select" id="bot-sector"><option>generico</option><option>restaurante</option><option>fisioterapia</option><option>clinica</option><option>peluqueria</option><option>gimnasio</option></select></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="btn btn-outline" onclick="closeModal()">Cancelar</button>' +
    '<button class="btn btn-primary" onclick="createBot()">Crear</button></div>');
}

async function createBot() {
  var body = {
    name:   document.getElementById('bot-name').value.trim(),
    sector: document.getElementById('bot-sector').value,
  };
  if (!body.name) { toast('Nombre requerido', 'err'); return; }
  try {
    await api('/api/admin/demo-bots', 'POST', body);
    toast('Bot creado ✓');
    closeModal();
    loadSidebar();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Voice demo ──────────────────────────────────────────────────────
var _demoActive   = false;
var _mediaRecorder = null;
var _demoMessages = [];
var _botSpeaking  = false;
var _currentAudio = null;

async function toggleDemo() {
  if (_demoActive) {
    stopDemo();
  } else {
    startDemo();
  }
}

async function startDemo() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _demoActive = true;
    _demoMessages = [];
    document.getElementById('demoTranscript').innerHTML = '';
    document.getElementById('demoMicBtn').className = 'demo-mic-btn active';
    document.getElementById('demoStatus').textContent = 'Escuchando...';
    captureChunk(stream);
  } catch (e) {
    toast('No se puede acceder al micrófono: ' + e.message, 'err');
  }
}

function stopDemo() {
  _demoActive = false;
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  if (_currentAudio) { _currentAudio.pause(); _currentAudio = null; }
  document.getElementById('demoMicBtn').className = 'demo-mic-btn idle';
  document.getElementById('demoStatus').textContent = 'Pulsa para iniciar demo de voz';
}

function captureChunk(stream) {
  if (!_demoActive || _botSpeaking) return;
  var chunks = [];
  _mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  _mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
  _mediaRecorder.onstop = async function() {
    if (!_demoActive) return;
    var blob = new Blob(chunks, { type: 'audio/webm' });
    var reader = new FileReader();
    reader.onload = async function() {
      var base64 = reader.result.split(',')[1];
      try {
        var sttData = await api('/api/demo/stt', 'POST', { audio: base64, mimeType: 'audio/webm' });
        var transcript = (sttData.transcript || '').trim();
        if (transcript) {
          addDemoMsg('user', transcript);
          _demoMessages.push({ role: 'user', content: transcript });
          document.getElementById('demoStatus').textContent = 'Pensando...';
          _botSpeaking = true;
          document.getElementById('demoMicBtn').className = 'demo-mic-btn speaking';
          var chatData = await api('/api/demo/chat', 'POST', {
            orgId: _selectedOrgId || null,
            botId: _selectedBotId || null,
            messages: _demoMessages,
          });
          var reply = chatData.reply || '';
          if (reply) {
            addDemoMsg('bot', reply);
            _demoMessages.push({ role: 'assistant', content: reply });
            await playTTS(reply);
          }
        }
      } catch (e) {
        toast('Error demo: ' + e.message, 'err');
      } finally {
        _botSpeaking = false;
        if (_demoActive) {
          document.getElementById('demoMicBtn').className = 'demo-mic-btn active';
          document.getElementById('demoStatus').textContent = 'Escuchando...';
          captureChunk(stream);
        }
      }
    };
    reader.readAsDataURL(blob);
  };
  _mediaRecorder.start();
  setTimeout(function() {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') _mediaRecorder.stop();
  }, 3000);
}

async function playTTS(text) {
  return new Promise(async function(resolve) {
    try {
      var voice = _assistantConfig.voice || 'nova';
      var res = await fetch('/api/demo/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
        body: JSON.stringify({ text, voice }),
      });
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      _currentAudio = new Audio(url);
      _currentAudio.onended = resolve;
      _currentAudio.onerror = resolve;
      _currentAudio.play();
    } catch (e) { resolve(); }
  });
}

function addDemoMsg(role, text) {
  var div = document.createElement('div');
  div.className = 'demo-msg ' + role;
  div.textContent = text;
  var container = document.getElementById('demoTranscript');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ── PATCH for demo bots (add to routes-admin.js if needed) ─────────
// Note: need to add PATCH /api/admin/demo-bots/:id endpoint in Task 3

// ── Init ────────────────────────────────────────────────────────────
(function init() {
  var saved = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (saved) { _token = saved; showApp(); }
})();
```

- [ ] **Step 3: Add PATCH /api/admin/demo-bots/:id to routes-assistant.js**

In `src/api/routes-assistant.js`, add before `module.exports`:

```js
  // ── PATCH /api/admin/demo-bots/:id ───────────────────────────
  // Update demo bot config
  app.patch('/api/admin/demo-bots/:id', adminAuth, async (req, res) => {
    const { config, name, sector } = req.body;
    const db = getDatabase();
    const patch = {};
    if (config  !== undefined) patch.config  = config;
    if (name    !== undefined) patch.name    = name;
    if (sector  !== undefined) patch.sector  = sector;
    try {
      await db.client.from('demo_bots').update(patch).eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
```

Also add PATCH for orgs in `routes-admin.js` (find `setupAdminRoutes`, add after DELETE org):

```js
  // ─── PATCH org fields ──────────────────────────────────────────────────────────
  app.patch('/api/admin/orgs/:id', adminAuth, async (req, res) => {
    const { name, plan, sector, phone, status } = req.body;
    const db = getDatabase();
    const patch = {};
    if (name   !== undefined) patch.name   = name;
    if (plan   !== undefined) {
      if (!['starter','negocio','pro'].includes(plan)) return res.status(400).json({ error: 'plan inválido' });
      patch.plan = plan;
    }
    if (sector !== undefined) patch.sector = sector;
    if (phone  !== undefined) patch.phone  = phone;
    if (status !== undefined) patch.status = status;
    try {
      await db.client.from('organizations').update(patch).eq('id', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
```

- [ ] **Step 4: Verify playground loads**

```bash
# Start server
node server.js &
sleep 3
# Check the page loads
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin/playground
# Should return: 200
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add public/admin/playground.html public/admin/playground.js src/api/routes-assistant.js src/api/routes-admin.js
git commit -m "feat: add /admin/playground — full org/bot management + voice demo UI"
```

---

## Task 9: Portal — Asistente section

**Files:**
- Modify: `public/portal/index.html`
- Modify: `public/portal/portal.js`

- [ ] **Step 1: Add nav item to portal/index.html**

Find the nav items block in the sidebar (look for `data-section="automatizaciones"`) and add after it:

```html
<div class="nav-item" data-section="asistente" onclick="navigate('asistente')">
  <span class="nav-icon">🤖</span>
  <span>Asistente</span>
</div>
```

- [ ] **Step 2: Add Asistente section HTML to portal/index.html**

Find `<section id="sec-automatizaciones"` and add after its closing `</section>`:

```html
<section id="sec-asistente" class="section hidden">
  <div class="section-header">
    <h2 class="section-title">🤖 Asistente</h2>
    <p class="section-sub">Configura cómo habla tu asistente con tus clientes</p>
  </div>

  <!-- Sub-tabs -->
  <div style="display:flex;gap:4px;margin-bottom:20px;background:var(--card2);border-radius:8px;padding:4px;width:fit-content">
    <button class="btn-subtab active" data-subtab="basico" onclick="switchAsistenteTab('basico')">📋 Básico</button>
    <button class="btn-subtab" data-subtab="horario" onclick="switchAsistenteTab('horario')">🕐 Horario</button>
    <button class="btn-subtab" data-subtab="contenido" onclick="switchAsistenteTab('contenido')">📄 Contenido</button>
    <button class="btn-subtab" data-subtab="voz" onclick="switchAsistenteTab('voz')">🔊 Voz</button>
  </div>

  <div id="asis-basico" class="asis-panel">
    <div class="card" style="padding:20px">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre del asistente</label><input class="form-ctrl" id="asis-name" placeholder="Laura"></div>
        <div class="form-group"><label class="form-label">Idioma</label>
          <select class="form-ctrl" id="asis-lang">
            <option value="es">Español</option><option value="eu">Euskera</option><option value="es+eu">Español + Euskera</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Mensaje de bienvenida</label><input class="form-ctrl" id="asis-first" placeholder="Buenas, ¿en qué puedo ayudarle?"></div>
      <div class="form-group"><label class="form-label">Información adicional</label><textarea class="form-ctrl" id="asis-extra" rows="3" placeholder="Parking, accesibilidad, notas..."></textarea></div>
    </div>
  </div>

  <div id="asis-horario" class="asis-panel hidden">
    <div class="card" style="padding:20px" id="asis-schedule-grid"></div>
  </div>

  <div id="asis-contenido" class="asis-panel hidden">
    <div class="card" style="padding:20px" id="asis-contenido-body"></div>
  </div>

  <div id="asis-voz" class="asis-panel hidden">
    <div class="card" style="padding:20px">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Voz del asistente</label>
          <select class="form-ctrl" id="asis-voice">
            <option value="nova">Nova</option><option value="alloy">Alloy</option><option value="echo">Echo</option><option value="shimmer">Shimmer</option>
          </select>
        </div>
      </div>
    </div>
    <div class="card" style="padding:20px;margin-top:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px">🎤 Demo de voz</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:10px 0">
        <button id="portal-mic-btn" onclick="togglePortalDemo()" style="width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;font-size:24px;background:rgba(108,92,231,.15);color:var(--accent-l);transition:all .2s">🎤</button>
        <div id="portal-demo-status" style="font-size:12px;color:var(--dim)">Pulsa para probar tu asistente</div>
        <div id="portal-demo-transcript" style="width:100%;background:var(--card2);border-radius:10px;padding:12px;min-height:80px;font-size:12px;line-height:1.6"></div>
      </div>
    </div>
  </div>

  <!-- Avanzado accordion -->
  <details style="margin-top:16px">
    <summary style="cursor:pointer;font-size:12px;color:var(--dim);padding:8px 0;user-select:none">⚙️ Avanzado — Prompt raw</summary>
    <div class="card" style="padding:16px;margin-top:8px">
      <div style="background:rgba(249,202,36,.08);border:1px solid rgba(249,202,36,.2);border-radius:8px;padding:10px;font-size:11px;color:#f9ca24;margin-bottom:12px">
        Modificar el prompt puede cambiar el comportamiento del asistente de formas inesperadas. Solo edita si sabes lo que haces.
      </div>
      <div style="font-size:11px;color:var(--dim);margin-bottom:6px">Prompt actual (generado automáticamente):</div>
      <pre id="asis-generated-prompt" style="white-space:pre-wrap;font-size:10px;color:#8888a8;background:#0d0d15;padding:12px;border-radius:8px;max-height:200px;overflow-y:auto"></pre>
    </div>
  </details>

  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
    <button class="btn-secondary" onclick="loadAsistente()">Descartar cambios</button>
    <button class="btn-primary" onclick="saveAsistente()">Guardar asistente</button>
  </div>
</section>
```

Add these CSS rules inside the `<style>` block of portal/index.html:

```css
.btn-subtab{padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;color:var(--dim);cursor:pointer;border:none;background:none;font-family:inherit;transition:all .15s}
.btn-subtab.active{background:var(--card);color:var(--text)}
.asis-panel{display:block}.asis-panel.hidden{display:none}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.form-label{display:block;font-size:11px;font-weight:600;color:var(--dim);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}
.form-ctrl{width:100%;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
.form-ctrl:focus{border-color:var(--accent)}
```

- [ ] **Step 3: Add portal asistente functions to portal.js**

Append to the end of `public/portal/portal.js`:

```js
// ── Asistente section ─────────────────────────────────────────────
var _asisConfig = {};
var _asisOrgName = '';
var _DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
var _DAY_LABELS = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

async function loadAsistente() {
  try {
    var data = await api('/api/portal/assistant');
    _asisConfig  = data.config  || {};
    _asisOrgName = data.orgName || '';
    renderAsistenteForm();
  } catch (e) { toast('Error cargando asistente: ' + e.message, 'err'); }
}

function switchAsistenteTab(tab) {
  document.querySelectorAll('.btn-subtab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.subtab === tab);
  });
  document.querySelectorAll('.asis-panel').forEach(function(p) {
    p.classList.toggle('hidden', p.id !== 'asis-' + tab);
  });
}

function renderAsistenteForm() {
  var c = _asisConfig;
  var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

  setVal('asis-name',  c.assistantName || '');
  setVal('asis-lang',  c.language || 'es');
  setVal('asis-first', c.firstMessage || '');
  setVal('asis-extra', c.extraInfo || '');
  setVal('asis-voice', c.voice || 'nova');

  // Schedule grid
  var sched = c.schedule || {};
  var schedHtml = _DAYS.map(function(d) {
    var slot = sched[d];
    return '<div style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center;margin-bottom:8px">' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);cursor:pointer">' +
      '<input type="checkbox" id="asis-day-' + d + '"' + (slot ? ' checked' : '') + ' onchange="toggleAsisDayClosed(\'' + d + '\')">' +
      ' ' + _DAY_LABELS[d] + '</label>' +
      '<div id="asis-slots-' + d + '" style="display:' + (slot?'flex':'none') + ';gap:8px;align-items:center">' +
      '<input type="time" class="form-ctrl" id="asis-open-' + d + '" value="' + (slot?slot.open:'09:00') + '" style="width:90px">' +
      '<span style="color:var(--dim);font-size:11px">–</span>' +
      '<input type="time" class="form-ctrl" id="asis-close-' + d + '" value="' + (slot?slot.close:'18:00') + '" style="width:90px">' +
      '</div>' +
      '</div>';
  }).join('');
  document.getElementById('asis-schedule-grid').innerHTML = schedHtml;

  // Contenido
  renderAsisSectorFields(c.sector || 'generico', c.sectorData || {}, c.services || '');

  // Generated prompt preview
  var genPrompt = document.getElementById('asis-generated-prompt');
  if (genPrompt) genPrompt.textContent = '(Guarda primero para ver el prompt generado)';
}

function toggleAsisDayClosed(day) {
  var checked = document.getElementById('asis-day-' + day).checked;
  document.getElementById('asis-slots-' + day).style.display = checked ? 'flex' : 'none';
}

function renderAsisSectorFields(sector, sd, services) {
  var html = '<div class="form-group" style="margin-bottom:14px"><label class="form-label">Servicios generales</label>' +
    '<textarea class="form-ctrl" id="asis-services" rows="3" placeholder="Describe los servicios que ofrece el negocio...">' + (services||'') + '</textarea></div>';

  if (sector === 'fisioterapia' || sector === 'clinica') {
    var seguros = (sd.seguros || []);
    html += '<div class="form-group"><label class="form-label">Seguros aceptados</label>' +
      '<div id="asis-seguros-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
      seguros.map(function(s) { return '<span style="background:rgba(108,92,231,.12);border:1px solid rgba(108,92,231,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px">' + s + ' <span style="cursor:pointer" onclick="this.parentElement.remove()">×</span></span>'; }).join('') +
      '</div><input class="form-ctrl" id="asis-seguro-input" placeholder="+ Seguro (Enter para añadir)" style="width:180px" onkeydown="if(event.key===\'Enter\'){addAsisSeguro();event.preventDefault()}"></div>';
    html += '<div class="form-group" style="margin-top:12px"><label class="form-label">Especialidades</label><textarea class="form-ctrl" id="asis-espec" rows="2">' + (sd.especialidades||'') + '</textarea></div>';
  } else if (sector === 'restaurante') {
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="form-group"><label class="form-label">Horario comidas</label><input class="form-ctrl" id="asis-horComida" value="' + (sd.horarioComida||'') + '" placeholder="13:00-15:30"></div>';
    html += '<div class="form-group"><label class="form-label">Horario cenas</label><input class="form-ctrl" id="asis-horCena" value="' + (sd.horarioCena||'') + '" placeholder="20:30-23:00"></div></div>';
    html += '<div class="form-group" style="margin-top:12px"><label class="form-label">Carta (un plato por línea: Nombre - Precio)</label><textarea class="form-ctrl" id="asis-carta" rows="5" placeholder="Chuletón - 28€">' + ((sd.cartaItems||[]).map(function(i){return i.name+(i.price?' - '+i.price:'');}).join('\n')) + '</textarea></div>';
  }

  document.getElementById('asis-contenido-body').innerHTML = html;
}

function addAsisSeguro() {
  var input = document.getElementById('asis-seguro-input');
  var val = input.value.trim(); if (!val) return;
  var span = document.createElement('span');
  span.style.cssText = 'background:rgba(108,92,231,.12);border:1px solid rgba(108,92,231,.2);border-radius:20px;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px';
  span.innerHTML = val + ' <span style="cursor:pointer" onclick="this.parentElement.remove()">×</span>';
  document.getElementById('asis-seguros-chips').appendChild(span);
  input.value = '';
}

function collectAsisConfig() {
  var c = {};
  var get = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  c.assistantName = get('asis-name');
  c.language      = get('asis-lang');
  c.firstMessage  = get('asis-first');
  c.extraInfo     = get('asis-extra');
  c.voice         = get('asis-voice');
  c.services      = get('asis-services') || '';

  c.schedule = {};
  _DAYS.forEach(function(d) {
    var cb = document.getElementById('asis-day-' + d);
    c.schedule[d] = (cb && cb.checked) ? { open: get('asis-open-' + d)||'09:00', close: get('asis-close-' + d)||'18:00' } : null;
  });

  var sector = _asisConfig.sector || 'generico';
  c.sector = sector;
  var sd = {};
  if (sector === 'fisioterapia' || sector === 'clinica') {
    sd.seguros = Array.from(document.querySelectorAll('#asis-seguros-chips span')).map(function(el) { return el.textContent.replace('×','').trim(); });
    sd.especialidades = get('asis-espec');
  } else if (sector === 'restaurante') {
    sd.horarioComida = get('asis-horComida');
    sd.horarioCena   = get('asis-horCena');
    var cartaRaw = get('asis-carta');
    sd.cartaItems = cartaRaw.split('\n').filter(Boolean).map(function(l) { var p=l.split(' - '); return {name:p[0].trim(),price:p[1]?p[1].trim():null}; });
  }
  c.sectorData = sd;
  return c;
}

async function saveAsistente() {
  var config = collectAsisConfig();
  try {
    var data = await api('/api/portal/assistant', 'PUT', config);
    _asisConfig = Object.assign(_asisConfig, config);
    var genEl = document.getElementById('asis-generated-prompt');
    if (genEl && data.prompt) genEl.textContent = data.prompt;
    toast('Asistente guardado ✓');
  } catch (e) { toast(e.message, 'err'); }
}

// ── Portal voice demo ──────────────────────────────────────────────
var _portalDemoActive = false;
var _portalMediaRecorder = null;
var _portalMessages = [];
var _portalBotSpeaking = false;
var _portalAudio = null;

async function togglePortalDemo() {
  if (_portalDemoActive) {
    _portalDemoActive = false;
    if (_portalMediaRecorder && _portalMediaRecorder.state !== 'inactive') _portalMediaRecorder.stop();
    if (_portalAudio) { _portalAudio.pause(); _portalAudio = null; }
    document.getElementById('portal-mic-btn').style.background = 'rgba(108,92,231,.15)';
    document.getElementById('portal-demo-status').textContent = 'Pulsa para probar tu asistente';
  } else {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _portalDemoActive = true;
      _portalMessages = [];
      document.getElementById('portal-demo-transcript').innerHTML = '';
      document.getElementById('portal-mic-btn').style.background = '#e74c3c';
      document.getElementById('portal-demo-status').textContent = 'Escuchando...';
      portalCaptureChunk(stream);
    } catch (e) { toast('No se puede acceder al micrófono', 'err'); }
  }
}

function portalCaptureChunk(stream) {
  if (!_portalDemoActive || _portalBotSpeaking) return;
  var chunks = [];
  _portalMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  _portalMediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
  _portalMediaRecorder.onstop = async function() {
    if (!_portalDemoActive) return;
    var blob = new Blob(chunks, { type: 'audio/webm' });
    var reader = new FileReader();
    reader.onload = async function() {
      var base64 = reader.result.split(',')[1];
      try {
        var sttData = await api('/api/demo/stt', 'POST', { audio: base64, mimeType: 'audio/webm' });
        var transcript = (sttData.transcript || '').trim();
        if (transcript) {
          var t = document.getElementById('portal-demo-transcript');
          t.innerHTML += '<div style="margin-bottom:6px;font-size:12px"><strong style="color:var(--dim)">Tú:</strong> ' + transcript + '</div>';
          _portalMessages.push({ role: 'user', content: transcript });
          document.getElementById('portal-demo-status').textContent = 'Pensando...';
          _portalBotSpeaking = true;
          var chatData = await api('/api/demo/chat', 'POST', { messages: _portalMessages });
          var reply = chatData.reply || '';
          if (reply) {
            t.innerHTML += '<div style="margin-bottom:6px;font-size:12px"><strong style="color:var(--accent-l)">Bot:</strong> ' + reply + '</div>';
            t.scrollTop = t.scrollHeight;
            _portalMessages.push({ role: 'assistant', content: reply });
            var res = await fetch('/api/demo/tts', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+_token}, body:JSON.stringify({text:reply,voice:_asisConfig.voice||'nova'}) });
            var audioBlob = await res.blob();
            _portalAudio = new Audio(URL.createObjectURL(audioBlob));
            await new Promise(function(resolve) { _portalAudio.onended = resolve; _portalAudio.onerror = resolve; _portalAudio.play(); });
          }
        }
      } catch(e) { toast('Error demo: ' + e.message, 'err'); }
      finally {
        _portalBotSpeaking = false;
        if (_portalDemoActive) {
          document.getElementById('portal-mic-btn').style.background = '#e74c3c';
          document.getElementById('portal-demo-status').textContent = 'Escuchando...';
          portalCaptureChunk(stream);
        }
      }
    };
    reader.readAsDataURL(blob);
  };
  _portalMediaRecorder.start();
  setTimeout(function() { if (_portalMediaRecorder && _portalMediaRecorder.state==='recording') _portalMediaRecorder.stop(); }, 3000);
}
```

- [ ] **Step 4: Wire loadAsistente into navigate() in portal.js**

Find the `navigate` function in portal.js (around line 60). Inside it, add:

```js
  if (section === 'asistente') loadAsistente();
```

right after the similar lines that load other sections (e.g. `if (section === 'dashboard') loadDashboard();`).

- [ ] **Step 5: Verify portal.js parses**

```bash
node -e "require('fs').readFileSync('./public/portal/portal.js','utf8'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add public/portal/index.html public/portal/portal.js
git commit -m "feat: portal — add Asistente section with config editor + voice demo"
```

---

## Task 10: Smoke tests

- [ ] **Step 1: Start the server**

```bash
node server.js
```

Expected: server starts on port 3000, no crash, logs show `ROUTES-ASSISTANT`, `ROUTES-DEMO` registered.

- [ ] **Step 2: Verify admin playground loads**

Open `http://localhost:3000/admin/playground` → login with `DASHBOARD_PASSWORD` → sidebar shows orgs list → click an org → Config org tab renders form fields.

- [ ] **Step 3: Test assistant config save**

Click an org → tab Asistente → fill in Básico fields → click "Guardar asistente" → toast "Asistente guardado ✓" → click "Ver prompt generado" → modal shows compiled prompt.

- [ ] **Step 4: Test create org**

Click "+ Nueva org" → fill form → create → org appears in sidebar.

- [ ] **Step 5: Test demo chat (text fallback)**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/auth \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$DASHBOARD_PASSWORD\"}" | node -e "var d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

ORG_ID="<paste an org id>"

curl -s -X POST http://localhost:3000/api/demo/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"orgId\":\"$ORG_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Hola, ¿estáis abiertos hoy?\"}]}"
```

Expected: `{"reply":"..."}` — the bot responds with something relevant to the org's schedule.

- [ ] **Step 6: Test TTS endpoint**

```bash
curl -s -X POST http://localhost:3000/api/demo/tts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"Buenos días, ¿en qué puedo ayudarle?","voice":"nova"}' \
  --output /tmp/test-tts.mp3

file /tmp/test-tts.mp3
```

Expected: `test-tts.mp3: Audio file with ID3 version 2.4.0` (or similar MP3 header).

- [ ] **Step 7: Test portal Asistente tab**

Log in to portal with a valid magic link → navigate to Asistente → page loads config form → change assistant name → save → toast "Asistente guardado ✓" → generated prompt appears in Avanzado accordion.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: smoke tests passed — playground + assistant config complete"
```
