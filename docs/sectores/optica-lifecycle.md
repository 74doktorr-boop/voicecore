# Óptica & Optometría — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `suministro_lentillas_dias` | número | Días de suministro de lentillas adquirido |
| `graduacion_actual` | texto | Graduación de la última revisión |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `revision_vista` | 330 días desde última revisión | 330 | — |
| `reposicion_lentillas` | `suministro_lentillas_dias` - 5 días desde hoy | variable | Se calcula desde el día de compra |

## Preguntas durante la llamada

- "¿Cuántos días de lentillas adquirió?"
- "¿Cuándo fue su última graduación?"

## Mensaje de ejemplo

> Hola Miren 👋 Te escribimos desde Óptica Arrizabalaga. Tu suministro de lentillas está a punto de agotarse. ¿Pedimos el próximo lote? Puedes responder o llamarnos.
