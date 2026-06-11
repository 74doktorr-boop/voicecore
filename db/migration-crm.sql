-- ============================================================
-- NodeFlow — Migración CRM: etiquetas de contacto + tareas del dueño
-- Ejecutar una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================

-- 1. Etiquetas en contactos (VIP, inactivo, nuevo…) — array de texto
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING gin (tags);

-- 2. Tareas/recordatorios del dueño (su agenda personal dentro del CRM)
CREATE TABLE IF NOT EXISTS nf_tasks (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  contact_id text,                 -- opcional: tarea ligada a un cliente
  contact_name text,               -- denormalizado para mostrar sin join
  title text NOT NULL,
  due_date date,                   -- opcional
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_org ON nf_tasks (organization_id, done, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON nf_tasks (contact_id);
