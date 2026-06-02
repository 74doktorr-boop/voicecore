# Sector Onboarding Wizard — Design Spec

**Date:** 2026-06-02  
**Feature:** Guided sector data entry wizard for lifecycle reminders  
**Status:** Approved for implementation

---

## Goal

When a NodeFlow client has contacts with missing `sector_data`, a persistent blue banner in the Seguimientos portal section guides them to fill in those fields via a modal wizard — unlocking lifecycle reminders for those contacts.

---

## User Story

A taller mechanic logs into their NodeFlow portal. They have 20 contacts from past calls, but none have their ITV date or last oil change date filled in — so zero lifecycle reminders will fire. They see a blue banner: *"Activa los recordatorios automáticos — completa los datos de 20 clientes."* They click it, fill in the data contact by contact in a modal, and when they reach 20/20 the banner disappears and reminders start scheduling automatically.

---

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Trigger | Persistent banner (disappears at 0) | Always relevant for new contacts, self-resolving |
| Banner tone | Blue/informative ("Activar") | Propositivo, not alarming |
| Wizard container | Modal flotante | Full focus, progress bar, no distraction |
| Contact flow | Expandable list with status chips | Progress visible at all times, flexible pacing |

---

## Sectors and Required Fields

Only sectors with manually-entered fields show the wizard. The rest (peluquería, dental, estética, nutrición) have no required manual fields — the banner never appears for them.

```javascript
// src/lifecycle/sector-fields.js
const SECTOR_REQUIRED_FIELDS = {
  taller: [
    { key: 'matricula',             label: 'Matrícula',                  type: 'text',  placeholder: 'ej. 1234 ABC' },
    { key: 'fecha_ultimo_aceite',   label: 'Último cambio de aceite',    type: 'date',  placeholder: 'dd/mm/aaaa' },
    { key: 'fecha_vencimiento_itv', label: 'ITV vence',                  type: 'date',  placeholder: 'dd/mm/aaaa', optional: true },
  ],
  veterinaria: [
    { key: 'nombre_mascota',        label: 'Nombre de la mascota',       type: 'text',  placeholder: 'ej. Tobi' },
    { key: 'fecha_proxima_vacuna',  label: 'Próxima vacuna',             type: 'date',  placeholder: 'dd/mm/aaaa', optional: true },
  ],
  gimnasio: [
    { key: 'fecha_vencimiento_cuota', label: 'Cuota vence',              type: 'date',  placeholder: 'dd/mm/aaaa' },
  ],
  fisioterapia: [
    { key: 'fecha_alta',            label: 'Fecha de alta',              type: 'date',  placeholder: 'dd/mm/aaaa', optional: true },
  ],
  psicologia: [
    { key: 'frecuencia_sesiones',   label: 'Frecuencia sesiones (días)', type: 'number', placeholder: 'ej. 14' },
  ],
  optica: [
    { key: 'suministro_lentillas_dias', label: 'Días de lentillas',      type: 'number', placeholder: 'ej. 90' },
  ],
  hotel: [
    { key: 'fecha_aniversario',     label: 'Aniversario (MM-DD)',        type: 'text',  placeholder: 'ej. 06-15' },
    { key: 'fecha_cumpleanos',      label: 'Cumpleaños (MM-DD)',         type: 'text',  placeholder: 'ej. 03-22', optional: true },
  ],
  academia: [
    { key: 'fecha_fin_curso',       label: 'Fin de curso',               type: 'date',  placeholder: 'dd/mm/aaaa' },
  ],
};
```

A field marked `optional: true` contributes to the "partial" status but its absence doesn't block the contact from being "complete enough to skip".

**Completion status logic:**
- `complete` → all non-optional fields are filled
- `partial` → at least one non-optional field filled, but not all
- `empty` → zero non-optional fields filled

Sectors not in `SECTOR_REQUIRED_FIELDS` → no banner, no wizard.

---

## Architecture

### New file
- **`src/lifecycle/sector-fields.js`** — exports `SECTOR_REQUIRED_FIELDS` and `getCompletionStatus(sectorSlug, sectorData)` → `{ status, missing }`

### New API endpoint
- **`GET /api/portal/contacts/sector-completion`** (authenticated, `portalAuth`)
  - Fetches `organizations.sector` for the authenticated org
  - If sector not in `SECTOR_REQUIRED_FIELDS` → returns `{ wizardNeeded: false }`
  - Fetches all contacts for the org with `id, name, phone, sector_data`
  - For each contact → calls `getCompletionStatus(sector, contact.sector_data)`
  - Returns:
    ```json
    {
      "wizardNeeded": true,
      "sector": "taller",
      "fields": [...],
      "contacts": [
        { "id": "uuid", "name": "Carlos López", "phone": "612...", "status": "complete", "missing": [] },
        { "id": "uuid", "name": "Ana Martínez",  "phone": "634...", "status": "empty",    "missing": ["matricula", "fecha_ultimo_aceite"] }
      ],
      "pendingCount": 7,
      "totalCount": 20
    }
    ```

### Reused endpoint (no changes)
- **`PUT /api/portal/contacts/:id/sector-data`** — already built in Task 10. Saves `sectorData` and calls `recalculate()` in background.

> ⚠️ **Routing order:** `GET /contacts/sector-completion` (literal) MUST be registered in `routes-portal.js` BEFORE `GET /contacts/:id/sector-data` (parameterized). Otherwise Express matches `sector-completion` as a contact ID and returns 404. Register the new endpoint first.

### Frontend files modified
- **`public/portal/index.html`** — add modal HTML (`#modal-sector-wizard`)
- **`public/portal/portal.js`** — add wizard functions (see below)

---

## Modal UI Structure

```
┌─────────────────────────────────────────────────────┐
│  Datos de sector — Taller                        [✕] │
│  Completa los datos de tus clientes para activar     │
│  los recordatorios automáticos                       │
│  ──────────────────────────────────────────────────  │
│  [████████░░░░░░░░░░░░░░░░] 3 de 8 completados      │
│  ──────────────────────────────────────────────────  │
│  ✓  Carlos López                          [completo] │
│  ──────────────────────────────────────────────────  │
│  ▼  Ana Martínez                          [editando] │
│     Matrícula: [___________]                         │
│     Último aceite: [___________]                     │
│     ITV vence: [___________ (opcional)]              │
│                              [Omitir]  [Guardar →]   │
│  ──────────────────────────────────────────────────  │
│  ○  Mikel Etxebarria                  [toca para ▸]  │
│  ○  Itziar Flores                     [toca para ▸]  │
│  ○  + 4 más...                                       │
└─────────────────────────────────────────────────────┘
```

**Behaviors:**
- Only one contact is expanded at a time
- After "Guardar →": saves via `PUT /api/portal/contacts/:id/sector-data`, collapses, auto-expands next incomplete contact, progress bar advances
- "Omitir": marks contact as skipped (client-side only, can be revisited), advances to next
- When all contacts are complete or skipped → shows "✅ ¡Todo listo! Los recordatorios se calcularán automáticamente." + "Cerrar" button
- Closing modal re-runs `checkSectorBanner()` to update/hide the banner

---

## Banner Logic

Located at the top of `#sec-seguimientos`, above the tabs.

```
┌──────────────────────────────────────────────────────────────┐
│ 💡  Activa los recordatorios automáticos                      │
│     Completa los datos de 8 clientes para que el sistema     │
│     empiece a funcionar                    [Completar →]     │
└──────────────────────────────────────────────────────────────┘
```

- **Appears:** when `pendingCount > 0` and `wizardNeeded: true`
- **Hidden:** when `wizardNeeded: false` (sector has no manual fields) OR `pendingCount === 0`
- **Count updates** after each save and after closing the modal
- Banner is rendered by `checkSectorBanner()`, called at the start of `loadSeguimientos()`

---

## Function Map (portal.js)

| Function | Responsibility |
|----------|---------------|
| `checkSectorBanner()` | Calls `/sector-completion`, renders or hides banner |
| `openSectorWizard()` | Opens `#modal-sector-wizard`, loads contacts |
| `renderWizardContacts(contacts, fields)` | Renders the expandable contact list |
| `expandWizardContact(contactId)` | Collapses all, expands the given contact |
| `saveWizardContact(contactId)` | Reads form, calls `PUT sector-data`, updates progress |
| `skipWizardContact(contactId)` | Marks skipped, advances to next |
| `updateWizardProgress(done, total)` | Updates progress bar and counter |
| `closeWizardModal()` | Closes modal, calls `checkSectorBanner()` |

---

## Date Format Handling

The backend stores dates as `YYYY-MM-DD`. The portal displays and accepts `DD/MM/YYYY` (Spanish convention). Conversion happens client-side:
- Display: `YYYY-MM-DD` → `DD/MM/YYYY`
- Save: `DD/MM/YYYY` → `YYYY-MM-DD`

For `MM-DD` fields (hotel aniversario, cumpleaños): stored and displayed as `MM-DD` directly, no year.

---

## Error Handling

- If `PUT sector-data` fails: show inline error under the form, keep contact expanded
- If `GET sector-completion` fails: hide banner silently (don't block Seguimientos)
- Empty name contacts (no name from calls yet): show phone number as fallback label

---

## What This Does NOT Do

- Does not import data from CSV (out of scope — manual entry only)
- Does not send push notifications reminding the owner to complete data
- Does not show in the admin panel (owner-only feature)
- Does not modify existing contacts' other fields (only `sector_data`)

---

## Files Changed

| File | Change |
|------|--------|
| `src/lifecycle/sector-fields.js` | **New** — SECTOR_REQUIRED_FIELDS + getCompletionStatus |
| `src/api/routes-portal.js` | **Add** `GET /contacts/sector-completion` endpoint |
| `public/portal/index.html` | **Add** modal `#modal-sector-wizard` HTML |
| `public/portal/portal.js` | **Add** wizard functions + checkSectorBanner |
