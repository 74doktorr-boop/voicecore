-- ============================================================
-- NodeFlow — Migración: tabla de citas persistentes
-- Tabla: nf_appointments (prefijo nf_ para evitar colisión
-- con tabla 'appointments' del proyecto inmobiliario anterior)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS nf_appointments (
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
  wa_confirmed      BOOLEAN     DEFAULT false,
  reminder_sent     BOOLEAN     DEFAULT false,
  review_requested  BOOLEAN     DEFAULT false,
  no_show_notified  BOOLEAN     DEFAULT false,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para queries habituales
CREATE INDEX IF NOT EXISTS idx_nf_appointments_org_date
  ON nf_appointments (organization_id, date);

CREATE INDEX IF NOT EXISTS idx_nf_appointments_org_status
  ON nf_appointments (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_nf_appointments_phone
  ON nf_appointments (phone);

-- RLS: cada negocio solo ve sus propias citas
ALTER TABLE nf_appointments ENABLE ROW LEVEL SECURITY;

-- La service_role (servidor) puede hacer todo
CREATE POLICY "service_role_all" ON nf_appointments
  FOR ALL USING (true);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_nf_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nf_appointments_updated_at ON nf_appointments;
CREATE TRIGGER nf_appointments_updated_at
  BEFORE UPDATE ON nf_appointments
  FOR EACH ROW EXECUTE FUNCTION update_nf_updated_at();
