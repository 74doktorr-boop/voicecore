-- ============================================================
-- NodeFlow — Migración: lista de espera (rellenar huecos)
-- Cuando no hay hueco, el cliente se apunta. Al liberarse uno
-- (cancelación), el negocio puede llamar a quien esperaba.
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS nf_waitlist (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  name text,
  phone text NOT NULL,
  service text,
  preferred text,                  -- franja deseada en texto libre ("martes mañana")
  notes text,
  status text NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'contacted' | 'booked' | 'cancelled'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_org ON nf_waitlist (organization_id, status, created_at);
