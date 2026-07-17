# Config por negocio — interruptores opt-in (2026-07-17)

Todas estas opciones viven en `organizations.automation_config.config` y están
**APAGADAS por defecto** (cero riesgo). Se activan por negocio. Salieron de la
crítica sectorial (128 clientes ficticios) y su ronda 2.

> Mientras no exista panel en el portal, se ponen con un `UPDATE` en Supabase
> (o el endpoint de admin de config de la org). Ejemplo al final.

## 1. Guardarraíl configurable — `guardrailExtra`

El asistente ya tiene guardarraíl duro por cluster (salud: nunca consejo
clínico ni precio de tratamiento; legal: nunca asesora, pero SÍ informa y
agenda). `guardrailExtra` añade una matización propia del negocio.

```json
"guardrailExtra": "Sí puedes confirmar que trabajamos con Adeslas y Sanitas."
```

## 2. Alerta de coste — `costAlertThresholdEur`

Avisa al dueño por email al 80% y 100% de este umbral de gasto variable del mes
(voz + mensajes fuera de cuota). Sin poner nada usa `COST_ALERT_THRESHOLD_EUR`
(env, default 25). `0` = desactivado.

```json
"costAlertThresholdEur": 30
```

## 3. Tope DURO de gasto — `costCapEur`

Cuando el gasto variable del mes supera este tope, se **posponen al mes
siguiente los envíos NO esenciales** (seguimientos, reseñas, reactivación,
campañas). **NUNCA** afecta a llamadas entrantes, recordatorios/confirmaciones
de cita ni avisos manuales del dueño. `0`/ausente = desactivado.

```json
"costCapEur": 60
```

## 4. Solicitud de señal / depósito — `deposit`

Al reservar, envía al cliente por WhatsApp la petición de señal con el **enlace
de pago propio del negocio** (Stripe Payment Link, Bizum, etc.). NodeFlow no
procesa el dinero (eso es v2, Stripe Connect). Anti-no-show.

```json
"deposit": { "enabled": true, "amountText": "15 €", "url": "https://buy.stripe.com/xxx" }
```

## 5. Integraciones (conector) — `integrations`

Empuja los eventos de NodeFlow al software del negocio y acepta los suyos de
vuelta (ver `docs/INTEGRACIONES.md`).

```json
"integrations": {
  "enabled": true,
  "outbound": [ { "url": "https://hooks.zapier.com/...", "secret": "clave", "events": ["appointment.saved","appointment.cancelled","lead.registered"] } ],
  "inboundSecret": "clave-de-ingreso"
}
```

## Cómo aplicarlo (Supabase SQL, hace merge sin pisar el resto)

```sql
update organizations
set automation_config = jsonb_set(
  coalesce(automation_config, '{}'::jsonb),
  '{config,deposit}',
  '{"enabled":true,"amountText":"15 €","url":"https://buy.stripe.com/xxx"}'::jsonb,
  true)
where id = '<ORG_ID>';
```

Repite cambiando la ruta (`{config,costCapEur}`, `{config,guardrailExtra}`, …)
y el valor. Todos son independientes y acumulables.

## Pendiente (post-lanzamiento)

Panel en el portal para togglear todo esto sin SQL; Stripe Connect para
procesar la señal de verdad; conectores nativos por cluster.
