# NodeFlow — Runbook de operaciones

Última actualización: 2026-06-11

## ✅ Tareas manuales — estado

- [x] **UptimeRobot** — monitor externo `https://nodeflow.es/health` cada 5 min (hecho 2026-06-10)
- [x] **Bucket `backups`** en Supabase Storage (privado) — backup probado OK
- [x] **Migración anti-double-booking** (`uniq_active_slot`) — ejecutada
- [x] **Migración referidos** (`nf_referrals` + `nf_referral_conversions`) — ejecutada
- [x] **API_KEY de producción** — verificado vía `/api/admin/diagnostics`: NO es la default ✅
- [ ] **Migración callbacks** (`db/migration-callbacks.sql`) — para el widget "¿Te llamamos?"
- [ ] **WABA de NodeFlow en Meta** — pendiente (checklist en `Desktop\NodeFlow-WhatsApp-Setup.html`, recordatorio activo).
      Al configurar, meter 4 vars: `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_WEBHOOK_VERIFY_TOKEN`, `WA_APP_SECRET`.
      Verificar en panel admin → pestaña 🩺 Sistema (todo verde) o `GET /api/admin/diagnostics`.

## 🚀 Próximos pasos (cuando se retome)

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
