# NodeFlow Lifecycle Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated lifecycle reminder system that contacts clients via WhatsApp/SMS/email at the right moment based on their service history and sector-specific intervals.

**Architecture:** Six new DB tables + four new JS modules in `src/lifecycle/` + two new notification files. A cron scheduler runs every 30 minutes, claims pending reminders atomically, and dispatches via WhatsApp (Meta Cloud API) → SMS (Twilio) → Email (Resend) in priority order. Post-call transcript analysis runs async after every call to build persistent per-contact memory that personalizes future interactions.

**Tech Stack:** Node.js (CommonJS), Supabase (PostgreSQL), OpenAI GPT-4o-mini (transcript analysis), Meta WhatsApp Cloud API, Twilio SMS, Resend email.

**Spec:** `docs/superpowers/specs/2026-06-02-lifecycle-reminders-design.md`

---

## Phase 1: Foundation

### Task 1: DB Migration

**Files:**
- Create: `db/schema-migration-lifecycle.sql`

> ⚠️ This SQL must be run **manually** in Supabase SQL Editor (Dashboard → SQL Editor → New query). The project has no programmatic migration runner.

- [ ] **Step 1: Create the migration file**

Create `db/schema-migration-lifecycle.sql` with this exact content:

```sql
-- ============================================================
-- NodeFlow Lifecycle Reminders — DB Migration
-- Run manually in Supabase SQL Editor
-- ============================================================

-- 1. contact_memory — accumulated state per contact
create table if not exists contact_memory (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id) on delete cascade,
  call_count       int not null default 0,
  last_call_at     timestamptz,
  last_call_summary text,
  preferences      jsonb not null default '{}',
  sensitivities    jsonb not null default '{}',
  no_whatsapp      boolean not null default false,
  no_email         boolean not null default false,
  no_sms           boolean not null default false,
  failed_attempts  int not null default 0,
  last_failed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, contact_id)
);

-- 2. call_summaries — immutable per-call records
create table if not exists call_summaries (
  id               uuid primary key default gen_random_uuid(),
  call_session_id  text,
  org_id           uuid references organizations(id) on delete set null,
  contact_id       uuid references contacts(id) on delete set null,
  summary          text not null,
  outcome          text check (outcome in (
    'booked','rescheduled','declined','no_answer',
    'callback_requested','wrong_number','do_not_contact','voicemail_left'
  )),
  extracted_data   jsonb not null default '{}',
  topics           text[] not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists idx_call_summaries_contact
  on call_summaries (contact_id, org_id, created_at desc);

-- 3. scheduled_reminders — reminder queue
create table if not exists scheduled_reminders (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  service_key     text not null,
  channel         text not null check (channel in ('whatsapp', 'sms', 'email')),
  scheduled_for   timestamptz not null,
  status          text not null default 'pending'
                  check (status in ('pending','sending','sent','failed','cancelled','postponed')),
  sent_at         timestamptz,
  failed_reason   text,
  postponed_from  uuid references scheduled_reminders(id),
  postponed_days  int,
  message_preview text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_reminders_pending
  on scheduled_reminders (org_id, scheduled_for)
  where status = 'pending';

-- 4. org_reminder_config — per-org interval overrides
create table if not exists org_reminder_config (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade unique,
  config     jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 5. org_campaigns — seasonal org-wide campaigns
create table if not exists org_campaigns (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  service_key     text not null,
  campaign_name   text not null,
  fire_month      int not null check (fire_month between 1 and 12),
  fire_day        int not null check (fire_day between 1 and 31),
  channel         text not null check (channel in ('whatsapp', 'sms', 'email')),
  enabled         boolean not null default true,
  last_fired_year int,
  created_at      timestamptz not null default now()
);

-- 6. scheduled_outbounds — HIDDEN, all enabled=false
create table if not exists scheduled_outbounds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete cascade,
  service_key    text not null,
  scheduled_for  timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending','calling','completed','failed','cancelled')),
  enabled        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- 7. Add opt-in columns to contacts (idempotent)
alter table contacts add column if not exists wa_opted_in  boolean not null default false;
alter table contacts add column if not exists sms_opted_in boolean not null default false;

-- 8. RPC: atomic claim of pending reminders (prevents duplicate sends on restart)
create or replace function claim_pending_reminders(
  p_window_end timestamptz,
  p_limit      int default 50
)
returns setof scheduled_reminders
language plpgsql
security definer
as $$
begin
  return query
  update scheduled_reminders
  set status = 'sending', updated_at = now()
  where id in (
    select id from scheduled_reminders
    where status = 'pending'
      and scheduled_for <= p_window_end
    order by scheduled_for asc
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

-- 9. RPC: upsert/increment failed attempts
create or replace function increment_failed_attempts(
  p_contact_id uuid,
  p_org_id     uuid
)
returns void
language plpgsql
security definer
as $$
begin
  insert into contact_memory (org_id, contact_id, failed_attempts, last_failed_at, updated_at)
  values (p_org_id, p_contact_id, 1, now(), now())
  on conflict (org_id, contact_id) do update
    set failed_attempts = contact_memory.failed_attempts + 1,
        last_failed_at  = now(),
        updated_at      = now();
end;
$$;

-- 10. Recover stalled 'sending' reminders older than 10 min (run on startup or cron)
create or replace function recover_stalled_reminders()
returns int
language plpgsql
security definer
as $$
declare v_count int;
begin
  update scheduled_reminders
  set status = 'pending', updated_at = now()
  where status = 'sending'
    and updated_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Open Supabase Dashboard → SQL Editor → New query → paste the file contents → Run.

Expected: All statements succeed. Check the Tables list for: `contact_memory`, `call_summaries`, `scheduled_reminders`, `org_reminder_config`, `org_campaigns`, `scheduled_outbounds`.

Verify `contacts` table now has `wa_opted_in` and `sms_opted_in` columns.

- [ ] **Step 3: Commit the migration file**

```bash
git add db/schema-migration-lifecycle.sql
git commit -m "db: add lifecycle reminders migration (6 tables + 3 RPCs)"
```

---

### Task 2: Contact Memory Module

**Files:**
- Create: `src/lifecycle/call-memory.js`

- [ ] **Step 1: Create the module**

Create `src/lifecycle/call-memory.js`:

```javascript
// ============================================================
// NodeFlow — Contact Memory (Lifecycle System)
// Persistent per-contact call history and preferences.
// ============================================================

const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('CALL-MEMORY');

/**
 * Get a contact's memory record.
 * Returns null if not found (cold start — first call).
 */
async function getContactMemory(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return null;

  const { data, error } = await db.client
    .from('contact_memory')
    .select('*')
    .eq('contact_id', contactId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) { log.warn('getContactMemory failed', { err: error.message }); return null; }
  return data;
}

/**
 * Upsert contact memory. Merges preferences/sensitivities with existing values.
 * do_not_contact flags are one-way: only set to true, never auto-cleared.
 *
 * @param {string} contactId
 * @param {string} orgId
 * @param {object} updates
 *   - incrementCallCount {boolean}
 *   - last_call_at {string} ISO timestamp
 *   - last_call_summary {string}
 *   - preferences {object} — merged into existing
 *   - sensitivities {object} — merged into existing
 *   - no_whatsapp {boolean} — only applied if true
 *   - no_email {boolean}
 *   - no_sms {boolean}
 */
async function upsertContactMemory(contactId, orgId, updates) {
  const db = getDatabase();
  if (!db.enabled) return;

  const existing = await getContactMemory(contactId, orgId);

  const row = {
    org_id:            orgId,
    contact_id:        contactId,
    call_count:        (existing?.call_count || 0) + (updates.incrementCallCount ? 1 : 0),
    last_call_at:      updates.last_call_at      ?? existing?.last_call_at      ?? null,
    last_call_summary: updates.last_call_summary ?? existing?.last_call_summary ?? null,
    // Merge: new values overwrite existing keys, existing keys not in updates are kept
    preferences:   { ...(existing?.preferences   || {}), ...(updates.preferences   || {}) },
    sensitivities: { ...(existing?.sensitivities  || {}), ...(updates.sensitivities  || {}) },
    // Keep existing flags, only ever set to true
    no_whatsapp: existing?.no_whatsapp || updates.no_whatsapp === true,
    no_email:    existing?.no_email    || updates.no_email    === true,
    no_sms:      existing?.no_sms      || updates.no_sms      === true,
    // Keep existing failed_attempts (managed separately via RPC)
    failed_attempts: existing?.failed_attempts || 0,
    last_failed_at:  existing?.last_failed_at  || null,
    updated_at:      new Date().toISOString(),
  };

  const { error } = await db.client
    .from('contact_memory')
    .upsert(row, { onConflict: 'org_id,contact_id' });

  if (error) log.error('upsertContactMemory failed', { err: error.message, contactId });
}

/**
 * Increment failed_attempts counter for a contact.
 * Uses a DB-side RPC to avoid race conditions.
 */
async function incrementFailedAttempts(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return;
  const { error } = await db.client.rpc('increment_failed_attempts', {
    p_contact_id: contactId,
    p_org_id:     orgId,
  });
  if (error) log.warn('incrementFailedAttempts failed', { err: error.message });
}

/**
 * Check if a contact has too many failed attempts (cooling-off period).
 * Returns true if we should skip this contact for now.
 */
function isCoolingOff(memory) {
  if (!memory) return false;
  if (memory.failed_attempts < 3) return false;
  if (!memory.last_failed_at) return false;
  const daysSince = (Date.now() - new Date(memory.last_failed_at).getTime()) / 86400000;
  return daysSince < 30;
}

/**
 * Build call context for the prompt generator.
 * Returns { isFirstCall, callCount, lastCallSummary, preferences,
 *           sensitivities, recentCalls, sectorData }
 */
async function buildCallContext(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return { isFirstCall: true, sectorData: {} };

  const [memRes, callsRes, contactRes] = await Promise.all([
    db.client.from('contact_memory').select('*')
      .eq('contact_id', contactId).eq('org_id', orgId).maybeSingle(),
    db.client.from('call_summaries')
      .select('summary, outcome, topics, created_at')
      .eq('contact_id', contactId).eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(5),
    db.client.from('contacts').select('name, phone, sector_data')
      .eq('id', contactId).maybeSingle(),
  ]);

  const memory     = memRes.data;
  const recentCalls = callsRes.data || [];
  const sectorData  = contactRes.data?.sector_data || {};

  if (!memory || memory.call_count === 0) {
    return { isFirstCall: true, sectorData };
  }

  return {
    isFirstCall:       false,
    callCount:         memory.call_count,
    lastCallAt:        memory.last_call_at,
    lastCallSummary:   memory.last_call_summary,
    preferences:       memory.preferences    || {},
    sensitivities:     memory.sensitivities  || {},
    recentCalls,
    sectorData,
  };
}

module.exports = {
  getContactMemory,
  upsertContactMemory,
  incrementFailedAttempts,
  isCoolingOff,
  buildCallContext,
};
```

- [ ] **Step 2: Write a quick smoke test**

Create `scripts/test-call-memory.js`:

```javascript
// Quick smoke test — requires DB connection
// Run: node scripts/test-call-memory.js
require('dotenv').config();
const { buildCallContext } = require('../src/lifecycle/call-memory');

async function main() {
  // Should return isFirstCall: true for a non-existent contact
  const ctx = await buildCallContext('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000');
  console.assert(ctx.isFirstCall === true, 'Expected isFirstCall: true for unknown contact');
  console.assert(typeof ctx.sectorData === 'object', 'Expected sectorData object');
  console.log('✅ buildCallContext cold start: OK');
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 3: Run the smoke test**

```bash
node scripts/test-call-memory.js
```

Expected: `✅ buildCallContext cold start: OK`

- [ ] **Step 4: Commit**

```bash
git add src/lifecycle/call-memory.js scripts/test-call-memory.js
git commit -m "feat(lifecycle): add call-memory module (contact memory CRUD + buildCallContext)"
```

---

### Task 3: Transcript Analyzer

**Files:**
- Create: `src/lifecycle/transcript-analyzer.js`

- [ ] **Step 1: Create the module**

Create `src/lifecycle/transcript-analyzer.js`:

```javascript
// ============================================================
// NodeFlow — Transcript Analyzer (Lifecycle System)
// Async post-call analysis: GPT summary → contact_memory update.
// Always fire-and-forget. Retries up to 3 times. Never silent fail.
// ============================================================

const { getDatabase }        = require('../db/database');
const { upsertContactMemory } = require('./call-memory');
const { Logger }              = require('../utils/logger');

const log = new Logger('TRANSCRIPT-ANALYZER');
const MAX_RETRIES = 3;

const SYSTEM_PROMPT = `Eres un asistente que analiza transcripciones de llamadas telefónicas de negocios españoles.
Analiza la transcripción y devuelve ÚNICAMENTE un objeto JSON válido con estos campos:
{
  "summary": "Resumen de 2-3 frases de lo ocurrido",
  "outcome": "<ver valores válidos>",
  "preferences": { "horario": "mañana|tarde|null", "idioma": "es|eu|gl|null", "tono": "formal|informal|null" },
  "sensitivities": {},
  "extracted_data": {},
  "topics": []
}

Valores válidos para outcome: booked | rescheduled | declined | no_answer | callback_requested | wrong_number | do_not_contact | voicemail_left

En extracted_data incluye cualquier dato relevante mencionado:
- fecha_itv, fecha_ultimo_aceite, matricula, marca_modelo (taller)
- nombre_mascota, fecha_proxima_vacuna, especie_raza (veterinaria)  
- fecha_cumpleanos, fecha_aniversario (cualquier sector)
- frecuencia_sesiones en días (psicología, nutrición)

En topics incluye tags como: vacuna, itv, cambio_aceite, presupuesto, horario, cancelación, etc.
Devuelve SOLO el JSON. Sin texto adicional.`;

/**
 * Analyze a call transcript via GPT-4o-mini.
 * Returns parsed analysis object, or null after MAX_RETRIES failures.
 * @param {Array|string} transcript
 * @param {number} attempt
 */
async function analyzeTranscript(transcript, attempt = 1) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('OPENAI_API_KEY not set — skipping transcript analysis');
    return null;
  }

  const text = Array.isArray(transcript)
    ? transcript.map(t => `${t.role === 'assistant' ? 'Asistente' : 'Cliente'}: ${t.content}`).join('\n')
    : String(transcript || '');

  if (!text.trim()) {
    log.warn('analyzeTranscript: empty transcript — skipping');
    return null;
  }

  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey });

    const resp = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      messages:    [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Transcripción:\n${text}` },
      ],
      temperature:  0,
      max_tokens:   600,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(resp.choices[0].message.content);
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      log.warn(`analyzeTranscript attempt ${attempt} failed: ${err.message} — retrying in ${attempt}s`);
      await new Promise(r => setTimeout(r, 1000 * attempt));
      return analyzeTranscript(transcript, attempt + 1);
    }
    // All retries exhausted — log with full context, never silent
    log.error(`analyzeTranscript failed after ${MAX_RETRIES} attempts: ${err.message}`);
    return null;
  }
}

/**
 * Full async post-call processing pipeline:
 * 1. Analyze transcript
 * 2. Insert call_summaries (immutable)
 * 3. Upsert contact_memory (merged)
 * 4. Update sector_data with any extracted dates/fields
 *
 * Call fire-and-forget: processCallAsync({...}).catch(() => {})
 */
async function processCallAsync({ callSessionId, contactId, orgId, transcript }) {
  if (!contactId || !orgId) {
    log.warn('processCallAsync: missing contactId or orgId — skipping');
    return;
  }

  const analysis = await analyzeTranscript(transcript);
  if (!analysis) {
    // Already logged with context in analyzeTranscript
    log.error(`processCallAsync: analysis null for session ${callSessionId} contact ${contactId}`);
    return;
  }

  const db = getDatabase();
  if (!db.enabled) return;

  // 1. Insert immutable call summary
  const { error: summaryErr } = await db.client.from('call_summaries').insert({
    call_session_id: callSessionId || null,
    org_id:          orgId,
    contact_id:      contactId,
    summary:         analysis.summary    || '',
    outcome:         analysis.outcome    || null,
    extracted_data:  analysis.extracted_data || {},
    topics:          analysis.topics     || [],
  });
  if (summaryErr) log.error('call_summaries insert failed', { err: summaryErr.message });

  // 2. Upsert contact memory
  const memUpdates = {
    incrementCallCount: true,
    last_call_at:       new Date().toISOString(),
    last_call_summary:  analysis.summary || '',
    preferences:        analysis.preferences  || {},
    sensitivities:      analysis.sensitivities || {},
  };
  if (analysis.outcome === 'do_not_contact') {
    memUpdates.no_whatsapp = true;
    memUpdates.no_email    = true;
    memUpdates.no_sms      = true;
  }
  await upsertContactMemory(contactId, orgId, memUpdates);

  // 3. If extracted_data has usable fields, merge into contacts.sector_data
  const extracted = analysis.extracted_data || {};
  if (Object.keys(extracted).length > 0) {
    const { data: contact } = await db.client
      .from('contacts').select('sector_data').eq('id', contactId).maybeSingle();
    const merged = { ...(contact?.sector_data || {}), ...extracted };
    await db.client.from('contacts')
      .update({ sector_data: merged })
      .eq('id', contactId)
      .catch(e => log.warn('sector_data auto-update failed', { err: e.message }));
  }

  log.info(`processCallAsync done: contact ${contactId}, outcome: ${analysis.outcome}, topics: ${(analysis.topics || []).join(',')}`);
}

module.exports = { analyzeTranscript, processCallAsync };
```

- [ ] **Step 2: Write unit test for analyzeTranscript**

Create `scripts/test-transcript-analyzer.js`:

```javascript
require('dotenv').config();
const { analyzeTranscript } = require('../src/lifecycle/transcript-analyzer');

const SAMPLE_TRANSCRIPT = [
  { role: 'assistant', content: 'Hola, soy el asistente de la Clínica Dental Arrate. ¿En qué le puedo ayudar?' },
  { role: 'user',      content: 'Quería pedir una cita para una revisión' },
  { role: 'assistant', content: '¿Para qué día le viene bien? Tenemos el martes a las 10 disponible' },
  { role: 'user',      content: 'Perfecto, el martes a las 10. Me llamo María García, mi teléfono es el 612345678' },
  { role: 'assistant', content: 'Cita confirmada para María García el martes a las 10. ¡Hasta pronto!' },
];

async function main() {
  console.log('Testing analyzeTranscript...');
  const result = await analyzeTranscript(SAMPLE_TRANSCRIPT);
  if (!result) { console.error('❌ result is null'); process.exit(1); }
  console.assert(result.outcome === 'booked', `Expected outcome 'booked', got '${result.outcome}'`);
  console.assert(typeof result.summary === 'string' && result.summary.length > 10, 'Expected non-empty summary');
  console.assert(Array.isArray(result.topics), 'Expected topics array');
  console.log('✅ analyzeTranscript:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 3: Run the test**

```bash
node scripts/test-transcript-analyzer.js
```

Expected: `✅ analyzeTranscript:` with JSON showing `outcome: "booked"` and a non-empty summary.

- [ ] **Step 4: Commit**

```bash
git add src/lifecycle/transcript-analyzer.js scripts/test-transcript-analyzer.js
git commit -m "feat(lifecycle): add transcript-analyzer (GPT post-call analysis with retry)"
```

---

### Task 4: Wire Transcript Analyzer into Post-Call Handler

**Files:**
- Modify: `src/automations/post-call-handler.js`

- [ ] **Step 1: Add the import at the top of the file**

In `src/automations/post-call-handler.js`, after the existing imports (after line ~16), add:

```javascript
const { processCallAsync } = require('../lifecycle/transcript-analyzer');
```

- [ ] **Step 2: Add the new step 9 after the contact upsert (step 8)**

After the existing `// ── 8. Upsert contact` block (around line 115-127), add this new block:

```javascript
  // ── 9. Async transcript analysis → call memory ──────────────────────────────
  if (db.enabled && callData.callerNumber && callData.transcript?.length > 0) {
    // Resolve contactId from the just-upserted contact
    db.client.from('contacts')
      .select('id')
      .eq('org_id', businessId)
      .eq('phone', callData.callerNumber)
      .maybeSingle()
      .then(({ data: contact }) => {
        if (contact?.id) {
          processCallAsync({
            callSessionId: callData.id         || null,
            contactId:     contact.id,
            orgId:         businessId,
            transcript:    callData.transcript || [],
          }).catch(e => log.warn('transcript async processing failed', { err: e.message }));
        }
      })
      .catch(() => {});
  }
```

- [ ] **Step 3: Verify the file still parses**

```bash
node -e "require('./src/automations/post-call-handler')" && echo "✅ Module loads OK"
```

Expected: `✅ Module loads OK`

- [ ] **Step 4: Commit**

```bash
git add src/automations/post-call-handler.js
git commit -m "feat(lifecycle): wire transcript-analyzer into post-call-handler (step 9)"
```

---

### Task 5: Enrich Prompts with Call Memory

**Files:**
- Modify: `src/assistants/prompt-generator.js`

- [ ] **Step 1: Add import at the top of prompt-generator.js**

At the top of `src/assistants/prompt-generator.js`, after existing requires, add:

```javascript
const { buildCallContext } = require('../lifecycle/call-memory');
```

- [ ] **Step 2: Add the context-building helper function**

Find the end of the file (before `module.exports`) and add this function:

```javascript
/**
 * Build a memory context block to append to any assistant prompt.
 * Returns empty string for first-time callers (no history yet).
 * @param {string} contactId
 * @param {string} orgId
 * @returns {Promise<string>}
 */
async function buildMemoryBlock(contactId, orgId) {
  if (!contactId || !orgId) return '';
  let ctx;
  try { ctx = await buildCallContext(contactId, orgId); }
  catch (e) { return ''; } // Never break the call flow

  if (!ctx || ctx.isFirstCall) return '';

  const lines = [
    '\n\n## Historial del cliente (usa esto para personalizar la conversación)',
    `- Número de llamadas anteriores: ${ctx.callCount}`,
  ];

  if (ctx.lastCallAt) {
    lines.push(`- Última llamada: ${new Date(ctx.lastCallAt).toLocaleDateString('es-ES')}`);
  }
  if (ctx.lastCallSummary) {
    lines.push(`- Resumen última llamada: ${ctx.lastCallSummary}`);
  }
  if (ctx.preferences?.horario) {
    lines.push(`- Prefiere horario: ${ctx.preferences.horario}`);
  }
  if (ctx.preferences?.idioma) {
    lines.push(`- Idioma preferido: ${ctx.preferences.idioma}`);
  }
  if (ctx.recentCalls?.length > 1) {
    const prev = ctx.recentCalls.slice(1).map(c =>
      `  * ${new Date(c.created_at).toLocaleDateString('es-ES')}: ${c.summary}`
    ).join('\n');
    lines.push(`- Llamadas previas:\n${prev}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 3: Export the new function**

Find the `module.exports` line at the bottom of `src/assistants/prompt-generator.js` and add `buildMemoryBlock` to the exports:

```javascript
module.exports = {
  // ... existing exports ...
  buildMemoryBlock,
};
```

- [ ] **Step 4: Verify module still loads**

```bash
node -e "const pg = require('./src/assistants/prompt-generator'); console.log(typeof pg.buildMemoryBlock === 'function' ? '✅ buildMemoryBlock exported' : '❌ not exported')"
```

Expected: `✅ buildMemoryBlock exported`

- [ ] **Step 5: Commit**

```bash
git add src/assistants/prompt-generator.js
git commit -m "feat(lifecycle): add buildMemoryBlock to prompt-generator for call personalization"
```

---

## Phase 2: Lifecycle Engine

### Task 6: Reminder Engine

**Files:**
- Create: `src/lifecycle/reminder-engine.js`

- [ ] **Step 1: Create the module**

Create `src/lifecycle/reminder-engine.js`:

```javascript
// ============================================================
// NodeFlow — Reminder Engine (Lifecycle System)
// Knows WHEN to remind each client based on sector + trigger type.
// Creates/cancels entries in scheduled_reminders.
// ============================================================

const { getDatabase }    = require('../db/database');
const { getContactMemory, isCoolingOff } = require('./call-memory');
const { Logger }          = require('../utils/logger');

const log = new Logger('REMINDER-ENGINE');

// ── Sector defaults ──────────────────────────────────────────────────────────
// Trigger types:
//   from_last_appointment  → date of last appointment + N days
//   before_sector_field    → sector_data[field] - N days
//   from_sector_field      → sector_data[field] + N days (with optional days_offset)
//   from_last_if_no_new    → from_last_appointment only if no newer appointment booked
//   custom_frequency       → sector_data[frequency_field] days after last appointment
//   only_if_completed      → flag: only schedule if appointment.status === 'completed'
//   seasonal               → goes to org_campaigns, not individual reminders
const SECTOR_DEFAULTS = {
  peluqueria: {
    corte_pelo:    { days: 24,  trigger: 'from_last_appointment', serviceFilter: ['corte','pelo','cabello'] },
    color_tinte:   { days: 35,  trigger: 'from_last_appointment', serviceFilter: ['color','tinte'] },
    tratamiento:   { days: 28,  trigger: 'from_last_appointment', serviceFilter: ['tratamiento'] },
    permanente:    { days: 70,  trigger: 'from_last_appointment', serviceFilter: ['permanente'] },
  },
  taller: {
    cambio_aceite: { days: 335, trigger: 'from_sector_field',  field: 'fecha_ultimo_aceite' },
    itv:           { days: 60,  trigger: 'before_sector_field', field: 'fecha_vencimiento_itv' },
    revision:      { days: 335, trigger: 'from_last_appointment' },
    // ruedas_verano / ruedas_invierno → org_campaigns (seasonal)
  },
  dental: {
    revision_anual:   { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','revision','check'] },
    limpieza:         { days: 165, trigger: 'from_last_appointment', serviceFilter: ['limpieza'] },
    ortodoncia:       { days: 25,  trigger: 'from_last_appointment', serviceFilter: ['ortodoncia'], onlyIfCompleted: true },
    post_tratamiento: { days: 12,  trigger: 'from_last_appointment', serviceFilter: ['extracción','implante','endodoncia'], onlyIfCompleted: true },
  },
  estetica: {
    facial:               { days: 28, trigger: 'from_last_appointment', serviceFilter: ['facial'] },
    depilacion_laser:     { days: 35, trigger: 'from_last_appointment', serviceFilter: ['láser','laser'] },
    depilacion_cera:      { days: 28, trigger: 'from_last_appointment', serviceFilter: ['cera'] },
    tratamiento_corporal: { days: 21, trigger: 'from_last_appointment', serviceFilter: ['corporal'] },
  },
  veterinaria: {
    vacuna_anual:    { days: 14,  trigger: 'before_sector_field',  field: 'fecha_proxima_vacuna' },
    desparasitacion: { days: 70,  trigger: 'from_last_appointment', serviceFilter: ['desparasitación','desparasitacion'] },
    revision_anual:  { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','revision','chequeo'] },
    post_cirugia:    { days: 10,  trigger: 'from_last_appointment', serviceFilter: ['cirugía','cirugia','operación'], onlyIfCompleted: true },
  },
  gimnasio: {
    renovacion_cuota: { days: 5, trigger: 'before_sector_field', field: 'fecha_vencimiento_cuota' },
  },
  fisioterapia: {
    seguimiento_post: { days: 14,  trigger: 'from_last_appointment', onlyIfCompleted: true },
    mantenimiento:    { days: 90,  trigger: 'from_sector_field',  field: 'fecha_alta' },
  },
  psicologia: {
    sesion_habitual: { trigger: 'custom_frequency', frequencyField: 'frecuencia_sesiones', onlyIfCompleted: true },
  },
  nutricion: {
    revision_mensual: { days: 28, trigger: 'from_last_appointment' },
    reactivacion:     { days: 42, trigger: 'from_last_if_no_new' },
  },
  optica: {
    revision_vista:       { days: 330, trigger: 'from_last_appointment', serviceFilter: ['revisión','graduación'] },
    reposicion_lentillas: { trigger: 'from_sector_field', field: 'suministro_lentillas_dias', daysOffset: -5 },
  },
  hotel: {
    aniversario:  { days: 21,  trigger: 'before_sector_field', field: 'fecha_aniversario' },
    cumpleanos:   { days: 21,  trigger: 'before_sector_field', field: 'fecha_cumpleanos' },
    recuperacion: { days: 270, trigger: 'from_last_if_no_new' },
  },
  academia: {
    renovacion_matricula: { days: 21, trigger: 'before_sector_field', field: 'fecha_fin_curso' },
    // matricula_nueva → org_campaigns (seasonal)
  },
};

/**
 * Get the effective reminder config for an org.
 * Merges org overrides on top of sector defaults.
 * @returns {object} { serviceKey: { days, channel, enabled } }
 */
async function getOrgReminderConfig(orgId, sectorSlug) {
  const db = getDatabase();
  const sectorDefaults = SECTOR_DEFAULTS[sectorSlug] || {};

  if (!db.enabled) return sectorDefaults;

  const { data } = await db.client
    .from('org_reminder_config')
    .select('config')
    .eq('org_id', orgId)
    .maybeSingle();

  const orgConfig = data?.config || {};

  // Merge: org config overrides sector defaults per service key
  const result = {};
  for (const [key, def] of Object.entries(sectorDefaults)) {
    result[key] = {
      ...def,
      channel: 'whatsapp', // default channel (will be overridden if set)
      enabled: true,
      ...(orgConfig[key] || {}),
    };
  }
  return result;
}

/**
 * Calculate scheduledFor date from a trigger definition and data.
 * Returns a Date or null if trigger cannot be resolved.
 */
function calculateScheduledFor(def, sectorData, lastAppointmentDate) {
  const now = new Date();

  if (def.trigger === 'from_last_appointment' || def.trigger === 'from_last_if_no_new') {
    if (!lastAppointmentDate) return null;
    const d = new Date(lastAppointmentDate);
    d.setDate(d.getDate() + (def.days || 30));
    return d > now ? d : null; // Don't schedule in the past
  }

  if (def.trigger === 'before_sector_field') {
    const fieldValue = sectorData?.[def.field];
    if (!fieldValue) return null;
    const target = new Date(fieldValue);
    if (isNaN(target.getTime())) return null;
    target.setDate(target.getDate() - (def.days || 30));
    return target > now ? target : null;
  }

  if (def.trigger === 'from_sector_field') {
    const fieldValue = sectorData?.[def.field];
    if (!fieldValue) return null;
    // For numeric fields like suministro_lentillas_dias, calculate from today
    if (typeof fieldValue === 'number') {
      const d = new Date();
      d.setDate(d.getDate() + fieldValue + (def.daysOffset || 0));
      return d > now ? d : null;
    }
    // For date fields
    const base = new Date(fieldValue);
    if (isNaN(base.getTime())) return null;
    base.setDate(base.getDate() + (def.days || 335) + (def.daysOffset || 0));
    return base > now ? base : null;
  }

  if (def.trigger === 'custom_frequency') {
    if (!lastAppointmentDate || !sectorData?.[def.frequencyField]) return null;
    const freq = parseInt(sectorData[def.frequencyField], 10);
    if (isNaN(freq) || freq <= 0) return null;
    const d = new Date(lastAppointmentDate);
    d.setDate(d.getDate() + freq);
    return d > now ? d : null;
  }

  return null;
}

/**
 * Schedule (or update) a reminder for a contact.
 * Idempotent: if a pending reminder already exists for (contact, service), updates it.
 */
async function scheduleReminder({ orgId, contactId, serviceKey, scheduledFor, channel = 'whatsapp', messagePreview = null }) {
  const db = getDatabase();
  if (!db.enabled) return;

  // Check do_not_contact
  const memory = await getContactMemory(contactId, orgId);
  if (memory) {
    const blocked = (channel === 'whatsapp' && memory.no_whatsapp)
                 || (channel === 'sms'      && memory.no_sms)
                 || (channel === 'email'    && memory.no_email);
    if (blocked) {
      log.info(`scheduleReminder: contact ${contactId} blocked on ${channel} — skipping`);
      return;
    }
    if (isCoolingOff(memory)) {
      log.info(`scheduleReminder: contact ${contactId} in cooling-off period — skipping`);
      return;
    }
  }

  // Upsert: cancel existing pending for same (contact, service), create new
  // Step 1: cancel existing pending
  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('service_key', serviceKey)
    .eq('status', 'pending')
    .catch(e => log.warn('scheduleReminder: cancel existing failed', { err: e.message }));

  // Step 2: insert new
  const { error } = await db.client.from('scheduled_reminders').insert({
    org_id:          orgId,
    contact_id:      contactId,
    service_key:     serviceKey,
    channel,
    scheduled_for:   scheduledFor.toISOString(),
    status:          'pending',
    message_preview: messagePreview,
  });

  if (error) {
    log.error('scheduleReminder: insert failed', { err: error.message, orgId, contactId, serviceKey });
  } else {
    log.info(`Reminder scheduled: ${serviceKey} for contact ${contactId} on ${scheduledFor.toLocaleDateString('es-ES')} via ${channel}`);
  }
}

/**
 * Cancel all pending reminders for a contact + service.
 * Call when a new appointment is booked (prevents stale reminders).
 */
async function cancelRemindersForService(contactId, serviceKey) {
  const db = getDatabase();
  if (!db.enabled) return;
  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', failed_reason: 'appointment_booked', updated_at: new Date().toISOString() })
    .eq('contact_id', contactId)
    .eq('service_key', serviceKey)
    .in('status', ['pending', 'postponed'])
    .catch(e => log.warn('cancelRemindersForService failed', { err: e.message }));
}

/**
 * Recalculate reminders for a contact after sector_data changes.
 * Gets the org's sector, fetches last appointment, creates new reminders.
 */
async function recalculate(contactId, orgId) {
  const db = getDatabase();
  if (!db.enabled) return;

  // Get contact info
  const { data: contact } = await db.client.from('contacts')
    .select('sector_data, org_id')
    .eq('id', contactId).maybeSingle();
  if (!contact) return;

  // Get org sector
  const { data: org } = await db.client.from('organizations')
    .select('sector').eq('id', orgId).maybeSingle();
  const sectorSlug = org?.sector;
  if (!sectorSlug) return;

  // Get last appointment
  const { data: lastApt } = await db.client.from('appointments')
    .select('date, service, status')
    .eq('org_id', orgId).eq('contact_id', contactId)
    .order('date', { ascending: false }).limit(1).maybeSingle();

  const config = await getOrgReminderConfig(orgId, sectorSlug);

  for (const [serviceKey, def] of Object.entries(config)) {
    if (!def.enabled) continue;
    if (def.trigger === 'seasonal') continue; // handled by campaigns

    const scheduledFor = calculateScheduledFor(def, contact.sector_data, lastApt?.date);
    if (!scheduledFor) continue;

    await scheduleReminder({
      orgId, contactId, serviceKey,
      scheduledFor,
      channel: def.channel || 'whatsapp',
    });
  }
}

module.exports = {
  SECTOR_DEFAULTS,
  getOrgReminderConfig,
  calculateScheduledFor,
  scheduleReminder,
  cancelRemindersForService,
  recalculate,
};
```

- [ ] **Step 2: Test the calculateScheduledFor function**

Create `scripts/test-reminder-engine.js`:

```javascript
const { calculateScheduledFor } = require('../src/lifecycle/reminder-engine');

// Test from_last_appointment
const def1 = { trigger: 'from_last_appointment', days: 24 };
const lastApt = new Date(Date.now() - 10 * 86400000).toISOString(); // 10 days ago
const result1 = calculateScheduledFor(def1, {}, lastApt);
const expectedDaysFromNow = Math.round((result1 - Date.now()) / 86400000);
console.assert(expectedDaysFromNow >= 13 && expectedDaysFromNow <= 15, `Expected ~14 days, got ${expectedDaysFromNow}`);
console.log(`✅ from_last_appointment: fires in ~${expectedDaysFromNow} days`);

// Test before_sector_field with future date
const def2 = { trigger: 'before_sector_field', field: 'fecha_vencimiento_itv', days: 60 };
const futureDate = new Date(Date.now() + 100 * 86400000).toISOString().split('T')[0]; // 100 days from now
const result2 = calculateScheduledFor(def2, { fecha_vencimiento_itv: futureDate }, null);
const daysUntil = Math.round((result2 - Date.now()) / 86400000);
console.assert(daysUntil >= 38 && daysUntil <= 42, `Expected ~40 days, got ${daysUntil}`);
console.log(`✅ before_sector_field (ITV): fires in ~${daysUntil} days`);

// Test null returns for missing data
const result3 = calculateScheduledFor(def2, {}, null);
console.assert(result3 === null, 'Expected null when sector field missing');
console.log('✅ Missing field returns null correctly');

process.exit(0);
```

- [ ] **Step 3: Run the test**

```bash
node scripts/test-reminder-engine.js
```

Expected: Three `✅` lines.

- [ ] **Step 4: Commit**

```bash
git add src/lifecycle/reminder-engine.js scripts/test-reminder-engine.js
git commit -m "feat(lifecycle): add reminder-engine (sector defaults + schedule/cancel logic)"
```

---

### Task 7: Notification Channels

**Files:**
- Create: `src/notifications/client-whatsapp.js`
- Create: `src/notifications/sms.js`

- [ ] **Step 1: Create client-whatsapp.js (Meta Cloud API)**

Create `src/notifications/client-whatsapp.js`:

```javascript
// ============================================================
// NodeFlow — WhatsApp to Clients (Meta Cloud API)
// Different from whatsapp.js (Callmebot) which only alerts owner.
// Env vars: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN
// Setup: Meta Business Manager → WhatsApp Product → Phone Number
// ============================================================

const https  = require('https');
const { Logger } = require('../utils/logger');

const log = new Logger('CLIENT-WA');

const META_API_VERSION = 'v19.0';
const META_API_BASE    = 'graph.facebook.com';

function isConfigured() {
  return !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);
}

/**
 * Send a WhatsApp template message to a client.
 * Templates must be pre-approved by Meta (category: UTILITY).
 *
 * @param {string} phone  - International format without +: "34612345678"
 * @param {string} templateName - Approved template name
 * @param {string} languageCode - "es" | "eu" | "gl"
 * @param {Array}  components   - Template variable components
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
function sendTemplate(phone, templateName, languageCode, components = []) {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      log.warn('WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN not set — WA skipped');
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const accessToken   = process.env.WA_ACCESS_TOKEN;

    // Normalize phone: strip spaces, dashes, +
    const normalizedPhone = String(phone).replace(/[\s\-+]/g, '');

    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to:                normalizedPhone,
      type:              'template',
      template: {
        name:     templateName,
        language: { code: languageCode || 'es' },
        components,
      },
    });

    const options = {
      hostname: META_API_BASE,
      path:     `/${META_API_VERSION}/${phoneNumberId}/messages`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200 && json.messages?.[0]?.id) {
            log.info(`WA sent to ${normalizedPhone} (template: ${templateName})`);
            resolve({ ok: true, messageId: json.messages[0].id });
          } else {
            const errMsg = json.error?.message || `HTTP ${res.statusCode}`;
            log.warn(`WA failed to ${normalizedPhone}: ${errMsg}`);
            resolve({ ok: false, error: errMsg });
          }
        } catch (e) {
          log.warn(`WA parse error: ${e.message}`);
          resolve({ ok: false, error: e.message });
        }
      });
    });

    req.on('error', (e) => {
      log.warn(`WA request error: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send a free-text WhatsApp message.
 * Only works within 24h of the last client-initiated message.
 * For lifecycle reminders (business-initiated) use sendTemplate instead.
 */
function sendText(phone, text) {
  return new Promise((resolve) => {
    if (!isConfigured()) {
      return resolve({ ok: false, reason: 'not_configured' });
    }

    const normalizedPhone = String(phone).replace(/[\s\-+]/g, '');
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to:   normalizedPhone,
      type: 'text',
      text: { body: text },
    });

    const options = {
      hostname: META_API_BASE,
      path:     `/${META_API_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      method:   'POST',
      headers:  {
        'Authorization':  `Bearer ${process.env.WA_ACCESS_TOKEN}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode === 200) {
            resolve({ ok: true, messageId: json.messages?.[0]?.id });
          } else {
            resolve({ ok: false, error: json.error?.message || `HTTP ${res.statusCode}` });
          }
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTemplate, sendText, isConfigured };
```

- [ ] **Step 2: Create sms.js (Twilio)**

Create `src/notifications/sms.js`:

```javascript
// ============================================================
// NodeFlow — SMS to Clients (Twilio)
// Fallback when WhatsApp is not available.
// Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// Note: SMS is independent of voice calls — works even if Vonage handles voice.
// ============================================================

const { Logger } = require('../utils/logger');

const log = new Logger('SMS');

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN  &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

/**
 * Send an SMS to a client via Twilio.
 * @param {string} phone - Client phone, any format (will normalize to E.164)
 * @param {string} text  - Message body (max 160 chars for single SMS)
 * @returns {Promise<{ok: boolean, sid?: string, error?: string}>}
 */
async function sendSMS(phone, text) {
  if (!isConfigured()) {
    log.warn('Twilio SMS not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER) — SMS skipped');
    return { ok: false, reason: 'not_configured' };
  }

  // Normalize to E.164: ensure starts with +34 for Spain if no country code
  let normalized = String(phone).replace(/[\s\-().]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = '+34' + normalized.replace(/^34/, '');
  }

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const message = await client.messages.create({
      body: text,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   normalized,
    });

    log.info(`SMS sent to ${normalized} (sid: ${message.sid})`);
    return { ok: true, sid: message.sid };
  } catch (err) {
    log.warn(`SMS failed to ${normalized}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSMS, isConfigured };
```

- [ ] **Step 3: Verify both modules load**

```bash
node -e "
const wa = require('./src/notifications/client-whatsapp');
const sms = require('./src/notifications/sms');
console.log('WA configured:', wa.isConfigured());
console.log('SMS configured:', sms.isConfigured());
console.log('✅ Both modules load OK');
"
```

Expected: `✅ Both modules load OK` (configured status depends on .env)

- [ ] **Step 4: Commit**

```bash
git add src/notifications/client-whatsapp.js src/notifications/sms.js
git commit -m "feat(lifecycle): add client-whatsapp (Meta Cloud API) and sms (Twilio) notification modules"
```

---

### Task 8: Lifecycle Scheduler

**Files:**
- Create: `src/lifecycle/scheduler.js`

- [ ] **Step 1: Create the scheduler**

Create `src/lifecycle/scheduler.js`:

```javascript
// ============================================================
// NodeFlow — Lifecycle Scheduler (System D)
// Cron: every 30 min → claim pending reminders → dispatch
// Channel priority: WhatsApp → SMS → Email
// ============================================================

const { getDatabase }           = require('../db/database');
const { getContactMemory, incrementFailedAttempts } = require('./call-memory');
const { sendTemplate, sendText, isConfigured: waConfigured } = require('../notifications/client-whatsapp');
const { sendSMS, isConfigured: smsConfigured } = require('../notifications/sms');
const { sendEmail }             = require('../notifications/email');
const { Logger }                = require('../utils/logger');

const log = new Logger('LIFECYCLE-SCHEDULER');

// ── Message builder ──────────────────────────────────────────────────────────

/**
 * Build a personalized reminder message for the given reminder + contact.
 * Returns { text, waTemplateName, waComponents, language }
 */
function buildMessage(reminder, contact, memory) {
  const name     = contact?.name || 'cliente';
  const firstName = name.split(' ')[0];
  const orgName  = contact?._orgName || 'el negocio';
  const lang     = memory?.preferences?.idioma || 'es';

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

  const serviceLabel = SERVICE_LABELS[reminder.service_key] || 'tu próxima cita';

  const text = `Hola ${firstName} 👋 Te escribimos desde ${orgName}. Ha llegado el momento de ${serviceLabel}. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.`;

  return {
    text,
    language: lang,
    // WA template: must be pre-approved in Meta Business Manager
    // Template name: nodeflow_recordatorio_servicio
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
 * Dispatch a reminder via the requested channel.
 * Falls back automatically: WhatsApp → SMS → Email.
 * Returns { ok, channel } where channel is the one that actually sent.
 */
async function dispatch(reminder, contact, memory) {
  const requestedChannel = reminder.channel;
  const phone = contact?.phone;
  const email = contact?.email;

  const { text, waTemplateName, waComponents, language } = buildMessage(reminder, contact, memory);

  // Try WhatsApp first (if requested or it's the primary)
  if ((requestedChannel === 'whatsapp' || requestedChannel === 'sms') && phone && waConfigured()) {
    const waPhone = String(phone).replace(/[\s\-+]/g, '');
    const result = await sendTemplate(waPhone, waTemplateName, language, waComponents);
    if (result.ok) return { ok: true, channel: 'whatsapp' };
    // WA failed → fall through to SMS
    log.warn(`WA send failed for reminder ${reminder.id}: ${result.error} — trying SMS`);
  }

  // Try SMS
  if ((requestedChannel === 'whatsapp' || requestedChannel === 'sms') && phone && smsConfigured()) {
    const result = await sendSMS(phone, text);
    if (result.ok) return { ok: true, channel: 'sms' };
    log.warn(`SMS send failed for reminder ${reminder.id}: ${result.error} — trying email`);
  }

  // Fall back to email
  if (email) {
    const ok = await sendEmail({
      to:      email,
      subject: `Recordatorio de ${reminder.service_key.replace(/_/g, ' ')}`,
      text,
      html:    `<p>${text}</p><p style="font-size:11px;color:#999;">Para no recibir más recordatorios: <a href="${process.env.PUBLIC_URL || 'https://nodeflow.es'}/api/portal/unsubscribe?c=${reminder.contact_id}&o=${reminder.org_id}&ch=email">clic aquí</a></p>`,
    });
    if (ok) return { ok: true, channel: 'email' };
  }

  return { ok: false, channel: null };
}

// ── Main cron logic ───────────────────────────────────────────────────────────

async function processReminders() {
  const db = getDatabase();
  if (!db.enabled) return;

  // Recover any stalled 'sending' reminders from previous run
  await db.client.rpc('recover_stalled_reminders').catch(() => {});

  // Claim pending reminders in the next 30 min window atomically
  const windowEnd = new Date(Date.now() + 31 * 60 * 1000).toISOString();
  const { data: reminders, error } = await db.client.rpc('claim_pending_reminders', {
    p_window_end: windowEnd,
    p_limit: 50,
  });

  if (error) { log.error('claim_pending_reminders failed', { err: error.message }); return; }
  if (!reminders?.length) return;

  log.info(`Processing ${reminders.length} reminders`);

  for (const reminder of reminders) {
    try {
      // Re-check do_not_contact (may have changed since scheduling)
      const memory = await getContactMemory(reminder.contact_id, reminder.org_id);
      const channel = reminder.channel;
      const blocked = (channel === 'whatsapp' && memory?.no_whatsapp)
                   || (channel === 'sms'      && memory?.no_sms)
                   || (channel === 'email'    && memory?.no_email)
                   || (memory?.no_whatsapp && memory?.no_sms && memory?.no_email);
      if (blocked) {
        await db.client.from('scheduled_reminders')
          .update({ status: 'cancelled', failed_reason: 'do_not_contact', updated_at: new Date().toISOString() })
          .eq('id', reminder.id);
        continue;
      }

      // Get contact with org name for message building
      const { data: contact } = await db.client
        .from('contacts')
        .select('name, phone, email, sector_data')
        .eq('id', reminder.contact_id)
        .maybeSingle();

      const { data: org } = await db.client
        .from('organizations')
        .select('name')
        .eq('id', reminder.org_id)
        .maybeSingle();

      const contactWithOrg = { ...contact, _orgName: org?.name || '' };

      // Check if a newer appointment was booked after this reminder was created
      const { data: newerApt } = await db.client
        .from('appointments')
        .select('id')
        .eq('org_id', reminder.org_id)
        .eq('contact_id', reminder.contact_id)
        .gt('created_at', reminder.created_at)
        .limit(1)
        .maybeSingle();

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
        log.error(`Reminder ${reminder.id} failed on all channels`);
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
 * Process seasonal campaigns (runs once daily).
 * Creates individual reminders for all contacts in an org.
 */
async function processCampaigns() {
  const db = getDatabase();
  if (!db.enabled) return;

  const now = new Date();
  const month = now.getMonth() + 1;
  const day   = now.getDate();
  const year  = now.getFullYear();

  const { data: campaigns } = await db.client
    .from('org_campaigns')
    .select('*')
    .eq('fire_month', month)
    .eq('fire_day', day)
    .eq('enabled', true)
    .or(`last_fired_year.is.null,last_fired_year.lt.${year}`);

  if (!campaigns?.length) return;

  for (const campaign of campaigns) {
    log.info(`Processing campaign ${campaign.campaign_name} for org ${campaign.org_id}`);

    const { data: contacts } = await db.client
      .from('contacts')
      .select('id, phone, email')
      .eq('org_id', campaign.org_id);

    if (!contacts?.length) continue;

    for (const contact of contacts) {
      const { scheduleReminder } = require('./reminder-engine');
      await scheduleReminder({
        orgId:       campaign.org_id,
        contactId:   contact.id,
        serviceKey:  campaign.service_key,
        scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 min from now
        channel:     campaign.channel,
      }).catch(() => {});
    }

    // Mark campaign as fired this year
    await db.client.from('org_campaigns')
      .update({ last_fired_year: year })
      .eq('id', campaign.id);
  }
}

let _cronInterval = null;
let _campaignLastRun = null;

function startLifecycleCron() {
  if (_cronInterval) return;
  log.info('Lifecycle cron started (30 min interval)');

  _cronInterval = setInterval(async () => {
    await processReminders().catch(e => log.error('processReminders error', { err: e.message }));

    // Run campaigns once per day (check if it's been > 23h since last run)
    const now = Date.now();
    if (!_campaignLastRun || now - _campaignLastRun > 23 * 60 * 60 * 1000) {
      _campaignLastRun = now;
      await processCampaigns().catch(e => log.error('processCampaigns error', { err: e.message }));
    }
  }, 30 * 60 * 1000);

  // Also run immediately on startup
  setTimeout(() => {
    processReminders().catch(() => {});
    processCampaigns().catch(() => {});
  }, 5000);
}

module.exports = { startLifecycleCron, processReminders, processCampaigns };
```

- [ ] **Step 2: Verify module loads**

```bash
node -e "const s = require('./src/lifecycle/scheduler'); console.log(typeof s.startLifecycleCron === 'function' ? '✅ scheduler loads OK' : '❌')"
```

Expected: `✅ scheduler loads OK`

- [ ] **Step 3: Commit**

```bash
git add src/lifecycle/scheduler.js
git commit -m "feat(lifecycle): add lifecycle scheduler (30min cron, WA→SMS→email dispatch, campaigns)"
```

---

### Task 9: Register Lifecycle Cron in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add the import and startup call**

In `server.js`, after the line `startRebookingCron();` (around line 409), add:

```javascript
// System D: lifecycle reminders cron
const { startLifecycleCron } = require('./src/lifecycle/scheduler');
startLifecycleCron();
```

- [ ] **Step 2: Verify server still starts**

```bash
node -e "
// Quick syntax check only (don't actually bind port)
try {
  // Just check the require chain
  require('./src/lifecycle/scheduler');
  require('./src/lifecycle/reminder-engine');
  require('./src/lifecycle/call-memory');
  require('./src/lifecycle/transcript-analyzer');
  console.log('✅ All lifecycle modules load without errors');
} catch(e) { console.error('❌', e.message); process.exit(1); }
"
```

Expected: `✅ All lifecycle modules load without errors`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(lifecycle): register lifecycle cron in server.js (System D)"
```

---

## Phase 3: API + Portal

### Task 10: Portal API Endpoints

**Files:**
- Modify: `src/api/routes-portal.js`

- [ ] **Step 1: Add the lifecycle imports at the top of routes-portal.js**

At the top of `src/api/routes-portal.js`, after the existing imports, add:

```javascript
const { getOrgReminderConfig, scheduleReminder, recalculate } = require('../lifecycle/reminder-engine');
const { getDatabase: _db2 } = require('../db/database'); // already imported as db likely
```

Check if `getDatabase` is already imported in that file. If so, skip the second line.

- [ ] **Step 2: Add the 9 new endpoints**

Find the end of `routes-portal.js` (before `module.exports`) and add:

```javascript
// ── Lifecycle: Reminder Config ──────────────────────────────────────────────

router.get('/reminder-config', portalAuth, async (req, res) => {
  const db = getDatabase();
  const orgId = req.org.id;

  const { data: org } = await db.client.from('organizations')
    .select('sector').eq('id', orgId).maybeSingle();
  const { getOrgReminderConfig } = require('../lifecycle/reminder-engine');
  const config = await getOrgReminderConfig(orgId, org?.sector || '');

  res.json({ ok: true, config });
});

router.put('/reminder-config', portalAuth, async (req, res) => {
  const db = getDatabase();
  const orgId = req.org.id;
  const { config } = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config object required' });

  const { error } = await db.client.from('org_reminder_config')
    .upsert({ org_id: orgId, config, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Lifecycle: Sector Data per Contact ──────────────────────────────────────

router.get('/contacts/:id/sector-data', portalAuth, async (req, res) => {
  const db = getDatabase();
  const { data, error } = await db.client.from('contacts')
    .select('id, name, phone, sector_data')
    .eq('id', req.params.id)
    .eq('org_id', req.org.id)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true, sectorData: data.sector_data || {} });
});

router.put('/contacts/:id/sector-data', portalAuth, async (req, res) => {
  const db = getDatabase();
  const orgId = req.org.id;
  const contactId = req.params.id;
  const { sectorData } = req.body;
  if (!sectorData || typeof sectorData !== 'object') return res.status(400).json({ error: 'sectorData object required' });

  const { error } = await db.client.from('contacts')
    .update({ sector_data: sectorData })
    .eq('id', contactId)
    .eq('org_id', orgId);

  if (error) return res.status(500).json({ error: error.message });

  // Recalculate reminders in background
  const { recalculate } = require('../lifecycle/reminder-engine');
  recalculate(contactId, orgId).catch(() => {});

  res.json({ ok: true });
});

// ── Lifecycle: Reminders Dashboard ──────────────────────────────────────────

router.get('/reminders', portalAuth, async (req, res) => {
  const db = getDatabase();
  const { status = 'pending', limit = 50, offset = 0 } = req.query;

  let query = db.client.from('scheduled_reminders')
    .select('*, contacts(name, phone)')
    .eq('org_id', req.org.id)
    .order('scheduled_for', { ascending: true })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status !== 'all') query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, reminders: data || [], total: count });
});

router.get('/reminders/upcoming', portalAuth, async (req, res) => {
  const db = getDatabase();
  const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db.client.from('scheduled_reminders')
    .select('*, contacts(name, phone)')
    .eq('org_id', req.org.id)
    .eq('status', 'pending')
    .lte('scheduled_for', until)
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, reminders: data || [] });
});

router.post('/reminders/:id/send-now', portalAuth, async (req, res) => {
  const db = getDatabase();
  // Cancel the existing reminder, create a new one firing in 5 seconds
  const { data: existing } = await db.client.from('scheduled_reminders')
    .select('*').eq('id', req.params.id).eq('org_id', req.org.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Reminder not found' });

  await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', failed_reason: 'manual_send_now', updated_at: new Date().toISOString() })
    .eq('id', req.params.id);

  const { scheduleReminder } = require('../lifecycle/reminder-engine');
  await scheduleReminder({
    orgId:        req.org.id,
    contactId:    existing.contact_id,
    serviceKey:   existing.service_key,
    scheduledFor: new Date(Date.now() + 5000),
    channel:      existing.channel,
  });

  res.json({ ok: true, message: 'Reminder queued for immediate dispatch' });
});

router.post('/reminders/:id/postpone', portalAuth, async (req, res) => {
  const db = getDatabase();
  const days = Math.max(1, Math.min(90, Number(req.body.days) || 7));

  const { data: existing } = await db.client.from('scheduled_reminders')
    .select('*').eq('id', req.params.id).eq('org_id', req.org.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Reminder not found' });

  const newDate = new Date(existing.scheduled_for);
  newDate.setDate(newDate.getDate() + days);

  await db.client.from('scheduled_reminders')
    .update({ status: 'postponed', updated_at: new Date().toISOString() })
    .eq('id', req.params.id);

  await db.client.from('scheduled_reminders').insert({
    org_id:         req.org.id,
    contact_id:     existing.contact_id,
    service_key:    existing.service_key,
    channel:        existing.channel,
    scheduled_for:  newDate.toISOString(),
    status:         'pending',
    postponed_from: req.params.id,
    postponed_days: days,
  });

  res.json({ ok: true, newDate: newDate.toISOString() });
});

router.post('/reminders/:id/cancel', portalAuth, async (req, res) => {
  const db = getDatabase();
  const { error } = await db.client.from('scheduled_reminders')
    .update({ status: 'cancelled', failed_reason: 'manual_cancel', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', req.org.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Opt-out (public, no auth) ────────────────────────────────────────────────

router.get('/unsubscribe', async (req, res) => {
  const { c: contactId, o: orgId, ch: channel } = req.query;
  if (!contactId || !orgId || !['whatsapp','email','sms'].includes(channel)) {
    return res.status(400).send('Enlace inválido');
  }

  const db = getDatabase();
  const field = channel === 'whatsapp' ? 'no_whatsapp'
              : channel === 'sms'      ? 'no_sms'
              :                          'no_email';

  await db.client.from('contact_memory')
    .upsert(
      { org_id: orgId, contact_id: contactId, [field]: true, updated_at: new Date().toISOString() },
      { onConflict: 'org_id,contact_id' }
    ).catch(() => {});

  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
    <h2>✅ Preferencia guardada</h2>
    <p>No recibirás más recordatorios por ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'email'} de este negocio.</p>
  </body></html>`);
});
```

- [ ] **Step 3: Test the endpoints with curl**

```bash
# Start server first: node server.js &

# Test reminder-config (requires valid portal token)
curl -s "http://localhost:3001/api/portal/reminder-config" \
  -H "Authorization: Bearer TEST_TOKEN" | head -c 200

# Test unsubscribe (public)
curl -s "http://localhost:3001/api/portal/unsubscribe?c=test&o=test&ch=email"
```

Expected: unsubscribe returns HTML with "Preferencia guardada".

- [ ] **Step 4: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(lifecycle): add 9 lifecycle API endpoints to routes-portal (reminders, sector-data, opt-out)"
```

---

### Task 11: Portal UI — Seguimientos Section

**Files:**
- Modify: `public/portal/index.html`
- Modify: `public/portal/portal.js`

- [ ] **Step 1: Add Seguimientos nav item to portal HTML**

In `public/portal/index.html`, find the nav menu (look for the section with `Llamadas`, `Citas`, etc.) and add:

```html
<li class="nav-item" data-section="seguimientos">
  <span class="nav-icon">🔔</span>
  <span class="nav-label">Seguimientos</span>
</li>
```

- [ ] **Step 2: Add Seguimientos section HTML**

Find where sections like `<section id="section-llamadas">` are defined and add after the last section:

```html
<section id="section-seguimientos" class="section hidden">
  <div class="section-header">
    <h2>Seguimientos automáticos</h2>
    <p class="section-desc">Recordatorios programados para tus clientes</p>
  </div>

  <!-- Tabs -->
  <div class="tabs" style="margin-bottom:20px">
    <button class="tab-btn active" data-tab="proximos">Próximos 30 días</button>
    <button class="tab-btn" data-tab="historial">Historial</button>
  </div>

  <!-- Upcoming tab -->
  <div id="tab-proximos">
    <div id="reminders-upcoming-list">
      <div class="loading-msg">Cargando recordatorios...</div>
    </div>
  </div>

  <!-- History tab -->
  <div id="tab-historial" style="display:none">
    <div id="reminders-history-list">
      <div class="loading-msg">Cargando historial...</div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add Seguimientos logic to portal.js**

Add these functions to `public/portal/portal.js`:

```javascript
// ── Seguimientos (Lifecycle Reminders) ────────────────────────────────────

async function loadSeguimientos() {
  // Tab switching
  document.querySelectorAll('#section-seguimientos .tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#section-seguimientos .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('tab-proximos').style.display  = tab === 'proximos'  ? '' : 'none';
      document.getElementById('tab-historial').style.display = tab === 'historial' ? '' : 'none';
      if (tab === 'historial') loadReminderHistory();
    };
  });

  await loadUpcomingReminders();
}

async function loadUpcomingReminders() {
  const container = document.getElementById('reminders-upcoming-list');
  container.innerHTML = '<div class="loading-msg">Cargando...</div>';

  const res = await apiGet('/api/portal/reminders/upcoming');
  if (!res.ok || !res.reminders?.length) {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">No hay recordatorios programados en los próximos 30 días</p>';
    return;
  }

  // Group by date
  const byDate = {};
  res.reminders.forEach(r => {
    const d = new Date(r.scheduled_for).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
  });

  container.innerHTML = Object.entries(byDate).map(([date, reminders]) => `
    <div class="reminder-group">
      <h4 class="reminder-date">📅 ${date}</h4>
      ${reminders.map(r => `
        <div class="reminder-row" id="reminder-${r.id}">
          <span class="reminder-contact">${r.contacts?.name || r.contact_id}</span>
          <span class="reminder-service">${r.service_key.replace(/_/g,' ')}</span>
          <span class="reminder-channel badge">${r.channel}</span>
          <div class="reminder-actions">
            <button class="btn-sm btn-primary" onclick="sendReminderNow('${r.id}')">Enviar ahora</button>
            <button class="btn-sm" onclick="postponeReminder('${r.id}')">Posponer</button>
            <button class="btn-sm btn-danger" onclick="cancelReminder('${r.id}')">✕</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

async function loadReminderHistory() {
  const container = document.getElementById('reminders-history-list');
  container.innerHTML = '<div class="loading-msg">Cargando...</div>';

  const res = await apiGet('/api/portal/reminders?status=all&limit=50');
  const past = (res.reminders || []).filter(r => ['sent','failed','cancelled'].includes(r.status));

  if (!past.length) {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sin historial aún</p>';
    return;
  }

  const STATUS_ICONS = { sent: '✅', failed: '❌', cancelled: '⛔' };
  container.innerHTML = `<table class="table"><thead><tr>
    <th></th><th>Fecha</th><th>Cliente</th><th>Servicio</th><th>Canal</th><th>Motivo</th>
  </tr></thead><tbody>
    ${past.map(r => `<tr>
      <td>${STATUS_ICONS[r.status] || ''}</td>
      <td>${new Date(r.sent_at || r.updated_at).toLocaleDateString('es-ES')}</td>
      <td>${r.contacts?.name || '—'}</td>
      <td>${r.service_key.replace(/_/g,' ')}</td>
      <td>${r.channel}</td>
      <td style="color:#888;font-size:12px">${r.failed_reason || ''}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function sendReminderNow(id) {
  if (!confirm('¿Enviar este recordatorio ahora?')) return;
  const res = await apiPost(`/api/portal/reminders/${id}/send-now`, {});
  if (res.ok) { showToast('Recordatorio enviado ✓', 'success'); loadUpcomingReminders(); }
  else showToast('Error al enviar', 'error');
}

async function postponeReminder(id) {
  const days = prompt('¿Cuántos días posponer?', '7');
  if (!days || isNaN(days)) return;
  const res = await apiPost(`/api/portal/reminders/${id}/postpone`, { days: Number(days) });
  if (res.ok) { showToast(`Pospuesto ${days} días ✓`, 'success'); loadUpcomingReminders(); }
  else showToast('Error al posponer', 'error');
}

async function cancelReminder(id) {
  if (!confirm('¿Cancelar este recordatorio?')) return;
  const res = await apiPost(`/api/portal/reminders/${id}/cancel`, {});
  if (res.ok) { showToast('Cancelado ✓', 'success'); loadUpcomingReminders(); }
  else showToast('Error al cancelar', 'error');
}
```

- [ ] **Step 4: Wire section loading**

In `portal.js`, find where other sections are loaded (look for `loadLlamadas()`, `loadCitas()` pattern) and add:

```javascript
case 'seguimientos':
  loadSeguimientos();
  break;
```

- [ ] **Step 5: Commit**

```bash
git add public/portal/index.html public/portal/portal.js
git commit -m "feat(lifecycle): add Seguimientos section to portal (upcoming reminders + history)"
```

---

## Phase 4: Documentation

### Task 12: Sector Lifecycle Documentation

**Files:**
- Create: `docs/sectores/` (11 files)

- [ ] **Step 1: Create the sector docs directory and key sector files**

```bash
mkdir -p "docs/sectores"
```

Create `docs/sectores/taller-lifecycle.md`:

```markdown
# Taller Mecánico — Lifecycle & Recordatorios

## Datos sector_data (el dueño los introduce en el portal)

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `matricula` | texto | En el onboarding o primera llamada |
| `marca_modelo` | texto | En el onboarding |
| `fecha_ultimo_aceite` | fecha YYYY-MM-DD | Después de cada cambio de aceite |
| `fecha_vencimiento_itv` | fecha YYYY-MM-DD | En onboarding y cuando caduca |
| `km_aproximados` | número | Opcional, al inicio |

**Importante:** `fecha_ultimo_aceite` y `fecha_vencimiento_itv` se introducen **manualmente** por el dueño del taller, no se calculan automáticamente.

## Intervalos de recordatorio

| Servicio | Trigger | Días | Ejemplo |
|----------|---------|------|---------|
| Cambio de aceite | 335 días desde `fecha_ultimo_aceite` | 335 | Cambio el 12/03/2026 → aviso 12/02/2027 |
| ITV | 60 días antes de `fecha_vencimiento_itv` | -60 | ITV caduca 05/09/2026 → aviso 06/07/2026 |
| Revisión general | 335 días desde última cita de revisión | 335 | — |

## Campañas estacionales (org_campaigns)

| Campaña | Fecha | Para todos los clientes |
|---------|-------|------------------------|
| Cambio a ruedas de verano | 1 abril | ✅ |
| Cambio a ruedas de invierno | 1 octubre | ✅ |

## Preguntas que hace el asistente durante la llamada

Para extraer datos a `sector_data` (si no están ya disponibles):
- "¿Me puede decir la matrícula del vehículo?"
- "¿Recuerda cuándo fue el último cambio de aceite?"
- "¿Sabe cuándo le caduca la ITV?" → Si no sabe: pasar a siguiente pregunta sin insistir

## Protocolo especial

- **ITV:** Si el cliente no sabe la fecha de vencimiento durante la llamada, no insistir. El dueño puede consultarla después y añadirla al portal.
- **Aceite:** La fecha del último cambio no se puede calcular desde las reservas; el mecánico la introduce tras cada servicio.

## Mensaje de recordatorio de ejemplo

> Hola Carlos 👋 Te escribimos desde Taller Arrate. Ha llegado el momento del cambio de aceite de tu Ford Focus. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.
```

Create `docs/sectores/peluqueria-lifecycle.md`:

```markdown
# Peluquería — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `tipo_servicio_habitual` | texto | Primera llamada o onboarding |
| `color_referencia` | texto | Si tiene color activo |
| `preferencia_estilista` | texto | Si tiene estilista asignado |
| `largo_cabello` | corto/medio/largo | Opcional |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Observación |
|----------|---------|------|-------------|
| Corte de pelo | Desde última cita de corte | **24 días** | Máximo 4 semanas |
| Color/tinte | Desde última cita de color | 35 días | |
| Tratamiento | Desde última cita de tratamiento | 28 días | |
| Permanente | Desde última cita de permanente | 70 días | |

**Importante:** El intervalo del corte es **máximo 4 semanas (24-28 días)**. No superar este valor.

## Preguntas en llamada

- "¿Suele venir para corte, color, o ambos?"
- "¿Tiene alguna estilista de preferencia?"

## Mensaje de ejemplo

> Hola María 👋 Te escribimos desde Peluquería Carmen. Han pasado casi 4 semanas desde tu último corte. ¿Te apetece reservar cita? Puedes responder a este mensaje o llamarnos.
```

Create `docs/sectores/veterinaria-lifecycle.md`:

```markdown
# Veterinaria — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `nombre_mascota` | texto | Primera llamada |
| `especie_raza` | texto | Primera llamada |
| `fecha_nacimiento_mascota` | fecha | Onboarding |
| `fecha_ultima_vacuna` | fecha | Tras cada vacunación |
| `fecha_proxima_vacuna` | fecha | Lo calcula el vet tras la vacuna |
| `veterinario_asignado` | texto | Opcional |

## Intervalos de recordatorio

| Servicio | Trigger | Días |
|----------|---------|------|
| Vacuna anual | 14 días ANTES de `fecha_proxima_vacuna` | -14 |
| Desparasitación | 70 días desde última cita de desparasitación | 70 |
| Revisión anual | 330 días desde última revisión | 330 |
| Post-cirugía | 10 días desde cirugía (solo si cita completada) | 10 |

## Preguntas en llamada

- "¿Me puede decir el nombre de su mascota?"
- "¿Es perro o gato? ¿Qué raza?"
- "¿Recuerda cuándo fue la última vacuna?" → Si no sabe, pasar a siguiente

## Mensaje de ejemplo

> Hola Iker 👋 Te escribimos desde Clínica Veterinaria Begoña. La vacuna anual de Tobi está próxima. ¿Le reservamos cita? Puedes responder o llamarnos directamente.

## Protocolo especial

- Siempre usar el nombre de la mascota en el mensaje, no solo el del dueño.
- Post-cirugía: solo crear recordatorio si el estado de la cita es `completed`.
```

- [ ] **Step 2: Create remaining sector files**

Create brief files for the other 8 sectors following the same template. Create each with `docs/sectores/[sector]-lifecycle.md`:

Sectors remaining: `dental`, `estetica`, `gimnasio`, `fisioterapia`, `psicologia`, `nutricion`, `optica`, `hotel`, `academia`

Each file should follow the pattern established in the three above: sector_data table, reminder intervals table, sample call questions, sample message, any special protocols.

For `psicologia-lifecycle.md` — include this critical protocol:
```markdown
## Protocolo especial — OBLIGATORIO

Los mensajes de recordatorio de psicología **NUNCA** deben mencionar:
- El tipo de consulta
- El nombre del tratamiento  
- Nada que identifique el motivo de la visita

Mensaje correcto: "Ha llegado el momento de tu próxima sesión"
Mensaje incorrecto: "Ha llegado el momento de tu sesión de terapia de ansiedad"
```

- [ ] **Step 3: Commit all sector docs**

```bash
git add docs/sectores/
git commit -m "docs: add lifecycle sector documentation for all 11 sectors"
```

---

## Final: Env vars and smoke test

- [ ] **Step 1: Add new env vars to .env.example or your .env**

Add these to `.env` (with empty values until configured):

```bash
# Lifecycle Reminders — WhatsApp (Meta Cloud API)
WA_PHONE_NUMBER_ID=        # From Meta Developer Console → WhatsApp → Phone Numbers
WA_ACCESS_TOKEN=           # Permanent token from Meta Business Manager
# WA_BUSINESS_ACCOUNT_ID=  # Optional, for template management via API

# SMS fallback (Twilio — independent of voice, uses existing Twilio credentials)
# TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER already in .env
```

- [ ] **Step 2: End-to-end smoke test**

```bash
node -e "
require('dotenv').config();
const modules = [
  './src/lifecycle/call-memory',
  './src/lifecycle/transcript-analyzer',
  './src/lifecycle/reminder-engine',
  './src/lifecycle/scheduler',
  './src/notifications/client-whatsapp',
  './src/notifications/sms',
];
let ok = true;
for (const m of modules) {
  try { require(m); console.log('✅', m); }
  catch(e) { console.error('❌', m, e.message); ok = false; }
}
process.exit(ok ? 0 : 1);
"
```

Expected: 6 `✅` lines.

- [ ] **Step 3: Final commit**

```bash
git add .env
git commit -m "chore: add lifecycle env vars to .env (WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN)"
```

---

## Pending manual steps (not in this plan)

| Step | Who | Notes |
|------|-----|-------|
| Run `db/schema-migration-lifecycle.sql` in Supabase SQL Editor | Owner | Task 1 |
| Create Meta Business Manager account | Owner | One-time setup |
| Get `WA_PHONE_NUMBER_ID` + `WA_ACCESS_TOKEN` | Owner | From Meta Developer Console |
| Create and submit WhatsApp template `nodeflow_recordatorio_servicio` | Owner | ~24h approval |
| Set `WA_PHONE_NUMBER_ID` and `WA_ACCESS_TOKEN` in EasyPanel env | Owner | After Meta approval |
| Confirm `TWILIO_PHONE_NUMBER` is set | Owner | Numbers arriving this week |
