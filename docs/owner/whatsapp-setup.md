# Configuración de WhatsApp Business (Meta) para Recordatorios

NodeFlow usa la API oficial de Meta (WhatsApp Cloud API) para enviar recordatorios a clientes. Este proceso es único y tarda ~2-3 días (por la verificación de Meta).

---

## Resumen del proceso

1. Crear cuenta en Meta Business Manager
2. Añadir producto WhatsApp
3. Verificar el negocio con Meta (~24-48h)
4. Obtener las credenciales (WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN)
5. Crear y enviar template `nodeflow_recordatorio_servicio` para aprobación (~24h)
6. Añadir las credenciales en EasyPanel

---

## Paso 1: Meta Business Manager

1. Ve a [business.facebook.com](https://business.facebook.com)
2. Crea un negocio a nombre de NodeFlow (o el tuyo si ya tienes)
3. Accede a **Configuración del negocio**

---

## Paso 2: Añadir WhatsApp

1. En el panel izquierdo → **Cuentas** → **Cuentas de WhatsApp**
2. → **Añadir** → **Crear una nueva cuenta de WhatsApp**
3. Nombre: "NodeFlow" (o el nombre de tu empresa)
4. Añade un número de teléfono que NO esté ya en WhatsApp personal
   - Recomendado: número de empresa dedicado o número virtual (Twilio, etc.)
   - Si el número está en WhatsApp personal, primero hay que eliminarlo

---

## Paso 3: Verificación del negocio

Meta requiere verificar que eres un negocio real:
1. En **Configuración del negocio** → **Info del negocio** → **Verificación del negocio**
2. Aportar: nombre legal, dirección, CIF/NIF, y un documento de empresa
3. Proceso automático: de 1 a 48 horas

> ⏳ Mientras esperas la verificación, puedes continuar con el Paso 4 en modo sandbox.

---

## Paso 4: Obtener credenciales

Una vez verificado el número:

1. Ve a [developers.facebook.com](https://developers.facebook.com)
2. → Mis Apps → Crear App → **Business** → Siguiente
3. Añadir producto → **WhatsApp**
4. En el panel de WhatsApp:
   - **Phone Number ID** → copia este valor → es `WA_PHONE_NUMBER_ID`
   - **Temporary access token** → úsalo para pruebas
   - **Para producción:** Ve a **System Users** → crea un System User → asígnale permiso `whatsapp_business_messaging` → genera token permanente → es `WA_ACCESS_TOKEN`

---

## Paso 5: Crear el template de mensaje

NodeFlow usa un template pre-aprobado por Meta llamado `nodeflow_recordatorio_servicio`.

1. En el panel de WhatsApp → **Plantillas de mensajes** → **Crear plantilla**
2. Configuración:
   - **Nombre:** `nodeflow_recordatorio_servicio`
   - **Categoría:** `UTILITY` (Utilidad — NO marketing)
   - **Idioma:** Español (España)
3. Cuerpo del mensaje:
   ```
   Hola {{1}} 👋 Te escribimos desde {{2}}. Ha llegado el momento de {{3}}. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.
   ```
   Parámetros:
   - `{{1}}` = nombre del cliente
   - `{{2}}` = nombre del negocio
   - `{{3}}` = descripción del servicio (ej. "tu corte de pelo")

4. Enviar para revisión → Meta la aprueba en ~24 horas

> ⚠️ IMPORTANTE: La categoría debe ser `UTILITY`, no `MARKETING`. Las de utilidad tienen mayor tasa de entrega y menor coste.

---

## Paso 6: Configurar en EasyPanel

Una vez tengas las credenciales:

1. EasyPanel → tu app NodeFlow → **Environment**
2. Añadir:
   ```
   WA_PHONE_NUMBER_ID=123456789012345
   WA_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
   ```
3. Guardar → redeploy automático

---

## Verificar que funciona

Desde el servidor (SSH o EasyPanel terminal):
```bash
node -e "
require('dotenv').config();
const wa = require('./src/notifications/client-whatsapp');
console.log('WA configurado:', wa.isConfigured());
"
```

Debe devolver `WA configurado: true`.

---

## Límites y costes

| Tier | Conversaciones/mes | Coste |
|------|-------------------|-------|
| Gratis | 1.000 | €0 |
| Pago | >1.000 | ~€0.02/conversación |

Una "conversación" = todos los mensajes a un mismo cliente en 24h. Con 500 clientes activos: ~€0–€10/mes.

---

## Soporte Meta

- Documentación oficial: [developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp)
- Si el template es rechazado: revisa que la categoría sea `UTILITY` y que no contenga palabras promocionales.
- Si el número falla: confirma que el número no está en uso en WhatsApp personal.
