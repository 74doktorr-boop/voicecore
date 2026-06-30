# Configuración de voz (TTS) y cobro de minutos extra — estado actual

_Última actualización: 2026-06-30. Resume cómo quedó montada la voz del asistente
y el cobro de overage, y cómo cambiar las cosas más comunes._

---

## 1. Voz del asistente (TTS)

### Proveedores y prioridad
La voz se decide en `src/tts/router.js`. Por idioma:

| Idioma | Voz principal | Respaldo automático |
|--------|---------------|---------------------|
| **Castellano (es)** | **ElevenLabs** (Flash v2.5) | Azure → OpenAI |
| **Euskera (eu)** | Modelo local (F5/XTTS) si está; si no, **Azure** | — |
| **Galego (gl)** | Modelo local-gl si está; si no, **Azure** | — |

- **ElevenLabs** es preferente para castellano (`languageAffinity: ['es']`). Si falla
  (cuota, caída), el router cae solo a Azure → la llamada nunca se queda muda.
- **ElevenLabs NO se usa para euskera/galego** (flojea ahí): esos van por el modelo
  local o Azure.
- Modelo ElevenLabs: **`eleven_flash_v2_5`** (baja latencia ~75ms, coste ~mitad).

### Las 4 voces españolas (ElevenLabs Voice Library)
| Rol | Voice ID |
|-----|----------|
| 👩 Femenina 1 — **principal/default** | `dNjJKg63Fr5AXwIdkATa` |
| 👩 Femenina 2 | `kwNLkNjbQHMw9YUFZsHI` |
| 👨 Masculina 1 | `JngPf0lmRkKhY3qSJz0f` |
| 👨 Masculina 2 | `uVoJJFOcQglSD16zUGOl` |

### Cómo cambiar la voz principal
Dos formas:
- **Sin código (recomendado):** en EasyPanel → voicecore-api → Entorno, pon
  `ELEVENLABS_VOICE_ID=<voice_id>` → Implementar.
- En código: el default está en `src/tts/elevenlabs.js` y `src/tts/router.js`.

---

## 2. Cuenta de ElevenLabs (pago por uso)

- **Modelo: pago por uso (PAYG)**, NO suscripción. Funciona con **saldo prepago**:
  se añaden créditos y la API descuenta.
- **Recarga automática ACTIVADA** → el saldo se repone solo (si llega a 0, vuelve el
  error 402 y se corta la voz; por eso la recarga automática es importante).
- Precio: **Text to Speech · Flash = $0,05 / 1.000 caracteres** (~$0,045/min de voz).
- La API key está restringida solo al endpoint **Text to Speech** (lo único que usamos).

### Margen (con Flash)
La IA habla ~40% de la llamada. Un cliente de 49 € intenso (500 min) ≈ 15 € de COGS
total → **~70% de margen**. El overage (ver abajo) cubre a los clientes que se pasan.

---

## 3. La demo (`nodeflow.es/demo`)

- Requiere el **token de demo** (env `DEMO_TOKEN`) introducido en el panel de la demo.
- Tiene un **selector de voz** (junto al 🔊) para A/B las 4 voces en contexto.
  El selector es solo para probar; las **llamadas reales** usan la voz principal.
- Endpoint `/api/demo/tts` (en `src/api/routes-demo.js`): intenta **ElevenLabs mp3**
  (es) → si falla, **Azure mp3** → si no, WAV del router. Devuelve la cabecera
  `X-TTS-Provider` para verificar qué voz sirvió.

---

## 4. Cobro de minutos extra (overage)

Cuando un cliente pasa de los **500 min incluidos**, NodeFlow reporta los minutos
extra a Stripe y se le cobran a **0,10 €/min** en su factura mensual. Automático.

- **Stripe (creado por API):** Meter `mtr_61UxB18xRUM8CYCL541JA7wUpVWZFXOy`
  (event `nodeflow_overage_minutes`) + precio medido `price_1Tnn3nJA7wUpVWZFzKwESS3C`.
- **Código:** `src/billing/stripe.js` (`reportUsage`/`reportOverage` vía Billing Meters)
  + hook en `src/db/database.js` (`_doIncrementMinutes`) + alta del item medido en la
  suscripción al pagar (`routes-billing.js`, `addOverageItem`).
- **No corta llamadas** al pasar de 500: deja seguir y cobra el extra (banda de overage
  con tope de seguridad ×3 en `src/auth/middleware.js`).

---

## 5. Variables de entorno relevantes (EasyPanel → voicecore-api)

| Variable | Para qué |
|----------|----------|
| `ELEVENLABS_API_KEY` | Voz ElevenLabs (castellano) |
| `ELEVENLABS_VOICE_ID` | (opcional) cambiar la voz principal sin tocar código |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Voz Azure (respaldo es + eu/gl) |
| `STRIPE_OVERAGE_METER_EVENT=nodeflow_overage_minutes` | Activa el reporte de overage |
| `STRIPE_OVERAGE_PRICE_ID=price_1Tnn3nJA7wUpVWZFzKwESS3C` | Engancha el cobro a las altas |

---

## 6. Pendiente / siguiente
- **Telnyx + SIM**: cerrar las llamadas reales (número Gipuzkoa +34 943 por Telnyx;
  la SIM DIGI para pruebas de WhatsApp). Ver `db/pending-migrations.md` y memoria.
- Aplicar la migración de índice de cola `db/schema-migration-lifecycle-patch2-scale.sql`.
