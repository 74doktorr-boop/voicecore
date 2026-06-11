-- ============================================================
-- NodeFlow — Migración: solicitudes de llamada del widget "¿Te llamamos?"
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS nf_callbacks (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  name text,
  phone text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_callbacks_org ON nf_callbacks (organization_id, created_at DESC);
