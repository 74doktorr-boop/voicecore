# New Sectors + Automation Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand NodeFlow from 14 to 25+ sectors and add three new automation systems (birthday campaigns, no-show management, multi-touch rebooking) to justify the €49/month Negocio plan.

**Architecture:** Part A adds new sectors as pure data expansions to existing modules (no new files, no logic changes). Part B adds three new automation capabilities: (1) birthday emails built on top of the existing critical-dates infrastructure, (2) no-show detection in the existing 30-min cron cycle, (3) second-touch follow-up email in the existing rebooking cron. All features are opt-in and gracefully degrade when data is missing.

**Tech Stack:** Node.js, Resend (email), existing `criticalDatesStore` + `scheduler` + `flowManager` singletons, no new npm packages required.

---

## File Map

**Modified (no new files in Part A):**
- `src/assistants/prompt-generator.js` — add 11 new `sectorBlock()` cases
- `src/scheduling/rebooking-cron.js` — expand `REBOOKING_DEFAULTS` + add second-touch logic (Task 7)
- `src/notifications/rebooking-notifications.js` — expand `SECTOR_COPY` + add `sendRebookingFollowUp()`
- `src/scheduling/critical-dates.js` — expand `CRITICAL_DATE_TYPES`
- `src/scheduling/cron.js` — add no-show check + update stats
- `src/notifications/critical-date-notifications.js` — add birthday-specific template branch
- `public/admin/playground.js` — expand sectors list + `renderContenidoTab`
- `public/portal/portal.js` — expand SECTORS array + `renderAsisSectorFields`

**Created (Part B):**
- `src/notifications/noshow-notifications.js` — no-show email template

---

## Part A: New Sectors

---

### Task 1: Expand `prompt-generator.js` with 11 new sector blocks

**Files:**
- Modify: `src/assistants/prompt-generator.js`

**Context:** `sectorBlock(sector, sectorData)` is a switch-case function. Currently handles: `restaurante`, `fisioterapia`/`clinica`, `peluqueria`, `gimnasio`. Default case returns `''`. Add 11 new cases BEFORE the `default:` line.

- [ ] **Step 1: Verify current switch structure**

```bash
node -e "const {generatePrompt}=require('./src/assistants/prompt-generator'); console.log(generatePrompt({sector:'optica',language:'es'},'Test Óptica').slice(0,200))"
```

Expected: prints prompt with empty sector block (no errors, just no sector-specific content yet).

- [ ] **Step 2: Add 11 new sector cases to `sectorBlock()`**

In `src/assistants/prompt-generator.js`, find the line `default:` (currently the last case in the switch) and insert these cases immediately before it:

```js
    case 'optica': {
      const seguros = Array.isArray(sectorData.seguros) && sectorData.seguros.length > 0
        ? `SEGUROS ÓPTICOS: ${sectorData.seguros.join(', ')}` : null;
      const marcas = sectorData.marcas ? `MARCAS DISPONIBLES: ${sectorData.marcas}` : null;
      return [seguros, marcas].filter(Boolean).join('\n');
    }
    case 'psicologia':
    case 'coaching': {
      const esp      = sectorData.especialidades ? `ESPECIALIDADES: ${sectorData.especialidades}` : null;
      const sesiones = sectorData.duracionSesion ? `DURACIÓN DE SESIÓN: ${sectorData.duracionSesion}` : null;
      return [esp, sesiones].filter(Boolean).join('\n');
    }
    case 'nutricion':
    case 'dietetica': {
      const programas = sectorData.programas ? `PROGRAMAS: ${sectorData.programas}` : null;
      const metodo    = sectorData.metodo ? `METODOLOGÍA: ${sectorData.metodo}` : null;
      return [programas, metodo].filter(Boolean).join('\n');
    }
    case 'podologia': {
      return sectorData.servicios ? `SERVICIOS Y PRECIOS:\n${sectorData.servicios}` : '';
    }
    case 'autoescuela': {
      const carnets = sectorData.carnets ? `CARNETS: ${sectorData.carnets}` : null;
      const precio  = sectorData.precioPractica ? `PRECIO CLASE PRÁCTICA: ${sectorData.precioPractica}` : null;
      return [carnets, precio].filter(Boolean).join('\n');
    }
    case 'estetica_avanzada':
    case 'laser': {
      return sectorData.tratamientos ? `TRATAMIENTOS: ${sectorData.tratamientos}` : '';
    }
    case 'yoga':
    case 'pilates': {
      const tipos = sectorData.tiposClase ? `TIPOS DE CLASE: ${sectorData.tiposClase}` : null;
      const packs = sectorData.packs ? `PACKS DISPONIBLES: ${sectorData.packs}` : null;
      return [tipos, packs].filter(Boolean).join('\n');
    }
    case 'guarderia_canina':
    case 'residencia_mascotas': {
      const razas  = sectorData.razasAdmitidas ? `RAZAS ADMITIDAS: ${sectorData.razasAdmitidas}` : null;
      const plazas = sectorData.plazas ? `PLAZAS DISPONIBLES: ${sectorData.plazas}` : null;
      return [razas, plazas].filter(Boolean).join('\n');
    }
    case 'abogados':
    case 'notaria': {
      const esp      = sectorData.especialidades ? `ESPECIALIDADES LEGALES: ${sectorData.especialidades}` : null;
      const consulta = sectorData.consultaInicial ? `CONSULTA INICIAL: ${sectorData.consultaInicial}` : null;
      return [esp, consulta].filter(Boolean).join('\n');
    }
    case 'agencia_viajes': {
      return sectorData.destinos ? `DESTINOS PRINCIPALES: ${sectorData.destinos}` : '';
    }
    case 'reformas':
    case 'arquitectura': {
      return sectorData.tiposObra ? `TIPOS DE OBRA/REFORMA: ${sectorData.tiposObra}` : '';
    }
```

- [ ] **Step 3: Verify each new sector generates a valid prompt**

```bash
node -e "
const {generatePrompt}=require('./src/assistants/prompt-generator');
const sectors=['optica','psicologia','nutricion','podologia','autoescuela','estetica_avanzada','yoga','guarderia_canina','abogados','agencia_viajes','reformas'];
sectors.forEach(s=>{
  const p=generatePrompt({sector:s,language:'es',sectorData:{especialidades:'Test',servicios:'Test'}}, 'Test Biz');
  const ok=p.includes('Eres') && p.includes('Test Biz');
  console.log(s, ok ? 'OK' : 'FAIL');
});
"
```

Expected: All sectors print `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/assistants/prompt-generator.js
git commit -m "feat: add 11 new sector blocks to prompt-generator (optica, psicologia, nutricion, podologia, autoescuela, estetica_avanzada, yoga, guarderia_canina, abogados, agencia_viajes, reformas)"
```

---

### Task 2: Expand rebooking cron + notifications with 11 new sectors

**Files:**
- Modify: `src/scheduling/rebooking-cron.js`
- Modify: `src/notifications/rebooking-notifications.js`

**Context:** `REBOOKING_DEFAULTS` in `rebooking-cron.js` maps sector names to threshold days. `SECTOR_COPY` in `rebooking-notifications.js` maps sector names to `{es: [title, body]}` objects. Both fall back to sensible defaults when sector is not found, so missing entries won't crash — but explicit entries give better personalisation.

- [ ] **Step 1: Add 11 new sectors to `REBOOKING_DEFAULTS` in `rebooking-cron.js`**

Find the `REBOOKING_DEFAULTS` object (starts at line ~16) and add these entries inside it, before the closing `}`:

```js
  optica:              365,
  psicologia:           21,
  coaching:             21,
  nutricion:            30,
  dietetica:            30,
  podologia:            90,
  autoescuela:          14,
  estetica_avanzada:    45,
  laser:                45,
  yoga:                 21,
  pilates:              21,
  guarderia_canina:     60,
  residencia_mascotas:  60,
  abogados:             60,
  notaria:              60,
  agencia_viajes:      180,
  reformas:             90,
  arquitectura:         90,
```

- [ ] **Step 2: Verify REBOOKING_DEFAULTS includes new sectors**

```bash
node -e "const {checkAndSendRebookings}=require('./src/scheduling/rebooking-cron'); console.log('REBOOKING_DEFAULTS loaded OK');"
```

Expected: prints `REBOOKING_DEFAULTS loaded OK` with no errors.

- [ ] **Step 3: Add 11 new sectors to `SECTOR_COPY` in `rebooking-notifications.js`**

Find the `SECTOR_COPY` object (after line ~14) and add these entries inside it, before `default:`:

```js
  optica:            { es: ['Tu vista merece atención', 'Hace tiempo que no revisamos tu graduación. ¿Reservamos una revisión?'] },
  psicologia:        { es: ['¿Cómo estás?', 'Hace unas semanas que no hablamos. Estoy aquí cuando lo necesites.'] },
  coaching:          { es: ['Sigamos avanzando', 'Hace un tiempo que no tenemos sesión. ¿La retomamos esta semana?'] },
  nutricion:         { es: ['Tu seguimiento mensual te espera', 'Es el momento de revisar tu progreso. ¿Reservamos la próxima visita?'] },
  dietetica:         { es: ['Tu control mensual', 'Ha pasado un mes desde tu última visita. Mantengamos el ritmo juntos.'] },
  podologia:         { es: ['Tus pies te lo agradecerán', 'Hace unos meses que no te vemos. ¿Reservamos hora para una revisión?'] },
  autoescuela:       { es: ['Tu carnet te está esperando', 'Lleva un tiempo sin clase. ¿Retomamos las prácticas?'] },
  estetica_avanzada: { es: ['Continuemos tu tratamiento', 'Tu ciclo de tratamiento no está completo. Los mejores resultados se logran con constancia.'] },
  laser:             { es: ['Continuemos tu tratamiento', 'Para mejores resultados, los ciclos deben completarse. ¿Agendamos la próxima sesión?'] },
  yoga:              { es: ['El mat te echa de menos', 'Hace unas semanas que no practicas. La constancia marca la diferencia.'] },
  pilates:           { es: ['Retomemos el pilates', 'Tu cuerpo mejora con la constancia. ¿Reservamos una clase esta semana?'] },
  guarderia_canina:  { es: ['¿Tu mascota necesita cuidados?', 'Tenemos disponibilidad para las próximas semanas. ¿Reservamos?'] },
  residencia_mascotas: { es: ['Tu peludín siempre tiene sitio aquí', 'Tenemos plazas disponibles. ¿Reservamos su próxima estancia?'] },
  abogados:          { es: ['Revisemos tu situación', 'Han pasado unos meses. ¿Hay algo legal que deba revisar o gestionar para ti?'] },
  notaria:           { es: ['Documentos y trámites pendientes', 'Si tienes algún trámite notarial pendiente, estamos a tu disposición.'] },
  agencia_viajes:    { es: ['¿Ya piensas en el próximo viaje?', 'El mejor momento para planificar es ahora. ¿Te ayudamos a organizar tu próximo destino?'] },
  reformas:          { es: ['¿Tienes algún proyecto en mente?', 'Seguimos aquí para ayudarte con cualquier reforma. ¿Hablamos?'] },
  arquitectura:      { es: ['¿Avanzamos con tu proyecto?', 'Han pasado unos meses. Si tienes un proyecto nuevo, cuéntanoslo.'] },
```

- [ ] **Step 4: Verify rebooking-notifications loads correctly**

```bash
node -e "
const {sendRebookingEmail}=require('./src/notifications/rebooking-notifications');
console.log('sendRebookingEmail loaded OK — function?', typeof sendRebookingEmail === 'function');
"
```

Expected: `sendRebookingEmail loaded OK — function? true`.

- [ ] **Step 5: Commit**

```bash
git add src/scheduling/rebooking-cron.js src/notifications/rebooking-notifications.js
git commit -m "feat: expand rebooking system to 25+ sectors (optica, psicologia, nutricion, etc.)"
```

---

### Task 3: Expand `critical-dates.js` with 7 new date types

**Files:**
- Modify: `src/scheduling/critical-dates.js`

**Context:** `CRITICAL_DATE_TYPES` is an object exported from this file. Each key maps to `{ label, emoji, sectors: string[] }`. Adding entries here makes them available in the API and in the portal UI.

- [ ] **Step 1: Add 7 new types to `CRITICAL_DATE_TYPES`**

Find the closing `};` of the `CRITICAL_DATE_TYPES` object and insert these entries before it:

```js
  passport_expiry:      { label: 'Vencimiento pasaporte',      emoji: '🛂', sectors: ['agencia_viajes'] },
  glasses_prescription: { label: 'Renovación de prescripción', emoji: '👓', sectors: ['optica'] },
  legal_deadline:       { label: 'Plazo legal / escritura',    emoji: '⚖️', sectors: ['abogados', 'notaria'] },
  driving_license:      { label: 'Renovación carnet conducir', emoji: '🪪', sectors: ['taller', 'asesoria'] },
  annual_contract:      { label: 'Vencimiento contrato anual', emoji: '📋', sectors: ['asesoria', 'reformas'] },
  treatment_cycle:      { label: 'Ciclo de tratamiento',       emoji: '✨', sectors: ['estetica_avanzada', 'laser'] },
  class_pack_expiry:    { label: 'Vencimiento pack de clases', emoji: '🧘', sectors: ['yoga', 'pilates', 'gimnasio'] },
```

- [ ] **Step 2: Verify all new types are exported**

```bash
node -e "
const {CRITICAL_DATE_TYPES}=require('./src/scheduling/critical-dates');
const newTypes=['passport_expiry','glasses_prescription','legal_deadline','driving_license','annual_contract','treatment_cycle','class_pack_expiry'];
newTypes.forEach(t => console.log(t, CRITICAL_DATE_TYPES[t] ? 'OK' : 'MISSING'));
"
```

Expected: All 7 types print `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/scheduling/critical-dates.js
git commit -m "feat: add 7 new critical date types (passport, glasses prescription, legal deadlines, etc.)"
```

---

### Task 4: Update sector dropdowns in playground.js and portal.js

**Files:**
- Modify: `public/admin/playground.js`
- Modify: `public/portal/portal.js`

**Context:**
- `playground.js` line 237 has a hardcoded array of sectors for the assistant sub-tab selector. Line 439 has another hardcoded array for the bot creation modal.
- `portal.js` line 754 has a `SECTORS` local variable (inside the config-render function) with the list used for the config form dropdown.
- Both `renderContenidoTab` (playground.js ~line 292) and `renderAsisSectorFields` (portal.js ~line 1137) need a generic fallback that shows a "Servicios" textarea for any sector not explicitly handled. This ensures new sectors always have something useful.

- [ ] **Step 1: Update the assistant config sector selector in `playground.js`**

Find this line in `playground.js` (~line 237):
```js
      ['generico','restaurante','fisioterapia','clinica','peluqueria','gimnasio','veterinaria','farmacia'].map(function(s){ return '<option value="' + s + '"' + (c.sector===s?' selected':'') + '>' + s + '</option>'; }).join('')
```

Replace it with:
```js
      ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia','estetica','gimnasio',
       'veterinaria','farmacia','asesoria','taller','hotel','inmobiliaria',
       'optica','psicologia','coaching','nutricion','podologia','autoescuela',
       'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
       'agencia_viajes','reformas'].map(function(s){ return '<option value="' + s + '"' + (c.sector===s?' selected':'') + '>' + s + '</option>'; }).join('')
```

- [ ] **Step 2: Update the demo-bot creation modal sector selector in `playground.js`**

Find this line (~line 439):
```js
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><select class="form-select" id="bot-sector"><option>generico</option><option>restaurante</option><option>fisioterapia</option><option>clinica</option><option>peluqueria</option><option>gimnasio</option></select></div>' +
```

Replace it with:
```js
    '<div class="form-group" style="margin-bottom:18px"><label>Sector</label><select class="form-select" id="bot-sector">' +
      ['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia','estetica','gimnasio',
       'veterinaria','farmacia','asesoria','taller','hotel','inmobiliaria',
       'optica','psicologia','coaching','nutricion','podologia','autoescuela',
       'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
       'agencia_viajes','reformas'].map(function(s){return '<option>'+s+'</option>';}).join('') +
      '</select></div>' +
```

- [ ] **Step 3: Add generic fallback to `renderContenidoTab` in `playground.js`**

Find the `renderContenidoTab` function (~line 292). At the end of the if/else chain, just before `container.innerHTML = html;` (or equivalent), add a fallback that renders a generic "Servicios" field for any sector not in the if/else blocks:

After the last `} else if (sector === 'gimnasio') {` block (which ends with `}`), find the next line that sets the container's innerHTML and add a fallback else block immediately before it:

```js
  } else {
    // Generic fallback: any sector not explicitly handled gets a services textarea
    html += '<div class="form-group form-full"><label>Servicios y precios</label><textarea class="form-textarea" id="sd-servicios" placeholder="Lista tus servicios y precios...">' + esc(sectorData.servicios || services || '') + '</textarea></div>';
  }
```

Also update the `collectAssistantConfig()` function in `playground.js` to collect the generic `sd-servicios` field. Find where `c.sectorData = sd;` is set. The current code only fills `sd` for known sectors. Add this at the end of the sector-specific `sd` building, before `c.sectorData = sd;`:

```js
  var sdServEl = document.getElementById('sd-servicios');
  if (sdServEl) sd.servicios = sdServEl.value.trim();
```

- [ ] **Step 4: Update `SECTORS` array in `portal.js`**

Find line 754 in `portal.js`:
```js
  var SECTORS = ['peluqueria','barberia','estetica','clinica','dental','veterinaria','restaurante',
    'taller','gimnasio','academia','farmacia','asesoria','hotel','inmobiliaria','otro'];
```

Replace with:
```js
  var SECTORS = ['peluqueria','barberia','estetica','clinica','dental','veterinaria','restaurante',
    'taller','gimnasio','academia','farmacia','asesoria','hotel','inmobiliaria',
    'optica','psicologia','coaching','nutricion','podologia','autoescuela',
    'estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria',
    'agencia_viajes','reformas','otro'];
```

- [ ] **Step 5: Add generic fallback to `renderAsisSectorFields` in `portal.js`**

Find `renderAsisSectorFields` (~line 1137). It currently has `if (sector === 'fisioterapia' || ...)` blocks. After the last explicit else-if, before the closing of the function, add:

```js
  } else {
    html += '<div class="asis-field"><label class="form-label">Servicios y precios</label>' +
      '<textarea class="form-ctrl" id="sd-servicios" rows="4" placeholder="Lista tus servicios...">' +
      esc(sd.servicios || services || '') + '</textarea></div>';
  }
```

Also update `collectAsisConfig()` (~line 1183) to collect the generic field. Find where `c.sectorData = sd;` is set and add before it:

```js
  var sdServEl = document.getElementById('sd-servicios');
  if (sdServEl) sd.servicios = sdServEl.value.trim();
```

- [ ] **Step 6: Verify server starts cleanly and playground loads**

```bash
node -e "require('./server.js')" &
sleep 3
curl -s http://localhost:3001/admin/playground | head -5
kill %1
```

Expected: Playground HTML is returned (starts with `<!DOCTYPE html>`).

- [ ] **Step 7: Commit**

```bash
git add public/admin/playground.js public/portal/portal.js
git commit -m "feat: expand sector dropdowns to 25+ sectors; add generic sector fallback in playground and portal"
```

---

## Part B: New Automation Features

---

### Task 5: Birthday email template

**Files:**
- Modify: `src/notifications/critical-date-notifications.js`

**Context:** `sendCriticalDateReminder(criticalDate, daysUntilDue, config)` currently sends a generic urgency-based reminder email. We need to detect `type === 'birthday'` and send a completely different festive email instead. The birthday entry is stored in `criticalDatesStore` with `type: 'birthday'` and `advanceDays: [1]` (1 day before = arrives on birthday morning).

- [ ] **Step 1: Verify current birthday type exists in CRITICAL_DATE_TYPES**

```bash
node -e "const {CRITICAL_DATE_TYPES}=require('./src/scheduling/critical-dates'); console.log('birthday:', CRITICAL_DATE_TYPES.birthday);"
```

Expected: `birthday: { label: 'Cumpleaños', emoji: '🎂', sectors: [] }`.

- [ ] **Step 2: Add `_sendBirthdayEmail` helper function to `critical-date-notifications.js`**

At the top of the file, after the existing helper functions `esc`, `firstName`, `_urgencyLabel`, `_urgencyColor`, add this new function:

```js
async function _sendBirthdayEmail(criticalDate, config) {
  if (!criticalDate?.clientEmail) {
    log.warn(`_sendBirthdayEmail: no email for ${criticalDate?.clientName} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const name    = esc(firstName(criticalDate.clientName));
  const bizName = esc(config?.name || 'nosotros');
  const phone   = esc(config?.ownerPhone || '');
  const notes   = esc(criticalDate.notes || '');  // notes can hold discount text e.g. "10% descuento"

  const subject = lang === 'eu'
    ? `Zorionak ${name}! 🎂 — ${bizName}`
    : `¡Feliz cumpleaños, ${name}! 🎂 — ${bizName}`;

  const greeting = lang === 'eu'
    ? `Zorionak ${name}! 🥳`
    : `¡Feliz cumpleaños, ${name}! 🥳`;

  const bodyText = lang === 'eu'
    ? `Zure urtebetetzea ospatzeko ${bizName}-k zoragarria den eguna opa dizu.`
    : `Todo el equipo de <strong>${bizName}</strong> te desea un día increíble.`;

  const giftNote = notes
    ? `<p style="color:#fbbf24;font-size:14px;font-weight:700;margin:16px 0 0;text-align:center;">🎁 ${notes}</p>`
    : '';

  const ctaLabel  = lang === 'eu' ? 'Hitzordua hartu' : 'Reservar cita';
  const unsubText = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(251,191,36,.3);">
  <div style="background:linear-gradient(135deg,#f59e0b,#fbbf24,#f97316);padding:28px;text-align:center;">
    <div style="font-size:48px;line-height:1;margin-bottom:8px;">🎂</div>
    <div style="font-size:22px;font-weight:900;color:#fff;text-shadow:0 2px 4px rgba(0,0,0,.3);">${greeting}</div>
    <div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:4px;">${bizName}</div>
  </div>
  <div style="padding:28px;">
    <p style="color:#e2e8f0;font-size:15px;line-height:1.7;margin:0 0 20px;text-align:center;">${bodyText}</p>
    ${giftNote}
    ${phone ? `<a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-top:20px;">🎁 ${ctaLabel}</a>` : ''}
    <p style="color:#334155;font-size:11px;text-align:center;margin:20px 0 0;">${unsubText}</p>
  </div>
</div>
</body></html>`;

  log.info(`Sending birthday email to ${criticalDate.clientEmail}`);
  return sendEmail({ to: criticalDate.clientEmail, subject, html });
}
```

- [ ] **Step 3: Add birthday branch to `sendCriticalDateReminder`**

Find the `sendCriticalDateReminder` function. Add this check at the very beginning of the function body, after the `if (!criticalDate?.clientEmail)` guard:

```js
  // Birthday emails use a completely different template
  if (criticalDate.type === 'birthday') {
    return _sendBirthdayEmail(criticalDate, config);
  }
```

- [ ] **Step 4: Test birthday template generates valid HTML**

```bash
node -e "
require('dotenv').config();
const {sendCriticalDateReminder}=require('./src/notifications/critical-date-notifications');
const entry={id:'test-1',type:'birthday',clientName:'María García',clientEmail:'test@example.com',clientPhone:null,dueDate:'2026-06-01',notes:'10% de descuento en tu próxima visita',advanceDays:[1],sentReminders:[]};
const config={name:'Peluquería Ejemplo',ownerPhone:'34666123456',language:'es'};
// Just test that the function calls through without throwing
sendCriticalDateReminder(entry, 1, config).then(r=>console.log('Birthday email result:',r)).catch(e=>console.error('ERROR:',e.message));
"
```

Expected: `Birthday email result: false` (because RESEND_API_KEY not set in test) or `Birthday email result: true` if API key configured. No crash.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/critical-date-notifications.js
git commit -m "feat: add birthday email template to critical-date-notifications — festive design, discount note support"
```

---

### Task 6: No-show detection and email notification

**Files:**
- Create: `src/notifications/noshow-notifications.js`
- Modify: `src/scheduling/cron.js`

**Context:** The scheduler stores appointments in `scheduler.appointments` (a Map). Each appointment has: `id, businessId, patientName, email, phone, service, date, time, status`. There is no `noShowNotified` flag yet — we add it at runtime. The cron runs every 30 minutes; we add a no-show check to `runAutomations()`. A no-show is: status `!== 'cancelled'`, appointment datetime has passed by 30+ minutes, email exists, `noShowNotified` is not set.

- [ ] **Step 1: Create `src/notifications/noshow-notifications.js`**

```js
// ============================================
// NodeFlow — No-Show Email Notification
// Sent when a client misses their appointment
// ============================================
'use strict';

const { sendEmail } = require('./email');
const { Logger }    = require('../utils/logger');

const log = new Logger('NOSHOW-NOTIF');

function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function firstName(n = '') { return n.split(' ')[0]; }

/**
 * Sends a no-show recovery email to the client.
 * @param {object} apt    - appointment object from scheduler
 * @param {object} config - { name, ownerPhone, language }
 */
async function sendNoShowEmail(apt, config) {
  if (!apt?.email) {
    log.warn(`sendNoShowEmail: no email for ${apt?.patientName} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const name    = esc(firstName(apt.patientName));
  const bizName = esc(config?.name || 'nuestro equipo');
  const phone   = esc(config?.ownerPhone || '');
  const service = esc(apt.service || 'tu cita');

  // Format appointment datetime
  let aptStr = `${apt.date} a las ${apt.time}`;
  try {
    const d = new Date(`${apt.date}T${apt.time}:00`);
    aptStr = d.toLocaleDateString(lang === 'eu' ? 'eu' : 'es-ES', {
      weekday: 'long', day: 'numeric', month: 'long',
    }) + ` a las ${apt.time}`;
  } catch(_) {}

  const greeting = lang === 'eu' ? `Kaixo ${name}` : `Hola ${name}`;
  const subject  = lang === 'eu'
    ? `${bizName}: zure hitzordua falta duzu`
    : `${bizName}: vimos que no pudiste venir hoy`;

  const bodyLine1 = lang === 'eu'
    ? `Gaur ${service} zure hitzordua zegoen (${aptStr}), baina ez zara etorri.`
    : `Tenías cita para <strong>${service}</strong> el <strong>${aptStr}</strong>, pero no pudiste venir.`;

  const bodyLine2 = lang === 'eu'
    ? `Ez kezkatu! Hitzordua beste egun batera aldatu dezakegu.`
    : `¡No te preocupes! A veces surgen imprevistos. ¿Quieres que te busquemos otro hueco?`;

  const ctaLabel = lang === 'eu' ? 'Deitu hurrengo data ezartzeko' : 'Llamar para reagendar';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : 'Para darte de baja de estos avisos, responde a este email.';

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.2);">
  <div style="background:linear-gradient(135deg,#1e1e2e,#2d2d3e);padding:24px 28px;border-bottom:2px solid #f59e0b;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;">NodeFlow · ${esc(bizName)}</div>
    <div style="font-size:20px;margin-top:6px;">😔 <span style="color:#fff;font-weight:800;">${lang === 'eu' ? 'Galdu duzun hitzordua' : 'Cita no atendida'}</span></div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 12px;">${greeting},</p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 12px;">${bodyLine1}</p>
    <p style="color:#e2e8f0;font-size:14px;line-height:1.7;margin:0 0 24px;">${bodyLine2}</p>
    ${phone ? `<a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:#f59e0b;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px;">📞 ${ctaLabel}</a>` : ''}
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">${unsubLabel}</p>
  </div>
</div>
</body></html>`;

  log.info(`No-show email sent to ${apt.email} (apt:${apt.id}, biz:${apt.businessId})`);
  return sendEmail({
    to: apt.email,
    subject,
    html,
  });
}

module.exports = { sendNoShowEmail };
```

- [ ] **Step 2: Verify the new file loads cleanly**

```bash
node -e "const {sendNoShowEmail}=require('./src/notifications/noshow-notifications'); console.log('sendNoShowEmail type:', typeof sendNoShowEmail);"
```

Expected: `sendNoShowEmail type: function`.

- [ ] **Step 3: Add `checkAndHandleNoShows` function to `src/scheduling/cron.js`**

Find the `checkAndSendCriticalDateReminders` function in `cron.js` (starts around line 18). After that function's closing `}`, add this new function:

```js
async function checkAndHandleNoShows(scheduler, flowManager) {
  const { sendNoShowEmail } = require('../notifications/noshow-notifications');
  const GRACE_MS = 30 * 60 * 1000; // 30 minutes grace period after appointment time
  const now  = Date.now();
  let handled = 0;

  for (const apt of scheduler.appointments.values()) {
    if (apt.status === 'cancelled') continue;   // cancelled — not a no-show
    if (apt.noShowNotified) continue;           // already sent a no-show email
    if (!apt.email) continue;                   // no email to send to

    const aptMs = new Date(`${apt.date}T${apt.time}:00`).getTime();
    if (isNaN(aptMs)) continue;                 // invalid date — skip
    if (now < aptMs + GRACE_MS) continue;       // not yet past grace period

    // No-show confirmed: appointment passed, still confirmed, not notified
    const config = scheduler.getBusinessConfig(apt.businessId) || {};

    try {
      const ok = await sendNoShowEmail(apt, config);
      if (ok) {
        apt.noShowNotified = true;
        handled++;
        log.info(`No-show handled: apt ${apt.id} — ${apt.patientName}`);
      }
    } catch (e) {
      log.warn(`No-show email error for apt ${apt.id}`, { err: e.message });
    }
  }

  return handled;
}
```

- [ ] **Step 4: Wire `checkAndHandleNoShows` into `runAutomations()` in `cron.js`**

Find `runAutomations()`. It currently calls `checkAndSendReminders`, `checkAndSendReviews`, `checkAndSendCriticalDateReminders`. Add no-show handling after the critical dates call:

```js
    const noShows        = await checkAndHandleNoShows(scheduler, flowManager);
```

And update the stats line from:
```js
    _stats.reminders     += reminders;
    _stats.reviews       += reviews;
    _stats.criticalDates += criticalDates;
    _stats.runs          += 1;
```
to:
```js
    _stats.reminders     += reminders;
    _stats.reviews       += reviews;
    _stats.criticalDates += criticalDates;
    _stats.noShows       = (_stats.noShows || 0) + noShows;
    _stats.runs          += 1;
```

Also update the log line to include noShows:
```js
    log.info(`Automations done in ${elapsed}ms — reminders:${reminders} reviews:${reviews} criticalDates:${criticalDates} noShows:${noShows}`);
```

And the `_history` push to include noShows:
```js
    _history.unshift({ runAt: _lastRun, reminders, reviews, criticalDates, noShows });
```

Also initialise `_stats` object to include noShows. Find the line:
```js
let _stats = { reminders: 0, reviews: 0, criticalDates: 0, runs: 0 };
```
Replace with:
```js
let _stats = { reminders: 0, reviews: 0, criticalDates: 0, noShows: 0, runs: 0 };
```

- [ ] **Step 5: Verify cron loads cleanly**

```bash
node -e "const {runAutomations,getCronStats}=require('./src/scheduling/cron'); console.log('cron loaded OK, stats:', getCronStats());"
```

Expected: prints `cron loaded OK, stats:` followed by stats object with `noShows: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/notifications/noshow-notifications.js src/scheduling/cron.js
git commit -m "feat: add no-show detection and email recovery — checks every 30min, sends empathetic re-scheduling email"
```

---

### Task 7: Multi-touch rebooking (second-touch follow-up email)

**Files:**
- Modify: `src/scheduling/rebooking-cron.js`
- Modify: `src/notifications/rebooking-notifications.js`

**Context:** The rebooking cron currently sends one email per client per rebooking cycle (anti-spam via `_sentLog`). Multi-touch adds a second email 3 days after the first, if the client still has no upcoming appointment. We track the second touch in a separate `_secondTouchLog` Map so we don't break the existing `_sentLog` semantics (it still stores plain timestamps).

- [ ] **Step 1: Add `sendRebookingFollowUp` function to `rebooking-notifications.js`**

After the `sendRebookingEmail` function's closing `}`, add:

```js
/**
 * Second-touch follow-up — shorter, more personal, different angle.
 * @param {object} client  - { name, email, phone, lastVisitDate }
 * @param {object} config  - { name, ownerPhone, language, sector }
 */
async function sendRebookingFollowUp(client, config) {
  if (!client?.email) {
    log.warn(`sendRebookingFollowUp: no email for ${client?.name} — skipped`);
    return false;
  }

  const lang    = config?.language || 'es';
  const name    = firstName(client.name);
  const bizName = esc(config?.name || 'nuestro equipo');
  const phone   = esc(config?.ownerPhone || '');

  const greeting = lang === 'eu' ? `Kaixo ${esc(name)}` : `Hola ${esc(name)}`;
  const ctaLabel = lang === 'eu' ? 'Hitzordua hartu' : 'Reservar cita';
  const unsubLabel = lang === 'eu'
    ? 'Jakinarazpenik ez jasotzeko, erantzun email hau.'
    : 'Para darte de baja de estos recordatorios, responde a este email.';

  // Second-touch copy: shorter, more direct, acknowledges previous contact
  const title = lang === 'eu' ? 'Zurekin egon nahi dugu' : '¿Seguimos en contacto?';
  const body  = lang === 'eu'
    ? `Duela egun gutxi idatzi genizun. ${bizName}ko atea zabalik dago zuretzat.`
    : `Te escribimos hace unos días. Seguimos aquí cuando lo necesites — reservar solo lleva un momento.`;

  const html = `
<!DOCTYPE html><html><body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:20px 0;">
<div style="max-width:480px;margin:0 auto;background:#0c0c1a;border-radius:16px;overflow:hidden;border:1px solid rgba(124,58,237,.2);">
  <div style="background:linear-gradient(135deg,#1e1e2e,#0c0c1a);padding:20px 28px;border-bottom:2px solid rgba(124,58,237,.4);">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;">NodeFlow · ${esc(bizName)}</div>
    <div style="font-size:18px;margin-top:6px;color:#fff;font-weight:800;">${esc(title)}</div>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 12px;">${greeting} 👋</p>
    <p style="color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 24px;">${esc(body)}</p>
    ${phone ? `<a href="tel:${phone.replace(/\s/g,'')}" style="display:block;background:#7c3aed;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px;">📞 ${ctaLabel}</a>` : ''}
    <p style="color:#334155;font-size:11px;text-align:center;margin:16px 0 0;">${unsubLabel}</p>
  </div>
</div>
</body></html>`;

  log.info(`Second-touch rebooking sent to ${client.email} (${config?.sector}/${lang})`);
  return sendEmail({ to: client.email, subject: `${title} — ${config?.name || ''}`, html });
}

module.exports = { sendRebookingEmail, sendRebookingFollowUp };
```

Note: this replaces the existing `module.exports = { sendRebookingEmail };` line.

- [ ] **Step 2: Add `_secondTouchLog` Map to `rebooking-cron.js`**

Find this line near the top of `rebooking-cron.js`:
```js
const _sentLog = new Map();
```

Add immediately after it:
```js
// Second-touch log: Map<sentKey, lastSecondTouchAt (ms)>
const _secondTouchLog = new Map();
```

- [ ] **Step 3: Update the `require` in `rebooking-cron.js` to import `sendRebookingFollowUp`**

Find:
```js
const { sendRebookingEmail }   = require('../notifications/rebooking-notifications');
```

Replace with:
```js
const { sendRebookingEmail, sendRebookingFollowUp } = require('../notifications/rebooking-notifications');
```

- [ ] **Step 4: Add second-touch evaluation inside `checkAndSendRebookings()`**

Find the inner `for` loop that evaluates each client (around line 98). It ends with a `}` after the `try/catch` block for the first-touch send. After that closing `}`, inside the same outer `for (const [, client] of clientMap)` loop, add the second-touch check:

```js
      // ── Second touch: 3 days after first email, if no appointment yet ────────
      if (client.email && client.upcomingCount === 0 && client.lastVisitDate) {
        const firstTouchKey = _sentKey(businessId, client.phone || client.email);
        const firstSent = _sentLog.get(firstTouchKey);
        if (!firstSent) continue; // no first touch sent yet — skip

        const daysSinceFirst = Math.floor((Date.now() - firstSent) / 86400000);
        if (daysSinceFirst < 3) continue; // too soon for second touch

        const secondTouchKey = `2nd:${firstTouchKey}`;
        const lastSecond = _secondTouchLog.get(secondTouchKey);
        if (lastSecond) {
          const daysSinceSecond = Math.floor((Date.now() - lastSecond) / 86400000);
          if (daysSinceSecond < threshold) continue; // already sent second touch this cycle
        }

        const config2 = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId) || {});
        config2.sector = sector;

        try {
          await sendRebookingFollowUp(client, config2);
          _secondTouchLog.set(secondTouchKey, Date.now());
          sent++;
          log.info(`Second-touch rebooking sent: ${client.email} (${businessId}/${sector})`);
        } catch (e) {
          log.warn(`Second-touch send failed: ${client.email}`, { err: e.message });
        }
      }
```

**Important:** This block must be inside `for (const [, client] of clientMap)` but OUTSIDE the first-touch `if (!client.email) continue;` guard block — because the first-touch guard would prevent reaching the second-touch code. The cleanest approach is to restructure the guard: instead of early-continuing for no-email clients, wrap the first-touch logic in `if (client.email)`. The full corrected inner loop should look like this:

```js
    for (const [, client] of clientMap) {
      checked++;
      const key = _sentKey(businessId, client.phone || client.email);

      if (client.email && client.upcomingCount === 0 && client.lastVisitDate) {
        const daysSince = _daysSince(client.lastVisitDate);

        // ── First touch ────────────────────────────────────────────────────
        if (daysSince >= threshold) {
          const lastSent = _sentLog.get(key);
          const alreadySent = lastSent && Math.floor((Date.now() - lastSent) / 86400000) < threshold;
          if (!alreadySent) {
            const yearKey = `${key}:${new Date().getFullYear()}`;
            const sentThisYear = _sentLog.get(yearKey) || 0;
            if (sentThisYear < maxPerYear) {
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
        }

        // ── Second touch: 3 days after first, if no appointment yet ────────
        const firstSent = _sentLog.get(key);
        if (firstSent) {
          const daysSinceFirst = Math.floor((Date.now() - firstSent) / 86400000);
          if (daysSinceFirst >= 3) {
            const secondKey = `2nd:${key}`;
            const lastSecond = _secondTouchLog.get(secondKey);
            const secondAlreadySent = lastSecond && Math.floor((Date.now() - lastSecond) / 86400000) < threshold;
            if (!secondAlreadySent) {
              const config2 = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId) || {});
              config2.sector = sector;
              try {
                await sendRebookingFollowUp(client, config2);
                _secondTouchLog.set(secondKey, Date.now());
                sent++;
                log.info(`Second-touch sent: ${client.email} (${businessId}/${sector})`);
              } catch (e) {
                log.warn(`Second-touch failed: ${client.email}`, { err: e.message });
              }
            }
          }
        }
      }
    }
```

This completely replaces the existing `for (const [, client] of clientMap)` loop body. The existing code used multiple early `continue` statements; this version uses if-blocks instead for cleaner nesting.

- [ ] **Step 5: Verify rebooking-cron loads cleanly**

```bash
node -e "
const {checkAndSendRebookings}=require('./src/scheduling/rebooking-cron');
console.log('rebooking-cron loaded OK — checkAndSendRebookings:', typeof checkAndSendRebookings);
"
```

Expected: `rebooking-cron loaded OK — checkAndSendRebookings: function`.

- [ ] **Step 6: Commit**

```bash
git add src/scheduling/rebooking-cron.js src/notifications/rebooking-notifications.js
git commit -m "feat: add multi-touch rebooking — second follow-up email 3 days after first, if client still hasn't booked"
```

---

### Task 8: Integration smoke tests

**Files:** No changes — verification only.

- [ ] **Step 1: Start server and check all existing automations still work**

```bash
node -e "
require('dotenv').config();
// Test 1: prompt-generator handles all 25+ sectors without throwing
const {generatePrompt}=require('./src/assistants/prompt-generator');
const allSectors=['generico','restaurante','fisioterapia','clinica','dental','peluqueria','barberia',
  'estetica','gimnasio','veterinaria','farmacia','asesoria','taller','hotel','inmobiliaria',
  'optica','psicologia','coaching','nutricion','podologia','autoescuela','estetica_avanzada',
  'yoga','pilates','guarderia_canina','abogados','notaria','agencia_viajes','reformas'];
let ok=true;
allSectors.forEach(s=>{
  try {
    const p=generatePrompt({sector:s,language:'es',sectorData:{especialidades:'X',servicios:'X',tratamientos:'X',destinos:'X',tiposObra:'X',carnets:'X',tiposClase:'X',razasAdmitidas:'X'}}, 'Test Biz');
    if(!p.includes('Eres')) { console.error(s,'FAIL: no Eres'); ok=false; }
  } catch(e) { console.error(s,'THROW:',e.message); ok=false; }
});
if(ok) console.log('ALL SECTORS OK (' + allSectors.length + ' sectors)');
"
```

Expected: `ALL SECTORS OK (29 sectors)`.

- [ ] **Step 2: Test rebooking-notifications handles all sectors without throwing**

```bash
node -e "
require('dotenv').config();
const {sendRebookingEmail,sendRebookingFollowUp}=require('./src/notifications/rebooking-notifications');
const allSectors=['optica','psicologia','coaching','nutricion','podologia','autoescuela','estetica_avanzada','yoga','pilates','guarderia_canina','abogados','notaria','agencia_viajes','reformas'];
// Check that SECTOR_COPY lookup doesn't throw for all sectors
const mod=require('./src/notifications/rebooking-notifications');
// Access via module — test the internal getCopy function indirectly by calling sendRebookingEmail
// with no actual send (RESEND_API_KEY unset = returns false without throwing)
const client={name:'Test Cliente',email:'noreply@test.com',phone:'600000000',lastVisitDate:'2026-01-01'};
Promise.all(allSectors.map(s=>
  sendRebookingEmail(client,{name:'Test Biz',ownerPhone:'600000000',language:'es',sector:s},'2026-01-01')
)).then(results=>{
  const allFalse=results.every(r=>r===false); // false because no RESEND key — that's OK
  console.log('All sectors processed without throw:', allFalse || results.every(r=>typeof r==='boolean'));
}).catch(e=>console.error('ERROR:',e.message));
"
```

Expected: `All sectors processed without throw: true`.

- [ ] **Step 3: Test critical-dates includes all new types**

```bash
node -e "
const {CRITICAL_DATE_TYPES}=require('./src/scheduling/critical-dates');
const allTypes=['itv_expiry','service_due','insurance_renewal','vaccine_due','annual_checkup',
  'deworming','tax_filing','quarterly_vat','annual_accounts','prescription_renewal',
  'membership_renewal','exam_date','enrollment_deadline','contract_expiry','birthday','anniversary',
  'passport_expiry','glasses_prescription','legal_deadline','driving_license','annual_contract',
  'treatment_cycle','class_pack_expiry'];
let missing=allTypes.filter(t=>!CRITICAL_DATE_TYPES[t]);
if(missing.length===0) console.log('ALL CRITICAL_DATE_TYPES OK ('+allTypes.length+' types)');
else console.error('MISSING:',missing);
"
```

Expected: `ALL CRITICAL_DATE_TYPES OK (23 types)`.

- [ ] **Step 4: Test cron module loads and `getCronStats()` includes noShows**

```bash
node -e "
const {getCronStats}=require('./src/scheduling/cron');
const stats=getCronStats();
console.log('stats:', JSON.stringify(stats));
const hasNoShows='noShows' in stats;
console.log('noShows field present:', hasNoShows);
"
```

Expected: `noShows field present: true`.

- [ ] **Step 5: Test noshow-notifications loads**

```bash
node -e "
const {sendNoShowEmail}=require('./src/notifications/noshow-notifications');
console.log('sendNoShowEmail loaded:', typeof sendNoShowEmail === 'function');
const apt={id:'test',businessId:'biz1',patientName:'Juan García',email:'noreply@test.com',phone:'600000000',service:'Corte de pelo',date:'2026-05-28',time:'10:00',status:'confirmed'};
const config={name:'Peluquería Test',ownerPhone:'600000000',language:'es'};
sendNoShowEmail(apt,config).then(r=>console.log('No-show email result (false=OK, no RESEND key):',r)).catch(e=>console.error('ERROR:',e.message));
"
```

Expected: `No-show email result (false=OK, no RESEND key): false`.

- [ ] **Step 6: Full module-load smoke test**

```bash
node -e "
require('dotenv').config();
// Load all modified/created modules to verify no syntax errors
require('./src/assistants/prompt-generator');
require('./src/scheduling/rebooking-cron');
require('./src/notifications/rebooking-notifications');
require('./src/scheduling/critical-dates');
require('./src/scheduling/cron');
require('./src/notifications/critical-date-notifications');
require('./src/notifications/noshow-notifications');
console.log('All modules loaded without errors ✅');
"
```

Expected: `All modules loaded without errors ✅` with no stack traces.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete new-sectors-and-automations — 25+ sectors, birthday emails, no-show management, multi-touch rebooking"
```

---

## Summary of changes

| File | Change |
|---|---|
| `src/assistants/prompt-generator.js` | +11 sector cases in `sectorBlock()` |
| `src/scheduling/rebooking-cron.js` | +18 entries in `REBOOKING_DEFAULTS`; second-touch `_secondTouchLog` + loop restructure |
| `src/notifications/rebooking-notifications.js` | +18 entries in `SECTOR_COPY`; +`sendRebookingFollowUp()` |
| `src/scheduling/critical-dates.js` | +7 entries in `CRITICAL_DATE_TYPES` |
| `src/scheduling/cron.js` | +`checkAndHandleNoShows()`; wire into `runAutomations()`; add `noShows` to stats |
| `src/notifications/critical-date-notifications.js` | +birthday branch in `sendCriticalDateReminder`; +`_sendBirthdayEmail()` |
| `src/notifications/noshow-notifications.js` | NEW — `sendNoShowEmail()` |
| `public/admin/playground.js` | Expanded sector lists (×2); generic sector fallback in `renderContenidoTab` |
| `public/portal/portal.js` | Expanded `SECTORS` array; generic fallback in `renderAsisSectorFields` |
