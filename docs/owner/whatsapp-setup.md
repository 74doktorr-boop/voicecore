# Configuración de WhatsApp Business (Meta) — número propio de NodeFlow

NodeFlow usa la **WhatsApp Cloud API oficial de Meta** para enviar a los clientes finales:
confirmaciones de cita, recordatorios 24h antes (con botones CONFIRMAR/CANCELAR → menos
no-shows), peticiones de reseña y mensajes de reactivación. Fase 1 = **un número propio de
NodeFlow compartido** por todos los negocios (env vars). Fase 2 (opcional/Enterprise) = WABA
propio por negocio vía 360dialog.

---

## ⚡ Activación rápida (credenciales de Meta ya en mano)

Si ya tienes el número dado de alta en Meta con **Phone Number ID**, **token permanente** y
**App Secret**, la activación son 4 pasos:

### 1) Poner las variables en EasyPanel
EasyPanel → app NodeFlow → **Environment** → añadir (Guardar = redeploy):

```
WA_PHONE_NUMBER_ID=<Phone Number ID>            # WhatsApp → API Setup
WA_ACCESS_TOKEN=<token permanente>              # SECRETO — System User token
WA_APP_SECRET=<App Secret>                      # SECRETO — App → Settings → Basic
WA_WEBHOOK_VERIFY_TOKEN=nf-wa-5c5f8bcc1904b45e32  # valor libre; usa este mismo en Meta
WA_BUSINESS_ACCOUNT_ID=<WABA ID>                # para el script de plantillas (paso 3)
```

> Los secretos (`WA_ACCESS_TOKEN`, `WA_APP_SECRET`) se pegan **directamente en EasyPanel**,
> nunca en el repo ni en el chat.

### 2) Registrar el webhook en Meta
App de Meta → **WhatsApp → Configuration → Webhook** → *Edit*:
- **Callback URL:** `https://nodeflow.es/whatsapp/webhook`
- **Verify token:** el mismo valor de `WA_WEBHOOK_VERIFY_TOKEN` (arriba)
- *Verify and save* → debe quedar en verde (el servidor responde el `hub.challenge`).
- **Subscribe** al campo **`messages`** (imprescindible para recibir CONFIRMAR/CANCELAR y opt-out).

### 3) Dar de alta las 3 plantillas
Desde tu máquina (el token se pasa por entorno, no se guarda):

```powershell
$env:WA_ACCESS_TOKEN="EAAG..."; $env:WA_BUSINESS_ACCOUNT_ID="123..."
node scripts/wa-submit-templates.js
```

Crea `nodeflow_cita_confirmada`, `nodeflow_cita_recordatorio` y `nodeflow_resena`
(categoría UTILITY). Meta las aprueba en ~1-24h. Estado en WhatsApp Manager → Plantillas.

### 4) Verificar
- **Estado de config** (sin exponer secretos): `GET /api/admin/diagnostics` con
  `Authorization: Bearer <token admin>` → `whatsapp.ready:true` y `whatsapp.secure:true`.
- **Envío de prueba real:** `POST /api/admin/test-whatsapp` con body `{ "phone": "34XXXXXXXXX" }`
  → te llega un WhatsApp desde el número de NodeFlow.

(El token admin se obtiene con `POST /api/admin/auth` usando `DASHBOARD_PASSWORD`.)

Con las plantillas aprobadas, el sistema de recordatorios/confirmaciones/reseñas ya envía solo.

---

## Referencia: montar el número desde cero en Meta

Solo si aún no tienes el número en Meta.

**1. Meta Business Manager** — [business.facebook.com](https://business.facebook.com) → crea el
negocio a nombre de NodeFlow → Configuración del negocio.

**2. Añadir WhatsApp** — Cuentas → Cuentas de WhatsApp → Añadir → nueva cuenta. Usa un número
que NO esté en un WhatsApp personal (dedicado o virtual).

**3. Verificación del negocio** — Info del negocio → Verificación. Nombre legal, dirección,
NIF y documento de empresa. 1-48h. (Puedes avanzar en sandbox mientras.)

**4. Credenciales** — [developers.facebook.com](https://developers.facebook.com) → Crear App
(Business) → añadir producto **WhatsApp**:
- **Phone Number ID** → `WA_PHONE_NUMBER_ID`
- **Temporary token** → solo pruebas
- Producción: **System Users** → crea uno → permiso `whatsapp_business_messaging` → **token
  permanente** → `WA_ACCESS_TOKEN`
- **App Secret**: App → Settings → Basic → `WA_APP_SECRET`
- **WABA ID** (WhatsApp Business Account ID): WhatsApp Manager → Configuración → `WA_BUSINESS_ACCOUNT_ID`

Luego sigue la **Activación rápida** de arriba.

---

## Las 3 plantillas (categoría UTILITY)

| Plantilla | Cuándo | Botones |
|-----------|--------|---------|
| `nodeflow_cita_confirmada` | Al crear la cita | — |
| `nodeflow_cita_recordatorio` | 24h antes | CONFIRMAR / CANCELAR |
| `nodeflow_resena` | 24h después | Dejar reseña (URL) |

Definidas en `scripts/wa-submit-templates.js` (Meta directo) y en
`src/api/routes-whatsapp-connect.js` (auto-alta para 360dialog). Deben ser **UTILITY**, no
MARKETING (mejor entrega y menor coste). Si Meta rechaza una, revisa que no tenga lenguaje
promocional.

---

## Cómo lo usa el código

- **Emisor:** `src/notifications/client-whatsapp.js` (`sendTemplate` / `sendText`,
  `isConfigured`). Si un negocio tiene WABA propio (Fase 2) usa sus credenciales; si no, cae a
  las env vars globales (número NodeFlow).
- **Webhook entrante:** `src/api/routes-whatsapp.js` (`GET/POST /whatsapp/webhook`) — verifica
  la firma `X-Hub-Signature-256` con `WA_APP_SECRET`, procesa respuestas de botón y opt-out.
- **Programación:** `src/lifecycle/*` y `src/scheduling/*` deciden CUÁNDO enviar por sector.

---

## Límites y costes

| Tier | Conversaciones/mes | Coste |
|------|-------------------|-------|
| Gratis | 1.000 | €0 |
| Pago | >1.000 | ~€0,02–0,05/conversación (UTILITY) |

Una "conversación" = todos los mensajes a un cliente en 24h. Con cientos de clientes activos:
unos pocos €/mes.

---

## Soporte Meta

- Docs: [developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp)
- Template rechazada: categoría `UTILITY`, sin palabras promocionales.
- Número falla: confirma que no está en uso en un WhatsApp personal.
