-- ============================================================
-- NodeFlow — Marca de tiempo para reconciliar altas atascadas
-- Ejecutar en Supabase → SQL Editor. Idempotente y SEGURO (solo añade columna).
--
-- Contexto (auditoría 2026-07-16): si el proceso muere ENTRE el claim de
-- aprovisionamiento y marcar 'active' (OOM, redeploy de EasyPanel), el registro
-- se queda en 'provisioning' para siempre y el fundador pagó pero se quedó a
-- medias EN SILENCIO. La reconciliación (reconcileStuckProvisioning, en el cron
-- leader-gated) rescata esos casos, pero necesita saber CUÁNDO empezó el
-- aprovisionamiento para no tocar altas en vuelo (que tardan segundos).
--
-- provisioning_at lo escribe claimRegistroForProvisioning de forma best-effort;
-- si esta columna no existe, ese write falla en silencio y la reconciliación es
-- un no-op. Con la columna puesta, la reconciliación se activa sola.
-- ============================================================

ALTER TABLE registros ADD COLUMN IF NOT EXISTS provisioning_at timestamptz;

-- Índice parcial: el barrido solo mira los que están 'provisioning'.
CREATE INDEX IF NOT EXISTS idx_registros_provisioning
  ON registros (provisioning_at)
  WHERE status = 'provisioning';
