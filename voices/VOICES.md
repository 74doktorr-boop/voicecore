# Voice Profiles

Coloca aquí los archivos WAV de referencia para cada voz clonada.

## Formato requerido
- WAV, mono, 22050 Hz o superior (XTTS v2 acepta cualquier frecuencia)
- Mínimo 6 segundos, recomendado 30+ segundos de audio limpio
- Sin música de fondo, sin eco, sin reverb

## Convención de nombres
El nombre del archivo (sin extensión) es el `voice_id` que se usa en el asistente.

```
voices/
  ane.wav    → voice: "ane"    (locutora femenina vasca)
  mikel.wav  → voice: "mikel"  (locutor masculino vasco)
```

## Usar una voz en un asistente
En el JSON del asistente (`assistants/mi-negocio.json`):

```json
{
  "ttsProvider": "local",
  "language": "eu",
  "voice": "ane"
}
```

## Calidad recomendada
- 30 seg → clonación rápida (aceptable)
- 2-5 min → buena calidad
- 10+ min → excelente (graba en sesiones de 1-2h y segmenta)
