# Migraciones pendientes de ejecutar en Supabase

**Estado: 0 pendientes ✅ — audit_log aplicada 2026-07-01. Patch de escalado 2026-06-30.**

---

## audit_log — registro de auditoría del panel admin ✅ APLICADA 2026-07-01
**Por qué:** trazar quién hizo qué y cuándo (login, alta/edición/baja de clientes,
cambios de plan…). El código escribe best-effort; sin esta tabla el registro no
persiste pero NO rompe nada. Fichero de código: `src/audit/audit-log.js`.

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT        NOT NULL DEFAULT 'admin',
  action      TEXT        NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     JSONB       NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON audit_log TO service_role USING (true) WITH CHECK (true);
```

---

## 0. Lifecycle scaling patch 2 — índices de cola ✅ APLICADA 2026-06-30
**Por qué:** la cola global de recordatorios (`claim_pending_reminders`) ordena por
`scheduled_for` pero el índice previo lidera por `org_id`; a miles de clientes el
claim (la consulta más caliente) se degrada. Fichero: `db/schema-migration-lifecycle-patch2-scale.sql`.
Creados `idx_reminders_due` y `idx_nf_appointments_org_phone` (verificado: 2 filas en pg_indexes).

---

## 1. magic_tokens (login de portal)
**Estado:** tabla no existe → magic links no funcionan

```sql
CREATE TABLE IF NOT EXISTS magic_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT        UNIQUE NOT NULL,
  email       TEXT        NOT NULL,
  registro_id TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_count  INT         DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_token   ON magic_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_email   ON magic_tokens(email);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires ON magic_tokens(expires_at);
ALTER TABLE magic_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON magic_tokens TO service_role USING (true) WITH CHECK (true);
```

---

## 2. webhook_configs (webhooks del portal)
**Estado:** tabla no existe → webhooks creados en el portal no se envían  
(existe tabla `webhooks` antigua pero el código usa `webhook_configs`)

```sql
CREATE TABLE IF NOT EXISTS webhook_configs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  secret       TEXT        NOT NULL,
  events       TEXT[]      NOT NULL DEFAULT ARRAY['*']::TEXT[],
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_business_id
  ON webhook_configs (business_id);
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON webhook_configs TO service_role USING (true) WITH CHECK (true);
```

---

## 3. Columnas organizations (flow manager + language)
**Estado:** probablemente aplicadas si el sistema funciona — verificar con  
`SELECT column_name FROM information_schema.columns WHERE table_name='organizations';`  
Si faltan `google_place_id`, `automation_config`, `language`:

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS google_place_id        TEXT,
  ADD COLUMN IF NOT EXISTS review_url             TEXT,
  ADD COLUMN IF NOT EXISTS automation_config      JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language               VARCHAR(5) DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS status                 TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS registered_at          TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS assistant_config       JSONB DEFAULT '{}';
```

---

## 4. whatsapp_accounts (conexión WA por negocio)
**Estado:** tabla probablemente no existe → botón "Conectar WhatsApp" del portal no funciona

```sql
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT        NOT NULL UNIQUE,
  waba_id         TEXT        NOT NULL,
  phone_number_id TEXT        NOT NULL,
  phone_number    TEXT        NOT NULL,
  display_name    TEXT,
  access_token    TEXT        NOT NULL,     -- cifrado AES-256-GCM
  api_base        TEXT,                     -- null = Meta; 'waba.360dialog.io' = 360dialog
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','suspended')),
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_org
  ON whatsapp_accounts (organization_id);
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON whatsapp_accounts TO service_role USING (true) WITH CHECK (true);
```

---

## 5. calls (historial de llamadas)
**Estado:** probablemente no existe → post-call-handler falla al persistir llamadas silenciosamente

```sql
CREATE TABLE IF NOT EXISTS calls (
  call_sid            TEXT        PRIMARY KEY,
  org_id              TEXT        NOT NULL,
  outcome             TEXT,
  caller_number       TEXT,
  client_email        TEXT,
  booked_appointment  JSONB,
  transcript          JSONB       DEFAULT '[]',
  duration_ms         INTEGER     DEFAULT 0,
  turn_count          INTEGER     DEFAULT 0,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  status              TEXT        DEFAULT 'ended',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_org_id ON calls (org_id);
CREATE INDEX IF NOT EXISTS idx_calls_ended_at ON calls (ended_at);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON calls TO service_role USING (true) WITH CHECK (true);
```

---

## 6. Tablas sector-específicas (opcionales — solo si usas ese sector)
**Estado:** se crean bajo demanda; fallan silenciosamente si no existen

```sql
-- Leads (cualquier sector)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL, name TEXT, phone TEXT,
  goal TEXT, business_type TEXT, need TEXT, operation TEXT,
  notes TEXT, urgency TEXT DEFAULT 'media', source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Eventos de llamada (urgencias, flags)
CREATE TABLE IF NOT EXISTS call_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL, event_type TEXT, client_name TEXT,
  phone TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock farmacia
CREATE TABLE IF NOT EXISTS pharmacy_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL, medication TEXT NOT NULL,
  in_stock BOOLEAN DEFAULT true, updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Casos asesoría
CREATE TABLE IF NOT EXISTS advisory_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL, client_name TEXT, status TEXT,
  subject TEXT, advisor TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Propiedades inmobiliaria
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL, title TEXT, price NUMERIC, bedrooms INTEGER,
  zone TEXT, type TEXT, operation TEXT DEFAULT 'compra',
  description TEXT, active BOOLEAN DEFAULT true
);
```

---

## 10. nf_phone_pool — pool de números pre-comprados para auto-asignación
**Estado:** PENDIENTE — sin esta tabla, la auto-asignación de números no puede persistir

```sql
CREATE TABLE IF NOT EXISTS nf_phone_pool (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT        NOT NULL UNIQUE,   -- E.164, ej: +34943123456
  provider     TEXT        NOT NULL DEFAULT 'manual',  -- 'vonage'|'twilio'|'telnyx'|'manual'
  prefix       TEXT,                          -- '943', '91', etc. (para búsqueda)
  country_code TEXT        NOT NULL DEFAULT 'ES',
  status       TEXT        NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','assigned','reserved','retired')),
  org_id       TEXT,                          -- rellenado al asignar
  assigned_at  TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nf_phone_pool_status
  ON nf_phone_pool (status, created_at)
  WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_nf_phone_pool_org
  ON nf_phone_pool (org_id)
  WHERE org_id IS NOT NULL;
ALTER TABLE nf_phone_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON nf_phone_pool TO service_role USING (true) WITH CHECK (true);
```

---

## Ya aplicadas ✅
- `nf_appointments` + columnas `reminder_sent`, `review_requested`, `no_show_notified`
- `contacts`
- `contact_memory`
- `call_summaries`
- `scheduled_reminders` + RPCs (`claim_pending_reminders`, `recover_stalled_reminders`) + columnas `postponed_from`, `postponed_days`
- `org_reminder_config`
- `org_campaigns`
- `registros`
- `magic_tokens`
- `webhook_configs`
- `organizations` — columnas `google_place_id`, `review_url`, `automation_config`, `language`, `status`, `registered_at`, `assistant_config`
- `whatsapp_accounts`
- `calls` — columnas añadidas sobre tabla existente
- `leads`, `call_events`, `pharmacy_stock`, `advisory_cases`, `properties`
- `calls` — columnas `followup_at`, `followup_sent` + índice `idx_calls_followup` ✅ 2026-06-10
- `nf_rebooking_log` + índice + RLS ✅ 2026-06-10
- `nf_phone_pool` + índice + RLS ✅ 2026-06-10
- `idx_reminders_due` + `idx_nf_appointments_org_phone` (lifecycle scaling patch 2) ✅ 2026-06-30
