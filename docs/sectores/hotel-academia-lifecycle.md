# Hotel & Alojamiento / Academia & Formación — Lifecycle & Recordatorios

---

## Hotel & Alojamiento

### Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `fecha_aniversario` | fecha MM-DD | Aniversario de boda o primera estancia |
| `fecha_cumpleanos` | fecha MM-DD | Cumpleaños del huésped |
| `preferencia_habitacion` | texto | Tipo de habitación habitual |

### Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `aniversario` | 21 días ANTES de `fecha_aniversario` | -21 | Aviso anticipado |
| `cumpleanos` | 21 días ANTES de `fecha_cumpleanos` | -21 | Oferta especial |
| `recuperacion` | 270 días desde última estancia (si no hay nueva) | 270 | `from_last_if_no_new` |

### Mensaje de ejemplo

> Hola Mikel 👋 Te escribimos desde Hotel Ría Bilbao. Se acerca vuestro aniversario. ¿Reserváis para celebrarlo con nosotros? Tenemos disponibilidad. Puedes responder o llamarnos.

---

## Academia & Centro de Formación

### Datos sector_data

| Campo | Tipo | Cuándo completar |
|-------|------|-----------------|
| `fecha_fin_curso` | fecha YYYY-MM-DD | Al matricularse |
| `curso_actual` | texto | Nombre del curso en curso |

### Intervalos de recordatorio

| Servicio | Trigger | Días | Notas |
|----------|---------|------|-------|
| `renovacion_matricula` | 21 días ANTES de `fecha_fin_curso` | -21 | Para cursos recurrentes |

### Campaña estacional

| Campaña | Mes | Día |
|---------|-----|-----|
| Matriculación nueva temporada | 6 (junio) | 1 |

### Mensaje de ejemplo

> Hola Ainhoa 👋 Te escribimos desde Academia de Idiomas Bilbao. Tu curso de inglés termina pronto. ¿Renovamos la matrícula para el próximo trimestre? Puedes responder o llamarnos.

## Protocolo especial

- Las fechas `fecha_aniversario` y `fecha_cumpleanos` son recurrentes anuales (MM-DD). El sistema proyecta automáticamente al próximo año.
