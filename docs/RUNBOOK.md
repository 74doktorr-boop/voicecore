# NodeFlow — Runbook de operaciones

Última actualización: 2026-06-10

## ⏳ Tareas manuales pendientes (Unai)

### 1. UptimeRobot (5 min — PRIORITARIO)
El health-monitor interno corre *dentro* del propio servidor: si el servidor cae,
el monitor cae con él y **nunca alertará de una caída total**. Hace falta
monitorización externa:

1. Crear cuenta gratis en https://uptimerobot.com (50 monitores gratis)
2. Add New Monitor → tipo **HTTP(s)**
3. URL: `https://nodeflow.es/health` · Interval: 5 min
4. Keyword monitoring (opcional): buscar `"status":"ok"` en la respuesta
5. Alert contacts: email + (opcional) app móvil de UptimeRobot

### 2. Bucket de backups en Supabase (2 min)
El backup semanal (`src/db/backup.js`, domingos 04:00 Madrid) sube a Supabase
Storage. El bucket hay que crearlo una vez:

1. Supabase Dashboard → **Storage** → New bucket
2. Nombre: `backups` · **Private** (no público)
3. Probar: `POST /api/admin/backup` (con token admin) → debe devolver `ok: true`

### 3. WABA de NodeFlow en Meta (ver recordatorio del 11/06)
Checklist completo en `C:\Users\unais\Desktop\NodeFlow-WhatsApp-Setup.html`.

### 3b. Migración: candado anti-double-booking (1 min)
Ejecutar una vez en Supabase → SQL Editor el contenido de
`db/migration-appointment-slot-lock.sql`. Crea un índice único que
impide dos citas activas en el mismo hueco a nivel de base de datos
(red de seguridad para cuando se escale a varias instancias).

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

### 4. Verificar API_KEY en producción
La key legacy da acceso plan *enterprise* sin límites. En EasyPanel debe ser un
valor aleatorio largo, **nunca** el `voicecore-dev` del .env.example.
Generar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 🧪 Tests

```
npm test          # smoke tests (node:test nativo, sin dependencias)
```

Cubren: JWT (firma/expiración/manipulación), reservas (double-booking,
solapamiento, validación fecha/hora/horario), rate limiter, resolveApiKey.

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
