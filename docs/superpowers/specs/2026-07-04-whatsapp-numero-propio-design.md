# WhatsApp con número propio por negocio (Fase 2) — Diseño

> Brainstorming 2026-07-04 con Unai. Camino elegido: **Meta Embedded Signup
> directo** (NodeFlow como proveedor tecnológico de Meta). **360dialog
> descartado por completo.** Add-on de pago `wa_own_number` a 15€/mes (ya
> anunciado en la landing #6).

## Objetivo

Que cada negocio pueda enviar los avisos a SUS clientes (confirmación de
cita, recordatorio, reseña) desde **su propio número de WhatsApp Business**,
en lugar del número compartido de NodeFlow. Es una mejora de pago; sin ella,
el negocio sigue usando el número compartido incluido en su plan.

**Decisión económica (por qué Meta directo):** el coste que hacía inviable la
Fase 2 era el fee del intermediario (360dialog, ~50€/mes/número). Meta directo
elimina ese fee: NodeFlow paga 0€/mes por número, solo los céntimos de Meta por
conversación (categoría utilidad, muy bajo). Con el add-on de 15€/mes el margen
es holgado.

## Estado actual — lo que YA existe y se reutiliza

El sistema que **envía** ya es multi-tenant. No se reconstruye:

- `src/whatsapp/accounts.js` — credenciales por negocio cifradas (AES-256),
  caché, `getWaCredentials`, `saveWaCredentials`, `getBusinessIdByPhoneNumberId`.
- `src/notifications/client-whatsapp.js` — emisor: `sendTemplate`/`sendText`
  aceptan credenciales por negocio o caen a las globales.
- `src/api/routes-whatsapp.js` — webhook que ya resuelve el negocio por
  `phone_number_id` (multi-WABA listo).
- `src/billing/addons.js` — sistema de add-ons de pago (activar/cancelar/gating).
- `src/notifications/reminders.js` — `sendWaConfirmation`/`sendWaReminder`/
  `sendWaReview`, ya con fallback al número compartido.

## Limpieza incluida en este trabajo

- **Borrar** `src/api/routes-whatsapp-connect.js` (es puro 360dialog).
- **Retirar** las ramas `is360dialog` / `apiBase` / `DIALOG360_*` de
  `client-whatsapp.js` y `accounts.js` → el emisor queda con un solo camino (Meta).
- **Borrar** `render.yaml` (archivo muerto de Render.com; hosting real = EasyPanel).

## Arquitectura nueva

### 1. Frontend — botón "Conectar mi WhatsApp" (Embedded Signup)
En el portal, sección WhatsApp: si el add-on `wa_own_number` está activo, se
muestra un botón que lanza el **Embedded Signup de Meta** (SDK JS de Facebook
Login for Business, con un `config_id` de la app). El negocio autoriza en el
popup oficial de Meta y este devuelve al frontend un `code` de autorización más
`phone_number_id` y `waba_id`.

### 2. Backend — intercambio y guardado (`src/whatsapp/meta-connect.js`, nuevo)
- `exchangeCodeForToken(code)` → token de negocio (Graph API `oauth/access_token`
  con `app_id` + `app_secret`).
- `registerNumber(token, phoneNumberId, pin)` → registra el número en la Cloud API.
- `subscribeAppToWaba(token, wabaId)` → suscribe nuestra app al WABA del cliente
  para que sus mensajes entrantes lleguen a nuestro webhook.
- Guarda credenciales con `saveWaCredentials(businessId, { ..., apiBase: null })`
  (`apiBase: null` = Meta directo).
- Nueva ruta `POST /api/portal/whatsapp/connect-meta` (portalAuth + gating).

### 3. Alta de plantillas en el WABA del cliente
Cada WABA es independiente en Meta: las plantillas se aprueban por número. Al
conectar, damos de alta las 3 plantillas UTILITY (`nodeflow_cita_confirmada`,
`nodeflow_cita_recordatorio`, `nodeflow_resena`) en el WABA del cliente (Graph
API `POST /{waba_id}/message_templates` con su token). Los textos se centralizan
en `src/whatsapp/templates.js` (nuevo), reutilizados por este flujo y por
`scripts/wa-submit-templates.js`.

### 4. Envío con fallback robusto (regla de oro: el aviso nunca se pierde)
Los `sendWa*` ya usan credenciales del negocio. Se añade: si el envío con
credenciales propias falla por **auth** (token revocado) o **plantilla no
disponible**, se reintenta con el **número compartido** (global). Si es fallo de
auth, además se marca el número como "necesita reconexión" y se avisa al dueño.

### 5. Gating de pago
Nuevo add-on `wa_own_number` (1500 céntimos/mes) en `addons.js`
(`ADDONS` map + `STRIPE_ADDON_WA_PRICE_ID`). La ruta `connect-meta` y el botón del
portal exigen `hasAddon(org, 'wa_own_number')`. Sin add-on → número compartido.

### 6. Portal — estados de la sección WhatsApp
- **Sin add-on:** "Tus clientes reciben avisos desde el número de NodeFlow
  (incluido)" + CTA "Quiero mi propio número (+15€/mes)".
- **Con add-on, sin conectar:** botón "Conectar mi WhatsApp".
- **Conectado:** su número, estado de sus plantillas, botón "Desconectar".

## Flujo de conexión

```
Portal "Conectar mi WhatsApp" (solo si add-on wa_own_number activo)
  → popup Embedded Signup de Meta → el dueño autoriza
  → Meta devuelve code + phone_number_id + waba_id
  → POST /api/portal/whatsapp/connect-meta
      1. exchangeCodeForToken(code) → token del negocio
      2. registerNumber(token, phone_number_id)
      3. subscribeAppToWaba(token, waba_id)  → mensajes entrantes a nuestro webhook
      4. saveWaCredentials(cifrado, apiBase=null)
      5. alta de las 3 plantillas en el WABA del cliente
  → número propio conectado; el emisor lo usará en la próxima cita
```

## Manejo de errores

| Situación | Respuesta |
|---|---|
| Token caducado / permisos revocados | Envío cae al número compartido + aviso al dueño "reconecta tu WhatsApp" |
| Plantilla recién conectada, en revisión de Meta | Envío cae al número compartido esa vez; al aprobarse (utility, rápido) sale del propio |
| Add-on cancelado o número desconectado | Cae al compartido (sin castigo) |
| Intercambio de code falla | Error claro en el portal; no se guarda credencial parcial |
| Webhook | Firma HMAC compartida (misma app para todos los WABA); negocio resuelto por `phone_number_id` |

## Testing

Todo con mocks de la Graph API — no depende de tener la app de Meta creada:
- `exchangeCodeForToken` / `registerNumber` / `subscribeAppToWaba`: éxito y errores.
- Alta de plantillas: envía las 3 con el token del cliente.
- Guardado: credenciales cifradas con `apiBase: null`.
- Gating: `connect-meta` rechaza (402) sin add-on; acepta con add-on.
- Fallback: envío con token roto → reintenta y sale por el compartido.
- Webhook multi-WABA: eventos de dos WABA distintos se atribuyen a su negocio.
- **E2E real** (conectar un número real y ver salir un WhatsApp): manual,
  cuando Meta levante el bloqueo de registro de desarrollador.

## Seguridad

- Tokens cifrados en reposo (AES-256, ya existe).
- `app_secret` solo en el servidor (nunca al frontend).
- Firma HMAC (`X-Hub-Signature-256`) verificada en el webhook (ya existe).
- Gating server-side en la ruta, no solo en el botón del portal.

## Fuera de alcance (YAGNI)

- **App Review pública de Meta**: se solicita DESPUÉS, con un vídeo del flujo ya
  funcionando. Hasta entonces, se conecta con "acceso estándar" (el propio Unai y
  Osakin como testers de la app). No bloquea construir ni probar con mocks.
- Migración/coexistence de números ya existentes en otros proveedores.
- Idiomas de plantilla más allá de es/eu/gl (ya cubiertos).

## Dependencias externas (de Unai / Meta, en paralelo)

- Desbloqueo del registro de desarrollador de Meta (bloqueo temporal de
  seguridad, 2026-07-04) → crear la app + obtener `app_id`, `app_secret`, `config_id`.
- Crear el precio de Stripe del add-on (lo genera el script, como los otros).
- Verificación de empresa (se dispara al pedir permisos avanzados) y App Review
  (con vídeo) para autoservicio masivo — ambos posteriores a la implementación.
