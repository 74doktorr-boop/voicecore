-- ============================================================
-- NodeFlow — Fix RLS en todas las tablas públicas
-- Ejecutar en Supabase SQL Editor para resolver la alerta de seguridad.
-- Fecha: 2026-06-09
-- ============================================================

-- Habilitar RLS en TODAS las tablas del schema public que puedan existir.
-- Usar DO block para no fallar si alguna tabla no existe.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        -- Tablas de sistema de Supabase (no tocar)
        'schema_migrations', 'buckets', 'objects', 'migrations'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    RAISE NOTICE 'RLS enabled on: %', t;
  END LOOP;
END $$;

-- Verificar resultado: mostrar todas las tablas con su estado RLS
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
