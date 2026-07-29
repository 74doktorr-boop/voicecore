-- ============================================================
-- NodeFlow — Opt-out de LLAMADAS de voz (no_calls)
-- Ejecutar manualmente en el SQL Editor de Supabase.
-- ------------------------------------------------------------
-- Por qué: hasta ahora un contacto solo quedaba libre de llamadas
-- salientes (recuperación / reactivación / anti no-show / avisos de
-- entidades) si tenía las TRES bajas a la vez (no_whatsapp + no_email
-- + no_sms = do-not-contact total). No existía una baja dedicada de
-- "no me llames por teléfono": un cliente que solo se dio de baja de
-- WhatsApp seguía recibiendo llamadas de voz.
--
-- Esta columna añade ese concepto. contactInfo() (src/campaigns/
-- enqueuers.js) bloquea las campañas de VOZ cuando no_calls = true,
-- aunque no estén las otras bajas. La semántica do-not-contact total
-- se mantiene intacta (además, ese total implica también no llamar).
--
-- Idempotente: si la columna ya existe, no hace nada.
-- ============================================================

ALTER TABLE contact_memory
  ADD COLUMN IF NOT EXISTS no_calls boolean NOT NULL DEFAULT false;
