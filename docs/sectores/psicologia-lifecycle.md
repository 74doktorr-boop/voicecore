# Psicología & Salud Mental — Lifecycle & Recordatorios

## Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `frecuencia_sesiones` | número (días) | Establecida por el terapeuta: 7, 14, 21, etc. |

## Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `sesion_habitual` | `frecuencia_sesiones` días desde última sesión | variable | `onlyIfCompleted: true`, `custom_frequency` |

## Preguntas durante la llamada

- Nunca preguntar directamente sobre el motivo de consulta.
- "¿Con qué frecuencia suele tener sus sesiones?"

## Mensaje de ejemplo

> Hola Nerea 👋 Te escribimos desde Consulta de Psicología. Ha llegado el momento de tu próxima sesión. ¿Te reservamos cita? Puedes responder a este mensaje o llamarnos directamente.

## ⚠️ PROTOCOLO ESPECIAL — OBLIGATORIO

Los mensajes de recordatorio de psicología **NUNCA** deben mencionar:
- El tipo de consulta
- El nombre del tratamiento o terapia
- Nada que identifique el motivo de la visita
- Palabras como: terapia, ansiedad, depresión, consulta psicológica, etc.

**Mensaje correcto:** "Ha llegado el momento de tu próxima sesión"
**Mensaje incorrecto:** "Ha llegado el momento de tu sesión de terapia de ansiedad"

Este protocolo protege la privacidad del paciente en caso de que el mensaje sea visto por terceros.
