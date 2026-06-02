# Fisioterapia & Rehabilitación — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `fecha_alta` | fecha YYYY-MM-DD | Cuando el paciente recibe el alta |
| `tipo_lesion` | texto | Opcional, para personalizar mensajes |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `seguimiento_post` | 14 días desde última sesión (si completada) | 14 | `onlyIfCompleted: true` |
| `mantenimiento` | 90 días desde `fecha_alta` | 90 | Para reactivar pacientes dados de alta |

## Preguntas durante la llamada

- "¿Ha recibido el alta médica?"
- "¿Cómo se encuentra desde la última sesión?"

## Mensaje de ejemplo

> Hola Gorka 👋 Te escribimos desde Fisioterapia Aitziber. Han pasado 2 semanas desde tu última sesión. ¿Cómo va la recuperación? ¿Quieres reservar un seguimiento?
