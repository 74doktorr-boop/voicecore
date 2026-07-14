-- ============================================================
-- NodeFlow — Multi-sede light: centro de la cita
-- Ejecutar en Supabase → SQL Editor. Idempotente.
-- Negocios con varios centros (automations.config.locations) guardan
-- en qué centro es cada cita; la disponibilidad se calcula por centro.
-- Sin locations configuradas, la columna queda null y nada cambia.
-- ============================================================
ALTER TABLE nf_appointments
  ADD COLUMN IF NOT EXISTS location TEXT;

COMMENT ON COLUMN nf_appointments.location IS 'Centro/sede de la cita (multi-sede). Null = negocio mono-sede.';
