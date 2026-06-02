# Gimnasio & Centro Deportivo — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `fecha_vencimiento_cuota` | fecha YYYY-MM-DD | Se actualiza con cada renovación |
| `tipo_cuota` | texto | mensual, trimestral, anual |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `renovacion_cuota` | 5 días ANTES de `fecha_vencimiento_cuota` | -5 | Aviso de renovación |

## Preguntas durante la llamada

- "¿Su cuota vence este mes o el próximo?"

## Mensaje de ejemplo

> Hola Jokin 👋 Te escribimos desde GymPro Bilbao. Tu cuota vence en 5 días. ¿La renovamos? Puedes responder a este mensaje o llamarnos.

## Protocolo especial

- `fecha_vencimiento_cuota` se debe actualizar cada vez que el cliente renueva.
