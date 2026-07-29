-- ============================================================
-- NodeFlow — El profesional (staff) debe existir en la BD y en el anti-solape
-- Ejecutar en Supabase → Database → SQL Editor. Idempotente y SEGURO:
-- el cambio del constraint es MÁS PERMISIVO (permite misma hora a profesionales
-- distintos), así que recrearlo no puede fallar sobre los datos existentes.
--
-- BUG (auditoría 2026-07-29, VERIFICADO contra la BD de producción:
-- `select staff from nf_appointments` → "column nf_appointments.staff does not
-- exist"). Es el mismo fallo que ya se corrigió para `location`, pero con
-- `staff`, y nadie lo había detectado:
--
--   1. La memoria SÍ permite que dos profesionales compartan hueco
--      (src/scheduling/scheduler.js: "otro profesional no bloquea"), y hay un
--      test que lo consagra (test/reserva-profesional.test.js).
--   2. Pero la columna NO EXISTE, así que `staff` ni siquiera se persistía…
--   3. …y el EXCLUDE nf_appointments_no_overlap no lo conoce, así que la BD
--      RECHAZA la segunda cita con 23P01.
--
-- Efecto real en una barbería con Ana y Beto: Cliente2 reserva con Beto el
-- sábado a las 10:00, el bot le confirma en voz alta, la BD lo rechaza, el
-- dueño recibe una alerta de "doble reserva" que es FALSA, y la cita
-- desaparece en el siguiente despliegue.
--
-- Y un efecto secundario peor: incluso la cita que SÍ se guardaba perdía el
-- profesional. Tras reiniciar, apt.staff quedaba undefined → _isSlotTaken
-- dejaba de aplicar la excepción por profesional → la agenda colapsaba a 1:1 y
-- el negocio perdía la mitad de su capacidad hasta el siguiente redeploy.
--
-- FIX: añadir la columna y meter (COALESCE(staff,'')) en el EXCLUDE.
--   · Mismo org + mismo centro + MISMO profesional + solape  → BLOQUEADO (bien).
--   · Mismo org + mismo centro + profesionales distintos     → PERMITIDO (el fix).
--   · Citas sin profesional (mono-profesional): COALESCE→'' las mete en el
--     mismo cubo, así siguen chocando entre sí exactamente como hasta ahora.
--
-- REQUISITO: aplicar ANTES db/migration-appointment-location-overlap.sql si aún
-- no está (este script recrea el constraint incluyendo location Y staff, así
-- que también sirve si aquel no se llegó a ejecutar).
-- btree_gist ya está habilitado (lo exige el `organization_id WITH =` actual).
-- ============================================================

BEGIN;

-- 1) La columna. Sin ella, el código guarda la cita SIN profesional y grita en
--    los logs (nunca se pierde la cita), pero la capacidad real se pierde.
ALTER TABLE nf_appointments ADD COLUMN IF NOT EXISTS staff TEXT;

-- 2) Índice de apoyo para las consultas por profesional del portal.
CREATE INDEX IF NOT EXISTS idx_nf_appointments_staff
  ON nf_appointments (organization_id, date, staff)
  WHERE status <> 'cancelled';

-- 3) El índice único de hora exacta (si sigue existiendo) es redundante con el
--    EXCLUDE y no conoce ni centro ni profesional → fuera.
DROP INDEX IF EXISTS uniq_active_slot;

-- 4) Recrear el EXCLUDE con centro Y profesional.
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
      (COALESCE(staff, ''))    WITH =,
      nf_appt_range(date, time, duration) WITH &&
    )
    WHERE (status <> 'cancelled');

  RAISE NOTICE 'nf_appointments_no_overlap recreado con location + staff.';
END $$;

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'nf_appointments' AND column_name = 'staff';
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'nf_appointments_no_overlap';
