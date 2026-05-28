# Smart Automations — Diseño
**Fecha:** 2026-05-28  
**Alcance:** A — Post-call automations · B — Re-booking por sector · C — Critical date automations

---

## Contexto

El sistema actual tiene: reminders 24h antes de cita, reseñas 24h después, WA confirm link, cron cada 30 min, trilingüe (es/eu/gl). Lo que falta:

- **A**: Nada pasa cuando la IA cuelga. Ni el cliente recibe confirmación, ni el propietario sabe qué ocurrió.
- **B**: Los clientes se van y no vuelven. No hay ningún mecanismo de retención por sector.
- **C**: Fechas críticas mencionadas en llamadas (ITV, vacunas, renta) se pierden sin registrar.

---

## Sistema A — Post-Call Automations

### Flujo de datos al finalizar una llamada

```
endCall() en voice-pipeline.js
  → session.end() → callData (ya existe)
  → analytics.recordCall(callData) (ya existe)
  → [NUEVO] postCallHandler.handle(callData, flowManager, scheduler)
```

`postCallHandler.handle()` es fire-and-forget (no bloquea). Si falla, loggea y sigue.

### Qué se captura en CallSession (cambios necesarios)

`CallSession` actualmente NO guarda `outcome` ni el appointment reservado. Hay que añadir:

```js
// En CallSession constructor:
this.outcome = 'abandoned';     // 'booked' | 'info' | 'abandoned'
this.bookedAppointment = null;  // populated by bookAppointment tool
this.clientEmail = null;        // populated when email captured in tool args
this.businessId = null;         // set from assistant.businessId || assistant.id
```

En `ToolExecutor.bookAppointment()`, después de `scheduler.bookAppointment()`, guardar en la sesión activa:
```js
const session = pipeline.getSession(callId);
if (session && result.success) {
  session.outcome = 'booked';
  session.bookedAppointment = result.appointment;
  session.clientEmail = args.email || null;
  session.businessId = assistantId;
}
```

`CallSession.toJSON()` incluye los nuevos campos. `_deriveOutcome()` al hacer `end()`:
- Si `bookedAppointment` existe → `outcome = 'booked'`
- Si `turnCount >= 3` y no hay booking → `outcome = 'info'`
- Si `turnCount < 3` → `outcome = 'abandoned'`

### Nuevo archivo: `src/automations/post-call-handler.js`

```js
async function handle(callData, flowManager, scheduler) {
  const businessId = callData.businessId || callData.assistantId;
  const config = flowManager.mergeConfig(businessId, scheduler.getBusinessConfig(businessId));

  // 1. Email summary to owner (always, if owner email exists)
  if (config.ownerEmail) {
    await sendCallSummaryToOwner(callData, config).catch(e => log.warn('summary email failed', e));
    // WA alert to owner via Callmebot (brief)
    if (callData.outcome === 'booked') {
      sendWhatsApp(`📞 Nueva cita reservada en ${config.name}: ${callData.bookedAppointment?.patientName} el ${callData.bookedAppointment?.date} a las ${callData.bookedAppointment?.time}h`).catch(() => {});
    }
  }

  // 2. Booking confirmation to client
  if (callData.outcome === 'booked' && callData.bookedAppointment) {
    const apt = callData.bookedAppointment;
    if (apt.email) {
      await sendBookingConfirmationEmail(apt, config).catch(e => log.warn('booking email failed', e));
    }
    // WA link for owner to click (existing mechanism, shown in summary email)
  }

  // 3. Follow-up to client for info calls (30 min delay)
  if (callData.outcome === 'info' && callData.clientEmail) {
    setTimeout(() => {
      sendCallFollowUpEmail(callData, config).catch(e => log.warn('followup email failed', e));
    }, 30 * 60 * 1000);
  }
}
```

### Nuevo archivo: `src/notifications/call-notifications.js`

Tres funciones exportadas, todas trilingües (es/eu/gl):

**`sendBookingConfirmationEmail(appointment, config)`**  
- Para: `appointment.email`
- Asunto: `✅ Cita confirmada — {businessName}`
- Contenido: fecha, hora, servicio, precio si existe, dirección si existe en config
- CTA: "Añadir a Google Calendar" (enlace `https://calendar.google.com/calendar/render?action=TEMPLATE&...`)
- Footer con enlace para cancelar (responder al email)

**`sendCallSummaryToOwner(callData, config)`**  
- Para: `config.ownerEmail`
- Asunto: `📞 Llamada {outcome} — {callerNumber} ({duration})`
- Tabla: número llamante, duración, turns, outcome, sentimiento (si disponible), appointment details si booked
- Enlace WA confirm si booked: `https://wa.me/{ownerPhone}?text=...`

**`sendCallFollowUpEmail(callData, config)`**  
- Para: `callData.clientEmail`
- Asunto: `Gracias por llamar a {businessName}`
- Copy: "Hemos atendido tu consulta. Si necesitas algo más, puedes llamarnos o reservar cita directamente."
- CTA: botón "Llamar ahora" → `tel:{ownerPhone}` / "Reservar cita" → [según config]

### Wiring en voice-pipeline.js

En `endCall()`, después de `this._fireWebhook('call.ended', callData)`:
```js
// Post-call automations (fire-and-forget)
const { postCallHandler } = require('../automations/post-call-handler');
postCallHandler.handle(callData, flowManager, scheduler).catch(() => {});
```

`flowManager` y `scheduler` se importan como singletons (ya existen).

---

## Sistema B — Re-booking Automations

### Umbrales por sector (defaults, configurables por negocio)

```js
const REBOOKING_DEFAULTS = {
  restaurante:   { days: 21,  label: 'Han pasado unas semanas desde tu última visita' },
  peluqueria:    { days: 42,  label: 'Tu melena te está pidiendo una visita' },
  estetica:      { days: 42,  label: 'Es hora de tu próximo tratamiento' },
  barberia:      { days: 28,  label: 'Ya va tocando un repaso' },
  clinica:       { days: 180, label: 'Han pasado 6 meses desde tu última consulta' },
  dental:        { days: 180, label: 'Es hora de tu revisión dental' },
  veterinaria:   { days: 365, label: 'Tu mascota merece una revisión anual' },
  taller:        { days: 365, label: 'Tu coche lleva un año sin revisión' },
  gimnasio:      { days: 21,  label: 'Te echamos de menos en el gym' },
  academia:      { days: 30,  label: 'No te pierdas las próximas clases' },
  farmacia:      { days: 30,  label: 'Es momento de renovar tu receta' },
  asesoria:      { days: 90,  label: 'Se acerca el próximo trimestre fiscal' },
  hotel:         { days: 90,  label: 'Vuelve a visitarnos' },
  inmobiliaria:  { days: null, label: null },  // desactivado por defecto
};
```

### Extensión de FlowManager

Añadir al schema de flow:
```js
rebooking: {
  enabled: true,           // sector default: true (excepto inmobiliaria)
  daysThreshold: null,     // null = usar REBOOKING_DEFAULTS[sector].days
  maxPerYear: 4,           // máximo 4 mensajes/año por cliente
}
```

En `DEFAULTS`:
```js
rebooking: { enabled: true, daysThreshold: null, maxPerYear: 4 }
```

### Nuevo archivo: `src/scheduling/rebooking-cron.js`

Cron diario a las **10:00 Madrid**:

```
Para cada flow con rebooking.enabled = true:
  threshold = flow.rebooking.daysThreshold || REBOOKING_DEFAULTS[flow.sector].days
  Si threshold es null → skip (inmobiliaria)
  
  Obtener todos los appointments pasados del businessId
  Agrupar por cliente (patientName + phone normalizado)
  Para cada cliente:
    lastVisit = max(appointment.date) del pasado
    hasUpcoming = any appointment.date > today
    Si hasUpcoming → skip
    Si (hoy - lastVisit) < threshold → skip
    Si yaEnviado(businessId, phone) en los últimos threshold días → skip
    → sendRebookingEmail(client, config, lastVisit)
    → marcar rebooking_sent[businessId+phone] = now
```

Anti-spam en memoria: `Map<businessId:phone, lastSentAt>` — persiste en `organizations.rebooking_sent_log` (JSON) en Supabase.

### Nuevo archivo: `src/notifications/rebooking-notifications.js`

**`sendRebookingEmail(client, config, lastVisitDate)`**  
- Para: `client.email`
- Asunto varía por sector (copy de REBOOKING_DEFAULTS[sector].label)
- Trilingüe (es/eu/gl según `config.language`)
- CTA: "Reservar cita" → `tel:{ownerPhone}` (llamar al asistente) o URL de reserva si config la tiene
- Incluye: fecha última visita, nombre del negocio, teléfono de contacto

Ejemplo español peluquería:
```
Hola Ana 👋

Han pasado 6 semanas desde tu última visita a Peluquería Garazi.
Tu melena te está pidiendo un poco de cariño 💇

¿Quieres reservar tu próxima cita?
[Llamar para reservar] → tel:+34944000000

Hasta pronto,
Peluquería Garazi
```

### Wiring en `server.js` / `cron.js`

`rebooking-cron.js` expone `startRebookingCron()` — se llama desde `server.js` al arrancar, igual que `startCron()`.

---

## Sistema C — Critical Date Automations

### Store: `src/scheduling/critical-dates.js`

```js
class CriticalDatesStore {
  constructor() {
    this.dates = new Map(); // id → CriticalDate
  }
}

// Schema de cada entrada:
{
  id,           // uuid
  businessId,
  clientName,
  clientEmail,
  clientPhone,
  type,         // ver tabla de tipos abajo
  dueDate,      // 'YYYY-MM-DD'
  notes,        // texto libre: "ITV furgoneta Renault Trafic"
  advanceDays,  // [30, 15, 7] — cuándo avisar
  sentReminders,// ['30', '7'] — ya enviados
  createdAt,
  active: true
}
```

### Tipos por sector

```js
const CRITICAL_DATE_TYPES = {
  // Taller
  itv_expiry:         { label: 'Vencimiento ITV',       emoji: '🚗', sectors: ['taller'] },
  service_due:        { label: 'Revisión de vehículo',   emoji: '🔧', sectors: ['taller'] },
  insurance_renewal:  { label: 'Renovación de seguro',   emoji: '📋', sectors: ['taller', 'asesoria'] },
  // Veterinaria
  vaccine_due:        { label: 'Vacuna pendiente',       emoji: '💉', sectors: ['veterinaria', 'clinica'] },
  annual_checkup:     { label: 'Revisión anual',         emoji: '🩺', sectors: ['veterinaria', 'clinica'] },
  deworming:          { label: 'Desparasitación',        emoji: '🐾', sectors: ['veterinaria'] },
  // Asesoría
  tax_filing:         { label: 'Declaración de renta',   emoji: '📊', sectors: ['asesoria'] },
  quarterly_vat:      { label: 'Liquidación IVA',        emoji: '🧾', sectors: ['asesoria'] },
  annual_accounts:    { label: 'Cuentas anuales',        emoji: '📁', sectors: ['asesoria'] },
  // Clínica / Farmacia
  prescription_renewal: { label: 'Renovación receta',   emoji: '💊', sectors: ['farmacia', 'clinica'] },
  // Gimnasio / Academia
  membership_renewal: { label: 'Renovación membresía',   emoji: '🏋️', sectors: ['gimnasio'] },
  exam_date:          { label: 'Fecha de examen',        emoji: '📝', sectors: ['academia'] },
  enrollment_deadline:{ label: 'Plazo de matrícula',     emoji: '🎓', sectors: ['academia'] },
};
```

### Nueva herramienta de IA: `add_critical_date`

Definición OpenAI function-calling:
```json
{
  "name": "add_critical_date",
  "description": "Registra una fecha crítica del cliente para enviarle recordatorios automáticos (ITV, vacuna, declaración, etc.)",
  "parameters": {
    "type": "object",
    "properties": {
      "client_name":  { "type": "string" },
      "client_email": { "type": "string" },
      "client_phone": { "type": "string" },
      "type":         { "type": "string", "description": "itv_expiry | vaccine_due | tax_filing | etc." },
      "due_date":     { "type": "string", "description": "YYYY-MM-DD" },
      "notes":        { "type": "string" }
    },
    "required": ["client_name", "type", "due_date"]
  }
}
```

Añadir a `ToolExecutor.DEFINITIONS` y `ToolExecutor._handlers` (junto a `book_appointment`).

### Cron diario a las 09:00: `checkAndSendCriticalDateReminders()`

```
Para cada date activa:
  Para cada advanceDay en [30, 15, 7]:
    targetDate = dueDate - advanceDay días
    Si hoy === targetDate Y '${advanceDay}' no está en sentReminders:
      sendCriticalDateReminder(date, advanceDay)
      sentReminders.push('${advanceDay}')
      persistir en Supabase
```

Se integra en `cron.js` → `runAutomations()` llama también a `checkAndSendCriticalDateReminders()`.

### Nuevo archivo: `src/notifications/critical-date-notifications.js`

**`sendCriticalDateReminder(criticalDate, daysUntilDue)`**  
- Para: `criticalDate.clientEmail`
- Asunto varía: `🚗 Tu ITV vence en 30 días — no olvides pedir cita`
- Copy específico por tipo y `daysUntilDue` (30 = tranquilo, 15 = aviso, 7 = urgente)
- Incluye: fecha exacta, notas, teléfono del negocio para gestionar

### Nuevas rutas: `src/api/routes-critical-dates.js`

```
POST   /api/critical-dates           — authMiddleware (api-key o session JWT)
GET    /api/critical-dates/:businessId — adminAuth (admin panel)
DELETE /api/critical-dates/:id       — adminAuth
PATCH  /api/critical-dates/:id       — adminAuth (actualizar fecha)
```

Ruta `POST` usada tanto por la IA (tool callback) como por el admin panel.

### Supabase: tabla `critical_dates`

```sql
CREATE TABLE critical_dates (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id   TEXT NOT NULL,
  client_name   TEXT NOT NULL,
  client_email  TEXT,
  client_phone  TEXT,
  type          TEXT NOT NULL,
  due_date      DATE NOT NULL,
  notes         TEXT,
  advance_days  INT[]    DEFAULT '{30,15,7}',
  sent_reminders TEXT[]  DEFAULT '{}',
  active        BOOLEAN  DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Archivos afectados

| Archivo | Tipo | Sistema |
|---------|------|---------|
| `src/core/call-session.js` | Modify | A |
| `src/tools/executor.js` | Modify | A, C |
| `src/core/voice-pipeline.js` | Modify | A |
| `src/automations/post-call-handler.js` | Create | A |
| `src/notifications/call-notifications.js` | Create | A |
| `src/automations/flow-manager.js` | Modify | B |
| `src/scheduling/rebooking-cron.js` | Create | B |
| `src/notifications/rebooking-notifications.js` | Create | B |
| `src/scheduling/critical-dates.js` | Create | C |
| `src/scheduling/cron.js` | Modify | C |
| `src/notifications/critical-date-notifications.js` | Create | C |
| `src/api/routes-critical-dates.js` | Create | C |
| `server.js` | Modify | A, B, C |

---

## Prioridad de implementación

1. **A** — Mayor impacto inmediato de negocio (el cliente recibe confirmación de cita → reduce no-shows)
2. **B** — Revenue directo (retención de clientes sin esfuerzo)
3. **C** — Diferenciación de producto (nadie más tiene esto por sector)

---

## Spec self-review

**Placeholders:** ninguno — todos los tipos, rutas y schemas son concretos.

**Consistencia interna:**
- `ToolExecutor` necesita acceso al `pipeline` para obtener la sesión activa → se resuelve pasando `callId` en el contexto del tool executor (ya disponible en `_handleToolCalls` en voice-pipeline.js) ✅
- `postCallHandler` usa `flowManager` y `scheduler` como singletons importados directamente ✅  
- `sendWhatsApp` (Callmebot) ya exportado desde `whatsapp.js` ✅
- `rebooking-cron` comparte la misma Map de appointments del `scheduler` singleton ✅
- `CriticalDatesStore` — si la DB no está habilitada, trabaja solo en memoria (mismo patrón que FlowManager) ✅

**Scope:** tres sistemas independientes, cada uno con su propio conjunto de archivos. Pueden implementarse en orden sin dependencias entre B y C.

**Ambigüedad resuelta:**
- WA al CLIENTE: no (requiere Twilio WA Business). WA al PROPIETARIO: sí (Callmebot existente)
- "Sentimiento" de la llamada: se detecta en `AnalyticsEngine.recordCall` → disponible en `callData`; si no existe, se omite del summary email
- La herramienta `add_critical_date` solo está disponible para asistentes cuyo sector tenga tipos relevantes (configurable en el assistant JSON)
