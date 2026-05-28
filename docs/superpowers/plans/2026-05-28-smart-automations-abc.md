# Smart Automations A+B+C — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three autonomous automation systems — post-call actions (A), sector-based re-booking (B), and critical-date reminders (C) — into NodeFlow so that every call triggers follow-up workflows with zero human intervention.

**Architecture:** System A hooks into `endCall()` in `voice-pipeline.js` and fires a `postCallHandler` (fire-and-forget) that sends confirmation emails and WhatsApp owner alerts. System B is a daily cron at 10:00 that reads call history by business, finds clients past their sector-specific threshold, and sends a re-booking email (max 4/year/client). System C stores key dates captured by the AI during calls via a new `add_critical_date` tool, then a 09:00 cron sends reminders at 30/15/7 days before each due date.

**Tech Stack:** Node.js, Resend (email via `sendEmail()`), Callmebot (WhatsApp via `sendWhatsApp()`), Supabase (persistence for critical_dates), in-memory Maps for runtime state.

---

## File Structure

| File | Type | System | Purpose |
|------|------|--------|---------|
| `src/core/call-session.js` | Modify | A | Add `outcome`, `bookedAppointment`, `clientEmail`, `businessId`; `_deriveOutcome()` in `end()` |
| `src/core/voice-pipeline.js` | Modify | A | Pass `context={callId,session}` to executor; fire postCallHandler after endCall |
| `src/tools/executor.js` | Modify | A,C | Add `context` param to `execute()` + `bookAppointment()`; add `add_critical_date` |
| `src/automations/post-call-handler.js` | Create | A | Fire-and-forget post-call orchestrator |
| `src/notifications/call-notifications.js` | Create | A | 3 email templates: booking confirmation, owner summary, followup |
| `src/automations/flow-manager.js` | Modify | B | Add `rebooking` to DEFAULTS; add to `register()`/`patch()` |
| `src/scheduling/rebooking-cron.js` | Create | B | Daily 10:00 cron — scan clients, send re-booking emails |
| `src/notifications/rebooking-notifications.js` | Create | B | Re-booking email template (trilingüe) |
| `src/scheduling/critical-dates.js` | Create | C | `CriticalDatesStore` class + Supabase sync |
| `src/notifications/critical-date-notifications.js` | Create | C | Critical date reminder email template |
| `src/api/routes-critical-dates.js` | Create | C | POST/GET/DELETE/PATCH routes |
| `src/scheduling/cron.js` | Modify | C | Call `checkAndSendCriticalDateReminders()` in `runAutomations()` |
| `server.js` | Modify | B,C | `startRebookingCron()` on boot; mount critical-dates routes |

---

## Task 1: Add outcome fields to CallSession

**Files:**
- Modify: `src/core/call-session.js:22-46` (constructor), `src/core/call-session.js:167-186` (end + toJSON)

- [ ] **Step 1: Add new fields to constructor (after line 46, after `if (assistant) this._initConversation();`)**

Replace the constructor body to add 4 new fields. Open `src/core/call-session.js`. The constructor currently ends at line 46 (`if (assistant) this._initConversation();`). Add four lines before that closing:

```js
  constructor({ callId, assistant, callerNumber, calledNumber, direction = 'inbound' }) {
    this.id = callId || uuidv4();
    this.assistant = assistant;
    this.callerNumber = callerNumber;
    this.calledNumber = calledNumber;
    this.direction = direction;
    this.status = 'initializing';
    this.provider = 'twilio';
    this.streamSid = null;
    this.twilioWs = null;
    this.vonageWs = null;
    this.messages = [];
    this.turnCount = 0;
    this.isProcessing = false;
    this.isSpeaking = false;
    this.interrupted = false;
    this.markCounter = 0;
    this.pendingMarks = new Set();
    this.startTime = Date.now();
    this.endTime = null;
    this.metrics = { turns: [], totalSttTime: 0, totalLlmTime: 0, totalTtsTime: 0, totalToolTime: 0, llmTokens: 0, toolCalls: 0, interruptions: 0 };
    this.transcript = [];
    // ── Post-call context (populated by ToolExecutor during call) ────────────
    this.outcome         = 'abandoned';  // 'booked' | 'info' | 'abandoned'
    this.bookedAppointment = null;       // set by book_appointment tool
    this.clientEmail     = null;         // set by book_appointment tool if email given
    this.businessId      = assistant?.id || null;
    if (assistant) this._initConversation();
  }
```

- [ ] **Step 2: Update `end()` to derive outcome, and `toJSON()` to include new fields**

Replace the `end()` method (lines 167–173) and `toJSON()` (lines 175–185):

```js
  _deriveOutcome() {
    if (this.bookedAppointment) return 'booked';
    if (this.turnCount >= 3)   return 'info';
    return 'abandoned';
  }

  end() {
    this.status  = 'ended';
    this.endTime = Date.now();
    this.outcome = this._deriveOutcome();
    const cost   = this.getCost();
    log.call(`[${this.id}] Call ended — ${Math.round(this.getDuration()/1000)}s, ${this.turnCount} turns, $${cost.total.toFixed(4)}, outcome:${this.outcome}`);
    return this.toJSON();
  }

  toJSON() {
    const d = this.getDuration(); const s = Math.floor(d/1000); const m = Math.floor(s/60);
    return {
      id: this.id, assistantId: this.assistant?.id, assistantName: this.assistant?.name,
      callerNumber: this.callerNumber, calledNumber: this.calledNumber, direction: this.direction,
      status: this.status, startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      duration: d, durationFormatted: `${m}:${(s%60).toString().padStart(2,'0')}`,
      turnCount: this.turnCount, transcript: this.transcript, metrics: this.metrics, cost: this.getCost(),
      // Post-call context
      outcome: this.outcome,
      bookedAppointment: this.bookedAppointment,
      clientEmail: this.clientEmail,
      businessId: this.businessId,
    };
  }
```

- [ ] **Step 3: Smoke test — start server and verify the session object still works**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
node -e "const { CallSession } = require('./src/core/call-session'); const s = new CallSession({ callId: 'test', assistant: { id: 'biz1', name: 'Test' }, callerNumber: '+34600000000', calledNumber: '+34900000000' }); s.addUserMessage('Hola'); s.addAssistantMessage('Hola'); s.addUserMessage('Quiero reservar'); s.addAssistantMessage('Claro'); s.addUserMessage('El martes'); const d = s.end(); console.log('outcome:', d.outcome, '| businessId:', d.businessId);"
```

Expected: `outcome: info | businessId: biz1`

- [ ] **Step 4: Commit**

```bash
cd C:/Users/unais/.gemini/antigravity/scratch/voicecore
git add src/core/call-session.js
git commit -m "feat(A): add outcome/bookedAppointment/clientEmail/businessId to CallSession"
```

---

## Task 2: Pass context through ToolExecutor

**Files:**
- Modify: `src/tools/executor.js:58-73` (execute method), `src/tools/executor.js:107-122` (bookAppointment)

The goal: when `book_appointment` succeeds, stamp `session.outcome = 'booked'` and `session.bookedAppointment = result.appointment` so postCallHandler has this data.

- [ ] **Step 1: Add `context` parameter to `execute()` and pass it to handlers**

In `src/tools/executor.js`, update `execute()` (currently line 58) to accept and forward `context`:

```js
  async execute(functionName, args, assistantId, context = {}) {
    const handler = this.handlers[functionName];
    if (!handler) {
      log.warn(`Unknown tool: ${functionName}`);
      return { error: `Tool "${functionName}" not available.` };
    }
    log.info(`Executing: ${functionName}`, args);
    try {
      const result = await handler(args, assistantId, context);
      log.info(`Result: ${functionName}`, result);
      return result;
    } catch (err) {
      log.error(`Error: ${functionName} - ${err.message}`);
      return { error: err.message };
    }
  }
```

- [ ] **Step 2: Update `bookAppointment()` to stamp the session on success**

Replace `bookAppointment` (currently lines 107–122):

```js
  bookAppointment(args, assistantId, context = {}) {
    const businessId = assistantId || 'demo-clinic';
    const result = scheduler.bookAppointment(businessId, {
      patientName: args.patient_name,
      phone:       args.phone  || '',
      email:       args.email  || null,
      service:     args.service,
      date:        args.date,
      time:        args.time,
    });
    // Stamp the active session with booking context for post-call handler
    if (result.success && result.appointment && context.session) {
      context.session.bookedAppointment = result.appointment;
      context.session.clientEmail       = args.email || null;
      context.session.outcome           = 'booked';  // _deriveOutcome() will confirm in end()
    }
    // Best-effort Google Calendar sync (non-blocking)
    if (result.success && result.appointment) {
      _syncToCalendar(businessId, result.appointment).catch(() => {});
    }
    return result;
  }
```

- [ ] **Step 3: Pass `context` from voice-pipeline `_handleToolCalls`**

In `src/core/voice-pipeline.js`, update the `execute()` call at line 230:

```js
      const result = await this.toolExecutor.execute(
        tc.function.name,
        JSON.parse(tc.function.arguments || '{}'),
        session.assistant.id,
        { callId, session }          // ← add this
      );
```

- [ ] **Step 4: Smoke test**

```bash
node -e "
const { ToolExecutor } = require('./src/tools/executor');
const { CallSession }  = require('./src/core/call-session');
const te  = new ToolExecutor();
const ses = new CallSession({ callId: 'x', assistant: { id: 'demo-clinic', name: 'T' }, callerNumber: '+1', calledNumber: '+2' });
te.execute('book_appointment', { patient_name: 'Ana', service: 'Corte', date: '2026-06-10', time: '10:00', email: 'ana@test.com' }, 'demo-clinic', { session: ses }).then(r => {
  console.log('success:', r.success, '| session.outcome:', ses.outcome, '| clientEmail:', ses.clientEmail);
});
"
```

Expected: `success: true | session.outcome: booked | clientEmail: ana@test.com`  
(or `success: false` if demo-clinic not configured — that's fine, outcome stays `abandoned`)

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.js src/core/voice-pipeline.js
git commit -m "feat(A): pass context to executor so bookAppointment stamps session outcome"
```

---

## Task 3: Create call-notifications.js (email templates for System A)

**Files:**
- Create: `src/notifications/call-notifications.js`

This file exports three functions. They all use `sendEmail()` from `./email`. No external deps beyond that.

- [ ] **Step 1: Create the file**

Create `src/notifications/call-notifications.js`:

```js
// ============================================
// NodeFlow — Post-call email notifications
// System A: booking confirmation, owner summary, followup
// ============================================

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('CALL-NOTIF');

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function firstName(name = '') { return name.split(' ')[0]; }

// ── 1. Booking confirmation to client ─────────────────────────────────────────

/**
 * @param {object} appointment   - { patientName, email, service, date, time, phone, price? }
 * @param {object} config        - { name, ownerPhone, language, address? }
 */
async function sendBookingConfirmationEmail(appointment, config) {
  if (!appointment?.email) {
    log.warn('sendBookingConfirmationEmail: no email in appointment — skipped');
    return false;
  }

  const lang       = config?.language || 'es';
  const name       = firstName(appointment.patientName);
  const bizName    = esc(config?.name || 'tu negocio');
  const service    = esc(appointment.service || '');
  const date       = esc(appointment.date    || '');
  const time       = esc(appointment.time    || '');
  const phone      = esc(config?.ownerPhone  || '');
  const address    = esc(config?.address     || '');

  const gcalBase   = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const gcalTitle  = encodeURIComponent(`${appointment.service || 'Cita'} — ${config?.name || ''}`);
  const gcalDate   = (date + 'T' + time.replace(':','') + '00').replace(/-/g,'');
  const gcalLink   = `${gcalBase}&text=${gcalTitle}&dates=${gcalDate}/${gcalDate}`;

  // Spanish template
  if (lang === 'es' || lang === 'gl') {
    const greeting = lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
    const confirmed = lang === 'gl' ? 'A túa cita está confirmada' : 'Tu cita está confirmada';
    const addCal   = lang === 'gl' ? 'Engadir ao calendario' : 'Añadir al calendario';
    const cancel   = lang === 'gl' ? 'Para cancelar ou cambiar, responde a este email ou chama ao' : 'Para cancelar o cambiar, responde a este email o llama al';

    const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#07071200;margin:0;padding:0;">
<div style="max-width:520px;margin:32px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px 32px;">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em;">NodeFlow</div>
    <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">${confirmed}</div>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#e2e8f0;font-size:16px;margin:0 0 20px;">${greeting} 👋</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Negocio</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${bizName}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Servicio</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${service}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Fecha</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${date}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Hora</td><td style="color:#a855f7;font-size:15px;font-weight:800;text-align:right;">${time}h</td></tr>
        ${address ? `<tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Dirección</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${address}</td></tr>` : ''}
      </table>
    </div>
    <a href="${gcalLink}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:16px;">📅 ${addCal}</a>
    <p style="color:#64748b;font-size:12px;margin:0;">${cancel} <strong style="color:#94a3b8;">${phone}</strong></p>
  </div>
</div>
</body></html>`;

    const subject = lang === 'gl'
      ? `✅ Cita confirmada — ${config?.name || 'o teu negocio'}`
      : `✅ Cita confirmada — ${config?.name || 'tu negocio'}`;

    return sendEmail({ to: appointment.email, subject, html });
  }

  // Basque template
  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:520px;margin:32px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:28px 32px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">NodeFlow</div>
    <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px;">Zure hitzordua baieztatuta dago</div>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#e2e8f0;font-size:16px;margin:0 0 20px;">Kaixo ${esc(name)} 👋</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Negozioa</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${bizName}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Zerbitzua</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${service}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Data</td><td style="color:#fff;font-size:13px;font-weight:600;text-align:right;">${date}</td></tr>
        <tr><td style="color:#94a3b8;font-size:13px;padding:6px 0;">Ordua</td><td style="color:#a855f7;font-size:15px;font-weight:800;text-align:right;">${time}</td></tr>
      </table>
    </div>
    <a href="${gcalLink}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:16px;">📅 Egutegiari gehitu</a>
    <p style="color:#64748b;font-size:12px;margin:0;">Aldaketak egiteko, erantzun email hau edo deitu <strong style="color:#94a3b8;">${phone}</strong></p>
  </div>
</div>
</body></html>`;

  return sendEmail({ to: appointment.email, subject: `✅ Hitzordua baieztatuta — ${config?.name || ''}`, html });
}

// ── 2. Call summary to business owner ─────────────────────────────────────────

/**
 * @param {object} callData  - session.toJSON() result
 * @param {object} config    - { name, ownerEmail, ownerPhone, language }
 */
async function sendCallSummaryToOwner(callData, config) {
  if (!config?.ownerEmail) {
    log.warn('sendCallSummaryToOwner: no ownerEmail in config — skipped');
    return false;
  }

  const outcome      = callData.outcome    || 'abandoned';
  const caller       = esc(callData.callerNumber || 'desconocido');
  const dur          = esc(callData.durationFormatted || '0:00');
  const turns        = callData.turnCount  || 0;
  const bizName      = esc(config.name     || 'tu negocio');
  const apt          = callData.bookedAppointment;
  const outcomeBadge = outcome === 'booked' ? '✅ RESERVA' : outcome === 'info' ? 'ℹ️ CONSULTA' : '❌ ABANDONADA';

  let aptRows = '';
  if (apt) {
    aptRows = `
    <tr style="background:rgba(124,58,237,.08);">
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Cliente</td>
      <td style="color:#e2e8f0;font-size:12px;font-weight:600;padding:5px 8px;">${esc(apt.patientName)}</td>
    </tr>
    <tr>
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Servicio</td>
      <td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.service)}</td>
    </tr>
    <tr style="background:rgba(124,58,237,.08);">
      <td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Fecha / Hora</td>
      <td style="color:#a855f7;font-size:13px;font-weight:700;padding:5px 8px;">${esc(apt.date)} a las ${esc(apt.time)}h</td>
    </tr>`;
    if (apt.email) aptRows += `<tr><td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Email</td><td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.email)}</td></tr>`;
    if (apt.phone) aptRows += `<tr style="background:rgba(124,58,237,.08);"><td style="color:#94a3b8;font-size:12px;padding:5px 8px;">Teléfono</td><td style="color:#e2e8f0;font-size:12px;padding:5px 8px;">${esc(apt.phone)}</td></tr>`;
  }

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:540px;margin:24px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:#13131a;padding:20px 28px;border-bottom:1px solid rgba(255,255,255,.06);">
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;">NodeFlow · Resumen de llamada</span>
    <div style="font-size:18px;font-weight:800;color:#fff;margin-top:4px;">${bizName}</div>
  </div>
  <div style="padding:24px 28px;">
    <div style="display:inline-block;background:${outcome==='booked'?'rgba(34,197,94,.12)':outcome==='info'?'rgba(59,130,246,.1)':'rgba(239,68,68,.1)'};border:1px solid ${outcome==='booked'?'rgba(34,197,94,.3)':outcome==='info'?'rgba(59,130,246,.3)':'rgba(239,68,68,.3)'};border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;color:${outcome==='booked'?'#4ade80':outcome==='info'?'#60a5fa':'#f87171'};margin-bottom:20px;">${outcomeBadge}</div>
    <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,.03);border-radius:10px;overflow:hidden;">
      <tr style="background:rgba(255,255,255,.04);">
        <td style="color:#94a3b8;font-size:12px;padding:8px 12px;">Número</td>
        <td style="color:#e2e8f0;font-size:12px;font-weight:600;padding:8px 12px;">${caller}</td>
      </tr>
      <tr>
        <td style="color:#94a3b8;font-size:12px;padding:8px 12px;">Duración</td>
        <td style="color:#e2e8f0;font-size:12px;padding:8px 12px;">${dur} · ${turns} turnos</td>
      </tr>
      ${aptRows}
    </table>
    ${apt && config.ownerPhone ? `<a href="https://wa.me/${(config.ownerPhone||'').replace(/\D/g,'')}?text=${encodeURIComponent(`Hola, te confirmo la cita de ${apt.patientName} el ${apt.date} a las ${apt.time}h`)}" style="display:block;margin-top:16px;background:#25d366;color:#fff;text-decoration:none;text-align:center;padding:12px;border-radius:10px;font-weight:700;font-size:14px;">📲 Enviar confirmación WA al cliente</a>` : ''}
  </div>
</div>
</body></html>`;

  const subject = outcome === 'booked'
    ? `📞 Nueva reserva — ${callData.callerNumber} · ${apt?.date || ''}`
    : `📞 Llamada ${outcomeBadge} — ${callData.callerNumber} (${dur})`;

  return sendEmail({ to: config.ownerEmail, subject, html });
}

// ── 3. Follow-up email to client (info calls only) ────────────────────────────

/**
 * @param {object} callData  - session.toJSON()
 * @param {object} config    - { name, ownerPhone, language }
 */
async function sendCallFollowUpEmail(callData, config) {
  if (!callData?.clientEmail) {
    log.warn('sendCallFollowUpEmail: no clientEmail in callData — skipped');
    return false;
  }

  const bizName = esc(config?.name || 'nuestro negocio');
  const phone   = esc(config?.ownerPhone || '');

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;margin:0;padding:0;">
<div style="max-width:480px;margin:32px auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px 28px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">NodeFlow</div>
    <div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:2px;">Gracias por tu llamada</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;margin:0 0 16px;">Hemos atendido tu consulta a <strong>${bizName}</strong>. Si necesitas algo más, estamos aquí.</p>
    <a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:10px;">📞 Llamar ahora</a>
    <p style="color:#475569;font-size:11px;text-align:center;margin:0;">Este mensaje fue generado automáticamente por NodeFlow IA</p>
  </div>
</div>
</body></html>`;

  return sendEmail({
    to:      callData.clientEmail,
    subject: `Gracias por llamar a ${config?.name || 'nosotros'}`,
    html,
  });
}

module.exports = { sendBookingConfirmationEmail, sendCallSummaryToOwner, sendCallFollowUpEmail };
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./src/notifications/call-notifications'); console.log('OK — no syntax errors');"
```

Expected: `OK — no syntax errors`

- [ ] **Step 3: Commit**

```bash
git add src/notifications/call-notifications.js
git commit -m "feat(A): add call-notifications.js with booking confirmation, owner summary, followup"
```

---

## Task 4: Create post-call-handler.js (System A orchestrator)

**Files:**
- Create: `src/automations/post-call-handler.js`

This is the fire-and-forget entry point called by `voice-pipeline.js` after each call ends.

- [ ] **Step 1: Create the file**

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
}

module.exports = { postCallHandler: { handle } };
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./src/automations/post-call-handler'); console.log('OK — post-call-handler loaded');"
```

Expected: `OK — post-call-handler loaded`

- [ ] **Step 3: Wire into voice-pipeline.js endCall()**

In `src/core/voice-pipeline.js`, update `endCall()` (currently lines 339–350). Add the post-call trigger after `_fireWebhook`:

```js
  endCall(callId) {
    const session = this.activeCalls.get(callId);
    if (!session) return null;

    this.sttRouter.closeSession(callId);
    const callData = session.end();
    this.activeCalls.delete(callId);
    this.callHistory.unshift(callData);
    if (this.callHistory.length > this.maxHistory) this.callHistory.pop();
    this._fireWebhook('call.ended', callData);

    // System A: post-call automations (fire-and-forget — never blocks endCall)
    try {
      const { postCallHandler } = require('../automations/post-call-handler');
      postCallHandler.handle(callData).catch(e => this._log?.warn?.('post-call handler error', e));
    } catch (e) {
      // require() failure (missing module) must not break call teardown
    }

    return callData;
  }
```

- [ ] **Step 4: Smoke test the wiring**

```bash
node -e "
const { VoicePipeline } = require('./src/core/voice-pipeline');
const vp = new VoicePipeline({});
// Fake a minimal session by calling startCall then endCall
const s = vp.startCall({ callId: 'test-001', assistant: { id: 'demo', name: 'T', tools: [], systemPrompt: 'Test' }, callerNumber: '+34600000000', calledNumber: '+34900000000' });
const data = vp.endCall('test-001');
console.log('endCall returned outcome:', data.outcome, '— post-call handler fired (check logs)');
" 2>&1 | tail -10
```

Expected: no crash, logs show `Post-call [test-001]` line

- [ ] **Step 5: Commit**

```bash
git add src/automations/post-call-handler.js src/core/voice-pipeline.js
git commit -m "feat(A): wire post-call handler into endCall — owner email+WA, client confirmation"
```

---

## Task 5: Extend FlowManager with rebooking config (System B)

**Files:**
- Modify: `src/automations/flow-manager.js:13-17` (DEFAULTS), `src/automations/flow-manager.js:37-44` (register automations block), `src/automations/flow-manager.js:57-67` (patch automations block)

- [ ] **Step 1: Add `rebooking` to DEFAULTS**

In `src/automations/flow-manager.js`, update DEFAULTS (currently lines 13–17):

```js
const DEFAULTS = {
  reminders: { enabled: true,  hoursBefore: 24 },
  reviews:   { enabled: true,  hoursAfter:  24 },
  waConfirm: { enabled: true },
  rebooking: { enabled: true,  daysThreshold: null, maxPerYear: 4 },
};
```

- [ ] **Step 2: Add `rebooking` to the `register()` automations merge**

In `register()`, update the `automations:` block:

```js
      automations: {
        reminders: { ...DEFAULTS.reminders, ...(prev.automations?.reminders || {}), ...(config.automations?.reminders || {}) },
        reviews:   { ...DEFAULTS.reviews,   ...(prev.automations?.reviews   || {}), ...(config.automations?.reviews   || {}) },
        waConfirm: { ...DEFAULTS.waConfirm, ...(prev.automations?.waConfirm || {}), ...(config.automations?.waConfirm || {}) },
        rebooking: { ...DEFAULTS.rebooking, ...(prev.automations?.rebooking || {}), ...(config.automations?.rebooking || {}) },
      },
```

- [ ] **Step 3: Add `rebooking` to the `patch()` automations merge**

In `patch()`, update the automations merge block:

```js
          automations: automations
            ? {
                reminders: { ...flow.automations.reminders, ...(automations.reminders || {}) },
                reviews:   { ...flow.automations.reviews,   ...(automations.reviews   || {}) },
                waConfirm: { ...flow.automations.waConfirm, ...(automations.waConfirm || {}) },
                rebooking: { ...flow.automations.rebooking, ...(automations.rebooking || {}) },
              }
            : flow.automations,
```

- [ ] **Step 4: Verify**

```bash
node -e "
const { flowManager } = require('./src/automations/flow-manager');
flowManager.register('biz-test', { name: 'Test', sector: 'peluqueria' });
const f = flowManager.get('biz-test');
console.log('rebooking config:', JSON.stringify(f.automations.rebooking));
"
```

Expected: `rebooking config: {"enabled":true,"daysThreshold":null,"maxPerYear":4}`

- [ ] **Step 5: Commit**

```bash
git add src/automations/flow-manager.js
git commit -m "feat(B): add rebooking config to FlowManager DEFAULTS"
```

---

## Task 6: Create rebooking-notifications.js (System B email)

**Files:**
- Create: `src/notifications/rebooking-notifications.js`

- [ ] **Step 1: Create the file**

```js
// ============================================
// NodeFlow — Re-booking email (System B)
// Trilingüe: es / eu / gl
// ============================================

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('REBOOKING-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n = '') { return n.split(' ')[0]; }

// Sector-specific copy (title + message body)
const SECTOR_COPY = {
  restaurante:  { es: ['¿Volvemos a vernos?', 'Han pasado unas semanas desde tu última visita. Tenemos novedades que te van a encantar.'] },
  peluqueria:   { es: ['Tu melena te llama', 'Hace más de un mes que no pasas por aquí. ¿Reservamos para esta semana?'],
                  eu: ['Zure ilea dei egiten dizu', 'Hilabete baino gehiago da ikusten ez zaitudala. Aste honetarako hitzordua jartzen dugu?'] },
  estetica:     { es: ['Es hora de mimarte', 'Hace tiempo que no disfrutas de tu tratamiento favorito.'] },
  barberia:     { es: ['Ya va tocando un repaso', 'Lleva un tiempo sin pasar por la barbería. ¿Te apuntamos?'] },
  clinica:      { es: ['Recordatorio de revisión', 'Han pasado varios meses desde tu última consulta. Tu salud es lo primero.'] },
  dental:       { es: ['Tu revisión dental anual', 'Han pasado 6 meses. Te recomendamos una revisión para mantener tu sonrisa.'] },
  veterinaria:  { es: ['Tu mascota merece una revisión', 'Ha pasado un año desde la última visita. Una revisión anual es importante para su salud.'],
                  eu: ['Zure maskota azterketa bat merezi du', 'Urte bat igaro da azken bisita egin genuenetik.'] },
  taller:       { es: ['Tu coche lleva tiempo sin revisión', 'Hace un año desde la última puesta a punto. Revisemos que todo esté en orden.'] },
  gimnasio:     { es: ['¡Te echamos de menos!', 'Llevamos tiempo sin verte. Recuerda que estamos aquí para ayudarte con tus objetivos.'] },
  academia:     { es: ['No te pierdas las próximas clases', 'Hay plazas disponibles en los próximos cursos. ¿Te interesa continuar?'] },
  farmacia:     { es: ['Renovación de medicación', 'Es momento de renovar tu receta o pasar a recoger tu pedido habitual.'] },
  asesoria:     { es: ['Se acerca el próximo período fiscal', 'Llevamos unos meses sin hablar. ¿Revisamos tu situación antes del próximo vencimiento?'] },
  hotel:        { es: ['¿Vuelves a visitarnos?', 'Han pasado 3 meses desde tu estancia. Tenemos una oferta especial para clientes habituales.'] },
  default:      { es: ['Hace tiempo que no te vemos', 'Queremos recordarte que seguimos aquí para ayudarte cuando lo necesites.'] },
};

function getCopy(sector, lang) {
  const s = SECTOR_COPY[sector] || SECTOR_COPY.default;
  const l = s[lang] || s.es || SECTOR_COPY.default.es;
  return { title: l[0], body: l[1] };
}

/**
 * @param {object} client   - { name, email, phone, lastVisitDate }
 * @param {object} config   - { name, ownerPhone, language, sector }
 * @param {string} lastVisitDate  - 'YYYY-MM-DD'
 */
async function sendRebookingEmail(client, config, lastVisitDate) {
  if (!client?.email) {
    log.warn(`sendRebookingEmail: no email for client ${client?.name} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const sector  = config?.sector   || 'default';
  const copy    = getCopy(sector, lang);
  const name    = firstName(client.name);
  const bizName = esc(config?.name || 'nuestro negocio');
  const phone   = esc(config?.ownerPhone || '');

  // Format last visit date
  let lastVisitStr = lastVisitDate || '';
  if (lastVisitDate) {
    try {
      const d = new Date(lastVisitDate + 'T12:00:00');
      lastVisitStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch(_) {}
  }

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;
  const lastVisitLabel = lang === 'eu' ? 'Azken bisita' : lang === 'gl' ? 'Última visita' : 'Última visita';
  const ctaLabel = lang === 'eu' ? 'Hitzordua hartu' : lang === 'gl' ? 'Reservar cita' : 'Reservar cita';
  const unsubLabel = lang === 'eu' ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.' : 'Para darte de baja de estos recordatorios, responde a este email.';

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.25);">
  <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px 28px;">
    <div style="font-size:20px;font-weight:800;color:#fff;">NodeFlow</div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px;">${esc(bizName)}</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:16px;font-weight:700;margin:0 0 8px;">${greeting} 👋</p>
    <p style="color:#94a3b8;font-size:14px;margin:0 0 20px;">${esc(copy.body)}</p>
    ${lastVisitStr ? `<p style="color:#475569;font-size:12px;margin:0 0 16px;">${lastVisitLabel}: ${lastVisitStr}</p>` : ''}
    <a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px;">📞 ${ctaLabel}</a>
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">${unsubLabel}</p>
  </div>
</div>
</body></html>`;

  log.info(`Sending rebooking email to ${client.email} (${sector}/${lang})`);
  return sendEmail({ to: client.email, subject: `${copy.title} — ${config?.name || ''}`, html });
}

module.exports = { sendRebookingEmail };
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/notifications/rebooking-notifications'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add src/notifications/rebooking-notifications.js
git commit -m "feat(B): add rebooking-notifications.js with sector/language email templates"
```

---

## Task 7: Create rebooking-cron.js (System B daily cron)

**Files:**
- Create: `src/scheduling/rebooking-cron.js`

- [ ] **Step 1: Create the file**

```js
// ============================================
// NodeFlow — Re-booking Cron (System B)
// Runs daily at 10:00 Madrid
// Scans past appointments, sends re-booking emails
// to clients past sector threshold with no upcoming apt
// ============================================

const { flowManager }          = require('../automations/flow-manager');
const { scheduler }            = require('./scheduler');
const { sendRebookingEmail }   = require('../notifications/rebooking-notifications');
const { Logger }               = require('../utils/logger');

const log = new Logger('REBOOKING-CRON');

// Default thresholds in days per sector
const REBOOKING_DEFAULTS = {
  restaurante:  21,
  peluqueria:   42,
  estetica:     42,
  barberia:     28,
  clinica:      180,
  dental:       180,
  veterinaria:  365,
  taller:       365,
  gimnasio:     21,
  academia:     30,
  farmacia:     30,
  asesoria:     90,
  hotel:        90,
  inmobiliaria: null, // disabled
};

// Anti-spam log: Map<`${businessId}:${phone}`, lastSentAt (ms)>
// Loaded from memory only — acceptable loss on restart
const _sentLog = new Map();

function _sentKey(businessId, phone) {
  return `${businessId}:${(phone || '').replace(/\D/g, '')}`;
}

function _daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr + 'T12:00:00');
  const now  = new Date();
  return Math.floor((now - then) / 86400000);
}

function _todayStr() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
}

/**
 * Run the rebooking check for all registered businesses.
 * Returns number of emails sent.
 */
async function checkAndSendRebookings() {
  const flows   = flowManager.list();
  const today   = _todayStr();
  let   sent    = 0;
  let   checked = 0;

  for (const flow of flows) {
    const { businessId, sector, automations } = flow;
    const rebooking = automations?.rebooking;

    if (!rebooking?.enabled) continue;

    const threshold = rebooking.daysThreshold ?? REBOOKING_DEFAULTS[sector] ?? null;
    if (threshold == null) continue; // sector disabled (e.g. inmobiliaria)

    const maxPerYear = rebooking.maxPerYear ?? 4;

    // Get all appointments for this business
    const allApts = scheduler.getAppointments(businessId);
    if (!allApts || allApts.length === 0) continue;

    // Group past appointments by client (keyed by normalised phone)
    const clientMap = new Map(); // phone → { name, email, phone, lastVisitDate, upcomingCount }
    for (const apt of allApts) {
      const phone  = (apt.phone || '').replace(/\D/g, '');
      const isPast = apt.date < today;
      if (!phone && !apt.email) continue; // can't contact

      const key = phone || apt.email;
      const existing = clientMap.get(key) || { name: apt.patientName, email: apt.email || null, phone: phone || null, lastVisitDate: null, upcomingCount: 0 };

      if (isPast) {
        if (!existing.lastVisitDate || apt.date > existing.lastVisitDate) {
          existing.lastVisitDate = apt.date;
        }
      } else {
        existing.upcomingCount++;
      }
      clientMap.set(key, existing);
    }

    // Evaluate each client
    for (const [, client] of clientMap) {
      checked++;
      if (!client.email) continue;                             // need email to send
      if (client.upcomingCount > 0) continue;                 // already has upcoming apt
      if (!client.lastVisitDate) continue;                     // never visited

      const daysSince = _daysSince(client.lastVisitDate);
      if (daysSince < threshold) continue;                     // not yet past threshold

      // Anti-spam: check if already sent within threshold days
      const key = _sentKey(businessId, client.phone || client.email);
      const lastSent = _sentLog.get(key);
      if (lastSent) {
        const daysSinceSent = Math.floor((Date.now() - lastSent) / 86400000);
        if (daysSinceSent < threshold) continue;
      }

      // Check annual cap: count how many times sent this year
      // (simplified: use _sentLog — production should persist to DB)
      const yearKey = `${key}:${new Date().getFullYear()}`;
      const sentThisYear = _sentLog.get(yearKey) || 0;
      if (sentThisYear >= maxPerYear) continue;

      // Send
      const config = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId) || {});
      config.sector = sector;

      try {
        await sendRebookingEmail(client, config, client.lastVisitDate);
        _sentLog.set(key, Date.now());
        _sentLog.set(yearKey, sentThisYear + 1);
        sent++;
        log.info(`Rebooking sent: ${client.email} (${businessId}/${sector}, last:${client.lastVisitDate})`);
      } catch (e) {
        log.warn(`Rebooking send failed: ${client.email}`, { err: e.message });
      }
    }
  }

  log.info(`Rebooking cron done — checked:${checked} sent:${sent}`);
  return sent;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _interval = null;

function startRebookingCron() {
  if (_interval) { log.warn('Rebooking cron already running'); return; }

  // Schedule daily at 10:00 Madrid — check every minute if time has come
  // Simple approach: use setInterval every 60s, check current Madrid hour+minute
  _interval = setInterval(() => {
    const now = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false });
    if (now === '10:00') {
      checkAndSendRebookings().catch(e => log.error('Rebooking cron error', { err: e.message }));
    }
  }, 60 * 1000);

  log.info('Rebooking cron started — fires daily at 10:00 Madrid');
}

function stopRebookingCron() {
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Rebooking cron stopped'); }
}

module.exports = { startRebookingCron, stopRebookingCron, checkAndSendRebookings };
```

- [ ] **Step 2: Check that `scheduler.getAppointments(businessId)` exists**

```bash
grep -n "getAppointments\|getAppointment" src/scheduling/scheduler.js | head -10
```

If `getAppointments(businessId)` does NOT exist, add this stub to `src/scheduling/scheduler.js`:

```js
  getAppointments(businessId) {
    const config = this.getBusinessConfig(businessId);
    if (!config) return [];
    return (config.appointments || []).slice();
  }
```

Add it near the other getter methods. Then verify:

```bash
node -e "const { scheduler } = require('./src/scheduling/scheduler'); console.log('getAppointments:', typeof scheduler.getAppointments);"
```

Expected: `getAppointments: function`

- [ ] **Step 3: Verify rebooking-cron syntax**

```bash
node -e "require('./src/scheduling/rebooking-cron'); console.log('OK');"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/scheduling/rebooking-cron.js src/scheduling/scheduler.js
git commit -m "feat(B): add rebooking-cron.js — daily 10:00 scan for lapsed clients"
```

---

## Task 8: Create critical-dates.js store (System C)

**Files:**
- Create: `src/scheduling/critical-dates.js`

- [ ] **Step 1: Create the file**

```js
// ============================================
// NodeFlow — Critical Dates Store (System C)
// In-memory + Supabase persistence
// ============================================

const { v4: uuidv4 }  = require('uuid');
const { getDatabase } = require('../db/database');
const { Logger }      = require('../utils/logger');

const log = new Logger('CRITICAL-DATES');

// ── Date types per sector ──────────────────────────────────────────────────────
const CRITICAL_DATE_TYPES = {
  itv_expiry:           { label: 'Vencimiento ITV',          emoji: '🚗', sectors: ['taller'] },
  service_due:          { label: 'Revisión de vehículo',      emoji: '🔧', sectors: ['taller'] },
  insurance_renewal:    { label: 'Renovación de seguro',      emoji: '📋', sectors: ['taller','asesoria'] },
  vaccine_due:          { label: 'Vacuna pendiente',          emoji: '💉', sectors: ['veterinaria','clinica'] },
  annual_checkup:       { label: 'Revisión anual',            emoji: '🩺', sectors: ['veterinaria','clinica'] },
  deworming:            { label: 'Desparasitación',           emoji: '🐾', sectors: ['veterinaria'] },
  tax_filing:           { label: 'Declaración de renta',      emoji: '📊', sectors: ['asesoria'] },
  quarterly_vat:        { label: 'Liquidación IVA',           emoji: '🧾', sectors: ['asesoria'] },
  annual_accounts:      { label: 'Cuentas anuales',           emoji: '📁', sectors: ['asesoria'] },
  prescription_renewal: { label: 'Renovación receta',         emoji: '💊', sectors: ['farmacia','clinica'] },
  membership_renewal:   { label: 'Renovación membresía',      emoji: '🏋️', sectors: ['gimnasio'] },
  exam_date:            { label: 'Fecha de examen',           emoji: '📝', sectors: ['academia'] },
  enrollment_deadline:  { label: 'Plazo de matrícula',        emoji: '🎓', sectors: ['academia'] },
  contract_expiry:      { label: 'Vencimiento contrato',      emoji: '📋', sectors: ['inmobiliaria','asesoria'] },
  birthday:             { label: 'Cumpleaños',                emoji: '🎂', sectors: [] }, // universal
  anniversary:          { label: 'Aniversario',               emoji: '💑', sectors: [] },
};

class CriticalDatesStore {
  constructor() {
    this.dates = new Map(); // id → CriticalDate
  }

  /**
   * Add a new critical date entry.
   * Returns the created entry.
   */
  add({ businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays = [30, 15, 7] }) {
    if (!businessId || !clientName || !type || !dueDate) {
      throw new Error('businessId, clientName, type and dueDate are required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error(`dueDate must be YYYY-MM-DD, got: ${dueDate}`);
    }
    const entry = {
      id:             uuidv4(),
      businessId,
      clientName,
      clientEmail:    clientEmail  || null,
      clientPhone:    clientPhone  || null,
      type,
      dueDate,
      notes:          notes        || null,
      advanceDays:    advanceDays,
      sentReminders:  [],
      active:         true,
      createdAt:      new Date().toISOString(),
    };
    this.dates.set(entry.id, entry);
    log.info(`Critical date added: ${type} for ${clientName} on ${dueDate} (biz: ${businessId})`);
    // Persist async (fire-and-forget)
    this._persist(entry).catch(e => log.warn(`Persist failed for ${entry.id}`, { err: e.message }));
    return entry;
  }

  /**
   * Mark advance reminder as sent.
   */
  markSent(id, advanceDay) {
    const entry = this.dates.get(id);
    if (!entry) return false;
    if (!entry.sentReminders.includes(String(advanceDay))) {
      entry.sentReminders.push(String(advanceDay));
    }
    // Persist updated sentReminders
    this._updateDB(id, { sent_reminders: entry.sentReminders }).catch(() => {});
    return true;
  }

  deactivate(id) {
    const entry = this.dates.get(id);
    if (!entry) return false;
    entry.active = false;
    this._updateDB(id, { active: false }).catch(() => {});
    return true;
  }

  /**
   * Get all active entries for a business.
   */
  getByBusiness(businessId) {
    return [...this.dates.values()].filter(d => d.businessId === businessId && d.active);
  }

  /**
   * Get ALL active entries (for cron scan).
   */
  getAll() {
    return [...this.dates.values()].filter(d => d.active);
  }

  getById(id) { return this.dates.get(id) || null; }

  delete(id) {
    const existed = this.dates.has(id);
    this.dates.delete(id);
    return existed;
  }

  /**
   * Load all active critical dates from Supabase into memory.
   */
  async loadFromDB() {
    const db = getDatabase();
    if (!db.enabled) { log.info('DB disabled — critical dates not loaded from DB'); return 0; }
    try {
      const { data, error } = await db.client
        .from('critical_dates')
        .select('*')
        .eq('active', true);
      if (error) throw new Error(error.message);
      let n = 0;
      for (const row of (data || [])) {
        this.dates.set(row.id, {
          id:            row.id,
          businessId:    row.business_id,
          clientName:    row.client_name,
          clientEmail:   row.client_email,
          clientPhone:   row.client_phone,
          type:          row.type,
          dueDate:       row.due_date,
          notes:         row.notes,
          advanceDays:   row.advance_days  || [30, 15, 7],
          sentReminders: row.sent_reminders || [],
          active:        row.active,
          createdAt:     row.created_at,
        });
        n++;
      }
      log.info(`Loaded ${n} critical dates from DB`);
      return n;
    } catch (e) {
      log.warn('Failed to load critical dates from DB', { err: e.message });
      return 0;
    }
  }

  async _persist(entry) {
    const db = getDatabase();
    if (!db.enabled) return;
    await db.client.from('critical_dates').insert({
      id:             entry.id,
      business_id:    entry.businessId,
      client_name:    entry.clientName,
      client_email:   entry.clientEmail,
      client_phone:   entry.clientPhone,
      type:           entry.type,
      due_date:       entry.dueDate,
      notes:          entry.notes,
      advance_days:   entry.advanceDays,
      sent_reminders: entry.sentReminders,
      active:         entry.active,
    });
  }

  async _updateDB(id, patch) {
    const db = getDatabase();
    if (!db.enabled) return;
    await db.client.from('critical_dates').update(patch).eq('id', id);
  }
}

// Singleton
const criticalDatesStore = new CriticalDatesStore();

module.exports = { criticalDatesStore, CRITICAL_DATE_TYPES };
```

- [ ] **Step 2: Verify**

```bash
node -e "
const { criticalDatesStore } = require('./src/scheduling/critical-dates');
const e = criticalDatesStore.add({ businessId: 'biz1', clientName: 'Test User', clientEmail: 'test@example.com', type: 'itv_expiry', dueDate: '2026-12-15', notes: 'Seat León' });
console.log('Added:', e.id, '| dueDate:', e.dueDate, '| advanceDays:', e.advanceDays);
console.log('getAll count:', criticalDatesStore.getAll().length);
"
```

Expected: `Added: <uuid> | dueDate: 2026-12-15 | advanceDays: [ 30, 15, 7 ]` + `getAll count: 1`

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/critical-dates.js
git commit -m "feat(C): add CriticalDatesStore with in-memory + Supabase persistence"
```

---

## Task 9: Create critical-date-notifications.js (System C email)

**Files:**
- Create: `src/notifications/critical-date-notifications.js`

- [ ] **Step 1: Create the file**

```js
// ============================================
// NodeFlow — Critical Date Reminder Email (System C)
// ============================================

const { sendEmail }          = require('./email');
const { CRITICAL_DATE_TYPES } = require('../scheduling/critical-dates');
const { Logger }             = require('../utils/logger');

const log = new Logger('CRIT-DATE-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n = '') { return n.split(' ')[0]; }

function _urgencyLabel(daysUntil, lang) {
  if (daysUntil <= 7) {
    return lang === 'eu' ? '⚠️ URGENTEA' : lang === 'gl' ? '⚠️ URXENTE' : '⚠️ URGENTE';
  }
  if (daysUntil <= 15) {
    return lang === 'eu' ? '📢 Gogora egiozu' : lang === 'gl' ? '📢 Lembra' : '📢 Recuerda';
  }
  return lang === 'eu' ? '📅 Gogorarazle' : lang === 'gl' ? '📅 Recordatorio' : '📅 Recordatorio';
}

function _urgencyColor(daysUntil) {
  if (daysUntil <= 7) return '#ef4444';
  if (daysUntil <= 15) return '#f59e0b';
  return '#a855f7';
}

/**
 * @param {object} criticalDate  - CriticalDatesStore entry
 * @param {number} daysUntilDue  - how many days until dueDate (30|15|7 or custom)
 * @param {object} config        - { name, ownerPhone, language }
 */
async function sendCriticalDateReminder(criticalDate, daysUntilDue, config) {
  if (!criticalDate?.clientEmail) {
    log.warn(`sendCriticalDateReminder: no email for ${criticalDate?.clientName} — skipped`);
    return false;
  }

  const lang       = config?.language || 'es';
  const name       = firstName(criticalDate.clientName);
  const bizName    = esc(config?.name || 'tu negocio');
  const phone      = esc(config?.ownerPhone || '');
  const typeInfo   = CRITICAL_DATE_TYPES[criticalDate.type] || { label: criticalDate.type, emoji: '📅', sectors: [] };
  const urgColor   = _urgencyColor(daysUntilDue);
  const urgLabel   = _urgencyLabel(daysUntilDue, lang);
  const notes      = esc(criticalDate.notes || '');

  // Format due date
  let dueDateStr = criticalDate.dueDate;
  try {
    const d = new Date(criticalDate.dueDate + 'T12:00:00');
    dueDateStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : lang === 'gl' ? 'gl' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch(_) {}

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : lang === 'gl' ? `Ola ${esc(name)}` : `Hola ${esc(name)}`;

  const daysLabel = (() => {
    if (lang === 'eu') return `${daysUntilDue} egun barru`;
    if (lang === 'gl') return `en ${daysUntilDue} días`;
    return `en ${daysUntilDue} días`;
  })();

  const actionLabel = lang === 'eu' ? `Deitu ${bizName}` : lang === 'gl' ? `Chamar a ${bizName}` : `Llamar a ${bizName}`;

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">
  <div style="background:linear-gradient(135deg,#1c1c28,#0c0c1a);padding:20px 28px;border-bottom:3px solid ${urgColor};">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;">NodeFlow · ${urgLabel}</div>
    <div style="font-size:20px;margin-top:6px;">${typeInfo.emoji} <span style="color:#fff;font-weight:800;">${esc(typeInfo.label)}</span></div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 16px;">${greeting},</p>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;margin-bottom:20px;">
      <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.06em;">Fecha límite</p>
      <p style="color:${urgColor};font-size:18px;font-weight:800;margin:0 0 4px;">${dueDateStr}</p>
      <p style="color:#64748b;font-size:12px;margin:0;">${daysLabel}</p>
      ${notes ? `<p style="color:#94a3b8;font-size:12px;margin:12px 0 0;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;">${notes}</p>` : ''}
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">
      ${esc(bizName)} te recuerda esta fecha para que puedas gestionarla a tiempo.
    </p>
    <a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:${urgColor};color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;">📞 ${actionLabel}</a>
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">Recordatorio automático de NodeFlow IA · Para darte de baja responde a este email.</p>
  </div>
</div>
</body></html>`;

  const subject = daysUntilDue <= 7
    ? `⚠️ ${typeInfo.emoji} ${typeInfo.label} — quedan ${daysUntilDue} días`
    : `📅 ${typeInfo.emoji} ${typeInfo.label} — en ${daysUntilDue} días`;

  log.info(`Sending critical date reminder to ${criticalDate.clientEmail} — ${criticalDate.type} in ${daysUntilDue}d`);
  return sendEmail({ to: criticalDate.clientEmail, subject, html });
}

module.exports = { sendCriticalDateReminder };
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/notifications/critical-date-notifications'); console.log('OK');"
```

- [ ] **Step 3: Commit**

```bash
git add src/notifications/critical-date-notifications.js
git commit -m "feat(C): add critical-date-notifications.js with urgency-aware reminder emails"
```

---

## Task 10: Wire critical dates into cron.js and add the cron check function

**Files:**
- Modify: `src/scheduling/cron.js`

- [ ] **Step 1: Add `checkAndSendCriticalDateReminders()` function and integrate into `runAutomations()`**

In `src/scheduling/cron.js`, update the file to add the critical date checker:

```js
// ============================================
// NodeFlow — Automation Cron Runner
// Cada 30 min: reminders + review requests
// 09:00 Madrid: critical date reminders
// ============================================

const { Logger } = require('../utils/logger');

const log = new Logger('CRON');

let _interval    = null;
let _warmupTimer = null;
let _running     = false;
let _lastRun     = null;
let _stats       = { reminders: 0, reviews: 0, criticalDates: 0, runs: 0 };
let _history     = [];

async function checkAndSendCriticalDateReminders() {
  const { criticalDatesStore } = require('../scheduling/critical-dates');
  const { sendCriticalDateReminder } = require('../notifications/critical-date-notifications');
  const { flowManager } = require('../automations/flow-manager');
  const { scheduler }   = require('../scheduling/scheduler');

  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
  const allDates = criticalDatesStore.getAll();
  let sent = 0;

  for (const entry of allDates) {
    for (const advanceDay of (entry.advanceDays || [30, 15, 7])) {
      if (entry.sentReminders.includes(String(advanceDay))) continue;

      const targetDate = new Date(entry.dueDate + 'T12:00:00');
      targetDate.setDate(targetDate.getDate() - advanceDay);
      const targetStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(targetDate);

      if (targetStr !== today) continue;

      const config = flowManager.mergeConfig(entry.businessId, scheduler.getBusinessConfig(entry.businessId) || {});

      try {
        await sendCriticalDateReminder(entry, advanceDay, config);
        criticalDatesStore.markSent(entry.id, advanceDay);
        sent++;
        log.info(`Critical date reminder sent: ${entry.clientName} — ${entry.type} in ${advanceDay}d`);
      } catch (e) {
        log.warn(`Critical date reminder failed for ${entry.id}`, { err: e.message });
      }
    }
  }

  return sent;
}

async function runAutomations() {
  if (_running) return;
  _running = true;
  const start = Date.now();

  try {
    const { scheduler }              = require('./scheduler');
    const { flowManager }            = require('../automations/flow-manager');
    const { checkAndSendReminders,
            checkAndSendReviews }    = require('../notifications/reminders');

    log.info(`Running automations for ${flowManager.list().length} flows…`);
    const reminders     = await checkAndSendReminders(scheduler, flowManager);
    const reviews       = await checkAndSendReviews(scheduler, flowManager);
    const criticalDates = await checkAndSendCriticalDateReminders();

    _stats.reminders     += reminders;
    _stats.reviews       += reviews;
    _stats.criticalDates += criticalDates;
    _stats.runs          += 1;
    _lastRun              = new Date().toISOString();
    _history.unshift({ runAt: _lastRun, reminders, reviews, criticalDates });
    if (_history.length > 10) _history.pop();

    const elapsed = Date.now() - start;
    log.info(`Automations done in ${elapsed}ms — reminders:${reminders} reviews:${reviews} criticalDates:${criticalDates}`);
  } catch (e) {
    log.error('Automation run error', { error: e.message });
  } finally {
    _running = false;
  }
}

function startCron(intervalMinutes = 30) {
  if (_interval) { log.warn('Cron already running'); return; }
  log.info(`Cron started — interval: ${intervalMinutes} min`);
  _warmupTimer = setTimeout(runAutomations, 60 * 1000);
  _interval = setInterval(runAutomations, intervalMinutes * 60 * 1000);
}

function stopCron() {
  if (_warmupTimer) { clearTimeout(_warmupTimer); _warmupTimer = null; }
  if (_interval) { clearInterval(_interval); _interval = null; log.info('Cron stopped'); }
}

function getCronStats() {
  return {
    running:  _running,
    lastRun:  _lastRun,
    uptime:   _interval ? 'active' : 'stopped',
    totals:   { ..._stats },
    lastRuns: _history.slice(),
  };
}

module.exports = { startCron, stopCron, runAutomations, getCronStats };
```

- [ ] **Step 2: Verify**

```bash
node -e "require('./src/scheduling/cron'); console.log('OK — cron loaded with critical dates');"
```

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/cron.js
git commit -m "feat(C): integrate checkAndSendCriticalDateReminders into cron runAutomations"
```

---

## Task 11: Add add_critical_date tool to ToolExecutor

**Files:**
- Modify: `src/tools/executor.js`

- [ ] **Step 1: Register `add_critical_date` in the handlers map (constructor)**

In `src/tools/executor.js`, update the constructor's `this.handlers` block:

```js
  constructor() {
    this.handlers = {
      check_availability:  this.checkAvailability.bind(this),
      book_appointment:    this.bookAppointment.bind(this),
      cancel_appointment:  this.cancelAppointment.bind(this),
      lookup_appointments: this.lookupAppointments.bind(this),
      get_services:        this.getServices.bind(this),
      add_critical_date:   this.addCriticalDate.bind(this),
    };
  }
```

- [ ] **Step 2: Add `addCriticalDate()` method (after `getServices()`)**

```js
  addCriticalDate(args, assistantId, context = {}) {
    const businessId = assistantId || 'demo';
    try {
      const { criticalDatesStore } = require('../scheduling/critical-dates');
      const entry = criticalDatesStore.add({
        businessId,
        clientName:  args.client_name,
        clientEmail: args.client_email  || null,
        clientPhone: args.client_phone  || null,
        type:        args.type,
        dueDate:     args.due_date,
        notes:       args.notes         || null,
        advanceDays: [30, 15, 7],
      });
      log.info(`add_critical_date: saved ${entry.type} for ${entry.clientName} on ${entry.dueDate}`);
      return { success: true, id: entry.id, message: `Fecha crítica registrada: ${entry.type} el ${entry.dueDate}. El cliente recibirá recordatorios automáticos.` };
    } catch (e) {
      log.warn(`add_critical_date failed: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
```

- [ ] **Step 3: Add `add_critical_date` to `DEFINITIONS` in `toOpenAITools()`**

In the `DEFINITIONS` object inside `toOpenAITools()`, add after the existing tools:

```js
      add_critical_date: {
        type: 'function',
        function: {
          name: 'add_critical_date',
          description: 'Registra una fecha crítica del cliente para enviarle recordatorios automáticos (ITV, vacuna, declaración de renta, revisión, etc.)',
          parameters: {
            type: 'object',
            properties: {
              client_name:  { type: 'string',  description: 'Nombre completo del cliente o dueño de la mascota' },
              client_email: { type: 'string',  description: 'Email del cliente para los recordatorios' },
              client_phone: { type: 'string',  description: 'Teléfono del cliente' },
              type:         { type: 'string',  description: 'Tipo de fecha: itv_expiry | vaccine_due | service_due | tax_filing | quarterly_vat | prescription_renewal | membership_renewal | exam_date | enrollment_deadline | contract_expiry | birthday | anniversary | annual_checkup | deworming | insurance_renewal | annual_accounts' },
              due_date:     { type: 'string',  description: 'Fecha de vencimiento en formato YYYY-MM-DD' },
              notes:        { type: 'string',  description: 'Notas adicionales, p.ej. "ITV furgoneta Renault Trafic matrícula 1234ABC"' },
            },
            required: ['client_name', 'type', 'due_date'],
          },
        },
      },
```

- [ ] **Step 4: Verify**

```bash
node -e "
const { ToolExecutor } = require('./src/tools/executor');
const te = new ToolExecutor();
te.execute('add_critical_date', { client_name: 'Ana Lopez', type: 'itv_expiry', due_date: '2026-11-30', notes: 'Ford Focus', client_email: 'ana@test.com' }, 'demo').then(r => {
  console.log('result:', JSON.stringify(r));
});
"
```

Expected: `result: {"success":true,"id":"<uuid>","message":"Fecha crítica registrada..."}`

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.js
git commit -m "feat(C): add add_critical_date tool to ToolExecutor"
```

---

## Task 12: Create routes-critical-dates.js (System C API)

**Files:**
- Create: `src/api/routes-critical-dates.js`

- [ ] **Step 1: Create the file**

```js
// ============================================
// NodeFlow — Critical Dates API Routes (System C)
// POST   /api/critical-dates          — apiKey or session
// GET    /api/critical-dates/:bizId   — admin
// DELETE /api/critical-dates/:id      — admin
// PATCH  /api/critical-dates/:id      — admin
// ============================================

const express  = require('express');
const router   = express.Router();
const { criticalDatesStore } = require('../scheduling/critical-dates');
const { Logger } = require('../utils/logger');

const log = new Logger('ROUTES-CRIT-DATES');

// ── Simple api-key auth middleware (same pattern as other routes) ──────────────
function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.INTERNAL_API_KEY || process.env.ADMIN_SECRET;
  if (!validKey || key === validKey) return next(); // if no key configured, allow all
  // Also accept session cookie via verifySessionToken
  try {
    const { verifySessionToken } = require('./routes-auth');
    const token = req.cookies?.[process.env.SESSION_KEY || 'nf_session'] || req.headers.authorization?.replace('Bearer ', '');
    if (token && verifySessionToken(token)) return next();
  } catch(_) {}
  return res.status(401).json({ error: 'Unauthorized' });
}

// POST /api/critical-dates — add a new critical date entry
// Used by: ToolExecutor (add_critical_date tool callback), admin panel
router.post('/', apiKeyAuth, (req, res) => {
  const { businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays } = req.body;
  if (!businessId || !clientName || !type || !dueDate) {
    return res.status(400).json({ error: 'businessId, clientName, type and dueDate are required' });
  }
  try {
    const entry = criticalDatesStore.add({ businessId, clientName, clientEmail, clientPhone, type, dueDate, notes, advanceDays });
    log.info(`POST /api/critical-dates: added ${type} for ${clientName} (biz:${businessId})`);
    return res.json({ ok: true, entry });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// GET /api/critical-dates/:businessId — list all active dates for a business
router.get('/:businessId', apiKeyAuth, (req, res) => {
  const entries = criticalDatesStore.getByBusiness(req.params.businessId);
  return res.json({ ok: true, count: entries.length, entries });
});

// DELETE /api/critical-dates/:id — deactivate an entry
router.delete('/:id', apiKeyAuth, (req, res) => {
  const ok = criticalDatesStore.deactivate(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Entry not found' });
  return res.json({ ok: true });
});

// PATCH /api/critical-dates/:id — update dueDate or notes
router.patch('/:id', apiKeyAuth, (req, res) => {
  const entry = criticalDatesStore.getById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const { dueDate, notes, advanceDays } = req.body;
  if (dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD' });
    entry.dueDate = dueDate;
    entry.sentReminders = []; // reset sent reminders on date change
  }
  if (notes !== undefined) entry.notes = notes;
  if (advanceDays) entry.advanceDays = advanceDays;
  return res.json({ ok: true, entry });
});

module.exports = router;
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./src/api/routes-critical-dates'); console.log('OK — routes loaded');"
```

- [ ] **Step 3: Commit**

```bash
git add src/api/routes-critical-dates.js
git commit -m "feat(C): add routes-critical-dates.js — POST/GET/DELETE/PATCH"
```

---

## Task 13: Wire everything into server.js + load from DB

**Files:**
- Modify: `server.js`

Find where `startCron()` is called in server.js (after other startup calls). Also find where routes are mounted.

- [ ] **Step 1: Find the startup section in server.js**

```bash
grep -n "startCron\|loadFromDB\|setupAdmin\|setupFlows\|criticalDates\|rebooking" src/scheduling/cron.js server.js 2>/dev/null | head -20
```

Note the line numbers. `startCron` is likely called at bottom of server.js.

- [ ] **Step 2: Add rebooking cron + critical dates loading to startup**

In `server.js`, find where `startCron()` is called. Add after it:

```js
// System B: daily re-booking cron
const { startRebookingCron }  = require('./src/scheduling/rebooking-cron');
startRebookingCron();

// System C: load critical dates from Supabase on startup
const { criticalDatesStore }  = require('./src/scheduling/critical-dates');
criticalDatesStore.loadFromDB().catch(e => console.warn('Critical dates DB load failed:', e.message));
```

- [ ] **Step 3: Mount critical-dates routes in server.js**

Find where other API routes are mounted (e.g., `app.use('/api', routes)` or `setupAdminRoutes(app, ...)`). Add:

```js
// Critical dates API (System C)
const criticalDatesRouter = require('./src/api/routes-critical-dates');
app.use('/api/critical-dates', criticalDatesRouter);
```

Add this before the catch-all / 404 handler.

- [ ] **Step 4: Verify server starts without errors**

```bash
node -e "
// Quick require chain test — don't actually start server
require('./src/scheduling/rebooking-cron');
require('./src/scheduling/critical-dates');
require('./src/api/routes-critical-dates');
require('./src/automations/post-call-handler');
console.log('All new modules load without errors');
"
```

Expected: `All new modules load without errors`

- [ ] **Step 5: Full server start smoke test**

```bash
node server.js &
sleep 3
# Test critical dates endpoint
curl -s http://localhost:3000/api/critical-dates/demo-clinic -H "x-api-key: any" | head -c 100
# Kill server
kill %1
```

Expected: `{"ok":true,"count":0,"entries":[]}`

- [ ] **Step 6: Commit and push**

```bash
git add server.js
git commit -m "feat(A+B+C): wire rebooking cron, critical dates load, and routes into server.js"
git push origin master
```

---

## Self-Review

**Spec coverage:**
- ✅ System A — post-call handler in `endCall()` (Task 4)
- ✅ System A — session outcome + `_deriveOutcome()` (Task 1)
- ✅ System A — booking confirmation email to client (Task 3)
- ✅ System A — owner summary email (Task 3)
- ✅ System A — WhatsApp owner alert on booking (Task 4)
- ✅ System A — follow-up email for info calls, 30 min delay (Task 4)
- ✅ System A — context passed to executor to stamp session (Task 2)
- ✅ System B — rebooking DEFAULTS in FlowManager (Task 5)
- ✅ System B — sector thresholds in rebooking-cron (Task 7, REBOOKING_DEFAULTS)
- ✅ System B — anti-spam Map + annual cap (Task 7)
- ✅ System B — trilingüe rebooking email (Task 6)
- ✅ System B — daily 10:00 cron (Task 7)
- ✅ System C — CriticalDatesStore with all date types (Task 8)
- ✅ System C — Supabase persistence (Task 8 `_persist` + `loadFromDB`)
- ✅ System C — `add_critical_date` tool in executor (Task 11)
- ✅ System C — `checkAndSendCriticalDateReminders()` in cron (Task 10)
- ✅ System C — urgency-aware reminder email 30/15/7d (Task 9)
- ✅ System C — REST API routes POST/GET/DELETE/PATCH (Task 12)
- ✅ server.js wiring (Task 13)

**Missing from spec but needed:** `scheduler.getAppointments(businessId)` — addressed in Task 7 Step 2.

**Type consistency check:**
- `sendBookingConfirmationEmail(appointment, config)` — used consistently in Tasks 3 and 4 ✅
- `sendCallSummaryToOwner(callData, config)` — consistent ✅
- `sendCriticalDateReminder(entry, daysUntilDue, config)` — consistent in Tasks 9 and 10 ✅
- `criticalDatesStore.add({...})` / `.markSent(id, day)` / `.getAll()` — consistent Tasks 8, 10, 11 ✅
- `postCallHandler.handle(callData)` — consistent Tasks 4 and voice-pipeline ✅
- `checkAndSendRebookings()` — returns number, used in Task 7 standalone; not integrated into main cron (rebooking has its own 10:00 cron, separate from the 30-min reminders cron) ✅

**No placeholders found.**
