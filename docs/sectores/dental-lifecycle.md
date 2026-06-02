# Clínica Dental — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `ortodoncia_activa` | boolean | Si el paciente tiene ortodoncia en curso |
| `ultima_limpieza` | fecha | Tras cada limpieza |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `revision_anual` | 330 días desde última revisión | 330 | — |
| `limpieza` | 165 días desde última limpieza | 165 | Semestral |
| `ortodoncia` | 25 días desde última cita de ortodoncia | 25 | `onlyIfCompleted: true` |
| `post_tratamiento` | 12 días desde extracción/implante/endodoncia | 12 | `onlyIfCompleted: true` |

## Preguntas durante la llamada

- "¿Cuándo fue su última revisión dental?"
- "¿Tiene ortodoncia actualmente?"

## Mensaje de ejemplo

> Hola Ana 👋 Te escribimos desde Clínica Dental Arrate. Es momento de tu revisión semestral. ¿Te reservamos cita? Puedes responder o llamarnos.

## Protocolo especial

- `post_tratamiento` y `ortodoncia` solo se programan si la cita tiene estado `completed`.
