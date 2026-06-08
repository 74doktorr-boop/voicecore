# NodeFlow Lifecycle Reminders — Diseño

**Fecha:** 2026-06-02  
**Estado:** Aprobado

---

## Objetivo

Sistema de recordatorios automáticos personalizados por ciclo de vida del cliente. Cada negocio NodeFlow configura avisos por email (o WhatsApp cuando esté disponible) que se envían al cliente en el momento adecuado según su historial: antes de que caduque la ITV, cuando es hora de cortarse el pelo, cuando va a vencer la cuota del gimnasio.

El sistema incluye además:
- **Memoria persistente de llamadas** por contacto, para personalizar cada interacción futura
- **Motor de llamadas salientes** construido pero desactivado (flag `enabled: false`) hasta validación

---

## Arquitectura general

### Módulos nuevos

| Archivo | Responsabilidad |
|---------|----------------|
| `src/lifecycle/scheduler.js` | Cron cada 30 min: procesa `scheduled_reminders` pendientes y dispara envíos |
| `src/lifecycle/reminder-engine.js` | Lógica de negocio: cuándo crear recordatorios y para qué servicio |
| `src/lifecycle/call-memory.js` | CRUD de `contact_memory` y `call_summaries` |
| `src/lifecycle/transcript-analyzer.js` | Análisis GPT asíncrono post-llamada con retry |
| `src/notifications/client-whatsapp.js` | WA a clientes (canal distinto al Callmebot de alertas al owner) |

### Módulos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/automations/post-call-handler.js` | Añadir enqueue a `transcript-analyzer` tras persistir la llamada |
| `src/assistants/prompt-generator.js` | Añadir `buildCallContext()` que carga memoria antes de cada llamada |
| `src/api/routes-portal.js` | Nuevos endpoints: sector_data, reminder config, dashboard de seguimientos |
| `server.js` | Registrar lifecycle cron en el arranque |

### Tablas nuevas en Supabase

| Tabla | Función |
|-------|---------|
| `contact_memory` | Estado acumulado de la relación con cada contacto |
| `call_summaries` | Registro inmutable de resúmenes por llamada |
| `scheduled_reminders` | Cola de recordatorios pendientes/enviados/fallidos |
| `org_reminder_config` | Configuración personalizada de intervalos por organización |
| `org_campaigns` | Campañas estacionales org-wide (ruedas, matrículas, etc.) |
| `scheduled_outbounds` | Llamadas salientes programadas — **OCULTO, desactivado** |

---

## Memoria persistente de llamadas

### Tabla `contact_memory`

Una fila por contacto. Se actualiza acumulativamente tras cada llamada.

```sql
create table contact_memory (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid references organizations(id) on delete cascade,
  contact_id       uuid references contacts(id) on delete cascade,
  call_count       int not null default 0,
  last_call_at     timestamptz,
  last_call_summary text,
  preferences      jsonb not null default '{}',
  -- {"horario": "tarde", "idioma": "eu", "tono": "informal", "nombre_mascota": "Tobi"}
  sensitivities    jsonb not null default '{}',
  -- {"no_llamar_manana": true, "alergia_latex": true}
  no_whatsapp      boolean not null default false,
  no_email         boolean not null default false,
  no_sms           boolean not null default false,
  failed_attempts  int not null default 0,
  last_failed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, contact_id)
);
```

**Nota sobre `full_history`:** No se almacena en esta tabla. El historial completo está en `call_summaries`. Cuando se necesita contexto para una llamada, se consultan las últimas N filas de `call_summaries` directamente. Esto evita desincronización.

**Flags de no contactar:** Tres flags independientes (`no_whatsapp`, `no_email`, `no_sms`). Si alguien pide no ser contactado en absoluto, los tres a `true`. Son permanentes y no expiran. Tienen prioridad absoluta sobre cualquier recordatorio programado.

**`failed_attempts`:** Se incrementa cada vez que el contacto no contesta o el envío falla. Si llega a 3 y han pasado menos de 30 días desde `last_failed_at`, no se crean nuevos recordatorios salientes para ese contacto.

### Tabla `call_summaries`

Registro inmutable. Una fila por llamada.

```sql
create table call_summaries (
  id               uuid primary key default gen_random_uuid(),
  call_session_id  text references calls(call_sid),
  org_id           uuid references organizations(id),
  contact_id       uuid references contacts(id),
  summary          text not null,
  outcome          text check (outcome in (
                     'booked','rescheduled','declined','no_answer',
                     'callback_requested','wrong_number','do_not_contact','voicemail_left'
                   )),
  extracted_data   jsonb default '{}',
  -- datos extraídos: {"fecha_itv": "2026-09-05", "nombre_mascota": "Tobi", "km": "85000"}
  topics           text[] default '{}',
  -- tags: ["vacuna","itv","cambio_aceite","presupuesto"]
  created_at       timestamptz not null default now()
);
```

### Flujo de memoria post-llamada

```
llamada termina → post-call-handler.handle(callData)
  → (existente) persist call, upsert contact, webhooks, emails...
  → (nuevo) processingQueue.enqueue({
      callSessionId, contactId, orgId, transcript
    })

processingQueue — procesada por cron cada 5 min (o inmediata si carga baja):
  → transcriptAnalyzer.analyze(transcript)
      Prompt GPT: "Resume esta llamada en 2-3 frases. Determina el outcome.
                   Extrae preferencias del cliente (horario, idioma, sensitivities).
                   Extrae datos estructurados (fechas ITV, nombre mascota, km).
                   Devuelve JSON con: {summary, outcome, preferences, sensitivities,
                   extracted_data, topics}"
      → Retry hasta 3 veces si GPT falla
      → Si falla las 3: log.error con callSessionId — NUNCA falla silenciosamente
      → insert call_summaries (inmutable)
      → upsert contact_memory:
          - call_count + 1
          - last_call_at = now
          - last_call_summary = summary
          - preferences = mergePreferences(existentes, nuevas)
            (merge campo a campo: nuevas sobreescriben las existentes)
          - sensitivities = merge(existentes, nuevas)
          - Si outcome = 'do_not_contact':
              no_whatsapp = true, no_email = true, no_sms = true
          - Si outcome = 'no_answer':
              failed_attempts + 1, last_failed_at = now
      → Si extracted_data contiene fechas (ITV, vacuna, etc.):
          → contacts.sector_data UPDATE con esos datos
          → reminderEngine.recalculate(contactId, orgId) — cancela viejos, crea nuevos
```

### Cold start — primera llamada

Si `call_count === 0`, no hay historial. `buildCallContext()` devuelve solo `sector_data` + nombre + teléfono. El prompt no incluye bloque de historial. El asistente trata al contacto como cliente nuevo, sin mencionar el sistema.

### Integración en `prompt-generator.js`

```javascript
async function buildCallContext(contactId, orgId) {
  const [memory, recentCalls, contact] = await Promise.all([
    db.from('contact_memory').select('*')
      .eq('contact_id', contactId).eq('org_id', orgId).maybeSingle(),
    db.from('call_summaries').select('summary, outcome, topics, created_at')
      .eq('contact_id', contactId).eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(5),
    db.from('contacts').select('name, phone, sector_data')
      .eq('id', contactId).maybeSingle(),
  ]);

  if (!memory || memory.call_count === 0) {
    return { isFirstCall: true, sectorData: contact?.sector_data || {} };
  }

  return {
    isFirstCall: false,
    callCount: memory.call_count,
    lastCallAt: memory.last_call_at,
    lastCallSummary: memory.last_call_summary,
    preferences: memory.preferences,
    sensitivities: memory.sensitivities,
    recentCalls: recentCalls || [],
    sectorData: contact?.sector_data || {},
  };
}
```

El contexto se inyecta en el prompt como bloque de texto si `!isFirstCall`. Ejemplo:

> *"Es la 3ª vez que llama. Última llamada (12 may): reservó para Tobi (vacuna anual). Prefiere citas por la tarde, habla en euskera. Tono: cercano."*

---

## Lifecycle por sector

### Tabla `scheduled_reminders`

```sql
create table scheduled_reminders (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references organizations(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  service_key     text not null,
  -- 'corte_pelo' | 'itv' | 'vacuna_anual' | 'cambio_aceite' | etc.
  channel         text not null check (channel in ('email', 'whatsapp', 'sms')),
  scheduled_for   timestamptz not null,
  status          text not null default 'pending'
                  check (status in (
                    'pending','sending','sent','failed','cancelled','postponed'
                  )),
  sent_at         timestamptz,
  failed_reason   text,
  postponed_from  uuid references scheduled_reminders(id),
  postponed_days  int,
  message_preview text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_reminders_pending
  on scheduled_reminders (org_id, scheduled_for)
  where status = 'pending';
```

### Tabla `org_reminder_config`

```sql
create table org_reminder_config (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references organizations(id) on delete cascade unique,
  config     jsonb not null default '{}',
  -- {
  --   "corte_pelo":  { "days": 24, "channel": "email", "enabled": true },
  --   "itv":         { "days": 60, "channel": "email", "enabled": true },
  --   "vacuna_anual":{ "days": 14, "channel": "email", "enabled": true }
  -- }
  updated_at timestamptz not null default now()
);
```

Si un negocio no tiene fila en esta tabla, se usan los defaults del sector definidos en `reminder-engine.js`.

### Defaults por sector (`reminder-engine.js`)

Tipos de trigger:
- `from_last_appointment` — fecha última cita + N días
- `before_sector_data_field` — campo_fecha − N días
- `from_sector_data_field` — campo_fecha + N días
- `seasonal` — día/mes fijo anual → genera `org_campaigns`, no recordatorios individuales
- `inactivity` — si no hay actividad en N días desde campo (requiere dato disponible)
- `from_last_if_no_new` — solo si no hay cita posterior ya reservada
- `custom_frequency` — según campo configurable en `sector_data`
- `only_if_completed` — solo si el estado de la cita es `completed` (no `cancelled`)

```javascript
const SECTOR_DEFAULTS = {
  peluqueria: {
    corte_pelo:        { days: 24,  trigger: 'from_last_appointment',
                         service_filter: ['corte', 'pelo'] },
    color_tinte:       { days: 35,  trigger: 'from_last_appointment',
                         service_filter: ['color', 'tinte'] },
    tratamiento:       { days: 28,  trigger: 'from_last_appointment',
                         service_filter: ['tratamiento'] },
    permanente:        { days: 70,  trigger: 'from_last_appointment',
                         service_filter: ['permanente'] },
  },

  taller: {
    cambio_aceite:     { days: 335, trigger: 'from_sector_data_field',
                         field: 'fecha_ultimo_aceite' },
    // fecha_ultimo_aceite: MANUAL por el dueño en el portal
    itv:               { days: 60,  trigger: 'before_sector_data_field',
                         field: 'fecha_vencimiento_itv' },
    // fecha_vencimiento_itv: MANUAL por el dueño. Si el cliente no sabe → skip.
    revision_general:  { days: 335, trigger: 'from_last_appointment' },
    ruedas_verano:     { trigger: 'seasonal', month: 4,  day: 1 },
    ruedas_invierno:   { trigger: 'seasonal', month: 10, day: 1 },
  },
  // sector_data campos: matricula, marca_modelo, fecha_ultimo_aceite,
  //                     fecha_vencimiento_itv, km_aproximados

  dental: {
    revision_anual:    { days: 330, trigger: 'from_last_appointment',
                         service_filter: ['revisión', 'revision', 'check'] },
    limpieza:          { days: 165, trigger: 'from_last_appointment',
                         service_filter: ['limpieza'] },
    ortodoncia:        { days: 25,  trigger: 'from_last_appointment',
                         service_filter: ['ortodoncia'], flag: 'only_if_completed' },
    post_tratamiento:  { days: 12,  trigger: 'from_last_appointment',
                         service_filter: ['extracción', 'implante', 'endodoncia'],
                         flag: 'only_if_completed' },
  },
  // sector_data campos: tratamiento_activo, ortodoncista_asignado,
  //                     proxima_revision, historial_tratamientos

  estetica: {
    facial:            { days: 28, trigger: 'from_last_appointment',
                         service_filter: ['facial'] },
    depilacion_laser:  { days: 35, trigger: 'from_last_appointment',
                         service_filter: ['láser', 'laser'] },
    depilacion_cera:   { days: 28, trigger: 'from_last_appointment',
                         service_filter: ['cera'] },
    tratamiento_corporal: { days: 21, trigger: 'from_last_appointment',
                            service_filter: ['corporal'] },
  },
  // sector_data campos: tipo_piel, zona_depilacion, tratamiento_habitual, alergias_productos

  veterinaria: {
    vacuna_anual:      { days: 14,  trigger: 'before_sector_data_field',
                         field: 'fecha_proxima_vacuna' },
    desparasitacion:   { days: 70,  trigger: 'from_last_appointment',
                         service_filter: ['desparasitación', 'desparasitacion'] },
    revision_anual:    { days: 330, trigger: 'from_last_appointment',
                         service_filter: ['revisión', 'revision', 'chequeo'] },
    post_cirugia:      { days: 10,  trigger: 'from_last_appointment',
                         service_filter: ['cirugía', 'cirugia', 'operación'],
                         flag: 'only_if_completed' },
  },
  // sector_data campos: nombre_mascota, especie_raza, fecha_nacimiento_mascota,
  //                     fecha_ultima_vacuna, fecha_proxima_vacuna, veterinario_asignado

  gimnasio: {
    renovacion_cuota:  { days: 5, trigger: 'before_sector_data_field',
                         field: 'fecha_vencimiento_cuota' },
    reactivacion:      { days: 14, trigger: 'inactivity',
                         data_field: 'ultimo_checkin',
                         requires: 'checkin_data' },
    // requires: 'checkin_data' → si el gym no registra check-ins en NodeFlow,
    // este trigger se ignora silenciosamente
  },
  // sector_data campos: tipo_membresia, fecha_vencimiento_cuota,
  //                     actividades_preferidas, ultimo_checkin

  fisioterapia: {
    seguimiento_post:  { days: 14,  trigger: 'from_last_appointment',
                         flag: 'only_if_completed' },
    mantenimiento:     { days: 90,  trigger: 'from_sector_data_field',
                         field: 'fecha_alta' },
  },
  // sector_data campos: zona_tratamiento, diagnostico, numero_sesiones_completadas,
  //                     fecha_alta, fisioterapeuta_asignado

  psicologia: {
    sesion_habitual:   { trigger: 'custom_frequency',
                         frequency_field: 'frecuencia_sesiones',
                         flag: 'only_if_completed' },
    // IMPORTANTE: los mensajes de psicología NUNCA mencionan el tipo de consulta.
    // Solo "te recordamos que tienes disponibilidad para tu próxima cita".
  },
  // sector_data campos: frecuencia_sesiones (7|14|30 días), terapeuta_asignado,
  //                     modalidad (presencial|online)

  nutricion: {
    revision_mensual:  { days: 28, trigger: 'from_last_appointment' },
    reactivacion:      { days: 42, trigger: 'from_last_if_no_new' },
  },
  // sector_data campos: objetivo (pérdida|ganancia|mantenimiento),
  //                     nutricionista_asignado, alergias_intolerancias

  optica: {
    revision_vista:    { days: 330, trigger: 'from_last_appointment',
                         service_filter: ['revisión', 'graduación', 'agudeza'] },
    reposicion_lentillas: { trigger: 'from_sector_data_field',
                             field: 'suministro_lentillas_dias',
                             days_offset: -5 },
    // days_offset: -5 → avisa 5 días ANTES de que se acaben las lentillas
  },
  // sector_data campos: graduacion_derecha, graduacion_izquierda, tipo_lente,
  //                     fecha_ultima_revision, usa_lentillas, suministro_lentillas_dias

  hotel: {
    aniversario:       { days: 21, trigger: 'before_sector_data_field',
                         field: 'fecha_aniversario' },
    cumpleanos:        { days: 21, trigger: 'before_sector_data_field',
                         field: 'fecha_cumpleanos' },
    recuperacion:      { days: 270, trigger: 'from_last_if_no_new' },
  },
  // sector_data campos: fecha_cumpleanos, fecha_aniversario,
  //                     habitacion_preferida, preferencias_especiales

  academia: {
    renovacion_matricula: { days: 21, trigger: 'before_sector_data_field',
                             field: 'fecha_fin_curso' },
    matricula_nueva:      { trigger: 'seasonal', month: 7, day: 15 },
  },
  // sector_data campos: curso_matriculado, nivel, fecha_fin_curso, profesor_asignado
};
```

### Reglas de creación de recordatorio

1. Se evalúa el trigger cuando: (a) se completa una cita (`status = 'completed'`), o (b) el owner actualiza un campo de `sector_data` manualmente en el portal.
2. Antes de crear: comprobar `no_email / no_whatsapp / no_sms` en `contact_memory`.
3. Antes de crear: si ya existe un reminder `pending` para `(contact_id, service_key)`, **actualizar** la fecha, no duplicar.
4. Si `failed_attempts >= 3` y `last_failed_at < 30 días`: no crear, skip silencioso.
5. Si `requires: 'checkin_data'` y el campo está null: skip silencioso, sin error.
6. Psicología y fisioterapia: solo crear si `appointment.status === 'completed'`.

### Scheduler cron (`lifecycle/scheduler.js`)

Corre cada 30 minutos. Usa un `UPDATE … RETURNING` atómico para prevenir doble envío en reinicios:

```javascript
// RPC SQL en Supabase:
// UPDATE scheduled_reminders
//   SET status = 'sending', updated_at = now()
//   WHERE status = 'pending' AND scheduled_for <= $window_end
//   RETURNING *
// LIMIT 50

async function processReminders() {
  const windowEnd = new Date(Date.now() + 30 * 60 * 1000);
  const reminders = await db.rpc('claim_pending_reminders', {
    p_window_end: windowEnd.toISOString(), p_limit: 50
  });

  for (const reminder of reminders) {
    try {
      // Re-verificar do_not_contact (puede haber cambiado después de programarse)
      const memory = await getContactMemory(reminder.contact_id, reminder.org_id);
      if (isBlocked(reminder.channel, memory)) {
        await markCancelled(reminder.id, 'do_not_contact'); continue;
      }

      // Verificar que no se haya reservado nueva cita después de crear este reminder
      if (await hasNewerAppointment(reminder.contact_id, reminder.service_key, reminder.created_at)) {
        await markCancelled(reminder.id, 'appointment_booked'); continue;
      }

      const contact = await getContact(reminder.contact_id);
      const orgConfig = await getOrgConfig(reminder.org_id);
      const message = await buildReminderMessage(reminder, contact, memory, orgConfig);

      const sent = await dispatch(reminder.channel, contact, message);

      if (sent) {
        await markSent(reminder.id);
      } else {
        await markFailed(reminder.id, 'send_error');
        await incrementFailedAttempts(reminder.contact_id, reminder.org_id);
      }
    } catch (err) {
      await markFailed(reminder.id, err.message);
      log.error(`Reminder ${reminder.id} failed: ${err.message}`);
    }
  }
}
```

---

## Canales de notificación

### Prioridad de canales

El teléfono del cliente es el canal principal. El orden de dispatch es:

1. **WhatsApp** (primario) — si `wa_opted_in = true` y proveedor configurado → ~€0.02/conversación
2. **SMS** (fallback) — si WA falla o no hay opt-in WA, pero sí número → ~€0.05/SMS via Twilio
3. **Email** (terciario) — si no hay número o falla el canal telefónico

### WhatsApp — canal primario

> ⚠️ **El `src/notifications/whatsapp.js` actual usa Callmebot y solo envía al owner. No sirve para clientes.**

Para mensajes a clientes: `src/notifications/client-whatsapp.js` via **Meta WhatsApp Cloud API** (gratis hasta 1.000 conversaciones/mes; mensajes de utilidad ~€0.02).

Setup (una sola vez para toda la plataforma NodeFlow):
1. Meta Business Manager → crear app → añadir producto WhatsApp
2. Verificar negocio NodeFlow (~1-3 días)
3. Número dedicado NodeFlow → obtener `WA_PHONE_NUMBER_ID`
4. Crear y aprobar plantillas de utilidad en Meta (~24h)

Endpoint Meta: `POST https://graph.facebook.com/v19.0/{WA_PHONE_NUMBER_ID}/messages`

Requiere opt-in del cliente. El asistente pregunta en la primera llamada:
> *"¿Le parece bien que le enviemos recordatorios por WhatsApp? Son solo avisos útiles, sin publicidad."*

Se guarda `wa_opted_in: true` en `contacts`. Sin opt-in → fallback automático a SMS o email.

**Si `WA_PHONE_NUMBER_ID` no está en `.env`**: canal WA se salta, siguiente en prioridad.

### SMS — canal fallback

Twilio SMS (credenciales ya presentes en codebase: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`). SMS es independiente de las llamadas de voz — funciona aunque Vonage gestione la voz.

Nuevo `src/notifications/sms.js`. Si `TWILIO_PHONE_NUMBER` no está en `.env`: canal SMS se salta.

### Email — canal terciario

- Proveedor: **Resend** (ya configurado, `src/notifications/email.js`)
- Templates HTML multilingüe (es / eu / gl)
- Opt-out: enlace en footer → `GET /api/portal/unsubscribe?c=:contactId&o=:orgId&ch=email` → `no_email = true`

---

## Portal UI

### Nuevos endpoints en `routes-portal.js`

```
GET  /api/portal/reminder-config              → config actual + defaults del sector
PUT  /api/portal/reminder-config              → guardar org_reminder_config

GET  /api/portal/contacts/:id/sector-data     → sector_data del contacto
PUT  /api/portal/contacts/:id/sector-data     → actualizar + recalcular recordatorios

GET  /api/portal/reminders                    → lista paginada (filtros: status, fecha)
GET  /api/portal/reminders/upcoming           → próximos 30 días agrupados por fecha
POST /api/portal/reminders/:id/send-now       → envío manual inmediato
POST /api/portal/reminders/:id/postpone       → body: { days: 7 }
POST /api/portal/reminders/:id/cancel         → cancelar

GET  /api/portal/unsubscribe                  → opt-out público (no requiere auth)
```

### Sección "Recordatorios automáticos" en Configuración

El portal muestra los servicios del sector con sus defaults. Cada fila:

| Servicio | Canal | Días | Activo |
|----------|-------|------|--------|
| Corte de pelo | Email ▾ | 24 | ✅ |
| Color/tinte | Email ▾ | 35 | ✅ |
| ITV | Email ▾ | 60 | ✅ |

- **Canal**: selector `Email / WhatsApp / SMS` por servicio
- **Días**: número editable (input numérico, mínimo 1, máximo 365)
- **Activo**: toggle. Si se desactiva, los recordatorios pendientes de ese tipo se cancelan.
- Cambios se guardan en `org_reminder_config`. Los defaults del sector se usan si no hay override.

### Datos del cliente en perfil de contacto

Formulario por sector, datos editables inline. Para taller:

```
Matrícula:                 [8421 GKL   ]
Marca/Modelo:              [Ford Focus  ]
Último cambio de aceite:   [12/03/2026  ]  → Próx. aviso: 12/02/2027
Vencimiento ITV:           [05/09/2026  ]  → Próx. aviso: 06/07/2026 ⚠️ 33 días
```

Validaciones antes de guardar:
- Fecha en el pasado → aviso amarillo: *"Esta fecha ya pasó. ¿Es correcta?"* No bloquea el guardado.
- Fecha > 3 años en el futuro → aviso: *"¿Es correcta esta fecha?"*
- Al guardar: `reminderEngine.recalculate(contactId, orgId)` — cancela recordatorios existentes del contacto para ese campo y crea los nuevos.

### Dashboard "Seguimientos"

**Tab: Próximos 30 días** — agrupado por fecha:

```
📅 Hoy — 3 pendientes
  María García      Corte de pelo    Email    [Enviar ahora] [Posponer 7d] [✕]
  Jon Etxebarria    Vacuna Tobi      Email    [Enviar ahora] [Posponer 7d] [✕]

📅 Esta semana — 7 programados
  Leire Aguirre     Revisión dental  Email    15 jun...
```

**Tab: Historial:**

```
✅ Enviado   | 01 jun | Pedro Ruiz    | Cambio aceite  | Email
✅ Enviado   | 30 may | Leire Aguirre | Corte pelo     | Email
❌ Fallido   | 29 may | Iker Mendez   | ITV            | Email | "Invalid recipient"
⛔ Cancelado | 28 may | Amaia Lasa    | Corte pelo     | Email | Nueva cita reservada
```

**"Enviar ahora"**: crea un nuevo reminder con `scheduled_for = now + 5s`. El scheduler lo procesa en el siguiente ciclo. La UI actualiza el estado optimistamente.

**"Posponer"**: abre modal *"¿Cuántos días posponer? [7]"*. Crea nuevo reminder con `scheduled_for = original + N`, marca el original como `postponed`, guarda `postponed_from` y `postponed_days` para trazabilidad.

---

## Campañas estacionales (`org_campaigns`)

Los triggers `seasonal` (ruedas de verano/invierno, inicio de curso, etc.) son campañas org-wide, no recordatorios individuales. Se gestionan en una tabla separada:

```sql
create table org_campaigns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  service_key    text not null,
  campaign_name  text not null,
  fire_month     int not null check (fire_month between 1 and 12),
  fire_day       int not null check (fire_day between 1 and 31),
  channel        text not null check (channel in ('email', 'whatsapp', 'sms')),
  enabled        boolean not null default true,
  last_fired_year int,  -- año en que se disparó por última vez (previene doble disparo en restart)
  created_at     timestamptz not null default now()
);
```

El scheduler procesa campañas una vez al día. Cuando `today = fire_month/fire_day` Y `last_fired_year != current_year`, genera un `scheduled_reminder` individual para cada contacto activo de la org y actualiza `last_fired_year = current_year`. El `last_fired_year` previene que un restart del servidor en el mismo día dispare la campaña dos veces.

---

## Llamadas salientes (OCULTO)

Toda la infraestructura se construye pero queda desactivada. No aparece en el portal, ni en documentación de cliente, ni en NODEFLOW.md.

```sql
create table scheduled_outbounds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid references organizations(id) on delete cascade,
  contact_id     uuid references contacts(id) on delete cascade,
  service_key    text not null,
  scheduled_for  timestamptz not null,
  status         text not null default 'pending'
                 check (status in ('pending','calling','completed','failed','cancelled')),
  enabled        boolean not null default false,
  -- SIEMPRE false hasta activación explícita
  created_at     timestamptz not null default now()
);
```

El lifecycle engine puede crear registros aquí cuando `outbound_calls_enabled = true` en org_reminder_config. El scheduler de llamadas solo ejecuta filas donde `enabled = true`. Por ahora: ninguna.

---

## Casos de borde — tabla de comportamiento garantizado

| Situación | Comportamiento |
|-----------|---------------|
| `sector_data` field null | No se crea recordatorio. Silencioso. |
| `no_email/no_whatsapp` = true | Reminder marcado `cancelled` al procesar, no al crear |
| Nueva cita reservada antes de enviar | Reminder cancelado con reason `appointment_booked` |
| Reminder `pending` duplicado para mismo contacto+servicio | Engine hace UPSERT (actualiza fecha, no duplica) |
| GPT análisis falla 3 veces | `log.error` con `callSessionId`. Nunca falla silenciosamente |
| Fecha ITV en el pasado al entrar | Aviso en UI, no bloquea guardado, no crea reminder (fecha pasada) |
| Psicología — cita cancelada | No se crea reminder. Solo `status = 'completed'` lo dispara |
| Gimnasio — sin `ultimo_checkin` | Trigger `inactivity` ignorado silenciosamente |
| `failed_attempts >= 3` y < 30 días | No se crean reminders. Sí se envían si `no_email = false` para campañas |
| WA provider no configurado | Fallback automático a email, sin error |
| Restart del servidor mid-send | Status `sending` se reintenta si lleva > 10 min sin transición a `sent/failed` |
| "Enviar ahora" en reminder ya enviado | Crea nuevo registro independiente, no modifica el existente |
| Opt-out via enlace en email | `no_email = true` en `contact_memory`, no borra historial |

---

## Documentación por sector

Cada sector tendrá su ficha en `docs/sectores/[nombre]-lifecycle.md` con:
- Campos `sector_data` que se recogen en el onboarding
- Intervalos por defecto y lógica de cada uno
- Mensajes de reminder de ejemplo (personalizados con nombre, datos)
- Preguntas que el asistente hace durante la llamada para extraer datos de `sector_data`
- Protocolos especiales (psicología: no mencionar tipo de consulta, etc.)

Estos archivos se crean como parte de la implementación, un fichero por sector.

---

## Archivos afectados — resumen

### Crear
- `src/lifecycle/scheduler.js`
- `src/lifecycle/reminder-engine.js`
- `src/lifecycle/call-memory.js`
- `src/lifecycle/transcript-analyzer.js`
- `src/notifications/client-whatsapp.js`
- `db/schema-migration-lifecycle.sql`
- `docs/sectores/peluqueria-lifecycle.md`
- `docs/sectores/taller-lifecycle.md`
- `docs/sectores/dental-lifecycle.md`
- `docs/sectores/estetica-lifecycle.md`
- `docs/sectores/veterinaria-lifecycle.md`
- `docs/sectores/gimnasio-lifecycle.md`
- `docs/sectores/fisioterapia-lifecycle.md`
- `docs/sectores/psicologia-lifecycle.md`
- `docs/sectores/nutricion-lifecycle.md`
- `docs/sectores/optica-lifecycle.md`
- `docs/sectores/hotel-lifecycle.md`
- `docs/sectores/academia-lifecycle.md`

### Modificar
- `src/automations/post-call-handler.js` — añadir enqueue al transcript-analyzer
- `src/assistants/prompt-generator.js` — añadir `buildCallContext()`
- `src/api/routes-portal.js` — añadir 9 endpoints nuevos
- `server.js` — registrar lifecycle cron
- `public/portal/index.html` — añadir sección Seguimientos y campo sector_data en perfil de contacto
- `public/portal/portal.js` — lógica UI para las nuevas secciones
