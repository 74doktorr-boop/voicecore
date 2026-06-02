# Sector Onboarding Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent blue banner to the Seguimientos section that opens a modal wizard guiding the business owner to fill in sector-specific data (ITV dates, pet names, renewal dates, etc.) for contacts that are missing it — unlocking lifecycle reminders for those contacts.

**Architecture:** Three-layer build: (1) pure utility module `sector-fields.js` defines required fields per sector and computes completion status; (2) new API endpoint `/api/portal/contacts/sector-completion` queries all contacts and returns their completion status using that utility; (3) portal UI adds a banner + modal wizard that saves via the existing `PUT /contacts/:id/sector-data` endpoint.

**Tech Stack:** Node.js (CommonJS), Express, Supabase, vanilla JS (ES5, `var`), existing `openModal()` / `api()` portal helpers.

**Spec:** `docs/superpowers/specs/2026-06-02-sector-onboarding-wizard-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/lifecycle/sector-fields.js` | **New** — SECTOR_REQUIRED_FIELDS + getCompletionStatus() |
| `scripts/test-sector-fields.js` | **New** — unit tests for getCompletionStatus |
| `src/api/routes-portal.js` | **Modify** — add GET /contacts/sector-completion BEFORE existing :id routes |
| `public/portal/index.html` | **Modify** — add `<div id="wizard-banner">` inside sec-seguimientos |
| `public/portal/portal.js` | **Modify** — add checkSectorBanner + wizard modal functions |

---

## Task 1: Sector Fields Utility Module

**Files:**
- Create: `src/lifecycle/sector-fields.js`
- Create: `scripts/test-sector-fields.js`

- [ ] **Step 1: Create sector-fields.js**

Create `src/lifecycle/sector-fields.js`:

```javascript
// ============================================================
// NodeFlow — Sector Required Fields (Lifecycle Wizard)
// Defines which sector_data fields must be filled per sector
// for lifecycle reminders to work. Pure data + logic, no I/O.
// ============================================================

const SECTOR_REQUIRED_FIELDS = {
  taller: [
    { key: 'matricula',               label: 'Matrícula',                  type: 'text',   placeholder: 'ej. 1234 ABC' },
    { key: 'fecha_ultimo_aceite',     label: 'Último cambio de aceite',    type: 'date',   placeholder: 'dd/mm/aaaa' },
    { key: 'fecha_vencimiento_itv',   label: 'ITV vence',                  type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  veterinaria: [
    { key: 'nombre_mascota',          label: 'Nombre de la mascota',       type: 'text',   placeholder: 'ej. Tobi' },
    { key: 'fecha_proxima_vacuna',    label: 'Próxima vacuna',             type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  gimnasio: [
    { key: 'fecha_vencimiento_cuota', label: 'Cuota vence',                type: 'date',   placeholder: 'dd/mm/aaaa' },
  ],
  fisioterapia: [
    { key: 'fecha_alta',              label: 'Fecha de alta',              type: 'date',   placeholder: 'dd/mm/aaaa',  optional: true },
  ],
  psicologia: [
    { key: 'frecuencia_sesiones',     label: 'Frecuencia sesiones (días)', type: 'number', placeholder: 'ej. 14' },
  ],
  optica: [
    { key: 'suministro_lentillas_dias', label: 'Días de lentillas',        type: 'number', placeholder: 'ej. 90' },
  ],
  hotel: [
    { key: 'fecha_aniversario',       label: 'Aniversario (MM-DD)',        type: 'text',   placeholder: 'ej. 06-15' },
    { key: 'fecha_cumpleanos',        label: 'Cumpleaños (MM-DD)',         type: 'text',   placeholder: 'ej. 03-22',   optional: true },
  ],
  academia: [
    { key: 'fecha_fin_curso',         label: 'Fin de curso',               type: 'date',   placeholder: 'dd/mm/aaaa' },
  ],
};

/**
 * Get completion status for a contact's sector_data.
 *
 * A contact is 'complete' when all non-optional fields are filled.
 * A contact is 'partial' when some but not all non-optional fields are filled.
 * A contact is 'empty' when zero non-optional fields are filled.
 * Returns 'no_fields' for sectors with no required manual fields (peluqueria, dental, etc.)
 *
 * @param {string} sectorSlug - e.g. 'taller', 'veterinaria'
 * @param {object|null} sectorData - contact's sector_data from DB (may be null/undefined)
 * @returns {{ status: 'complete'|'partial'|'empty'|'no_fields', missing: string[] }}
 */
function getCompletionStatus(sectorSlug, sectorData) {
  var fields = SECTOR_REQUIRED_FIELDS[sectorSlug];
  if (!fields || fields.length === 0) return { status: 'no_fields', missing: [] };

  var data     = sectorData || {};
  var required = fields.filter(function(f) { return !f.optional; });
  var missing  = required.filter(function(f) {
    var v = data[f.key];
    return v === undefined || v === null || String(v).trim() === '';
  });

  if (missing.length === 0)              return { status: 'complete', missing: [] };
  if (missing.length < required.length)  return { status: 'partial',  missing: missing.map(function(f) { return f.key; }) };
  return                                        { status: 'empty',    missing: missing.map(function(f) { return f.key; }) };
}

module.exports = { SECTOR_REQUIRED_FIELDS, getCompletionStatus };
```

- [ ] **Step 2: Create the test script**

Create `scripts/test-sector-fields.js`:

```javascript
const { SECTOR_REQUIRED_FIELDS, getCompletionStatus } = require('../src/lifecycle/sector-fields');

var pass = 0, fail = 0;
function check(label, condition, details) {
  if (condition) { console.log('✅', label); pass++; }
  else { console.error('❌', label, details || ''); fail++; }
}

// 1. Complete taller — has both required fields
var r1 = getCompletionStatus('taller', { matricula: '1234 ABC', fecha_ultimo_aceite: '2026-03-12' });
check('taller complete',           r1.status === 'complete',  JSON.stringify(r1));
check('taller complete no missing', r1.missing.length === 0,  JSON.stringify(r1));

// 2. Empty taller — no fields at all
var r2 = getCompletionStatus('taller', {});
check('taller empty',              r2.status === 'empty',           JSON.stringify(r2));
check('taller empty has matricula', r2.missing.includes('matricula'), JSON.stringify(r2));

// 3. Partial taller — has matricula but missing aceite
var r3 = getCompletionStatus('taller', { matricula: '1234 ABC' });
check('taller partial',            r3.status === 'partial', JSON.stringify(r3));
check('taller partial missing aceite', r3.missing.includes('fecha_ultimo_aceite'), JSON.stringify(r3));

// 4. Optional field (ITV) does NOT affect complete status
var r4 = getCompletionStatus('taller', { matricula: '1234', fecha_ultimo_aceite: '2026-01-01' });
check('taller complete without optional ITV', r4.status === 'complete', JSON.stringify(r4));

// 5. Sector with no required fields → no_fields
var r5 = getCompletionStatus('peluqueria', { tipo_servicio_habitual: 'corte' });
check('peluqueria no_fields',      r5.status === 'no_fields', JSON.stringify(r5));

// 6. Unknown sector → no_fields
var r6 = getCompletionStatus('restaurante', {});
check('unknown sector no_fields',  r6.status === 'no_fields', JSON.stringify(r6));

// 7. null sector_data
var r7 = getCompletionStatus('gimnasio', null);
check('null sector_data empty',    r7.status === 'empty', JSON.stringify(r7));

// 8. veterinaria complete (nombre_mascota required; vacuna optional)
var r8 = getCompletionStatus('veterinaria', { nombre_mascota: 'Tobi' });
check('veterinaria complete without optional vacuna', r8.status === 'complete', JSON.stringify(r8));

// 9. All sectors defined
var sectors = ['taller','veterinaria','gimnasio','fisioterapia','psicologia','optica','hotel','academia'];
sectors.forEach(function(s) {
  check('sector ' + s + ' defined in SECTOR_REQUIRED_FIELDS', !!SECTOR_REQUIRED_FIELDS[s]);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3: Run the test (expect all pass)**

```bash
node scripts/test-sector-fields.js
```

Expected output: all `✅` lines, `"X passed, 0 failed"`.

- [ ] **Step 4: Verify module loads cleanly**

```bash
node -e "const sf = require('./src/lifecycle/sector-fields'); console.log('sectors:', Object.keys(sf.SECTOR_REQUIRED_FIELDS).length, '✅')"
```

Expected: `sectors: 8 ✅`

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle/sector-fields.js scripts/test-sector-fields.js
git commit -m "feat(wizard): add sector-fields utility (SECTOR_REQUIRED_FIELDS + getCompletionStatus)"
```

---

## Task 2: API Endpoint — GET /api/portal/contacts/sector-completion

**Files:**
- Modify: `src/api/routes-portal.js` (insert before line ~757, the `// Lifecycle: Contact Sector Data` comment)

> ⚠️ This endpoint MUST be registered BEFORE the existing `app.get('/api/portal/contacts/:id/sector-data', ...)`. Express matches routes top-to-bottom — if `:id` comes first, `sector-completion` gets matched as a contact ID and returns 404.

- [ ] **Step 1: Verify the insertion point**

```bash
grep -n "Lifecycle: Contact Sector Data" src/api/routes-portal.js
```

Expected output: something like `757:  // ============================================================`

Note the line number — the new code goes IMMEDIATELY BEFORE that comment.

- [ ] **Step 2: Add the import for sector-fields at the top of routes-portal.js**

At the top of `src/api/routes-portal.js`, after the existing lifecycle imports (after the line importing `reminder-engine`), add:

```javascript
const { SECTOR_REQUIRED_FIELDS, getCompletionStatus } = require('../lifecycle/sector-fields');
```

- [ ] **Step 3: Add the new endpoint before the existing sector-data block**

Find `// ============================================================\n  // Lifecycle: Contact Sector Data` in `src/api/routes-portal.js`.

Insert this block IMMEDIATELY BEFORE that comment:

```javascript
  // ============================================================
  // Lifecycle: Sector Completion (wizard data)
  // ============================================================

  // IMPORTANT: This literal route must come BEFORE /contacts/:id/sector-data
  // to prevent Express matching 'sector-completion' as a contact :id
  app.get('/api/portal/contacts/sector-completion', portalAuth, async (req, res) => {
    try {
      const db    = getDatabase();
      const orgId = req.businessId;

      // Get org sector
      const { data: org, error: orgErr } = await db.client
        .from('organizations').select('sector').eq('id', orgId).maybeSingle();
      if (orgErr) return res.status(500).json({ error: orgErr.message });

      const sectorSlug = org?.sector || '';
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

```

- [ ] **Step 4: Verify the file still loads**

```bash
node -e "require('./src/api/routes-portal')" && echo "✅ routes-portal loads OK"
```

Expected: `✅ routes-portal loads OK`

- [ ] **Step 5: Commit**

```bash
git add src/api/routes-portal.js
git commit -m "feat(wizard): add GET /api/portal/contacts/sector-completion endpoint"
```

---

## Task 3: Portal Banner + Wizard Modal

**Files:**
- Modify: `public/portal/index.html` (add `<div id="wizard-banner">` inside `#sec-seguimientos`)
- Modify: `public/portal/portal.js` (add banner + wizard functions, update `loadSeguimientos`)

### Part A: index.html — add banner div

- [ ] **Step 1: Add the banner container to the Seguimientos section**

In `public/portal/index.html`, find the `#sec-seguimientos` section. It will look like:

```html
<section id="sec-seguimientos" class="section hidden">
  <div class="section-header">
    <h2>Seguimientos automáticos</h2>
    <p class="section-desc">Recordatorios programados para tus clientes</p>
  </div>

  <!-- Tabs -->
  <div class="tabs" ...>
```

Insert a `<div id="wizard-banner" style="display:none"></div>` BETWEEN the `</div>` closing the section-header and the `<!-- Tabs -->` comment:

```html
<section id="sec-seguimientos" class="section hidden">
  <div class="section-header">
    <h2>Seguimientos automáticos</h2>
    <p class="section-desc">Recordatorios programados para tus clientes</p>
  </div>

  <!-- Lifecycle wizard banner (populated by checkSectorBanner()) -->
  <div id="wizard-banner" style="display:none;margin-bottom:16px"></div>

  <!-- Tabs -->
  <div class="tabs" ...>
```

- [ ] **Step 2: Verify the HTML file is valid**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/portal/index.html','utf8');
console.assert(html.includes('wizard-banner'), 'wizard-banner div missing');
console.log('✅ wizard-banner div present');
"
```

Expected: `✅ wizard-banner div present`

### Part B: portal.js — functions

- [ ] **Step 3: Add the wizard state variable at the top of portal.js**

At the top of `public/portal/portal.js`, after the existing global state block (after `_currentSection`), add:

```javascript
var _wizardContacts = [];  // cache of contacts loaded for the wizard
var _wizardFields   = [];  // cache of sector fields for the wizard
var _wizardDone     = 0;   // count of saved+skipped contacts in current wizard session
```

- [ ] **Step 4: Update loadSeguimientos to call checkSectorBanner**

Find the existing `loadSeguimientos` function:

```javascript
async function loadSeguimientos() {
  // Wire up tab switching
  document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(btn) {
```

Replace the first line inside the function (`// Wire up tab switching`) to add the banner check FIRST:

```javascript
async function loadSeguimientos() {
  checkSectorBanner();  // Check if wizard banner should show (async, non-blocking)

  // Wire up tab switching
  document.querySelectorAll('#sec-seguimientos .tab-btn').forEach(function(btn) {
```

Note: `checkSectorBanner()` is called WITHOUT `await` — it runs in the background so it doesn't slow down loading the reminders list.

- [ ] **Step 5: Add all wizard functions after the closing of loadSeguimientos**

Find the end of `loadSeguimientos` function and add all the following functions immediately after it. Insert them BEFORE the `loadUpcomingReminders` function.

```javascript
// ── Sector Onboarding Wizard ──────────────────────────────────

/**
 * Check if the sector wizard banner should be shown.
 * Calls /sector-completion and renders/hides the banner.
 * Fire-and-forget — never blocks section loading.
 */
async function checkSectorBanner() {
  var bannerEl = document.getElementById('wizard-banner');
  if (!bannerEl) return;
  try {
    var data = await api('/api/portal/contacts/sector-completion');
    if (!data.wizardNeeded || data.pendingCount === 0) {
      bannerEl.style.display = 'none';
      return;
    }
    var n = data.pendingCount;
    bannerEl.innerHTML =
      '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px">' +
        '<div style="font-size:22px">💡</div>' +
        '<div style="flex:1">' +
          '<div style="font-weight:700;color:#1d4ed8;font-size:14px">Activa los recordatorios automáticos</div>' +
          '<div style="color:#3b82f6;font-size:13px;margin-top:2px">Completa los datos de ' + n + ' cliente' + (n !== 1 ? 's' : '') + ' para que el sistema empiece a funcionar</div>' +
        '</div>' +
        '<button onclick="openSectorWizard()" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Completar →</button>' +
      '</div>';
    bannerEl.style.display = 'block';
  } catch (e) {
    // Banner is optional — if it fails, just hide it silently
    bannerEl.style.display = 'none';
  }
}

/**
 * Open the sector data wizard modal.
 * Loads contacts from /sector-completion and renders the expandable list.
 */
async function openSectorWizard() {
  openModal('<div class="modal-title">Cargando datos...</div>');
  try {
    var data = await api('/api/portal/contacts/sector-completion');
    if (!data.wizardNeeded) { closeModal(); return; }

    _wizardContacts = data.contacts.slice(); // local copy
    _wizardFields   = data.fields;
    _wizardDone     = data.contacts.filter(function(c) { return c.status === 'complete'; }).length;

    renderWizardModal(data.sector);
  } catch (e) {
    openModal('<div class="modal-title">Error</div><p style="color:#ef4444">' + esc(e.message) + '</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>');
  }
}

/**
 * Render the full wizard modal content.
 * @param {string} sectorSlug - e.g. 'taller'
 */
function renderWizardModal(sectorSlug) {
  var total    = _wizardContacts.length;
  var done     = _wizardContacts.filter(function(c) { return c._saved || c.status === 'complete'; }).length;
  var pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  var sectorLabel = { taller:'Taller', veterinaria:'Veterinaria', gimnasio:'Gimnasio', fisioterapia:'Fisioterapia', psicologia:'Psicología', optica:'Óptica', hotel:'Hotel', academia:'Academia' }[sectorSlug] || sectorSlug;

  var html =
    '<div style="max-width:520px">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
      '<div>' +
        '<div class="modal-title" style="margin-bottom:2px">Datos de sector — ' + esc(sectorLabel) + '</div>' +
        '<div style="color:#6b7280;font-size:13px">Completa los datos de tus clientes para activar los recordatorios</div>' +
      '</div>' +
      '<button onclick="closeWizardModal()" style="background:none;border:none;font-size:20px;color:#9ca3af;cursor:pointer;padding:0 0 0 12px">✕</button>' +
    '</div>' +
    '<div style="margin:14px 0 4px">' +
      '<div style="background:#e5e7eb;border-radius:8px;height:8px;overflow:hidden">' +
        '<div id="wizard-progress-bar" style="background:#2563eb;height:8px;border-radius:8px;transition:width 0.3s;width:' + pct + '%"></div>' +
      '</div>' +
      '<div id="wizard-progress-text" style="color:#6b7280;font-size:12px;margin-top:4px">' + done + ' de ' + total + ' completados</div>' +
    '</div>' +
    '<div id="wizard-contact-list" style="margin-top:12px;max-height:50vh;overflow-y:auto">' +
      renderWizardContactList() +
    '</div>' +
    '</div>';

  openModal(html);

  // Auto-expand first incomplete contact
  var firstIncomplete = _wizardContacts.find(function(c) { return !c._saved && c.status !== 'complete'; });
  if (firstIncomplete) {
    setTimeout(function() { expandWizardContact(firstIncomplete.id); }, 50);
  } else {
    // All complete — show done state
    showWizardComplete();
  }
}

/**
 * Render the scrollable contact list HTML (collapsed state).
 */
function renderWizardContactList() {
  return _wizardContacts.map(function(c) {
    var isComplete = c._saved || c.status === 'complete';
    var label = esc(c.name || c.phone || c.id);
    var statusBadge, rowBg;
    if (isComplete) {
      statusBadge = '<span style="color:#16a34a;font-size:12px">✓ completo</span>';
      rowBg = '#f0fdf4';
    } else if (c._skipped) {
      statusBadge = '<span style="color:#9ca3af;font-size:12px">omitido</span>';
      rowBg = '#f9fafb';
    } else {
      statusBadge = '<span style="color:#6b7280;font-size:12px">toca para completar ▸</span>';
      rowBg = '#fff';
    }
    return '<div id="wc-row-' + c.id + '" onclick="expandWizardContact(\'' + c.id + '\')" ' +
      'style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:' + rowBg + ';border:1px solid #e5e7eb;border-radius:8px;margin-bottom:6px;cursor:pointer">' +
      '<span style="font-weight:500;flex:1;font-size:13px">' + label + '</span>' +
      statusBadge +
      '</div>' +
      '<div id="wc-form-' + c.id + '" style="display:none"></div>';
  }).join('');
}

/**
 * Expand a contact's inline edit form, collapsing any other open form.
 * @param {string} contactId
 */
function expandWizardContact(contactId) {
  // Collapse all other open forms
  _wizardContacts.forEach(function(c) {
    var formEl = document.getElementById('wc-form-' + c.id);
    if (formEl && c.id !== contactId) formEl.style.display = 'none';
  });

  var contact = _wizardContacts.find(function(c) { return c.id === contactId; });
  if (!contact) return;
  if (contact._saved || contact.status === 'complete') return; // already done, don't re-expand

  var formEl = document.getElementById('wc-form-' + contactId);
  if (!formEl) return;

  var sectorData = contact._localData || contact.sectorData || {};
  var fieldsHtml = _wizardFields.map(function(f) {
    var currentVal = sectorData[f.key] || '';
    // Convert YYYY-MM-DD → DD/MM/YYYY for display
    if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
      var parts = currentVal.split('-');
      currentVal = parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    return '<div style="margin-bottom:8px">' +
      '<label style="display:block;font-size:11px;color:#6b7280;font-weight:600;margin-bottom:3px">' + esc(f.label) + (f.optional ? ' <span style="color:#9ca3af;font-weight:400">(opcional)</span>' : '') + '</label>' +
      '<input id="wf-' + contactId + '-' + f.key + '" type="' + (f.type === 'date' ? 'text' : f.type) + '" ' +
        'placeholder="' + esc(f.placeholder) + '" value="' + esc(currentVal) + '" ' +
        'style="width:100%;border:1px solid #93c5fd;border-radius:6px;padding:7px 10px;font-size:13px;box-sizing:border-box">' +
    '</div>';
  }).join('');

  formEl.innerHTML =
    '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin-bottom:6px">' +
    fieldsHtml +
    '<div id="wf-err-' + contactId + '" style="color:#ef4444;font-size:12px;display:none;margin-bottom:6px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">' +
      '<button onclick="skipWizardContact(\'' + contactId + '\')" style="background:#f3f4f6;border:none;border-radius:6px;padding:7px 14px;font-size:12px;color:#6b7280;cursor:pointer">Omitir</button>' +
      '<button onclick="saveWizardContact(\'' + contactId + '\')" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer">Guardar →</button>' +
    '</div>' +
    '</div>';
  formEl.style.display = 'block';

  // Scroll the row into view
  var rowEl = document.getElementById('wc-row-' + contactId);
  if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Read form fields, validate, save via PUT /contacts/:id/sector-data.
 * On success: collapse form, update progress, auto-advance to next.
 */
async function saveWizardContact(contactId) {
  var contact = _wizardContacts.find(function(c) { return c.id === contactId; });
  if (!contact) return;

  // Read values from form inputs
  var sectorData = {};
  _wizardFields.forEach(function(f) {
    var inputEl = document.getElementById('wf-' + contactId + '-' + f.key);
    if (!inputEl) return;
    var val = inputEl.value.trim();
    if (!val) return; // Skip empty optional fields

    // Convert DD/MM/YYYY → YYYY-MM-DD for date fields
    if (f.type === 'date' && /^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
      var parts = val.split('/');
      val = parts[2] + '-' + parts[1] + '-' + parts[0];
    }
    sectorData[f.key] = val;
  });

  // Client-side validation: check required fields
  var requiredMissing = _wizardFields.filter(function(f) {
    return !f.optional && (!sectorData[f.key] || String(sectorData[f.key]).trim() === '');
  });
  if (requiredMissing.length > 0) {
    var errEl = document.getElementById('wf-err-' + contactId);
    if (errEl) {
      errEl.textContent = 'Rellena los campos obligatorios: ' + requiredMissing.map(function(f) { return f.label; }).join(', ');
      errEl.style.display = 'block';
    }
    return;
  }

  // Save to backend
  try {
    await api('/api/portal/contacts/' + contactId + '/sector-data', 'PUT', { sectorData: sectorData });
  } catch (e) {
    var errEl = document.getElementById('wf-err-' + contactId);
    if (errEl) { errEl.textContent = 'Error al guardar: ' + e.message; errEl.style.display = 'block'; }
    return;
  }

  // Mark as saved in local state
  contact._saved      = true;
  contact._localData  = sectorData;
  contact.status      = 'complete';

  // Collapse form, update row appearance
  var formEl = document.getElementById('wc-form-' + contactId);
  if (formEl) formEl.style.display = 'none';
  var rowEl  = document.getElementById('wc-row-' + contactId);
  if (rowEl) {
    rowEl.style.background = '#f0fdf4';
    rowEl.style.cursor     = 'default';
    rowEl.onclick          = null;
    rowEl.innerHTML = '<span style="font-weight:500;flex:1;font-size:13px">' + esc(contact.name || contact.phone || contact.id) + '</span><span style="color:#16a34a;font-size:12px">✓ guardado</span>';
  }

  updateWizardProgress();
  advanceWizardToNext(contactId);
}

/**
 * Mark a contact as skipped (client-side only). Advances to next.
 */
function skipWizardContact(contactId) {
  var contact = _wizardContacts.find(function(c) { return c.id === contactId; });
  if (contact) contact._skipped = true;

  var formEl = document.getElementById('wc-form-' + contactId);
  if (formEl) formEl.style.display = 'none';
  var rowEl  = document.getElementById('wc-row-' + contactId);
  if (rowEl) {
    rowEl.style.background = '#f9fafb';
    rowEl.innerHTML = '<span style="font-weight:500;flex:1;font-size:13px">' + esc(contact ? (contact.name || contact.phone || contact.id) : contactId) + '</span><span style="color:#9ca3af;font-size:12px">omitido</span>';
  }

  advanceWizardToNext(contactId);
}

/**
 * Advance to the next incomplete (not saved, not skipped) contact.
 */
function advanceWizardToNext(currentId) {
  var currentIndex = _wizardContacts.findIndex(function(c) { return c.id === currentId; });
  var next = _wizardContacts.slice(currentIndex + 1).find(function(c) {
    return !c._saved && !c._skipped && c.status !== 'complete';
  });

  if (next) {
    setTimeout(function() { expandWizardContact(next.id); }, 100);
  } else {
    // Check if everything is done (saved or skipped)
    var anyPending = _wizardContacts.some(function(c) { return !c._saved && !c._skipped && c.status !== 'complete'; });
    if (!anyPending) showWizardComplete();
  }
}

/**
 * Update the progress bar and counter.
 */
function updateWizardProgress() {
  var total    = _wizardContacts.length;
  var done     = _wizardContacts.filter(function(c) { return c._saved || c.status === 'complete'; }).length;
  var pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  var barEl    = document.getElementById('wizard-progress-bar');
  var textEl   = document.getElementById('wizard-progress-text');
  if (barEl)  barEl.style.width  = pct + '%';
  if (textEl) textEl.textContent = done + ' de ' + total + ' completados';
}

/**
 * Show the "all done" completion state inside the modal.
 */
function showWizardComplete() {
  var listEl = document.getElementById('wizard-contact-list');
  if (listEl) {
    listEl.innerHTML =
      '<div style="text-align:center;padding:24px 0">' +
        '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
        '<div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:6px">¡Todo listo!</div>' +
        '<div style="color:#6b7280;font-size:14px">Los recordatorios se calcularán automáticamente en los próximos minutos.</div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" onclick="closeWizardModal()">Cerrar</button></div>';
  }
  // Update progress to 100%
  var barEl  = document.getElementById('wizard-progress-bar');
  var textEl = document.getElementById('wizard-progress-text');
  var total  = _wizardContacts.length;
  if (barEl)  barEl.style.width  = '100%';
  if (textEl) textEl.textContent = total + ' de ' + total + ' completados';
}

/**
 * Close the wizard modal and refresh the banner count.
 */
function closeWizardModal() {
  closeModal();
  // Re-check the banner (count may have changed after saves)
  checkSectorBanner();
}
```

- [ ] **Step 6: Verify portal.js has the new functions**

```bash
node -e "
const fs = require('fs');
const js = fs.readFileSync('public/portal/portal.js', 'utf8');
['checkSectorBanner','openSectorWizard','renderWizardModal','expandWizardContact','saveWizardContact','skipWizardContact','closeWizardModal'].forEach(function(fn) {
  console.assert(js.includes(fn), fn + ' missing from portal.js');
  console.log('✅', fn);
});
"
```

Expected: 7 `✅` lines.

- [ ] **Step 7: Verify loadSeguimientos calls checkSectorBanner**

```bash
node -e "
const fs = require('fs');
const js = fs.readFileSync('public/portal/portal.js', 'utf8');
const i = js.indexOf('async function loadSeguimientos');
const block = js.slice(i, i + 300);
console.assert(block.includes('checkSectorBanner'), 'checkSectorBanner not called in loadSeguimientos');
console.log('✅ checkSectorBanner called in loadSeguimientos');
"
```

Expected: `✅ checkSectorBanner called in loadSeguimientos`

- [ ] **Step 8: Commit**

```bash
git add public/portal/index.html public/portal/portal.js
git commit -m "feat(wizard): add sector onboarding wizard (banner + modal + save flow)"
```

---

## Final: End-to-End Smoke Test

- [ ] **Step 1: Load all modules together**

```bash
node -e "
require('dotenv').config();
const sf = require('./src/lifecycle/sector-fields');
require('./src/api/routes-portal');
require('./src/lifecycle/reminder-engine');
console.log('✅ All modules load OK');
console.log('Sectors with wizard:', Object.keys(sf.SECTOR_REQUIRED_FIELDS).join(', '));
"
```

Expected:
```
✅ All modules load OK
Sectors with wizard: taller, veterinaria, gimnasio, fisioterapia, psicologia, optica, hotel, academia
```

- [ ] **Step 2: Run sector-fields unit tests**

```bash
node scripts/test-sector-fields.js
```

Expected: all `✅`, 0 failed.

- [ ] **Step 3: Final commit**

```bash
git add .
git status   # confirm only intended files changed
git commit -m "chore: sector onboarding wizard complete — smoke tests pass"
```

---

## Pending Manual Steps

| What | Notes |
|------|-------|
| `git push origin master` | Deploys the wizard to production |
| Test in the portal with a real `taller` or `veterinaria` org | Check banner appears, wizard opens, saving updates reminders |
