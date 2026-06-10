-- ============================================================
-- NodeFlow — Migración: tabla de citas persistentes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS appointments (
  id              TEXT        PRIMARY KEY,           -- 'APT-1001'
  organization_id TEXT        NOT NULL,              -- businessId
  patient_name    TEXT        NOT NULL,
  phone           TEXT,
  email           TEXT,
  service         TEXT        NOT NULL,
  service_id      TEXT,
  date            DATE        NOT NULL,              -- '2026-06-15'
  time            TEXT        NOT NULL,              -- '10:00'
  duration        INTEGER     DEFAULT 30,            -- minutos
  price           NUMERIC(8,2) DEFAULT 0,
  notes           TEXT,
  status          TEXT        NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','pending','cancelled')),
  wa_confirmed    BOOLEAN     DEFAULT false,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para queries habituales
CREATE INDEX IF NOT EXISTS idx_appointments_org_date
  ON appointments (organization_id, date);

CREATE INDEX IF NOT EXISTS idx_appointments_org_status
  ON appointments (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_appointments_phone
  ON appointments (phone);

-- RLS: cada negocio solo ve sus propias citas
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- La service_role (servidor) puede hacer todo
CREATE POLICY "service_role_all" ON appointments
  FOR ALL USING (true);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_updated_at ON appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
