-- ============================================================
-- NodeFlow — El constraint anti-solape debe conocer el CENTRO (multi-sede)
-- Ejecutar en Supabase → Database → SQL Editor. Idempotente y SEGURO:
-- el cambio es MÁS PERMISIVO (permite misma hora en centros distintos), así
-- que recrear el constraint no puede fallar sobre los datos existentes.
--
-- BUG (auditoría 2026-07-16, verificado contra la BD): el EXCLUDE
-- nf_appointments_no_overlap NO incluía `location`, así que dos citas
-- legítimas a la misma hora en centros distintos (Osakin: Tolosa 10:00 y
-- Villabona 10:00) chocaban → la 2ª la rechazaba la BD (23P01), quedaba
-- SOLO en memoria, el dueño recibía un falso aviso de "doble reserva" y la
-- cita desaparecía en el siguiente deploy — DESPUÉS de que el bot se la
-- confirmó al paciente.
--
-- FIX: añadir (COALESCE(location,'')) al EXCLUDE.
--   · Mismo org + mismo centro + solape de horario → BLOQUEADO (correcto).
--   · Mismo org + CENTROS distintos + misma hora   → PERMITIDO (el fix).
--   · Citas SIN centro (mono-sede): COALESCE→'' las mete en el mismo cubo,
--     así siguen chocando entre sí como hasta ahora.
-- btree_gist ya está habilitado (lo exige el `organization_id WITH =` actual).
-- ============================================================

BEGIN;

-- 1) El índice único de hora exacta (si existe) es redundante con el EXCLUDE y
--    tampoco conoce el centro → lo retiramos; el EXCLUDE cubre la hora exacta.
DROP INDEX IF EXISTS uniq_active_slot;

-- 2) Recrear el EXCLUDE incluyendo el centro.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nf_appointments_no_overlap') THEN
    ALTER TABLE nf_appointments DROP CONSTRAINT nf_appointments_no_overlap;
  END IF;

  ALTER TABLE nf_appointments
    ADD CONSTRAINT nf_appointments_no_overlap
    EXCLUDE USING gist (
      organization_id WITH =,
      (COALESCE(location, '')) WITH =,
      nf_appt_range(date, time, duration) WITH &&
    )
    WHERE (status <> 'cancelled');

  RAISE NOTICE 'nf_appointments_no_overlap recreado con location — multi-sede OK.';
END $$;

COMMIT;

-- ── Verificación (opcional) ──────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'nf_appointments_no_overlap';
