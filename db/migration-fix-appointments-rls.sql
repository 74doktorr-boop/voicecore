-- ============================================================
-- NodeFlow — FIX DE SEGURIDAD: la política RLS de nf_appointments era PÚBLICA
-- Ejecutar en Supabase → SQL Editor. Idempotente.
--
-- Auditoría de seguridad 2026-07-16 (P0): la política de nf_appointments se creó
-- sin la cláusula `TO service_role`:
--     CREATE POLICY "service_role_all" ON nf_appointments FOR ALL USING (true);
-- En PostgreSQL, una política SIN `TO <rol>` aplica a PUBLIC (anon + authenticated).
-- Con `USING (true)` eso concede acceso TOTAL de lectura/escritura a cualquiera
-- con la anon key de Supabase (que es pública por diseño y PostgREST responde por
-- defecto). Un atacante podía leer/insertar/borrar las citas (teléfono, nombre,
-- fecha) de TODOS los negocios. Es la única política del repo sin `TO service_role`.
--
-- Fix: recrear la política restringida a service_role. El backend usa la SERVICE
-- key (bypasea RLS igualmente), así que la app no cambia; solo se cierra el acceso
-- anónimo. Se asegura además que RLS está habilitado.
-- ============================================================

ALTER TABLE nf_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON nf_appointments;

CREATE POLICY "service_role_all" ON nf_appointments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verificación (opcional): debe listar la política con roles = {service_role}
-- SELECT polname, polroles::regrole[] FROM pg_policy
--   WHERE polrelid = 'nf_appointments'::regclass;
