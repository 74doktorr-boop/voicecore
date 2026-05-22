# Guión de grabación — Voces vascas nativas
## NodeFlow Voice — Referencia para clonación F5-TTS

---

### Instrucciones para el locutor

**Antes de grabar:**
- Habitación cerrada, sin ruido de calle ni ventilación
- Ventanas cerradas, a.a. apagado
- Micro a ~15 cm de la boca, en ángulo (no directo — evita plosivas)
- Si usas móvil: grabadora de voz en máxima calidad, sin auriculares BT
- Haz 2-3 respiraciones lentas antes de empezar
- Tono natural de conversación telefónica — no "locutor de radio"

**Formato de entrega:**
- Nombre del archivo: `tu_nombre.wav` (ej: `ane.wav`, `mikel.wav`)
- Si el móvil graba en M4A: enviar tal cual, se convierte aquí

---

### Texto de referencia (leer en voz alta, una sola toma continua)

> Kaixo, nire izena Ane da eta NodeFlow-en lan egiten dut.
> Gure helburua da euskaraz hitz egiten duen adimen artifiziala sortzea.
> Telefonoz aritzen gara bezeroei laguntzen — hitzorduak hartzen,
> galderak erantzuten eta informazioa ematen.
> Oso gustura nago proiektu honetan parte hartzeaz.
> Euskara gure hizkuntza da eta teknologian presente egon behar du.

*(~20 segundos — suficiente para F5-TTS zero-shot cloning)*

---

### Frases adicionales (opcional — mejoran la calidad del fine-tuning)

Si tienes tiempo, graba también estas frases **por separado** (cada una en un archivo):

```
01. Egun on, klinika dentala, Ane naiz. Nola lagundu dezaket?
02. Une batez itxaron, mesedez. Datuak begiratzen ari naiz.
03. Zure hitzordua baieztatuta dago larunbat honetarako.
04. Barkatu, ez dut ongi entzun. Errepika al dezakezu?
05. Agur! Ederra den eguna. Laster arte!
06. Gaixoaren izena eta telefonoa behar ditut, mesedez.
07. Martitzenean goizeko hamarrak eta erdiak daude libre.
08. Arazorik badu, deitu berriz eta lagunduko dizugu.
09. Eskerrik asko deitu izanagatik. Agur!
10. Oraintxe konektatzen ari naiz zurekin. Segundu bat.
```

Nombrar los archivos: `ane_01.wav`, `ane_02.wav`, etc.

---

### Para el locutor masculino (Mikel u otro)

Mismo texto, mismas instrucciones. Cambiar "Ane" por el nombre del locutor en el texto de referencia.

---

### Tras la grabación: rellenar en voice_profiles.json

Después de grabar, anotar **exactamente** qué dice el fichero de referencia principal
en el campo `ref_text` de `config/voice_profiles.json`. Ejemplo:

```json
"ane": {
  "wav": "voices/ane.wav",
  "ref_text": "Kaixo, nire izena Ane da eta NodeFlow-en lan egiten dut. Gure helburua da euskaraz hitz egiten duen adimen artifiziala sortzea.",
  "language": "eu"
}
```

La coincidencia exacta entre audio y ref_text es lo que permite a F5-TTS
sincronizar fonemas y reproducir la voz con máxima fidelidad.

---

### Contrato de cesión (recordatorio)

Antes de usar cualquier voz en producción, el locutor debe firmar el
contrato de cesión en `docs/contrato_cesion_voz.md`.
