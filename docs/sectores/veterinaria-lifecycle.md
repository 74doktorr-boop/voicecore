# Veterinaria & Clínica Animal — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `nombre_mascota` | texto | Primera llamada |
| `especie_raza` | texto | Primera llamada |
| `fecha_nacimiento_mascota` | fecha | Onboarding |
| `fecha_ultima_vacuna` | fecha | Tras cada vacunación |
| `fecha_proxima_vacuna` | fecha | Lo calcula el veterinario tras cada vacuna |
| `veterinario_asignado` | texto | Opcional |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `vacuna_anual` | 14 días ANTES de `fecha_proxima_vacuna` | -14 | Aviso previo |
| `desparasitacion` | 70 días desde última cita de desparasitación | 70 | — |
| `revision_anual` | 330 días desde última revisión | 330 | — |
| `post_cirugia` | 10 días desde cirugía (solo si completada) | 10 | `onlyIfCompleted: true` |

## Preguntas durante la llamada

- "¿Me puede decir el nombre de su mascota?"
- "¿Es perro o gato? ¿Qué raza?"
- "¿Recuerda cuándo fue la última vacuna?" → Si no sabe, continuar

## Mensaje de ejemplo

> Hola Iker 👋 Te escribimos desde Clínica Veterinaria Begoña. La vacuna anual de Tobi está próxima. ¿Le reservamos cita? Puedes responder o llamarnos directamente.

## Protocolo especial

- Usar siempre el nombre de la mascota en el mensaje cuando esté disponible.
- `post_cirugia` solo se programa si el estado de la cita es `completed`.
