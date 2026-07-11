-- ============================================================
-- NodeFlow — Migración: anti-doble-reserva por SOLAPE PARCIAL (nivel DB)
-- ============================================================
-- Sustituye/mejora el índice uniq_active_slot (solo hora EXACTA) por un
-- EXCLUDE constraint que rechaza cualquier SOLAPE real teniendo en cuenta la
-- DURACIÓN: 10:00 (45 min) y 10:30 (30 min) se pisan (10:30 cae dentro de
-- 10:00–10:45) → antes NO chocaban para la BD; ahora sí.
--
-- Cómo se ejecuta: Supabase → SQL Editor. Corre los pasos EN ORDEN.
-- IMPORTANTE: primero el PASO 1 (pre-check). Si hay citas que ya se solapan o
-- horas con formato raro, el PASO 3 fallaría — límpialas antes.
-- Idempotente: el PASO 3 no hace nada si el constraint ya existe.
-- App: el código ya trata el rechazo (23P01) como colisión de hueco y avisa
-- al dueño (appointments-store.js). No hace falta tocar nada más al aplicarla.
-- ============================================================

-- ── PASO 0 — Extensión necesaria para indexar rangos + igualdad ──────────────
-- btree_gist permite mezclar "organization_id WITH =" y "rango WITH &&" en un
-- mismo índice GiST. Supabase la permite.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ── PASO 1 — PRE-CHECK (solo lectura, corre esto ANTES de crear nada) ────────

-- 1a) Horas con formato inesperado (romperían el cast time::time). Deben ser 0.
--     Si aparece alguna, corrige el valor de 'time' (formato HH:MM o HH:MM:SS).
SELECT id, organization_id, date, time
FROM nf_appointments
WHERE status <> 'cancelled'
  AND time !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$';

-- 1b) Citas ACTIVAS que YA se solapan (el constraint no se crea si existen).
--     Si aparece alguna, decide cuál cancelar/mover antes del PASO 3.
SELECT a.id AS cita_a, b.id AS cita_b, a.organization_id,
       a.date, a.time AS hora_a, a.duration AS dur_a,
       b.time AS hora_b, b.duration AS dur_b
FROM nf_appointments a
JOIN nf_appointments b
  ON a.organization_id = b.organization_id
 AND a.date = b.date
 AND a.id < b.id
 AND a.status <> 'cancelled'
 AND b.status <> 'cancelled'
 AND tsrange(a.date + a.time::time,
             a.date + a.time::time + (COALESCE(a.duration, 30)::text || ' minutes')::interval)
  && tsrange(b.date + b.time::time,
             b.date + b.time::time + (COALESCE(b.duration, 30)::text || ' minutes')::interval);


-- ── PASO 2 — (opcional) Retirar el índice antiguo de hora exacta ─────────────
-- El EXCLUDE de abajo cubre TODO lo que cubría uniq_active_slot (la hora
-- idéntica es un caso particular de solape) → el viejo queda redundante.
-- Descomenta para eliminarlo (recomendado, para no tener dos redes que hacen lo
-- mismo). Si prefieres conservarlo por prudencia, déjalo: no molesta.
-- DROP INDEX IF EXISTS uniq_active_slot;


-- ── PASO 3a — Función IMMUTABLE que calcula el intervalo de una cita ─────────
-- Postgres exige que las expresiones de un índice/EXCLUDE usen SOLO funciones
-- IMMUTABLE (si no: ERROR 42P17). La expresión inline no se lo garantiza, así
-- que la encapsulamos aquí. Es determinista de verdad: NO usa zona horaria ni
-- now() → marcarla IMMUTABLE es correcto y seguro. Idempotente (OR REPLACE).
CREATE OR REPLACE FUNCTION nf_appt_range(d date, t text, dur integer)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
AS $func$
  SELECT tsrange(
    d + t::time,
    d + t::time + (COALESCE(dur, 30)::text || ' minutes')::interval
  );
$func$;

-- ── PASO 3b — El EXCLUDE constraint usando la función (la red de verdad) ─────
-- Rechaza dos citas ACTIVAS del mismo negocio cuyos intervalos [inicio, fin)
-- se solapen. Se compara como timestamp SIN zona (hora local de pared,
-- consistente porque todas las citas de un negocio se guardan igual).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nf_appointments_no_overlap'
  ) THEN
    ALTER TABLE nf_appointments
      ADD CONSTRAINT nf_appointments_no_overlap
      EXCLUDE USING gist (
        organization_id WITH =,
        nf_appt_range(date, time, duration) WITH &&
      )
      WHERE (status <> 'cancelled');
    RAISE NOTICE 'Constraint nf_appointments_no_overlap creado.';
  ELSE
    RAISE NOTICE 'Constraint nf_appointments_no_overlap ya existía — sin cambios.';
  END IF;
END $$;


-- ── VERIFICACIÓN — que el constraint quedó puesto ────────────────────────────
SELECT conname, contype
FROM pg_constraint
WHERE conname = 'nf_appointments_no_overlap';


-- ── ROLLBACK (si hiciera falta deshacerlo) ───────────────────────────────────
-- ALTER TABLE nf_appointments DROP CONSTRAINT IF EXISTS nf_appointments_no_overlap;
-- DROP FUNCTION IF EXISTS nf_appt_range(date, text, integer);
-- -- y, si lo eliminaste en el PASO 2, recrear el antiguo:
-- CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
--   ON nf_appointments (organization_id, date, time)
--   WHERE status <> 'cancelled';
