-- ============================================================
-- NodeFlow — Migración: candado anti-double-booking a nivel DB
-- ============================================================
-- Red de seguridad para reservas: aunque el scheduler valida en
-- memoria, este índice único parcial garantiza que NUNCA existan
-- dos citas activas en el mismo (organización, fecha, hora) —
-- incluso con múltiples instancias del servidor o tras un reinicio.
--
-- Ejecutar una vez en Supabase → SQL Editor.
-- Idempotente: usa IF NOT EXISTS.
-- ============================================================

-- Índice único parcial: solo aplica a citas NO canceladas.
-- (una cita cancelada libera el hueco, por eso se excluye)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
  ON nf_appointments (organization_id, date, time)
  WHERE status <> 'cancelled';

-- NOTA sobre solapamientos parciales:
-- Este índice captura colisiones de hora EXACTA (el caso más común:
-- dos clientes piden "el martes a las 10:00"). Los solapamientos
-- parciales por duración (10:00-10:30 vs 10:15) los sigue cubriendo
-- la validación en memoria del scheduler (_isSlotTaken), que es la
-- fuente de verdad mientras haya una sola instancia.
--
-- Si en el futuro se escala a multi-instancia y se quiere protección
-- total de solapamientos a nivel DB, migrar a un EXCLUDE constraint
-- con tsrange + btree_gist (más pesado, requiere extensión).
