-- ============================================================
-- NodeFlow — Migración: flags de recordatorio y reseña
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE nf_appointments
  ADD COLUMN IF NOT EXISTS reminder_sent     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_requested  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_show_notified  BOOLEAN DEFAULT false;
