# Conector de integraciones (v1)

Ataca la objeción nº1 de la crítica sectorial: "solo hablamos con Google
Calendar → doble tecleo y overbooking". Motor genérico bidireccional por webhook
firmado (HMAC-SHA256). **Inerte** hasta que el negocio lo configura → cero riesgo.

## Configuración por negocio

En `organizations.automation_config.config.integrations`:

```json
{
  "enabled": true,
  "outbound": [
    { "url": "https://hooks.zapier.com/...", "secret": "clave-compartida",
      "events": ["appointment.saved", "appointment.cancelled"] }
  ],
  "inboundSecret": "otra-clave-para-lo-que-entra"
}
```

- `outbound`: a dónde EMPUJAMOS los eventos. `events` opcional (si se omite, todos).
- `inboundSecret`: clave para verificar lo que el sistema externo nos ENVÍA.

## Salida (NodeFlow → sistema externo)

Cuando se crea/cancela una cita, hacemos `POST` a cada `url` suscrita:

```
Headers: X-NodeFlow-Event, X-NodeFlow-Timestamp,
         X-NodeFlow-Signature = HMAC_SHA256(`${timestamp}.${body}`, secret)
Body: { "event": "appointment.saved", "org_id": "...", "at": "ISO",
        "data": { id, patientName, phone, service, date, time, duration, status, location } }
```

Eventos: `appointment.saved`, `appointment.cancelled`, `lead.registered`.
Reintentos ante 5xx/429 (no ante 4xx), timeout 5s, fail-open (un webhook caído
nunca afecta a la llamada/cita).

## Entrada (sistema externo → NodeFlow) — evita overbooking

El sistema externo firma igual (`X-NodeFlow-Timestamp` + `X-NodeFlow-Signature`
con el `inboundSecret`) y llama:

- `POST /api/integrations/:orgId/ping` — comprobar credenciales.
- `POST /api/integrations/:orgId/appointments` — body `{ patientName, phone, service, date, time, location? }` → crea/bloquea el hueco (respeta solape → 409 si ocupado).
- `POST /api/integrations/:orgId/appointments/:id/cancel` — body `{ patientName }`.

Reutiliza el mismo motor de reservas que el bot (validación + solape + persistencia).

## Env opcionales

`INTEGRATION_TIMEOUT_MS` (5000), `INTEGRATION_MAX_ATTEMPTS` (3).

## Pendiente (v2)

Conectores nativos por cluster (Clinic Cloud/Gesden salud, Booksy/Fresha belleza,
CoverManager restauración…), plantilla Zapier publicada, panel de configuración
en el portal, y `source` en el payload para evitar eco en setups bidireccionales.
