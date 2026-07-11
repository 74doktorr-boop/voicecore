-- ============================================================
-- NodeFlow — Migración: enlazar cada cita con su evento de Google Calendar
-- ============================================================
-- Fase 3. Hasta ahora, al reservar se creaba el evento en Google Calendar pero
-- su ID se TIRABA → no había forma de borrarlo/actualizarlo después. Resultado:
-- cuando un cliente CANCELA (por WhatsApp o voz), el evento quedaba de FANTASMA
-- en el calendario del dueño.
--
-- Esta columna guarda el id del evento de Google para cada cita, de modo que:
--   - al CONFIRMAR por WhatsApp, si la cita aún no tiene evento, se crea y se
--     guarda aquí (queda reflejada en Citas + Google Calendar);
--   - al CANCELAR, se borra el evento usando este id.
--
-- Cómo se ejecuta: Supabase → SQL Editor. Idempotente (IF NOT EXISTS).
-- La app es fail-open: si la columna aún no existe, el enlace simplemente no se
-- guarda (el sync de google_event_id va en su propio patch aislado y no tumba
-- la persistencia del estado de la cita). Aplícala para activar el borrado del
-- evento al cancelar.
-- ============================================================

ALTER TABLE nf_appointments
  ADD COLUMN IF NOT EXISTS google_event_id text;

-- Verificación (debe devolver una fila):
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'nf_appointments' AND column_name = 'google_event_id';

-- ── ROLLBACK (si hiciera falta) ──────────────────────────────────────────────
-- ALTER TABLE nf_appointments DROP COLUMN IF EXISTS google_event_id;
