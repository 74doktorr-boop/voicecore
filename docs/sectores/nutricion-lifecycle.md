# Nutrición & Dietética — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `objetivo` | texto | Primera consulta: pérdida de peso, mantenimiento, etc. |
| `frecuencia_sesiones` | número (días) | Según plan pactado con el nutricionista |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `revision_mensual` | 28 días desde última cita | 28 | Revisión de seguimiento |
| `reactivacion` | 42 días desde última cita (si no hay nueva) | 42 | `from_last_if_no_new` — solo si no hay cita futura |

## Preguntas durante la llamada

- "¿Cuándo fue su última revisión?"
- "¿Tiene marcado algún objetivo concreto?"

## Mensaje de ejemplo

> Hola Amaia 👋 Te escribimos desde Nutrición Salud Bilbao. Ha pasado un mes desde tu última revisión. ¿Reservamos tu seguimiento? Puedes responder o llamarnos.

## Protocolo especial

- `reactivacion` solo se dispara si el cliente no tiene ninguna cita futura reservada.
