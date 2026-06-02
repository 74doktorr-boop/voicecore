-- ============================================================
-- NodeFlow — Security Migration: Row-Level Security completo
-- Ejecutar en Supabase SQL Editor: app.supabase.com
-- ============================================================
-- Estrategia: todas las tablas solo accesibles por service_role
-- (la clave que usa el servidor). El anon key no tiene acceso a nada.
-- ============================================================

-- ─── 1. HABILITAR RLS en tablas que lo tenían desactivado ───────────────────

-- registros: CRÍTICO — datos de clientes (email, teléfono, plan, Stripe IDs)
ALTER TABLE registros ENABLE ROW LEVEL SECURITY;

-- demo_bots: config de bots de demo
ALTER TABLE demo_bots ENABLE ROW LEVEL SECURITY;

-- Lifecycle tables (si existen)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contact_memory')    THEN ALTER TABLE contact_memory    ENABLE ROW LEVEL SECURITY; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'call_summaries')    THEN ALTER TABLE call_summaries    ENABLE ROW LEVEL SECURITY; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_reminders') THEN ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_reminder_config') THEN ALTER TABLE org_reminder_config ENABLE ROW LEVEL SECURITY; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_campaigns')     THEN ALTER TABLE org_campaigns     ENABLE ROW LEVEL SECURITY; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_outbounds') THEN ALTER TABLE scheduled_outbounds ENABLE ROW LEVEL SECURITY; END IF;
END $$;

-- ─── 2. POLÍTICAS: service_role lo puede todo, anon NADA ────────────────────
-- Patrón: USING (true) = sin filtro de filas; WITH CHECK (true) = sin filtro de escritura
-- Solo service_role puede ejecutar estas operaciones.
-- El anon key queda completamente bloqueado por defecto (RLS sin política = deny).

-- organizations
DROP POLICY IF EXISTS "service_role_all" ON organizations;
CREATE POLICY "service_role_all" ON organizations
  TO service_role USING (true) WITH CHECK (true);

-- assistants
DROP POLICY IF EXISTS "service_role_all" ON assistants;
CREATE POLICY "service_role_all" ON assistants
  TO service_role USING (true) WITH CHECK (true);

-- calls
DROP POLICY IF EXISTS "service_role_all" ON calls;
CREATE POLICY "service_role_all" ON calls
  TO service_role USING (true) WITH CHECK (true);

-- appointments
DROP POLICY IF EXISTS "service_role_all" ON appointments;
CREATE POLICY "service_role_all" ON appointments
  TO service_role USING (true) WITH CHECK (true);

-- usage
DROP POLICY IF EXISTS "service_role_all" ON usage;
CREATE POLICY "service_role_all" ON usage
  TO service_role USING (true) WITH CHECK (true);

-- webhooks
DROP POLICY IF EXISTS "service_role_all" ON webhooks;
CREATE POLICY "service_role_all" ON webhooks
  TO service_role USING (true) WITH CHECK (true);

-- registros (CRÍTICO)
DROP POLICY IF EXISTS "service_role_all" ON registros;
CREATE POLICY "service_role_all" ON registros
  TO service_role USING (true) WITH CHECK (true);

-- demo_bots
DROP POLICY IF EXISTS "service_role_all" ON demo_bots;
CREATE POLICY "service_role_all" ON demo_bots
  TO service_role USING (true) WITH CHECK (true);

-- contacts / magic_tokens (ya tenían, por si acaso)
DROP POLICY IF EXISTS "service_role_all" ON contacts;
CREATE POLICY "service_role_all" ON contacts
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all" ON magic_tokens;
CREATE POLICY "service_role_all" ON magic_tokens
  TO service_role USING (true) WITH CHECK (true);

-- webhook_configs
DROP POLICY IF EXISTS "service_role_all" ON webhook_configs;
CREATE POLICY "service_role_all" ON webhook_configs
  TO service_role USING (true) WITH CHECK (true);

-- Lifecycle tables (si existen)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contact_memory') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON contact_memory';
    EXECUTE 'CREATE POLICY "service_role_all" ON contact_memory TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'call_summaries') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON call_summaries';
    EXECUTE 'CREATE POLICY "service_role_all" ON call_summaries TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_reminders') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON scheduled_reminders';
    EXECUTE 'CREATE POLICY "service_role_all" ON scheduled_reminders TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_reminder_config') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON org_reminder_config';
    EXECUTE 'CREATE POLICY "service_role_all" ON org_reminder_config TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org_campaigns') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON org_campaigns';
    EXECUTE 'CREATE POLICY "service_role_all" ON org_campaigns TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_outbounds') THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_all" ON scheduled_outbounds';
    EXECUTE 'CREATE POLICY "service_role_all" ON scheduled_outbounds TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─── 3. VERIFICACIÓN: listar tablas con RLS desactivado ─────────────────────
-- Ejecuta esto después para confirmar que no queda ninguna tabla expuesta:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Resultado esperado: rowsecurity = true en TODAS las filas.
