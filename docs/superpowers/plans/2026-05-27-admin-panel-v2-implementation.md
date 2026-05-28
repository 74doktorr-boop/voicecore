# Admin Panel v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all admin panel v2 improvements from the approved spec: bug fixes, KPI expansion, magic link action, analytics tab, cron history, and new Llamadas tab.

**Architecture:** Backend changes to `routes-admin.js` and `cron.js` first (Tasks 1–6), then all frontend changes to `public/admin/index.html` (Tasks 7–12), then deploy.

**Tech Stack:** Node.js/Express backend, vanilla JS + HTML frontend, Supabase DB, in-memory analytics singleton (`getAnalytics()`).

---

### Task 1: Fix MRR calculation bug in routes-admin.js

**Files:**
- Modify: `src/api/routes-admin.js:87`

The MRR calc currently uses `plan === 'pro' ? 49 : plan === 'business' ? 99 : 0`. Actual plans in DB are `negocio`=49€ and `pro`=99€. The `business` plan does not exist in production.

- [ ] **Step 1: Fix MRR calculation on line 87**

Replace the wrong ternary:
```js
// BEFORE (line 87)
return sum + (o.plan === 'pro' ? 49 : o.plan === 'business' ? 99 : 0);

// AFTER
return sum + (o.plan === 'negocio' ? 49 : o.plan === 'pro' ? 99 : 0);
```

- [ ] **Step 2: Commit**
```bash
git add src/api/routes-admin.js
git commit -m "fix: correct MRR calculation — negocio=49 pro=99"
```

---

### Task 2: Expand /api/admin/stats with new KPIs

**Files:**
- Modify: `src/api/routes-admin.js`

Add `leadsThisMonth`, fix `totalMinutes` (was summing all orgs, should be activeOrgs only), add `callsToday` from analytics engine.

- [ ] **Step 1: Add import for getAnalytics at top of routes-admin.js**

After line 4 (`const { getDatabase } = require('../db/database');`), add:
```js
const { getAnalytics } = require('../analytics/engine');
```

- [ ] **Step 2: Replace the entire /api/admin/stats handler**

Replace the current handler (lines 74–103) with:
```js
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const db = getDatabase();
    if (!db.enabled) return res.json({ totalLeads: 0, totalOrgs: 0, mrr: 0, totalMinutes: 0, leadsThisMonth: 0, callsToday: 0 });

    const [regRes, orgsRes] = await Promise.all([
      db.client.from('registros').select('id, status, plan, created_at', { count: 'exact' }),
      db.client.from('organizations').select('id, plan, monthly_minutes_used, is_active', { count: 'exact' }),
    ]);

    const orgs      = orgsRes.data || [];
    const regs      = regRes.data  || [];
    const activeOrgs = orgs.filter(o => o.is_active);
    const mrr = activeOrgs.reduce((sum, o) => {
      return sum + (o.plan === 'negocio' ? 49 : o.plan === 'pro' ? 99 : 0);
    }, 0);
    const totalMinutes = activeOrgs.reduce((sum, o) => sum + parseFloat(o.monthly_minutes_used || 0), 0);

    // Leads this month
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0);
    const leadsThisMonth = regs.filter(r => new Date(r.created_at) >= firstOfMonth).length;

    // Calls today from analytics engine
    const analytics   = getAnalytics();
    const dashboard   = analytics.getDashboard();
    const callsToday  = dashboard.today.calls;

    res.json({
      totalLeads:   regRes.count  || 0,
      activeLeads:  regs.filter(r => r.status === 'active').length,
      totalOrgs:    orgsRes.count || 0,
      activeOrgs:   activeOrgs.length,
      mrr,
      totalMinutes: totalMinutes.toFixed(1),
      leadsThisMonth,
      callsToday,
    });
  } catch (e) {
    log.error('Admin stats error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Commit**
```bash
git add src/api/routes-admin.js
git commit -m "feat: expand /api/admin/stats with leadsThisMonth, callsToday, fix totalMinutes"
```

---

### Task 3: Add POST /api/admin/send-magic-link endpoint

**Files:**
- Modify: `src/api/routes-admin.js`

- [ ] **Step 1: Add imports for generateMagicToken and sendMagicLinkEmail**

At the top of `routes-admin.js`, the file already imports `verifySessionToken` from routes-auth. Update that import line to also include `generateMagicToken`:

```js
// BEFORE
const { verifySessionToken } = require('./routes-auth');

// AFTER
const { verifySessionToken, generateMagicToken } = require('./routes-auth');
```

Then add the email import (add after the existing imports near the top):
```js
const { sendMagicLinkEmail } = require('../notifications/email');
```

- [ ] **Step 2: Add the new endpoint after the /api/admin/orgs/:id route**

After the `app.get('/api/admin/orgs/:id', ...)` block (currently ending around line 158), insert:

```js
// ─── Send magic link to org owner ────────────────────────────────────────────
app.post('/api/admin/send-magic-link', adminAuth, async (req, res) => {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ error: 'orgId requerido' });

    const db = getDatabase();
    const { data: org } = await db.client
      .from('organizations').select('id, owner_email, name').eq('id', orgId).single();
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    const token = generateMagicToken(org.owner_email, orgId);
    await sendMagicLinkEmail(org.owner_email, token);

    log.info(`Magic link enviado a ${org.owner_email} para org ${orgId}`);
    res.json({ ok: true, sentTo: org.owner_email });
  } catch (e) {
    log.error('send-magic-link error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Commit**
```bash
git add src/api/routes-admin.js
git commit -m "feat: add POST /api/admin/send-magic-link endpoint"
```

---

### Task 4: Add GET /api/admin/calls endpoint

**Files:**
- Modify: `src/api/routes-admin.js`

- [ ] **Step 1: Add the endpoint after the send-magic-link block**

```js
// ─── Calls analytics dashboard ───────────────────────────────────────────────
app.get('/api/admin/calls', adminAuth, (req, res) => {
  try {
    const analytics = getAnalytics();
    res.json(analytics.getDashboard());
  } catch (e) {
    log.error('Admin calls error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Commit**
```bash
git add src/api/routes-admin.js
git commit -m "feat: add GET /api/admin/calls endpoint"
```

---

### Task 5: Add _history[] tracking to cron.js

**Files:**
- Modify: `src/scheduling/cron.js`

- [ ] **Step 1: Add _history array declaration**

After line 14 (`let _stats = { reminders: 0, reviews: 0, runs: 0 };`), add:
```js
let _history = [];   // last 10 runs: [{ runAt, reminders, reviews }]
```

- [ ] **Step 2: Record run in history inside runAutomations()**

After the lines that update `_stats` and `_lastRun` (after line 34 `_lastRun = new Date().toISOString();`), add:
```js
    _history.unshift({ runAt: _lastRun, reminders, reviews });
    if (_history.length > 10) _history.pop();
```

- [ ] **Step 3: Expose history in getCronStats()**

Replace the getCronStats function:
```js
function getCronStats() {
  return {
    running:  _running,
    lastRun:  _lastRun,
    uptime:   _interval ? 'active' : 'stopped',
    totals:   { ..._stats },
    lastRuns: _history.slice(),
  };
}
```

- [ ] **Step 4: Commit**
```bash
git add src/scheduling/cron.js
git commit -m "feat: add _history tracking to cron — lastRuns[] in getCronStats"
```

---

### Task 6: Expose lastRuns in /api/automations/stats

**Files:**
- Modify: `src/api/routes-automations.js`

The automations/stats endpoint already passes the full `getCronStats()` result as `cron` in the response. Since getCronStats() now returns `lastRuns`, this is automatically available as `cron.lastRuns` — no backend change needed.

- [ ] **Step 1: Verify the automations/stats route passes cron object directly**

Confirm that `routes-automations.js` has:
```js
res.json({
  cron: getCronStats(),
  ...
});
```
It does — `cron.lastRuns` will be in the response automatically. No change required.

---

### Task 7: Fix UI bugs in admin/index.html

**Files:**
- Modify: `public/admin/index.html`

Three bugs to fix:
1. Plan badge in `loadFlows()` — `f.plan==='business'` doesn't exist
2. Citas selector — static hardcoded options, must be dynamic
3. Flujos `switchTab` doesn't load orgs for citas selector

- [ ] **Step 1: Fix plan badge in loadFlows() — find and replace**

In the `loadFlows()` function (around line 510), replace:
```js
const plan=f.plan==='business'?'<span class="badge bp">Pro</span>':f.plan?`<span class="badge bg">${f.plan}</span>`:'<span class="badge bd">—</span>';
```
With:
```js
const plan=f.plan==='pro'?'<span class="badge bp">Pro 99€</span>':f.plan==='negocio'?'<span class="badge bg">Negocio 49€</span>':'<span class="badge bd">—</span>';
```

- [ ] **Step 2: Remove static options from citasBusiness select**

In the HTML (around line 227), replace:
```html
<select id="citasBusiness" onchange="loadCitas()">
  <option value="demo-clinic">Clínica Dental Demo</option>
  <option value="lumina-estetica">Lumina Estética</option>
</select>
```
With:
```html
<select id="citasBusiness" onchange="loadCitas()">
  <option value="">Cargando negocios…</option>
</select>
```

- [ ] **Step 3: Dynamically populate citasBusiness when switching to Citas tab**

In the `switchTab()` function, the `if(name==='citas') loadCitas();` line needs to also load orgs. Replace:
```js
if(name==='citas') loadCitas();
```
With:
```js
if(name==='citas') loadCitasOrgs().then(loadCitas);
```

- [ ] **Step 4: Add the loadCitasOrgs() function**

In the `<script>` block, before the `loadCitas()` function, add:
```js
async function loadCitasOrgs() {
  try {
    const data = await api('/api/admin/orgs');
    const sel  = document.getElementById('citasBusiness');
    const orgs = (data.orgs || []).filter(o => o.is_active);
    if (!orgs.length) {
      sel.innerHTML = '<option value="">Sin clientes activos aún</option>';
      return;
    }
    sel.innerHTML = orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  } catch(e) { console.error('loadCitasOrgs', e); }
}
```

- [ ] **Step 5: Commit**
```bash
git add public/admin/index.html
git commit -m "fix: admin panel — plan badge bug, dynamic citas selector"
```

---

### Task 8: Expand KPI grid to 8 cards (2 rows of 4)

**Files:**
- Modify: `public/admin/index.html`

Replace the 6-KPI single row with 8 KPIs in 2 rows of 4. Also update `loadStats()` to populate the 2 new KPIs.

- [ ] **Step 1: Replace the KPI grid HTML**

In `tab-resumen` (around lines 172–179), replace the entire `<div class="kpi-grid">`:
```html
<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
  <div class="kpi-card" style="--kpi-color:#a29bfe"><div class="kpi-label">MRR</div><div class="kpi-value" id="kMrr">—</div><div class="kpi-sub">ingresos recurrentes</div></div>
  <div class="kpi-card" style="--kpi-color:#6c5ce7"><div class="kpi-label">ARR</div><div class="kpi-value" id="kArr">—</div><div class="kpi-sub">anual estimado</div></div>
  <div class="kpi-card" style="--kpi-color:#00b894"><div class="kpi-label">Clientes activos</div><div class="kpi-value" id="kOrgs">—</div><div class="kpi-sub">organizaciones</div></div>
  <div class="kpi-card" style="--kpi-color:#00cec9"><div class="kpi-label">Conversión %</div><div class="kpi-value" id="kConv">—</div><div class="kpi-sub">leads → clientes</div></div>
</div>
<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-top:-4px">
  <div class="kpi-card" style="--kpi-color:#f9ca24"><div class="kpi-label">Leads este mes</div><div class="kpi-value" id="kLeadsMonth">—</div><div class="kpi-sub">nuevos registros</div></div>
  <div class="kpi-card" style="--kpi-color:#e17055"><div class="kpi-label">Minutos usados</div><div class="kpi-value" id="kMins">—</div><div class="kpi-sub">orgs activas este mes</div></div>
  <div class="kpi-card" style="--kpi-color:#fd79a8"><div class="kpi-label">Llamadas hoy</div><div class="kpi-value" id="kCallsToday">—</div><div class="kpi-sub">vía IA</div></div>
  <div class="kpi-card" style="--kpi-color:#74b9ff"><div class="kpi-label">Citas próximas</div><div class="kpi-value" id="kCitas">—</div><div class="kpi-sub">confirmadas</div></div>
</div>
```

Note: The old `kLeads`, `kReminders`, `kReviews` KPI cards are removed from the resumen grid (those metrics still exist in Automatizaciones tab). The `kLeads` total is now `kLeadsMonth`.

- [ ] **Step 2: Update loadStats() to populate new KPIs**

Replace the existing `loadStats()` function:
```js
async function loadStats() {
  try {
    const [adm,aut] = await Promise.all([api('/api/admin/stats'),api('/api/automations/stats')]);
    const mrr = adm.mrr || 0;
    const arr = mrr * 12;
    const conv = adm.totalLeads > 0 ? (adm.activeOrgs / adm.totalLeads * 100).toFixed(1) : '0.0';
    document.getElementById('kMrr').textContent       = '€'+(mrr).toLocaleString('es-ES');
    document.getElementById('kArr').textContent       = '€'+(arr).toLocaleString('es-ES');
    document.getElementById('kOrgs').textContent      = adm.activeOrgs??'—';
    document.getElementById('kConv').textContent      = conv+'%';
    document.getElementById('kLeadsMonth').textContent = adm.leadsThisMonth??'—';
    document.getElementById('kMins').textContent      = adm.totalMinutes??'—';
    document.getElementById('kCallsToday').textContent = adm.callsToday??'—';
    document.getElementById('kCitas').textContent     = aut.appointments?.upcoming??'—';
    document.getElementById('mrrBadge').textContent   = 'MRR: €'+(mrr).toLocaleString('es-ES');
  } catch(e){if(e.message!=='401')console.error(e);}
}
```

- [ ] **Step 3: Commit**
```bash
git add public/admin/index.html
git commit -m "feat: expand admin KPI grid to 8 cards — ARR, Conversión, Leads mes, Minutos, Llamadas hoy"
```

---

### Task 9: Tab Clientes — magic link action + minutes progress bar

**Files:**
- Modify: `public/admin/index.html`

New columns: Negocio · Email · Plan · Minutos (with progress bar) · Activo · Acciones

- [ ] **Step 1: Update the Clientes table header**

Replace:
```html
<thead><tr><th>Negocio</th><th>Email</th><th>Teléfono</th><th>Plan</th><th>Minutos</th><th>Activo</th><th>Desde</th></tr></thead>
```
With:
```html
<thead><tr><th>Negocio</th><th>Email</th><th>Plan</th><th>Minutos</th><th>Activo</th><th>Acciones</th></tr></thead>
```

- [ ] **Step 2: Add progress bar CSS to the `<style>` block**

Add before the closing `</style>` tag:
```css
.mins-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-top:5px;overflow:hidden}
.mins-bar-fill{height:100%;border-radius:2px;background:var(--green2);transition:width .4s}
.mins-bar-fill.warn{background:var(--yellow)}
.mins-bar-fill.danger{background:var(--red)}
```

- [ ] **Step 3: Replace loadOrgs() function**

Replace the current `loadOrgs()` function (lines 411–425):
```js
async function loadOrgs() {
  try {
    const data=await api('/api/admin/orgs');
    const rows=data.orgs||[];
    document.getElementById('orgsCount').textContent=rows.length+' organizaciones';
    const b=document.getElementById('orgsBody');
    if(!rows.length){b.innerHTML='<tr class="empty-row"><td colspan="6">Sin clientes aún</td></tr>';return;}
    b.innerHTML=rows.map(o=>{
      const plan=o.plan==='pro'?'<span class="badge bp">Pro 99€</span>':o.plan==='negocio'?'<span class="badge bg">Negocio 49€</span>':`<span class="badge bd">${o.plan||'—'}</span>`;
      const active=o.is_active?'<span class="badge bg">✓ Activo</span>':'<span class="badge br">Inactivo</span>';
      const used=parseFloat(o.monthly_minutes_used||0);
      const limit=parseFloat(o.monthly_minutes_limit||500);
      const pct=Math.min(100,Math.round(used/limit*100));
      const barClass=pct>=90?'danger':pct>=80?'warn':'';
      const minsCell=`<div>${used.toFixed(0)} / ${limit} min</div><div class="mins-bar"><div class="mins-bar-fill ${barClass}" style="width:${pct}%"></div></div>`;
      const titleAttr=o.phone?`title="${o.phone}"`:'';
      return `<tr>
        <td><strong ${titleAttr}>${o.name||'—'}</strong></td>
        <td style="color:var(--dim);font-size:12px">${o.owner_email||'—'}</td>
        <td>${plan}</td>
        <td>${minsCell}</td>
        <td>${active}</td>
        <td><button class="btn btn-g" style="font-size:11px;padding:4px 10px" onclick="sendMagicLink('${o.id}','${o.owner_email}',this)">🔗 Enviar acceso</button></td>
      </tr>`;
    }).join('');
  } catch(e){if(e.message!=='401')console.error(e);}
}
```

- [ ] **Step 4: Add sendMagicLink() function**

In the `<script>` block, after `loadOrgs()`, add:
```js
async function sendMagicLink(orgId, email, btn) {
  btn.disabled=true; btn.textContent='Enviando…';
  try {
    const r=await api('/api/admin/send-magic-link',{method:'POST',body:JSON.stringify({orgId})});
    if(r.ok) toast(`✓ Acceso enviado a ${r.sentTo}`);
    else toast('Error al enviar','err');
  } catch { toast('Error','err'); }
  finally { btn.disabled=false; btn.textContent='🔗 Enviar acceso'; }
}
```

- [ ] **Step 5: Commit**
```bash
git add public/admin/index.html
git commit -m "feat: Tab Clientes — magic link action, minutes progress bar, new columns"
```

---

### Task 10: Tab Flujos — waConfirm column + hours display

**Files:**
- Modify: `public/admin/index.html`

Add WA Confirm toggle column; show `Xh antes` / `Xh después` next to reminder/review badges.

- [ ] **Step 1: Update Flujos table header**

Replace:
```html
<thead><tr><th>Negocio</th><th>Plan</th><th>Sector</th><th>Reminders</th><th>Reseñas</th><th>Google Place ID</th><th>Acciones</th></tr></thead>
```
With:
```html
<thead><tr><th>Negocio</th><th>Plan</th><th>Reminders</th><th>Reseñas</th><th>WA Confirm</th><th>Google Place ID</th><th>Acciones</th></tr></thead>
```

- [ ] **Step 2: Update the flows row template inside loadFlows()**

Replace the `return` template literal block in `loadFlows()` (the one starting with `` return `<tr>`` around line 517):
```js
const waOn=f.automations?.waConfirm?.enabled!==false;
const waBadge=waOn?'<span class="badge bg">✓ WA</span>':'<span class="badge br">Off</span>';
const remHours=f.automations?.reminders?.hoursBefore!=null?` <span style="color:var(--dim);font-size:11px">${f.automations.reminders.hoursBefore}h antes</span>`:'';
const revHours=f.automations?.reviews?.hoursAfter!=null?` <span style="color:var(--dim);font-size:11px">${f.automations.reviews.hoursAfter}h después</span>`:'';
return `<tr>
  <td><strong>${f.name}</strong> ${langBadgeF}<br><span style="font-size:11px;color:var(--dim)">${f.ownerEmail||''}</span></td>
  <td>${plan}</td>
  <td>
    ${remBadge}${remHours}
    <button class="btn btn-d" style="margin-left:6px;padding:3px 8px;font-size:11px" onclick="toggleFlow('${f.businessId}','reminders',${remOn},this)">
      ${remOn?'Pausar':'Activar'}
    </button>
  </td>
  <td>
    ${revBadge}${revHours}
    <button class="btn btn-d" style="margin-left:6px;padding:3px 8px;font-size:11px" onclick="toggleFlow('${f.businessId}','reviews',${revOn},this)">
      ${revOn?'Pausar':'Activar'}
    </button>
  </td>
  <td>
    ${waBadge}
    <button class="btn btn-d" style="margin-left:6px;padding:3px 8px;font-size:11px" onclick="toggleFlow('${f.businessId}','waConfirm',${waOn},this)">
      ${waOn?'Pausar':'Activar'}
    </button>
  </td>
  <td>
    <input type="text" id="pid-${f.businessId}" value="${f.googlePlaceId||''}" placeholder="ChIJ…" style="background:rgba(255,255,255,0.04);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:6px;font-size:12px;width:140px">
    <button class="btn btn-d" style="padding:3px 8px;font-size:11px;margin-left:4px" onclick="savePlaceId('${f.businessId}')">Guardar</button>
  </td>
  <td style="display:flex;gap:6px;flex-wrap:wrap">
    <button class="btn btn-g" style="padding:4px 8px;font-size:11px" onclick="testFlow('${f.businessId}','reminder')">Test reminder</button>
    <button class="btn btn-y" style="padding:4px 8px;font-size:11px" onclick="testFlow('${f.businessId}','review')">Test reseña</button>
  </td>
</tr>`;
```

Note: these lines must go immediately before the `return` in the `flows.map(f => {...})` arrow function, replacing the existing `const waOn` / `const waBadge` lines (which don't exist yet) plus the existing `return` template.

- [ ] **Step 3: Commit**
```bash
git add public/admin/index.html
git commit -m "feat: Tab Flujos — WA Confirm toggle, hours display"
```

---

### Task 11: Tab Automatizaciones — run history table

**Files:**
- Modify: `public/admin/index.html`

Add "Últimas ejecuciones" table below the existing stats. The data comes from `cron.lastRuns[]` which is now in `getCronStats()`.

- [ ] **Step 1: Add history table HTML after the stats table in tab-automatizaciones**

After the existing `<div class="table-wrap">...</div>` in `tab-automatizaciones` (the one with `id="autoHistory"`), add:
```html
<div class="section-hd" style="margin-top:24px"><h2>Últimas ejecuciones</h2></div>
<div class="table-wrap">
  <table>
    <thead><tr><th>Fecha / Hora</th><th>Reminders enviados</th><th>Reseñas enviadas</th></tr></thead>
    <tbody id="cronHistory"><tr class="empty-row"><td colspan="3">Cargando…</td></tr></tbody>
  </table>
</div>
```

- [ ] **Step 2: Update loadAutoStats() to populate cronHistory**

In `loadAutoStats()`, after the existing `autoHistory` rendering block, add:
```js
const runs=cron?.lastRuns||[];
const ch=document.getElementById('cronHistory');
if(!runs.length){ch.innerHTML='<tr class="empty-row"><td colspan="3">Sin ejecuciones aún en esta sesión</td></tr>';}
else{ch.innerHTML=runs.map(r=>`<tr><td>${new Date(r.runAt).toLocaleString('es-ES')}</td><td>${r.reminders}</td><td>${r.reviews}</td></tr>`).join('');}
```

- [ ] **Step 3: Commit**
```bash
git add public/admin/index.html
git commit -m "feat: Tab Automatizaciones — últimas ejecuciones history table"
```

---

### Task 12: New Tab Llamadas

**Files:**
- Modify: `public/admin/index.html`

Add a new "📞 Llamadas" tab with 3 KPI cards and a table of the last 50 calls.

- [ ] **Step 1: Add tab button to nav**

In the `<nav>` block, after the Flujos tab button, add:
```html
<button class="nav-tab" onclick="switchTab('llamadas',this)">📞 Llamadas</button>
```

- [ ] **Step 2: Add tab panel HTML before the closing `</main>` tag**

Before `</main>`, add:
```html
<!-- Llamadas -->
<div class="tab-panel" id="tab-llamadas">
  <div class="section-hd">
    <div><h2>Llamadas IA</h2><p>Datos en memoria — se reinician con el servidor</p></div>
    <button class="refresh-btn" onclick="loadCalls()">↻ Actualizar</button>
  </div>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
    <div class="kpi-card" style="--kpi-color:#fd79a8"><div class="kpi-label">Llamadas hoy</div><div class="kpi-value" id="cCallsToday">—</div><div class="kpi-sub">en lo que va del día</div></div>
    <div class="kpi-card" style="--kpi-color:#a29bfe"><div class="kpi-label">Minutos hoy</div><div class="kpi-value" id="cMinsToday">—</div><div class="kpi-sub">tiempo de IA</div></div>
    <div class="kpi-card" style="--kpi-color:#00b894"><div class="kpi-label">Llamadas este mes</div><div class="kpi-value" id="cCallsMonth">—</div><div class="kpi-sub">acumulado mes</div></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Hora</th><th>Duración</th><th>Sentimiento</th><th>Resultado</th><th>Latencia avg</th><th>Herramientas</th></tr></thead>
      <tbody id="callsBody"><tr class="empty-row"><td colspan="6">Cargando…</td></tr></tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 3: Wire up switchTab for llamadas**

In the `switchTab()` function, add:
```js
if(name==='llamadas') loadCalls();
```

- [ ] **Step 4: Add loadCalls() function**

In the `<script>` block, after `loadAutoStats()`, add:
```js
async function loadCalls(){
  try{
    const d=await api('/api/admin/calls');
    document.getElementById('cCallsToday').textContent=d.today?.calls??0;
    document.getElementById('cMinsToday').textContent=(d.today?.minutes??0).toFixed(1);
    document.getElementById('cCallsMonth').textContent=d.thisMonth?.calls??0;
    const calls=(d.recentCalls||[]).slice(0,50);
    const b=document.getElementById('callsBody');
    if(!calls.length){b.innerHTML='<tr class="empty-row"><td colspan="6">Sin llamadas registradas en esta sesión</td></tr>';return;}
    const sentEmoji=s=>s==='positive'?'😊 positivo':s==='negative'?'😔 negativo':'😐 neutral';
    const fmtDur=s=>{const m=Math.floor(s/60);const sec=s%60;return m?`${m}m ${sec}s`:`${sec}s`;};
    b.innerHTML=calls.map(c=>{
      const hora=c.startedAt?new Date(c.startedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'—';
      return `<tr>
        <td>${hora}</td>
        <td>${fmtDur(c.duration||0)}</td>
        <td style="font-size:13px">${sentEmoji(c.sentiment)}</td>
        <td><span class="badge ${c.outcome==='booked'?'bg':c.outcome==='completed'?'bd':'br'}">${c.outcome||'—'}</span></td>
        <td>${c.avgLatency?c.avgLatency+'ms':'—'}</td>
        <td style="text-align:center">${c.toolsUsed||0}</td>
      </tr>`;
    }).join('');
  }catch(e){if(e.message!=='401')console.error(e);}
}
```

- [ ] **Step 5: Commit**
```bash
git add public/admin/index.html
git commit -m "feat: new Tab Llamadas — KPIs + call log table"
```

---

### Task 13: Deploy and smoke tests

**Files:** none — deploy only

- [ ] **Step 1: Push to master**
```bash
git push origin master
```
Wait ~90 seconds for GitHub Actions → GHCR → EasyPanel deploy.

- [ ] **Step 2: Smoke test backend endpoints**
```bash
# Get admin token first (replace PASSWORD)
TOKEN=$(curl -s -X POST https://voicecore.nodeflow.es/api/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"password":"PASSWORD"}' | jq -r .token)

# Test expanded stats
curl -s -H "Authorization: Bearer $TOKEN" https://voicecore.nodeflow.es/api/admin/stats | jq '{mrr,leadsThisMonth,callsToday,totalMinutes}'

# Test calls endpoint
curl -s -H "Authorization: Bearer $TOKEN" https://voicecore.nodeflow.es/api/admin/calls | jq '{today,thisMonth}'

# Test automations stats has lastRuns
curl -s -H "Authorization: Bearer $TOKEN" https://voicecore.nodeflow.es/api/automations/stats | jq '.cron.lastRuns'
```

- [ ] **Step 3: Open admin panel and verify visually**

Navigate to `https://voicecore.nodeflow.es/admin` and check:
- 8 KPI cards in 2 rows of 4
- Clientes tab: progress bars on minutes, 🔗 Enviar acceso button
- Flujos tab: WA Confirm column present, hours shown
- Automatizaciones tab: "Últimas ejecuciones" table (will show empty until cron runs)
- Llamadas tab present in nav, loads without error

- [ ] **Step 4: Test send-magic-link (optional, requires an org in DB)**

From admin panel, click "🔗 Enviar acceso" for a client and verify toast shows "✓ Acceso enviado a email@..."

---

## Self-Review

**Spec coverage:**
- ✅ Bug 1: MRR calculation — Task 1 + Task 2
- ✅ Bug 2: Citas selector dynamic — Task 7
- ✅ Bug 3: Plan 'business' ghost in Flujos — Task 7
- ✅ KPIs 8 cards — Task 8
- ✅ Tab Clientes actions + bars — Task 9
- ✅ Tab Citas dynamic selector — Task 7
- ✅ Tab Flujos waConfirm + hours — Task 10
- ✅ Tab Automatizaciones history — Task 11 (uses cron.js changes from Task 5)
- ✅ Tab Llamadas — Task 12
- ✅ send-magic-link endpoint — Task 3
- ✅ GET /api/admin/calls endpoint — Task 4
- ✅ _history[] in cron.js — Task 5
- ✅ lastRuns in automations/stats — Task 6 (automatic via getCronStats)

**Placeholder scan:** None found — all code is complete.

**Type consistency:**
- `generateMagicToken(email, orgId)` — matches export from routes-auth.js ✅
- `sendMagicLinkEmail(email, token)` — matches export from email.js ✅  
- `getAnalytics()` → `getDashboard()` → `{today: {calls}, thisMonth, recentCalls}` — matches engine.js ✅
- `getCronStats()` now returns `lastRuns` array used in Task 11 frontend ✅
- New KPI element IDs (`kArr`, `kConv`, `kLeadsMonth`, `kMins`, `kCallsToday`) match loadStats() ✅
