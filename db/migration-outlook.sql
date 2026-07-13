-- ============================================================
-- NodeFlow — Integración Outlook / Microsoft 365 Calendar
-- Ejecutar en Supabase → Database → SQL Editor.
-- Espejo de las columnas google_* (schema-migration.sql). Idempotente.
-- Seguro de aplicar aunque la feature esté apagada (columnas sin usar).
-- ============================================================

-- ── Organizations: tokens OAuth de Microsoft (Graph) ────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS outlook_calendar_id    TEXT,
  ADD COLUMN IF NOT EXISTS outlook_refresh_token  TEXT,
  ADD COLUMN IF NOT EXISTS outlook_access_token   TEXT,
  ADD COLUMN IF NOT EXISTS outlook_token_expiry   BIGINT;

COMMENT ON COLUMN organizations.outlook_refresh_token IS 'Microsoft Graph OAuth refresh token (Outlook/M365 calendar)';

-- ── Citas: id del evento en Outlook (para borrar/actualizar) ────────────────
-- FIX 2026-07-13: la primera versión decía `appointments` (tabla LEGACY);
-- el código (appointments-store) usa `nf_appointments`. Si ejecutaste la
-- versión antigua, la columna sobrante en `appointments` es inocua.
ALTER TABLE nf_appointments
  ADD COLUMN IF NOT EXISTS outlook_event_id       TEXT;

COMMENT ON COLUMN nf_appointments.outlook_event_id IS 'Graph event id del evento creado en el Outlook del negocio';
