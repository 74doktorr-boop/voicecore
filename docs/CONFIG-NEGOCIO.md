# Config por negocio — interruptores opt-in (2026-07-17)

Todas estas opciones viven en `organizations.automation_config.config` y están
**APAGADAS por defecto** (cero riesgo). Se activan por negocio. Salieron de la
crítica sectorial (128 clientes ficticios) y su ronda 2.

> **Panel:** guardarraíl extra, aviso/tope de gasto, señal, estancias e
> integraciones se editan desde **Portal → Configuración → Ajustes avanzados**
> (sin SQL). El aforo por servicio (`capacity`) y el idioma en/fr aún van por
> SQL/Asistente. El `UPDATE` de Supabase de abajo sigue valiendo como
> alternativa/para lo no cubierto.

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

## 5. Aforo / clases — `capacity` en el servicio

Un servicio con `capacity > 1` deja de ser cita 1:1: admite varias plazas en el
mismo hueco hasta el aforo (clase de spinning, yoga, sesión de láser…). Sin
`capacity` (o =1) el servicio sigue siendo 1:1 exclusivo, como siempre.

En `automation_config.config.serviceList` (o donde estén los servicios):

```json
{ "name": "WOD", "duration": 60, "price": 10, "capacity": 12 }
```

La disponibilidad muestra `spotsLeft`; al llenarse, el hueco deja de ofrecerse.

## 6. Bonos / paquetes prepagados — tabla `nf_bonos`

Requiere ejecutar `db/migration-bonos.sql` en Supabase (sin ella todo es NO-OP).
Modelo: **se descuenta una sesión AL RESERVAR y se devuelve si se cancela**.

Alta de un bono (por ahora por SQL; luego panel):

```sql
insert into nf_bonos (org_id, phone, service_key, label, total_sessions, expires_at)
values ('<ORG_ID>', '+34600111222', 'wod', 'Bono 10 WODs', 10, '2026-12-31');
```

`service_key` null = vale para cualquier servicio. `expires_at` null = sin
caducidad. El bot consume/reembolsa solo; el saldo se puede consultar con
`getBalance(orgId, phone, serviceKey)`.

## 7. Estancias por noches — `stayUnits` + tabla `nf_stays`

Hotel, residencia de mascotas, guardería: reservar un RANGO de fechas con plazas
por noche. Requiere `db/migration-stays.sql`, la config `stayUnits`, y añadir las
tools `check_stay_availability` y `book_stay` a la lista de tools del asistente.

```json
"stayUnits": [ { "key": "suite", "label": "Suite", "capacity": 4 },
               { "key": "estandar", "label": "Habitación estándar", "capacity": 10 } ]
```

`checkout` es exclusivo (01→04 = 3 noches). El bot consulta disponibilidad por
noche contra el aforo y reserva si caben todas las noches.

## 8. Idioma del asistente — `language`

En `assistant_config.language` (o el idioma del flow):
`es` (default) · `eu` · `gl` · `es+eu` · `es+gl` · **`en`** · **`fr`** · **`es+en`** · **`es+fr`**.

Los bilingües responden en el idioma del cliente. `en`/`fr` y los combos con
inglés/francés son para turismo/costa (hotel, restaurante). El saludo
(`firstMessage`) conviene ponerlo en el idioma correspondiente.

## 9. Integraciones (conector) — `integrations`

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
