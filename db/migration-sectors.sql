-- ============================================================
-- NodeFlow — Migración: sectores custom (auto-borrador aprobado sin deploy)
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- Los 32 sectores de la SEMILLA viven en código; esta tabla guarda solo los
-- verticales nuevos aprobados en caliente. Si no la creas, el sistema funciona
-- igual con la semilla (fail-open) — solo no persisten los custom.
-- ============================================================

CREATE TABLE IF NOT EXISTS nf_sectors (
  slug       text PRIMARY KEY,
  definition jsonb NOT NULL,          -- { slug, label, aliases, norms, metricChecks, requiredFields, custom }
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sectors_active ON nf_sectors (active);
