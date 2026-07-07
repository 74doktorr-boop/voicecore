# NodeFlow — Runbook de operaciones

Última actualización: 2026-06-11

## ✅ Tareas manuales — estado

- [x] **UptimeRobot** — monitor externo `https://nodeflow.es/health` cada 5 min (hecho 2026-06-10)
- [x] **Bucket `backups`** en Supabase Storage (privado) — backup probado OK
- [x] **Migración anti-double-booking** (`uniq_active_slot`) — ejecutada
- [x] **Migración referidos** (`nf_referrals` + `nf_referral_conversions`) — ejecutada
- [x] **API_KEY de producción** — verificado vía `/api/admin/diagnostics`: NO es la default ✅
- [ ] **Migración callbacks** (`db/migration-callbacks.sql`) — para el widget "¿Te llamamos?"
- [~] **WABA de NodeFlow en Meta** — EN ACTIVACIÓN (2026-07-02, credenciales ya obtenidas).
      Guía real: `docs/owner/whatsapp-setup.md` → sección "Activación rápida".
      Pasos: (1) 4 vars en EasyPanel — `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET`,
      `WA_WEBHOOK_VERIFY_TOKEN` (+ `WA_BUSINESS_ACCOUNT_ID` para el script). (2) Webhook Meta →
      `https://nodeflow.es/whatsapp/webhook`, subscribe `messages`. (3) `node scripts/wa-submit-templates.js`
      (3 plantillas UTILITY). (4) Verificar `GET /api/admin/diagnostics` (ready+secure) y
      `POST /api/admin/test-whatsapp {phone}`.

## 🚀 Próximos pasos (cuando se retome)

- [ ] **Meter de mensajes en Stripe** (paquete 200/mes + 0,10€ extra ya en código, gateado):
      Stripe → Billing → Meters → crear meter (event name p.ej. `mensajes_extra`, agregación SUM)
      → crear Price medido 0,10€ asociado al meter → añadirlo a las suscripciones (como el de minutos)
      → env `STRIPE_MSG_METER_EVENT=mensajes_extra` en EasyPanel. Sin esto: se cuenta y se enseña, no se cobra.
- [ ] **Bundle regulatorio Telnyx ES** (la compra automática de números lo exige):
      portal.telnyx.com → Numbers → Regulatory bundles → crear bundle España (dirección + CIF)
      → env `TELNYX_REQUIREMENT_GROUP_ID=<id del bundle>` en EasyPanel. El diagnóstico avisa mientras falte.
- [ ] **WhatsApp**: 8 plantillas PENDING en Meta (~1-24h). Al aprobar: `POST /api/admin/test-whatsapp {phone}`.
      App publicada ✓ · número +34 604 CONNECTED ✓ · webhook verde ✓.
- [ ] **Proveedor de tecnología (Meta)**: iniciar revisión para Embedded Signup del número propio
      (panel de la app → Hazte proveedor de tecnología → Continuar incorporación).


Ideas/features diseñadas pero NO implementadas todavía:

1. ~~Widget "llámame"~~ ✅ HECHO — `public/widget/nf-widget.js` + `POST /api/widget/callback`.
   El negocio pega `<script src=".../widget/nf-widget.js" data-org="ORGID"></script>`.
   Falta: tarjeta en el portal que muestre el snippet (endpoint `/api/portal/widget` listo)
   y, a futuro, outbound real (que el asistente IA llame, no solo avisar al dueño).
2. ~~Dashboard admin visual~~ ✅ HECHO — pestaña 🩺 Sistema (diagnóstico + atribución).
3. **Tests de endpoints HTTP** — hoy se testea la lógica (36 tests); falta cobertura
   de las rutas Express completas (supertest o similar).
4. **Cupones por ciudad** (`BILBAO10`, `MADRID10`…) — incentivo + atribución más fina.
5. **UI portal del widget** — tarjeta que muestre el snippet + callbacks recibidos.
6. **Multi-instancia** — si se escala horizontalmente, mover scheduler/rate-limiter
   a Redis y validar reservas DB-first (ver notas de escalabilidad).

## 🔴 EasyPanel: deploys intermitentes

El panel de control de EasyPanel (`xmehd4.easypanel.host`) se cae a ratos, lo que
hace fallar el paso de deploy (HTTP 000). **La web nunca se cae por esto** — solo el
mecanismo de despliegue; el sitio sigue sirviendo la imagen anterior.

- El workflow ya reintenta hasta ~5 min. Si aun así falla, la imagen está en GHCR;
  basta re-lanzar el workflow (`gh run rerun <id> --failed`) o desplegar desde el panel.
- **Mejora recomendada**: configurar en EasyPanel el **auto-deploy desde GHCR**
  (que el panel vigile la imagen `:latest` y despliegue solo), eliminando la
  dependencia de que su API responda a GitHub Actions.

## 🏗️ Notas de escalabilidad

- **Instancias**: hoy corre 1 instancia en EasyPanel. El scheduler valida
  huecos en memoria (rápido, necesario para la latencia de voz). Para >1
  instancia, el índice `uniq_active_slot` (migración 3b) es la red de
  seguridad contra double-booking. Para protección total de solapamientos
  parciales a nivel DB, migrar a EXCLUDE constraint con btree_gist.
- **Tokens admin**: viven en memoria; un reinicio obliga a re-login en el
  panel. Aceptable para uso interno de 1 persona.
- **Rate limiter / analytics**: en memoria por instancia. Con multi-instancia,
  mover a Redis (ya contemplado en el código con comentarios).

## 🧪 Tests

```
npm test          # 32 smoke tests (node:test nativo, sin dependencias)
```

Cubren: JWT (firma/expiración/manipulación/longitud), reservas (double-booking,
solapamiento, validación fecha/hora/horario/día cerrado), rate limiter,
normalización de teléfonos WA, error-tracker (Express 500), informe semanal
(rango de fechas), referidos (slug + código), resolveApiKey.

## ⭐ Features clave y sus endpoints

- **Referidos**: `GET /api/portal/referral` (código + stats) · tablas `nf_referrals`,
  `nf_referral_conversions` · UI en portal "Recomienda y gana".
- **Informe semanal**: cron lunes 08:00 · manual `POST /api/admin/weekly-report`
  (dryRun por defecto; envío real con `{"dryRun":false}`).
- **Atribución**: `GET /api/admin/attribution` — leads/conversiones/MRR por landing.
- **Backup**: `POST /api/admin/backup` · cron domingos 04:00.
- **Test WhatsApp**: `POST /api/admin/test-whatsapp` `{"phone":"34..."}`.
- **Error tracker**: alertas por email automáticas (uncaught/unhandled/Express).

## 💾 Backups

- **Automático**: domingos 04:00 Madrid → `backups/nodeflow-backup-<fecha>.json.gz`
- **Manual**: `POST /api/admin/backup` con token admin
- **Retención**: últimos 8 (≈2 meses), poda automática
- **Restaurar**: descargar el .json.gz del bucket, descomprimir, y hacer upsert
  por tabla con el service key (el JSON tiene `data.<tabla>` con todas las filas)

## 📊 Monitorización

- `/health` — JSON con status, uptime, llamadas activas, estado DB
- `/status` — página pública de estado (auto-refresh 30s)
- Health-monitor interno: alerta por email si `/health` degrada (solo producción)
- UptimeRobot externo: ver tarea pendiente #1

## 🚨 Si el servidor cae

1. EasyPanel → https://xmehd4.easypanel.host → ver logs del servicio
2. Causas típicas: env var borrada, deploy roto (revisar GitHub Actions), OOM
3. Rollback: EasyPanel permite redeploy de la imagen anterior de GHCR

## 🎛️ Flags y crons añadidos el 2026-07-07

**Flags (EasyPanel) — features dormidas hasta encenderlas:**
| Variable | Enciende | Requiere |
|---|---|---|
| `WA_COMO_FUE_BUTTONS=1` | Check-in con botones 👍/👎 + máquina de reseñas | Plantilla `nodeflow_como_fue_v2` APPROVED |
| `WA_WAITLIST_AUTOOFFER=1` | Hueco por cancelación → oferta automática a lista de espera | Plantilla `nodeflow_hueco_libre` APPROVED |
| `STRIPE_MSG_METER_EVENT=mensajes_extra` | Cobro real del excedente de mensajes (hasta entonces solo cuenta) | Decisión de negocio |
| `WA_ES_CONFIG_ID` + `WA_APP_ID` | Botón "Conectar mi WhatsApp" (Embedded Signup) en el portal | Config creada en Meta (hecho) |

**Crons nuevos (leader-gated, hora Madrid):**
- 02:40 — reporte de excedente de mensajes a Stripe (reclamo atómico anti doble-cobro)
- 03:10 — renovación de tokens WA de 60 días (renueva a los 45; 15 días de reintentos)

**Avisos automáticos:** el webhook maneja `message_template_status_update` —
cuando Meta aprueba/rechaza una plantilla, llega WhatsApp+email al founder con
el flag exacto a encender. Ya no hay que preguntar "¿aprobaron?".

**Pool de números:** `POST /api/admin/phone-pool/topup {target}` auto-compra
en Telnyx hasta `target` disponibles (necesita TELNYX_API_KEY+APP_ID en el
servidor; puede exigir bundle regulatorio ES). ⚠️ Si el pool está a 0, el
cliente que pague recibe bienvenida pero NO número (alerta urgente al founder).

**Gotcha de audio:** jamás decimar PCM sin filtro anti-aliasing (el "zumbido
de microondas" de 2026-07-07). Cartesia se pide en `pcm_mulaw@8000` nativo;
el resampler de utils/audio ya filtra. Las previews del navegador pasan por
`masterForSpeakers` (limitador de picos) — el TTS crudo revienta altavoces.

**Gotcha Meta idiomas:** las plantillas de WhatsApp NO admiten euskera (eu) ni
gallego (gl) — verificado por API. La localización eu/gl va por SMS/email
(fallbackText) y por el texto libre del dueño en nodeflow_aviso.

## ⚠️ ANTES de lanzar marketing masivo por WhatsApp — coste de Meta

WhatsApp cambió a **precio POR MENSAJE** en 2025 (ya no "1.000 conversaciones
gratis/mes", ese era el modelo viejo). Reglas actuales:
- **Servicio (el cliente escribe primero)** → gratis e ilimitado en la ventana 24h.
- **Plantillas UTILITY** (confirmación, recordatorio) → gratis dentro de la
  ventana de servicio abierta; si no, se cobran.
- **Plantillas MARKETING** (promo, reactivación, nodeflow_promo, nodeflow_aviso
  cuando es promocional) → **SE COBRAN SIEMPRE**, por mensaje entregado, tarifa España.

**ACCIÓN antes de escalar:** consultar la tarifa España vigente en la página
oficial de precios de WhatsApp de Meta (cambia; no fiarse de cifras de memoria)
y cuadrarla con NUESTRO paquete (200 msg/mes + 0,10€ extra que cobramos al
negocio). Verificar margen: coste-Meta-por-plantilla-marketing < 0,10€.

**Umbral de facturación de Meta:** al añadir tarjeta a una WABA, Meta pone un
límite de facturación automático (visto 20€ el 2026-07-07 — cargo "Pendiente,
sin motivo" con uso real 0€ = era el umbral/autorización de la tarjeta, NO
mensajes; las conversaciones facturables estaban a 0€ verificado por API). Se
revisa/ajusta en Facturación → Configuración de pagos / Líneas de crédito.
Ojo: hay 2 WABA "NodeFlow" en el business (2548201375610184 = la que usa el
código; 2089981524951027 = duplicada, posible resto de pruebas de Embedded
Signup — revisar si sigue con tarjeta y facturando por su cuenta).
