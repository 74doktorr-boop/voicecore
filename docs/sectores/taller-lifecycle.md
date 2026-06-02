# Taller Mecánico — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `matricula` | texto | Primera llamada o onboarding |
| `marca_modelo` | texto | Primera llamada o onboarding |
| `fecha_ultimo_aceite` | fecha YYYY-MM-DD | Después de cada cambio de aceite (entrada manual del mecánico) |
| `fecha_vencimiento_itv` | fecha YYYY-MM-DD | Onboarding y cuando caduca (entrada manual) |
| `km_aproximados` | número | Opcional |

**Nota:** `fecha_ultimo_aceite` y `fecha_vencimiento_itv` se introducen manualmente por el dueño del taller. No se calculan automáticamente.

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `cambio_aceite` | 335 días desde `fecha_ultimo_aceite` | 335 | Pre-aviso 30 días antes del año |
| `itv` | 60 días ANTES de `fecha_vencimiento_itv` | -60 | Si el cliente no sabe la fecha → no crear reminder |
| `revision` | 335 días desde última cita de revisión | 335 | — |

## Campañas estacionales (org_campaigns)

| Campaña | Mes | Día | Para todos los clientes |
|---------|-----|-----|------------------------|
| Cambio a ruedas de verano | 4 (abril) | 1 | ✅ |
| Cambio a ruedas de invierno | 10 (octubre) | 1 | ✅ |

## Preguntas durante la llamada

- "¿Me puede indicar la matrícula del vehículo?"
- "¿Recuerda cuándo fue el último cambio de aceite aproximadamente?"
- "¿Sabe cuándo le caduca la ITV?" → Si no sabe: pasar a siguiente sin insistir

## Mensaje de recordatorio de ejemplo

> Hola Carlos 👋 Te escribimos desde Taller Arrate. Ha llegado el momento del cambio de aceite de tu Ford Focus. ¿Te ayudamos a reservar cita? Puedes responder a este mensaje o llamarnos directamente.

## Protocolo especial

- **ITV:** Si el cliente no sabe la fecha de vencimiento, no insistir. El dueño la introduce desde el portal tras confirmar con el cliente.
- **Aceite:** La fecha del último cambio la introduce el mecánico desde el portal tras cada servicio — no se calcula desde las reservas.
