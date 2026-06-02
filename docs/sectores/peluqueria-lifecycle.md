# Peluquería & Barbería — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `tipo_servicio_habitual` | texto | Primera llamada (corte, color, ambos...) |
| `color_referencia` | texto | Si tiene color activo |
| `preferencia_estilista` | texto | Si tiene estilista asignado |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `corte_pelo` | Desde última cita de corte | **24** | Máximo 4 semanas — no superar |
| `color_tinte` | Desde última cita de color | 35 | — |
| `tratamiento` | Desde última cita de tratamiento | 28 | — |
| `permanente` | Desde última cita de permanente | 70 | — |

## Preguntas durante la llamada

- "¿Suele venir para corte, color, o ambos?"
- "¿Tiene alguna estilista de preferencia?"

## Mensaje de ejemplo

> Hola María 👋 Te escribimos desde Peluquería Carmen. Han pasado casi 4 semanas desde tu último corte. ¿Te apetece reservar cita? Puedes responder a este mensaje o llamarnos.

## Protocolo especial

- El intervalo del corte es **máximo 4 semanas (24 días)**. Nunca configurar más de 28 días para cortes.
