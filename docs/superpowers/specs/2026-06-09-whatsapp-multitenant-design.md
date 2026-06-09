# WhatsApp Multi-Tenant — Diseño Técnico
**Fecha:** 2026-06-09  
**Estado:** Aprobado para implementación  
**Proyecto:** NodeFlow — Plataforma de IA para negocios

---

## 1. Problema

El sistema actual usa un único `WA_PHONE_NUMBER_ID` global. Todos los negocios comparten el número de NodeFlow. Los clientes finales reciben mensajes de un número desconocido — no de su dentista o peluquería. Esto destruye la tasa de apertura y no es vendible.

---

## 2. Objetivo

Cada negocio cliente de NodeFlow envía WhatsApp **desde su propio número** (el mismo que tienen en Google Maps, tarjetas de visita, etc.). NodeFlow gestiona todo de forma transparente — el negocio solo hace clic en "Conectar WhatsApp" en el portal una vez.

---

## 3. Arquitectura

### 3.1 Stack

| Capa | Tecnología |
|---|---|
| BSP (Business Solution Provider) | **360dialog** — partner Meta oficial en Europa |
| Embedded Signup | Meta OAuth 2.0 (Facebook Login for Business) |
| Almacenamiento credenciales | Supabase tabla `whatsapp_accounts` |
| API mensajes | 360dialog Partner API (compatible con Meta Cloud API) |
| Webhook entrante | `GET/POST /whatsapp/webhook` (ya construido) |

### 3.2 Flujo de onboarding de un negocio

```
Portal NodeFlow
    │
    ▼
[Botón "Conectar WhatsApp"]
    │
    ▼
Meta Embedded Signup (popup OAuth)
    │  · El negocio autoriza a NodeFlow
    │  · Selecciona/crea su WABA
    │  · Registra su número de teléfono
    ▼
Meta devuelve → code (OAuth)
    │
    ▼
NodeFlow backend: POST /api/portal/whatsapp/connect
    │  · Intercambia code → access_token (360dialog)
    │  · Obtiene phone_number_id y waba_id
    │  · Guarda en Supabase: whatsapp_accounts
    ▼
✅ Negocio conectado — mensajes salen desde su número
```

### 3.3 Flujo de envío de mensaje

```
reminders.js / scheduler.js
    │
    ▼
getWaCredentials(businessId)  ← Supabase
    │  Devuelve { phoneNumberId, accessToken }
    │  Si no tiene WA → fallback a email
    ▼
sendTemplate(phone, template, lang, components, credentials)
    │
    ▼
360dialog API → Meta → Cliente final
(mensaje sale del número del negocio)
```

---

## 4. Base de datos

### Tabla `whatsapp_accounts`

```sql
CREATE TABLE whatsapp_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES organizations(id) ON DELETE CASCADE,
  waba_id           text NOT NULL,
  phone_number_id   text NOT NULL,
  phone_number      text NOT NULL,          -- e.g. "+34 946 123 456"
  display_name      text,                   -- nombre del negocio en WA
  access_token      text NOT NULL,          -- cifrado en reposo
  token_expires_at  timestamptz,            -- null = permanent token
  status            text DEFAULT 'active',  -- active | suspended | pending
  templates_status  text DEFAULT 'pending', -- pending | approved | rejected
  connected_at      timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
```

### Cambio en `organizations`

Añadir campo: `whatsapp_connected boolean DEFAULT false`

---

## 5. Componentes a crear/modificar

### 5.1 NUEVO — `src/notifications/client-whatsapp.js` (modificar)
- Añadir parámetro `credentials` opcional a `sendTemplate()` y `sendText()`
- Si se pasa `credentials`, usa esos `phoneNumberId` + `accessToken`
- Si no, usa las env vars globales (retrocompatible)
- Cambiar `META_API_BASE` a `stoplight.io/360dialog` cuando hay credenciales de negocio

### 5.2 NUEVO — `src/whatsapp/accounts.js`
- `getWaCredentials(businessId)` → busca en Supabase, cachea en memoria (TTL 5min)
- `saveWaCredentials(businessId, { wabaId, phoneNumberId, accessToken, phoneNumber })`
- `revokeWaCredentials(businessId)`
- Cache en-memoria para evitar DB queries en cada mensaje

### 5.3 NUEVO — `src/api/routes-whatsapp-connect.js`
- `GET  /api/portal/whatsapp/status` → estado de conexión del negocio
- `POST /api/portal/whatsapp/connect` → intercambio OAuth code → token (360dialog)
- `DELETE /api/portal/whatsapp/connect` → revoca credenciales
- Auth: `portalAuth` middleware

### 5.4 MODIFICAR — `src/notifications/reminders.js`
- `sendWaReminder(apt, config)` → obtiene credenciales por `apt.businessId`
- `sendWaReview(apt, config)` → ídem

### 5.5 MODIFICAR — `src/scheduling/scheduler.js`
- `bookAppointment()` → obtiene credenciales por `businessId` para confirmación

### 5.6 MODIFICAR — Portal frontend (futuro)
- Botón "Conectar WhatsApp" en settings del negocio
- Muestra estado: Conectado ✅ / Pendiente ⏳ / No conectado

---

## 6. 360dialog — Setup

### Registro
1. Crear cuenta partner en `app.360dialog.io`
2. Obtener `DIALOG360_PARTNER_TOKEN` y `DIALOG360_PARTNER_ID`
3. Añadir a `.env`

### Embedded Signup URL
```
https://hub.360dialog.com/dashboard/app/{PARTNER_ID}/permissions
?redirect_url=https://nodeflow.es/api/portal/whatsapp/connect
&state={businessId}  ← para saber qué negocio está conectando
```

### API de mensajes (360dialog)
Idéntica a Meta Cloud API pero con:
- Base URL: `https://waba.360dialog.io/v1/`
- Auth header: `D360-API-KEY: {apiKey}` (en lugar de Bearer token)

---

## 7. Variables de entorno nuevas

```env
# 360dialog Partner
DIALOG360_PARTNER_TOKEN=your_partner_token
DIALOG360_PARTNER_ID=your_partner_id

# NodeFlow propio (Lebara SIM — para alertas internas y demo)
WA_PHONE_NUMBER_ID=xxx
WA_ACCESS_TOKEN=xxx
WA_WEBHOOK_VERIFY_TOKEN=nodeflow-wa-webhook
```

---

## 8. Templates Meta

Cada negocio necesita los 3 templates aprobados. NodeFlow los envía automáticamente al conectar el WABA:

| Template | Descripción | Variables |
|---|---|---|
| `nodeflow_cita_confirmada` | Confirmación de reserva | nombre, negocio, fecha, hora, servicio |
| `nodeflow_cita_recordatorio` | Recordatorio 24h antes + botones | nombre, negocio, fecha, hora, servicio |
| `nodeflow_resena` | Solicitud de reseña + botón | nombre, negocio, url_reseña |

La aprobación de templates tarda 24-48h por WABA.

---

## 9. Seguridad

- `access_token` de cada negocio se almacena **cifrado en Supabase** (AES-256 con `ENCRYPTION_KEY` env var)
- Nunca se expone en logs ni en API responses
- Revocación instantánea desde el portal
- El webhook valida `WA_WEBHOOK_VERIFY_TOKEN` antes de procesar cualquier mensaje

---

## 10. Roadmap de migración

| Phase | Cuándo | Qué |
|---|---|---|
| **Phase 1** (ahora) | Semana 1-2 | 360dialog + Embedded Signup + multi-WABA |
| **Phase 2** | Mes 2-3 | Aplicar Meta Tech Provider — eliminar 360dialog fees |
| **Phase 3** | Mes 4+ | Dashboard de métricas WA por negocio en portal |

---

## 11. Criterios de éxito

- ✅ Un negocio puede conectar su WhatsApp en < 3 minutos desde el portal
- ✅ Los mensajes salen desde el número del negocio (verificable en conversación del cliente)
- ✅ Si el negocio no tiene WA conectado, el sistema hace fallback a email sin errores
- ✅ Las credenciales de un negocio no son accesibles desde otro (aislamiento por `organization_id`)
- ✅ El webhook existente (`/whatsapp/webhook`) funciona para todos los WABAs conectados
