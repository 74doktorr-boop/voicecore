-- ============================================================
-- NodeFlow — Caja negra de la IA (auditable por llamada)
-- ------------------------------------------------------------
-- Guarda, por llamada, las DECISIONES (tools) que tomó el asistente: consultó
-- disponibilidad, reservó, registró un lead, marcó urgencia… Para que el dueño
-- audite EXACTAMENTE qué hizo su IA con cada cliente (mata "no me fío de la IA").
-- La escribe post-call-handler → call-store.saveCallEnd desde session.aiDecisions.
--
-- Idempotente: IF NOT EXISTS + default '[]'. Las llamadas antiguas quedan con []
-- (no había captura); no rompe nada.
-- Aplicar en Supabase (SQL Editor) antes de desplegar el commit de la feature.
-- ============================================================

ALTER TABLE nf_calls
  ADD COLUMN IF NOT EXISTS ai_decisions jsonb NOT NULL DEFAULT '[]'::jsonb;
